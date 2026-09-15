import type { AssistantHtmlRuntimeManifest } from '../../types/assistantArtifact';
import { transformAssistantCssColors, transformAssistantInlineStyles } from './assistantHtmlDarkTheme';

function escapeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function stripUnsafeHtml(source: string, applicationOrigin: string) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(?:iframe|object|embed|base)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed|base)\s*>/gi, '')
    .replace(/<(?:iframe|object|embed|base)\b[^>]*\/?\s*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
    // Keep authored UI handlers. The sandbox gives this document a unique
    // origin and the runtime below blocks application and local-network URLs.
    .replace(/\s+(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (full, name: string, value: string) => {
      return /on(?:error|load|beforeunload|unload)/i.test(name) || /(?:parent|top|document\.cookie|steal)/i.test(value) ? '' : full;
    })
    .replace(/\s+(?:src|href|action|formaction)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
    .replace(/\s+(?:src|href|action|formaction)\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, _quoted: string, doubleQuoted: string, singleQuoted: string) => {
      const value = doubleQuoted || singleQuoted || '';
      return /^https?:\/\//i.test(value) && isBlockedExternalUrl(value, applicationOrigin) ? '' : full;
    })
    .replace(/<input\b([^>]*?)type\s*=\s*["']?(?:file|password)["']?([^>]*)>/gi, '<input$1type="text" disabled$2>');
}

function bodyContent(source: string, applicationOrigin: string) {
  const withoutFence = source.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '');
  const bodyMatch = withoutFence.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return stripUnsafeHtml(bodyMatch?.[1] || withoutFence, applicationOrigin);
}

function isBlockedExternalUrl(value: string, applicationOrigin: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const applicationHost = new URL(applicationOrigin).hostname.toLowerCase();
    return host === applicationHost || host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch {
    return true;
  }
}

function extractLocalScripts(source: string, nonce: string, applicationOrigin: string) {
  return Array.from(source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))
    .flatMap((match) => {
      const attributes = match[0].match(/^<script\b([^>]*)>/i)?.[1] || '';
      const sourceUrl = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      if (sourceUrl) {
        if (!/^https?:\/\//i.test(sourceUrl) || isBlockedExternalUrl(sourceUrl, applicationOrigin)) return [];
        return [`<script nonce="${nonce}" src="${sourceUrl}"></script>`];
      }
      const script = match[1]?.trim() || '';
      if (!script || /\b(?:parent|top|steal|document\.cookie)\b/i.test(script) || /\b(?:new\s+)?Function\s*\(/.test(script)) return [];
      return [`<script nonce="${nonce}">${script}</script>`];
    })
    .join('');
}

function safeStyleContent(source: string) {
  return Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))
    .map((match) => match[1] || '')
    .join('\n')
    .replace(/url\s*\(\s*["']?javascript:[^)]+\)/gi, 'none');
}

export function buildAssistantHtmlDocument(params: {
  html: string;
  manifest: AssistantHtmlRuntimeManifest;
  channelToken: string;
  artifactId: string;
  versionId: string;
  interactionState?: Record<string, unknown>;
  readOnly?: boolean;
  displayMode?: 'light' | 'dark';
  applicationOrigin?: string;
}) {
  const hasNativeThemeContract = /--pneumata-(?:bg|surface|text|muted|border|accent)\s*:/iu.test(params.html)
    && /html\s*\[\s*data-pneumata-theme\s*=\s*["']light["']/iu.test(params.html)
    && /html\s*\[\s*data-pneumata-theme\s*=\s*["']dark["']/iu.test(params.html)
    && /prefers-color-scheme\s*:\s*dark/iu.test(params.html);
  const shouldConvertLegacyTheme = !hasNativeThemeContract && params.displayMode === 'dark';
  // CSP nonce-source accepts a base64 token; channel tokens contain prefixes
  // and punctuation that some browsers reject silently.
  const nonce = params.channelToken.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'pneumataNonce';
  const runtimeConfig = {
    channelToken: params.channelToken,
    artifactId: params.artifactId,
    versionId: params.versionId,
    interactionId: params.manifest.submission?.interactionId || '',
    fields: params.manifest.submission?.fields || [],
    initialState: params.interactionState || {},
    autosaveDebounceMs: params.manifest.autosave?.debounceMs || 900,
    readOnly: params.readOnly === true,
    displayMode: params.displayMode || 'light',
    hasNativeThemeContract,
    applicationOrigin: params.applicationOrigin || 'https://pneumata.invalid',
  };
const runtime = `(function(){
const config=${escapeScriptJson(runtimeConfig)};
const send=(type,payload)=>parent.postMessage({type,channelToken:config.channelToken,artifactId:config.artifactId,versionId:config.versionId,interactionId:config.interactionId,...payload},'*');
const blockedNetworkUrl=(value)=>{try{const raw=String(value||'').trim();if(!/^https?:\\/\\//i.test(raw))return true;const url=new URL(raw);const host=url.hostname.toLowerCase();const appHost=new URL(config.applicationOrigin).hostname.toLowerCase();return host===appHost||host==='localhost'||host==='127.0.0.1'||host==='::1'||/^127\\./.test(host)||/^10\\./.test(host)||/^192\\.168\\./.test(host)||/^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(host);}catch{return true;}};
const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);if(blockedNetworkUrl(url))return Promise.reject(new Error('已阻止访问应用或本地网络地址'));return nativeFetch(input,init);};
const nativeOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...rest){if(blockedNetworkUrl(url))throw new Error('已阻止访问应用或本地网络地址');return nativeOpen.call(this,method,url,...rest);};
const NativeWebSocket=window.WebSocket;window.WebSocket=function(url,...rest){if(blockedNetworkUrl(String(url).replace(/^ws/i,'http')))throw new Error('已阻止访问应用或本地网络地址');return new NativeWebSocket(url,...rest);};
const controls=()=>Array.from(document.querySelectorAll('input[name],select[name],textarea[name]'));
const read=()=>{const result=Object.create(null);for(const field of config.fields){const nodes=controls().filter((node)=>node.name===field.name);if(field.type==='boolean'){result[field.name]=Boolean(nodes[0]&&nodes[0].checked);}else if(field.type==='multi_choice'){result[field.name]=nodes.filter((node)=>node.checked).map((node)=>node.value);}else if(nodes[0]){result[field.name]=nodes[0].value;}}return result;};
const restore=()=>{for(const field of config.fields){const value=config.initialState[field.name];for(const node of controls().filter((item)=>item.name===field.name)){if(field.type==='boolean'){node.checked=Boolean(value);}else if(field.type==='multi_choice'){node.checked=Array.isArray(value)&&value.includes(node.value);}else if(value!==undefined&&value!==null){node.value=String(value);}}}};
const applyDisplayMode=()=>{if(!config.hasNativeThemeContract)return;document.documentElement.style.colorScheme=config.displayMode;document.documentElement.setAttribute('data-pneumata-theme',config.displayMode);};
let timer=0;const autosave=()=>{clearTimeout(timer);timer=setTimeout(()=>send('autosave',{payload:read()}),config.autosaveDebounceMs);};
// Read-only versions still need their own UI (tabs, choices, explanations)
// to work. Read-only only prevents bridge writes below; it must not disable
// every button in the authored document.
if(!config.readOnly){document.addEventListener('input',autosave);document.addEventListener('change',autosave);}
document.addEventListener('click',(event)=>{const node=event.target;const target=node instanceof Element?node.closest('[data-pneumata-action]'):null;if(!target)return;const action=target.getAttribute('data-pneumata-action');if(action==='open_fullscreen'){event.preventDefault();send('open_fullscreen',{});return;}if(config.readOnly)return;if(action==='save'){event.preventDefault();send('autosave',{payload:read()});}else if(action==='submit'){event.preventDefault();send('submit',{payload:read()});}else if(action==='close'){event.preventDefault();send('close',{});}else if(action==='reset'){event.preventDefault();for(const form of document.forms)form.reset();autosave();}});
document.addEventListener('submit',(event)=>{event.preventDefault();if(!config.readOnly)send('submit',{payload:read()});});
const report=()=>send('resize',{height:Math.min(Math.max(document.documentElement.scrollHeight,160),1600)});if(typeof ResizeObserver==='function')new ResizeObserver(report).observe(document.documentElement);else window.addEventListener('resize',report);
const describeError=(kind,error,source,line,column)=>{const message=error instanceof Error?error.message:String(error||'HTML运行时错误');const stack=error instanceof Error?error.stack:'';send('error',{error:message,errorInfo:{kind,message,stack:stack||'',source:source||'',line:Number(line)||0,column:Number(column)||0}});};
window.addEventListener('error',(event)=>{if(event.target&&event.target!==window){const target=event.target;describeError('resource',target.tagName+'资源加载失败',target.src||target.href||'',0,0);return;}describeError('runtime',event.error||event.message,event.filename,event.lineno,event.colno);},true);
window.addEventListener('unhandledrejection',(event)=>describeError('unhandledrejection',event.reason,'',0,0));
const originalConsoleError=console.error.bind(console);console.error=(...args)=>{originalConsoleError(...args);describeError('console',args.map((item)=>typeof item==='string'?item:(item&&item.message)||String(item)).join(' '),'',0,0);};
restore();applyDisplayMode();report();send('ready',{height:document.documentElement.scrollHeight});})();`;
  const styles = shouldConvertLegacyTheme ? transformAssistantCssColors(safeStyleContent(params.html)) : safeStyleContent(params.html);
  const displayStyles = hasNativeThemeContract && params.displayMode ? `html{color-scheme:${params.displayMode}}` : '';
  const body = bodyContent(params.html, runtimeConfig.applicationOrigin).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const userScripts = extractLocalScripts(params.html, nonce, runtimeConfig.applicationOrigin);
  const transformedBody = shouldConvertLegacyTheme ? transformAssistantInlineStyles(body) : body;
  // Install the bridge first so errors from authored scripts are observable,
  // then run the authored scripts after the DOM has been created.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' http: https:; img-src data: blob: http: https:; font-src data: http: https:; script-src 'nonce-${nonce}' http: https:; connect-src http: https:; form-action http: https:; frame-src 'none'; object-src 'none'; base-uri 'none'"><style>html,body{margin:0;padding:0;background:transparent;color:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}button,input,select,textarea{font:inherit}${styles}${displayStyles}</style></head><body>${transformedBody}<script nonce="${nonce}">${runtime}</script>${userScripts}</body></html>`;
}
