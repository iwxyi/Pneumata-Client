const warnedKeys = new Set<string>();

export const APP_DIAGNOSTIC_TOAST_EVENT = 'pneumata:diagnostic-toast';

export type DiagnosticToastSeverity = 'warning' | 'error' | 'success' | 'info';

export interface DiagnosticToastDetail {
  message: string;
  severity: DiagnosticToastSeverity;
  location?: string;
}

function shouldWarnUnresolvedId(id: string) {
  return id.length >= 8 || /^[0-9a-f-]{18,}$/i.test(id) || id.includes(':') || id.includes('-');
}

function warnOnce(key: string, message: string, details?: Record<string, unknown>) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(message, details || {});
  }
}

export function reportUnresolvedDisplayEntity(params: {
  id?: string | null;
  kind: 'character' | 'member' | 'participant' | 'relationship-target';
  location: string;
  fallback: string;
  extra?: Record<string, unknown>;
}) {
  const id = String(params.id || '').trim();
  if (!id) return;
  if (!shouldWarnUnresolvedId(id)) return;
  warnOnce(
    `unresolved-display-entity:${params.location}:${params.kind}:${id}`,
    `[display] unresolved ${params.kind}; using fallback "${params.fallback}"`,
    {
      id,
      kind: params.kind,
      location: params.location,
      fallback: params.fallback,
      ...(params.extra || {}),
    },
  );
}

export function notifyDiagnosticToast(detail: DiagnosticToastDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<DiagnosticToastDetail>(APP_DIAGNOSTIC_TOAST_EVENT, { detail }));
}

export function reportRecoverableError(params: {
  location: string;
  error: unknown;
  userMessage: string;
  extra?: Record<string, unknown>;
}) {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`[recoverable] ${params.location}`, {
      error: params.error,
      userMessage: params.userMessage,
      ...(params.extra || {}),
    });
  }
  notifyDiagnosticToast({ message: params.userMessage, severity: 'error', location: params.location });
}

export function reportRecoverableWarning(params: {
  location: string;
  error?: unknown;
  message: string;
  extra?: Record<string, unknown>;
}) {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[recoverable-warning] ${params.location}`, {
      error: params.error,
      message: params.message,
      ...(params.extra || {}),
    });
  }
}

export function reportUnhandledError(location: string, error: unknown, extra?: Record<string, unknown>): never {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`[unhandled] ${location}`, { error, ...(extra || {}) });
  }
  notifyDiagnosticToast({ message: '有一个环节出错了，请查看控制台详情。', severity: 'error', location });
  throw error;
}
