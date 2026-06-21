import { useSettingsStore } from '../stores/useSettingsStore';

export type DeveloperDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export function isDeveloperDiagnosticsEnabled() {
  return Boolean(useSettingsStore.getState().developerMode);
}

export function logDeveloperDiagnostic(
  location: string,
  payload: Record<string, unknown> = {},
  level: DeveloperDiagnosticLevel = 'debug',
) {
  if (!isDeveloperDiagnosticsEnabled()) return;
  if (typeof console === 'undefined') return;
  const writer = console[level] || console.debug || console.log;
  if (typeof writer !== 'function') return;
  writer.call(console, `[dev:${location}]`, {
    at: new Date().toISOString(),
    ...payload,
  });
}
