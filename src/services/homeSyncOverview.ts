import type { SyncScopeSnapshot } from '../stores/syncScopeMetadata';

export interface HomeSyncOperationLike {
  status?: string | null;
}

export interface HomeSyncWorkerEntryLike {
  id: string;
  priority: number;
  delay: number;
}

export interface HomeSyncOverviewInput {
  cloudSyncAvailable: boolean;
  cloudSyncEnabled: boolean;
  operations: HomeSyncOperationLike[];
  artifactJobs: HomeSyncOperationLike[];
  syncScopes: SyncScopeSnapshot[];
  workerEntries: HomeSyncWorkerEntryLike[];
}

export interface HomeSyncOverview {
  cloudSyncAvailable: boolean;
  cloudSyncEnabled: boolean;
  uploading: number;
  pendingUpload: number;
  failedUpload: number;
  checkingDownloads: number;
  backoffScopes: number;
  failedScopes: number;
  checkedScopes: number;
  registeredWorkers: number;
  activeWorkers: HomeSyncWorkerEntryLike[];
  severity: 'idle' | 'syncing' | 'attention' | 'off';
}

function isRunningStatus(status: string | null | undefined) {
  return status === 'syncing' || status === 'running';
}

function isPendingStatus(status: string | null | undefined) {
  return status === 'pending';
}

function isFailedStatus(status: string | null | undefined) {
  return status === 'failed' || status === 'error';
}

export function buildHomeSyncOverview(input: HomeSyncOverviewInput): HomeSyncOverview {
  const operations = [...input.operations, ...input.artifactJobs];
  const uploading = operations.filter((item) => isRunningStatus(item.status)).length;
  const pendingUpload = operations.filter((item) => isPendingStatus(item.status)).length;
  const failedUpload = operations.filter((item) => isFailedStatus(item.status)).length;
  const now = Date.now();
  const checkingDownloads = input.syncScopes.filter((scope) => scope.inflight).length;
  const backoffScopes = input.syncScopes.filter((scope) => scope.retryAt > now).length;
  const failedScopes = input.syncScopes.filter((scope) => Boolean(scope.lastError)).length;
  const checkedScopes = input.syncScopes.filter((scope) => scope.lastCheckedAt > 0).length;
  const activeWorkers = input.workerEntries.filter((worker) => worker.priority > 0);
  const needsAttention = failedUpload > 0 || failedScopes > 0 || backoffScopes > 0;
  const hasActivity = uploading > 0 || pendingUpload > 0 || checkingDownloads > 0;

  return {
    cloudSyncAvailable: input.cloudSyncAvailable,
    cloudSyncEnabled: input.cloudSyncEnabled,
    uploading,
    pendingUpload,
    failedUpload,
    checkingDownloads,
    backoffScopes,
    failedScopes,
    checkedScopes,
    registeredWorkers: input.workerEntries.length,
    activeWorkers,
    severity: !input.cloudSyncAvailable || !input.cloudSyncEnabled
      ? 'off'
      : needsAttention
        ? 'attention'
        : hasActivity
          ? 'syncing'
          : 'idle',
  };
}

