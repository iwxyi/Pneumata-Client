import { localOutboxRepository } from './localOutboxDb';
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

export function markLocalOutboxWorkerOperation(operation: LocalOutboxWorkerOperationLike) {
  void localOutboxRepository.markStatus(localOutboxStorageKey(), operation.id, {
    status: operation.status === 'running' ? 'syncing' : operation.status,
    attemptCount: operation.attemptCount || 0,
    lastError: operation.lastError || null,
    retryAt: operation.retryAt || 0,
    lockedAt: operation.lockedAt || 0,
  }).catch((error) => {
    console.warn('[local-outbox] failed to mark operation', error);
  });
}
