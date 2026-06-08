import { describe, expect, it, vi } from 'vitest';
import { buildHomeSyncOverview } from './homeSyncOverview';

describe('homeSyncOverview', () => {
  it('summarizes local upload queues, scope checks, and workers without remote data', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    expect(buildHomeSyncOverview({
      cloudSyncAvailable: true,
      cloudSyncEnabled: true,
      operations: [{ status: 'pending' }, { status: 'syncing' }, { status: 'failed' }],
      artifactJobs: [{ status: 'running' }],
      syncScopes: [
        { scope: 'chats.summary', inflight: true, lastCheckedAt: 900, lastAppliedAt: 0, cursor: null, revision: null, lastError: null, errorCount: 0, retryAt: 0 },
        { scope: 'characters.summary', inflight: false, lastCheckedAt: 800, lastAppliedAt: 0, cursor: null, revision: null, lastError: 'down', errorCount: 1, retryAt: 2_000 },
        { scope: 'messages.window:chat-1', inflight: false, lastCheckedAt: 0, lastAppliedAt: 0, cursor: 'log:12', revision: null, lastError: null, errorCount: 0, retryAt: 0 },
      ],
      workerEntries: [
        { id: 'message.pending-operations', priority: 100, delay: 300 },
        { id: 'settings.scope-refresh', priority: 0, delay: 650 },
      ],
    })).toMatchObject({
      uploading: 2,
      pendingUpload: 1,
      failedUpload: 1,
      checkingDownloads: 1,
      pendingDownload: 1,
      backoffScopes: 1,
      failedScopes: 1,
      checkedScopes: 2,
      registeredWorkers: 2,
      activeWorkers: [{ id: 'message.pending-operations', priority: 100, delay: 300 }],
      severity: 'attention',
    });
  });

  it('marks unavailable cloud sync as off even when local queues exist', () => {
    expect(buildHomeSyncOverview({
      cloudSyncAvailable: false,
      cloudSyncEnabled: false,
      operations: [{ status: 'pending' }],
      artifactJobs: [],
      syncScopes: [],
      workerEntries: [],
    }).severity).toBe('off');
  });
});
