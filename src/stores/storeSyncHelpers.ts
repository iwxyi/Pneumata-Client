import { useAuthStore } from './useAuthStore';
import type { SyncPatchOperation } from '../services/syncProjector';
import { isCloudSyncEnabled } from '../services/cloudSyncPreference';

export function isLocalOnlyMode() {
  return useAuthStore.getState().authMode === 'local';
}

export function shouldSkipCloudSync() {
  return isLocalOnlyMode() || !isCloudSyncEnabled();
}

export function canAttemptOnlineSync() {
  return !shouldSkipCloudSync() && (typeof navigator === 'undefined' || navigator.onLine);
}

export function classifySyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|登录已过期|未登录/i.test(message)) return `auth: ${message}`;
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) return `network: ${message}`;
  if (/500|502|503|504|服务器错误/i.test(message)) return `server_unavailable: ${message}`;
  if (/404|不存在|未删除/i.test(message)) return `conflict_ignored: ${message}`;
  return `validation: ${message}`;
}

export function latestSyncError<T extends { lastError?: string }>(queue: T[]) {
  return [...queue].reverse().find((item) => item.lastError)?.lastError || null;
}

function createOperationId(kind: string, timestamp: number, targetIds: string[]) {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  return `${kind}-${timestamp}-${targetIds[0] || 'all'}-${randomId}`;
}

export function createPendingOperation<TPatch extends Record<string, unknown>, TOp extends SyncPatchOperation<TPatch> & { kind: string; targetIds: string[] }>(
  params: {
    kind: TOp['kind'];
    targetIds?: string[];
    patch?: TPatch;
    timestamp?: number;
  }
): TOp {
  const timestamp = params.timestamp ?? Date.now();
  const targetIds = params.targetIds ?? [];
  return {
    id: createOperationId(String(params.kind), timestamp, targetIds),
    kind: params.kind,
    entityId: targetIds[0] || '',
    patch: (params.patch || {}) as TPatch,
    targetIds,
    clientTimestamp: timestamp,
    attemptCount: 0,
    status: 'pending',
    lastError: undefined,
  } as TOp;
}

export function removePendingOperation<T extends { id: string }>(queue: T[], operationId: string) {
  return queue.filter((item) => item.id !== operationId);
}

export function updatePendingOperation<T extends { id: string }>(queue: T[], operationId: string, patch: Partial<T>) {
  return queue.map((item) => item.id === operationId ? { ...item, ...patch } : item);
}

export function recoverInterruptedOperations<T extends { status: 'pending' | 'syncing' | 'failed'; lastError?: string }>(queue: T[] = []) {
  return queue.map((item) => item.status === 'syncing'
    ? {
      ...item,
      status: 'pending' as const,
      lastError: item.lastError || 'network: 上次同步中断，已重新排队',
    }
    : item);
}
