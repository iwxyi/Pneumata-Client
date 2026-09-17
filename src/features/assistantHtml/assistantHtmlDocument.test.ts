import { describe, expect, it } from 'vitest';
import { buildAssistantHtmlDocument } from './assistantHtmlDocument';
import { modifyAssistantCssColor, transformAssistantCssColors } from './assistantHtmlDarkTheme';

const manifest = { schemaVersion: 1, presentation: 'fullscreen', executionMode: 'declarative' } as const;

function build(displayMode: 'light' | 'dark') {
  return buildAssistantHtmlDocument({
    html: '<style>.card{background:#fff;color:#111}</style><div class="card">原始内容</div>',
    manifest,
    channelToken: 'test-channel',
    artifactId: 'artifact-1',
    versionId: 'version-1',
    displayMode,
  });
}

describe('assistant HTML viewer display mode', () => {
  it('preserves authored interaction scripts and runs the bridge before them', () => {
    const document = buildAssistantHtmlDocument({
      html: '<button class="choice">A</button><div id="result"></div><script>document.querySelector(".choice")?.addEventListener("click",()=>{document.querySelector("#result").textContent="选中"});</script>',
      manifest,
      channelToken: 'script-channel',
      artifactId: 'artifact-script',
      versionId: 'version-script',
    });
    expect(document).toContain('addEventListener("click"');
    const bridgeIndex = document.indexOf('parent.postMessage');
    const authoredIndex = document.lastIndexOf('addEventListener("click"');
    expect(bridgeIndex).toBeLessThan(authoredIndex);
    expect(document).toContain('<script>');
  });

  it('does not confuse ordinary function declarations with the Function constructor', () => {
    const document = buildAssistantHtmlDocument({
      html: `<button class="section-btn" data-section="writing">写作</button>
        <div id="recommendation" class="hidden"></div>
        <script>(function(){
          function selectSection(section) {
            document.querySelector('#recommendation').textContent = section;
            document.querySelector('#recommendation').classList.remove('hidden');
          }
          document.querySelector('.section-btn').addEventListener('click', function(){ selectSection(this.dataset.section); });
        })();</script>`,
      manifest,
      channelToken: 'function-channel',
      artifactId: 'artifact-function',
      versionId: 'version-function',
    });
    expect(document).toContain('function selectSection(section)');
    expect(document).toContain("classList.remove('hidden')");
  });

  it('preserves dynamic code used by ordinary browser mini-apps', () => {
    const document = buildAssistantHtmlDocument({
      html: '<script>const run = new Function("return 1"); run();</script>',
      manifest,
      channelToken: 'constructor-channel',
      artifactId: 'artifact-constructor',
      versionId: 'version-constructor',
    });
    expect(document).toContain('new Function');
  });

  it('preserves safe inline button handlers for authored quizzes', () => {
    const document = buildAssistantHtmlDocument({
      html: '<button onclick="this.textContent=\'已选择\'">选择</button>',
      manifest,
      channelToken: 'handler-channel',
      artifactId: 'artifact-handler',
      versionId: 'version-handler',
    });
    expect(document).toContain('onclick="this.textContent=\'已选择\'"');
  });

  it('preserves authored legacy HTML in dark mode', () => {
    const document = build('dark');
    expect(document).toContain('.card{background:#fff;color:#111}');
    expect(document).toContain('displayMode":"dark"');
    expect(document).toContain('applyDisplayMode()');
    expect(document).not.toContain('setViewerColor');
  });

  it('keeps the original HTML available in light mode', () => {
    const document = build('light');
    expect(document).toContain('.card{background:#fff;color:#111}');
    expect(document).toContain('<div class="card">原始内容</div>');
    expect(document).toContain('displayMode":"light"');
  });

  it('uses role-aware Dark Reader-derived static conversion for legacy colors', () => {
    expect(modifyAssistantCssColor('#111827', 'foreground')).toBe('#d4d9dd');
    expect(modifyAssistantCssColor('#ffffff', 'background')).toBe('#111318');
    expect(modifyAssistantCssColor('rgba(250, 255, 189, 0.5)', 'background')).toMatch(/^#[0-9a-f]{8}$/i);
    expect(transformAssistantCssColors('.card{background:#fff;color:#111827;border:1px solid #e5e7eb}')).toContain('background:#111318');
  });

  it('keeps native theme contracts intact', () => {
    const document = buildAssistantHtmlDocument({
      html: '<style>:root,html[data-pneumata-theme="light"]{--pneumata-bg:#fff}html[data-pneumata-theme="dark"]{--pneumata-bg:#111}@media (prefers-color-scheme:dark){:root{--pneumata-bg:#111}}body{background:var(--pneumata-bg)}</style><div>主题内容</div>',
      manifest,
      channelToken: 'native-theme',
      artifactId: 'artifact-theme',
      versionId: 'version-theme',
      displayMode: 'dark',
    });
    expect(document).toContain('hasNativeThemeContract":true');
    expect(document).toContain("setAttribute('data-pneumata-theme',config.displayMode)");
    expect(document).toContain('if(!config.hasNativeThemeContract)return');
  });

  it('does not rewrite incomplete native theme contracts', () => {
    const document = buildAssistantHtmlDocument({
      html: '<style>:root{--pneumata-bg:#fff}html[data-pneumata-theme="dark"]{--pneumata-bg:#111}</style><div>不完整主题</div>',
      manifest,
      channelToken: 'incomplete-theme',
      artifactId: 'artifact-incomplete',
      versionId: 'version-incomplete',
      displayMode: 'dark',
    });
    expect(document).toContain('hasNativeThemeContract":false');
    expect(document).toContain('--pneumata-bg:#fff');
  });

  it('keeps canvas, SVG, iframe and external scripts in the authored document', () => {
    const document = buildAssistantHtmlDocument({
      html: '<!doctype html><html><head><script src="https://cdn.example.test/game.js"></script></head><body><canvas id="board"></canvas><svg><path d="M0 0" /></svg><iframe src="https://example.test"></iframe><script>const topRow=[];document.querySelector("#board").getContext("2d");</script></body></html>',
      manifest,
      channelToken: 'canvas-channel',
      artifactId: 'artifact-canvas',
      versionId: 'version-canvas',
    });
    expect(document).toContain('<canvas id="board"></canvas>');
    expect(document).toContain('<svg><path d="M0 0" /></svg>');
    expect(document).toContain('<iframe src="https://example.test"></iframe>');
    expect(document).toContain('src="https://cdn.example.test/game.js"');
    expect(document).toContain('const topRow=[]');
    expect(document.indexOf('parent.postMessage')).toBeLessThan(document.indexOf('src="https://cdn.example.test/game.js"'));
  });

  it('reports handled page failures that only appear in visible status text', () => {
    const document = buildAssistantHtmlDocument({
      html: '<p>关卡生成失败，请点击重玩本关再试一次。</p>',
      manifest,
      channelToken: 'page-state-channel',
      artifactId: 'artifact-page-state',
      versionId: 'version-page-state',
    });
    expect(document).toContain('window.pneumataReportError=reportAuthoredError');
    expect(document).toContain('页面可见状态');
    expect(document).toContain('page_state');
    expect(document).toContain('MutationObserver');
    expect(document).toContain('replace(/\\s+/g');
    expect(document).toContain('[^。！？\\n]');
  });

  it('keeps historical runtime errors visible without repeating them in the console', () => {
    const document = buildAssistantHtmlDocument({
      html: '<script>console.error("historical failure")</script>',
      manifest,
      channelToken: 'historical-error-channel',
      artifactId: 'artifact-history',
      versionId: 'version-history',
      readOnly: true,
    });
    expect(document).toContain('"quietRuntimeErrors":true');
    expect(document).toContain('if(!config.quietRuntimeErrors)originalConsoleError(...args)');
    expect(document).toContain('if(config.quietRuntimeErrors)event.preventDefault()');
    expect(document).toContain("describeError('console'");
  });

});
