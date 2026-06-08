import { notifyDiagnosticToast } from './diagnostics';

export const PERSISTENCE_HEALTH_EVENT = 'pneumata:persistence-health-changed';

export type PersistenceFailureReason = 'quota_exceeded' | 'write_failed';

export interface PersistenceFailureSnapshot {
  id: string;
  name: string;
  reason: PersistenceFailureReason;
  message: string;
  at: number;
  sizeBytes?: number;
}

const failures: PersistenceFailureSnapshot[] = [];
const MAX_FAILURES = 12;
const toastLastShownAt = new Map<string, number>();

function estimateSizeBytes(value: string) {
  if (typeof Blob !== 'undefined') return new Blob([value]).size;
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return value.length;
}

function emitPersistenceHealthChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PERSISTENCE_HEALTH_EVENT, { detail: readPersistenceHealth() }));
}

export function recordPersistenceFailure(params: {
  name: string;
  reason: PersistenceFailureReason;
  error: unknown;
  serializedValue?: string;
}) {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const snapshot: PersistenceFailureSnapshot = {
    id: `${params.name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    name: params.name,
    reason: params.reason,
    message,
    at: Date.now(),
    sizeBytes: params.serializedValue ? estimateSizeBytes(params.serializedValue) : undefined,
  };
  failures.unshift(snapshot);
  failures.splice(MAX_FAILURES);

  const lastToastAt = toastLastShownAt.get(params.name) || 0;
  if (Date.now() - lastToastAt > 30_000) {
    toastLastShownAt.set(params.name, Date.now());
    notifyDiagnosticToast({
      severity: 'error',
      location: 'storage:persistence',
      message: params.reason === 'quota_exceeded'
        ? '本地存储空间不足，部分最新数据可能没有保存。请到同步详情页查看。'
        : '本地数据保存失败，部分最新数据可能没有保存。请到同步详情页查看。',
    });
  }
  emitPersistenceHealthChanged();
}

export function readPersistenceHealth() {
  return {
    failures: [...failures],
    latestFailure: failures[0] || null,
  };
}

export function clearPersistenceFailures() {
  failures.length = 0;
  emitPersistenceHealthChanged();
}
