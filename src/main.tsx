import { createRoot } from 'react-dom/client';
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';

// This entry module is intentionally not a Fast Refresh boundary.
/* eslint-disable react-refresh/only-export-components */

const style = document.createElement('style');
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #root { height: 100%; width: 100%; }
`;
document.head.appendChild(style);

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[pneumata] application render failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: '100%', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#333' }}>
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>页面加载失败</h1>
          <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#666' }}>
            {this.state.error.message || '应用初始化时发生未知错误'}
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 14px' }}>
            重新加载
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

function StartupLoading({ onRetry }: { onRetry: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <main style={{ minHeight: '100%', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#666' }}>
      <div>正在加载应用模块…</div>
      {elapsed >= 10000 ? (
        <>
          <p style={{ marginTop: 12, color: '#8a5a00' }}>模块加载时间过长，可能是远程开发服务器的旧模块缓存未失效。</p>
          <button type="button" onClick={onRetry} style={{ marginTop: 16, padding: '8px 14px' }}>重新加载</button>
        </>
      ) : null}
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StartupErrorBoundary>
    <StartupLoading onRetry={() => window.location.reload()} />
  </StartupErrorBoundary>,
);

const appLoad = import('./App');
const appTimeout = window.setTimeout(() => {
  console.error('[pneumata] application module load exceeded 15 seconds');
}, 15000);
void appLoad.then(({ default: App }) => {
  window.clearTimeout(appTimeout);
  void import('./services/diagnosticsBootstrap').catch((error) => {
    console.warn('[pneumata] diagnostics bootstrap unavailable', error);
  });
  root.render(
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>,
  );
}).catch((error: unknown) => {
  const startupError = error instanceof Error ? error : new Error(String(error));
  root.render(
    <StartupErrorBoundary>
      <main style={{ minHeight: '100%', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#333' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>页面加载失败</h1>
        <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#666' }}>{startupError.message}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 14px' }}>重新加载</button>
      </main>
    </StartupErrorBoundary>,
  );
});
/* eslint-enable react-refresh/only-export-components */
