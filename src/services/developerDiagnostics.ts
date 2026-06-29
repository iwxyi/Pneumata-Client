import { useSettingsStore } from '../stores/useSettingsStore';

export type DeveloperDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

const DIAGNOSTIC_SCOPE_STORAGE_KEY = 'miragetea:developer-diagnostic-scopes';

export function isDeveloperDiagnosticsEnabled() {
  return Boolean(useSettingsStore.getState().developerMode);
}

function parseDiagnosticScopes(raw: string | null) {
  return new Set((raw || '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean));
}

export function isDeveloperDiagnosticScopeEnabled(scope?: string) {
  if (!isDeveloperDiagnosticsEnabled()) return false;
  if (!scope) return true;
  if (typeof localStorage === 'undefined') return true;
  const scopes = parseDiagnosticScopes(localStorage.getItem(DIAGNOSTIC_SCOPE_STORAGE_KEY));
  return scopes.size === 0 || scopes.has('*') || scopes.has(scope);
}

export function logDeveloperDiagnostic(
  location: string,
  payload: Record<string, unknown> = {},
  level: DeveloperDiagnosticLevel = 'debug',
  scope?: string,
) {
  if (!isDeveloperDiagnosticScopeEnabled(scope)) return;
  if (typeof console === 'undefined') return;
  const writer = console[level] || console.debug || console.log;
  if (typeof writer !== 'function') return;
  writer.call(console, `[dev:${location}]`, {
    at: new Date().toISOString(),
    ...payload,
  });
}

export function measureDeveloperDiagnostic<T>(
  location: string,
  run: () => T,
  payload: Record<string, unknown> = {},
  scope?: string,
  warnThresholdMs = 16,
) {
  if (!isDeveloperDiagnosticScopeEnabled(scope) || typeof performance === 'undefined') return run();
  const startedAt = performance.now();
  try {
    return run();
  } finally {
    const durationMs = performance.now() - startedAt;
    logDeveloperDiagnostic(location, {
      ...payload,
      durationMs: Number(durationMs.toFixed(2)),
    }, durationMs >= warnThresholdMs ? 'info' : 'debug', scope);
  }
}
