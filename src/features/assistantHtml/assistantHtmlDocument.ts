import type { AssistantHtmlRuntimeManifest } from '../../types/assistantArtifact';

function escapeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function injectRuntime(source: string, runtime: string) {
  const script = `<script>${runtime}</script>`;
  if (/<head\b[^>]*>/i.test(source)) return source.replace(/(<head\b[^>]*>)/i, `$1${script}`);
  if (/<html\b[^>]*>/i.test(source)) return source.replace(/(<html\b[^>]*>)/i, `$1<head>${script}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${script}</head><body>${source}</body></html>`;
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
  const source = params.html.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '');
  const hasNativeThemeContract = /--pneumata-(?:bg|surface|text|muted|border|accent)\s*:/iu.test(source)
    && /html\s*\[\s*data-pneumata-theme\s*=\s*["']light["']/iu.test(source)
    && /html\s*\[\s*data-pneumata-theme\s*=\s*["']dark["']/iu.test(source)
    && /prefers-color-scheme\s*:\s*dark/iu.test(source);
  const runtimeConfig = {
    channelToken: params.channelToken,
    artifactId: params.artifactId,
    versionId: params.versionId,
    interactionId: params.manifest.submission?.interactionId || '',
    fields: params.manifest.submission?.fields || [],
    initialState: params.interactionState || {},
    autosaveDebounceMs: params.manifest.autosave?.debounceMs || 900,
    readOnly: params.readOnly === true,
    quietRuntimeErrors: params.readOnly === true,
    displayMode: params.displayMode || 'light',
    hasNativeThemeContract,
    applicationOrigin: params.applicationOrigin || 'https://pneumata.invalid',
  };
const runtime = `(function(){
const config=${escapeScriptJson(runtimeConfig)};
let hostReady=false;const pending=[];const post=(packet)=>parent.postMessage(packet,'*');
const send=(type,payload)=>{const packet={type,channelToken:config.channelToken,artifactId:config.artifactId,versionId:config.versionId,interactionId:config.interactionId,...payload};if(hostReady){post(packet);return;}if(type==='resize'){const index=pending.findIndex((item)=>item.type==='resize');if(index>=0)pending.splice(index,1);}pending.push(packet);if(pending.length>32)pending.splice(0,pending.length-32);};
window.addEventListener('message',(event)=>{const data=event.data;if(event.source!==parent||!data||data.type!=='host_ready'||data.channelToken!==config.channelToken||data.artifactId!==config.artifactId||data.versionId!==config.versionId)return;hostReady=true;while(pending.length)post(pending.shift());});
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
const normalizeReason=(reason,fallback)=>{if(reason instanceof Error)return reason;try{if(reason&&typeof reason==='object'){const error=new Error(typeof reason.message==='string'?reason.message:JSON.stringify(reason));if(typeof reason.name==='string')error.name=reason.name;if(typeof reason.stack==='string')error.stack=reason.stack;return error;}}catch{}return new Error(String(reason||fallback||'HTML运行时错误'));};
const describeError=(kind,error,source,line,column)=>{const normalized=normalizeReason(error);send('error',{error:normalized.message,errorInfo:{kind,message:normalized.message,stack:normalized.stack||'',source:source||'',line:Number(line)||0,column:Number(column)||0}});};
window.addEventListener('error',(event)=>{if(config.quietRuntimeErrors)event.preventDefault();if(event.target&&event.target!==window){const target=event.target;describeError('resource',target.tagName+'资源加载失败',target.src||target.href||'',0,0);return;}describeError('runtime',event.error||event.message,event.filename,event.lineno,event.colno);},true);
window.addEventListener('unhandledrejection',(event)=>{if(config.quietRuntimeErrors)event.preventDefault();describeError('unhandledrejection',event.reason,'',0,0);});
try{const originalConsoleError=console.error.bind(console);console.error=(...args)=>{if(!config.quietRuntimeErrors)originalConsoleError(...args);const original=args.find((item)=>item instanceof Error);const message=args.map((item)=>typeof item==='string'?item:(item&&item.message)||String(item)).join(' ');send('error',{error:message,errorInfo:{kind:'console',message,stack:original&&original.stack||'',source:'console.error',line:0,column:0}});};}catch(error){describeError('runtime',error,'',0,0);}
const reportAuthoredError=(error,context)=>{const normalized=normalizeReason(error,'页面运行失败');send('error',{error:normalized.message,errorInfo:{kind:'runtime',message:normalized.message,stack:normalized.stack||'',source:context?'页面主动上报：'+String(context).slice(0,160):'页面主动上报',line:0,column:0}});};
window.pneumataReportError=reportAuthoredError;
const initialize=()=>{try{restore();applyDisplayMode();report();send('ready',{height:document.documentElement.scrollHeight});}catch(error){describeError('runtime',error,'运行时初始化',0,0);}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();})();`;
  // Keep the authored document intact. This must stay a minimal wrapper so
  // third-party libraries, canvas apps and normal browser APIs behave exactly
  // as they do in a standalone HTML file.
  return injectRuntime(source, runtime);
}
