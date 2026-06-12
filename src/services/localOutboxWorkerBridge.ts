import { localOutboxRepository, type LocalOutboxRecord } from './localOutboxDb';
import { localOutboxStorageKey, mirrorLocalOutboxSourceQueue } from './localOutboxMirror';
import type {
  LocalOutboxArtifactJobLike,
  LocalOutboxMessageOperationLike,
  LocalOutboxPatchOperationLike,
  LocalOutboxScopeType,
  LocalOutboxStatus,
} from './localOutboxProjection';

export interface LocalOutboxWorkerOperationLike {
  id: string;
  status: LocalOutboxStatus | 'running';
  attemptCount?: number;
  lastError?: string | null;
  retryAt?: number;
  lockedAt?: number;
}

export interface LocalOutboxHistoryEntry extends LocalOutboxRecord {}

function sourceInput(sourceType: LocalOutboxScopeType, operations: unknown[]) {
  if (sourceType === 'character') return { characterOperations: operations as LocalOutboxPatchOperationLike[] };
  if (sourceType === 'chat') return { chatOperations: operations as LocalOutboxPatchOperationLike[] };
  if (sourceType === 'message') return { messageOperations: operations as LocalOutboxMessageOperationLike[] };
  return { artifactJobs: operations as LocalOutboxArtifactJobLike[] };
}

export async function mirrorLocalOutboxWorkerQueue(sourceType: LocalOutboxScopeType, operations: unknown[]) {
  try {
    await mirrorLocalOutboxSourceQueue(sourceType, sourceInput(sourceType, operations));
  } catch (error) {
    console.warn(`[local-outbox] failed to mirror ${sourceType} queue`, error);
  }
}

export function removeLocalOutboxWorkerOperation(operationId: string) {
  void localOutboxRepository.remove(localOutboxStorageKey(), [operationId]).catch((error) => {
    console.warn('[local-outbox] failed to remove operation', error);
  });
}

export function completeLocalOutboxWorkerOperation(operationId: string) {
  void localOutboxRepository.markStatus(localOutboxStorageKey(), operationId, {
    status: 'succeeded',
    lastError: null,
    retryAt: 0,
    lockedAt: 0,
  }).then(() => trimLocalOutboxHistory()).catch((error) => {
    console.warn('[local-outbox] failed to complete operation', error);
  });
}

export function markLocalOutboxWorkerOperation(operation: LocalOutboxWorkerOperationLike) {
  void localOutboxRepository.markStatus(localOutboxStorageKey(), operation.id, {
    status: operation.status === 'running' ? 'syncing' : operation.status,
    attemptCount: operation.attemptCount || 0,
    lastError: operation.lastError || null,
    retryAt: operation.retryAt || 0,
    lockedAt: operation.lockedAt || 0,
  }).then(() => {
    if (operation.status === 'failed') return trimLocalOutboxHistory();
    return null;
  }).catch((error) => {
    console.warn('[local-outbox] failed to mark operation', error);
  });
}

export async function listLocalOutboxHistory(options: { limit?: number; offset?: number } = {}) {
  const records = await localOutboxRepository.list(localOutboxStorageKey());
  const history = records
    .filter((record) => record.status === 'failed' || record.status === 'succeeded')
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const offset = Math.max(0, options.offset || 0);
  const limit = Math.max(1, options.limit || 50);
  return {
    items: history.slice(offset, offset + limit),
    total: history.length,
    succeededTotal: history.filter((record) => record.status === 'succeeded').length,
    failedTotal: history.filter((record) => record.status === 'failed').length,
    hasMore: offset + limit < history.length,
  };
}

async function trimLocalOutboxHistory(limit = 1000) {
  const records = await localOutboxRepository.list(localOutboxStorageKey());
  const overflow = records
    .filter((record) => record.status === 'failed' || record.status === 'succeeded')
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(limit);
  if (!overflow.length) return 0;
  await localOutboxRepository.remove(localOutboxStorageKey(), overflow.map((record) => record.id));
  return overflow.length;
}

export async function clearLocalOutboxHistory() {
  const records = await localOutboxRepository.list(localOutboxStorageKey());
  const ids = records
    .filter((record) => record.status === 'failed' || record.status === 'succeeded')
    .map((record) => record.id);
  if (!ids.length) return 0;
  await localOutboxRepository.remove(localOutboxStorageKey(), ids);
  return ids.length;
}
