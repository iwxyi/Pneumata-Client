import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStore = new Map<string, string>();
const windowTarget = new EventTarget();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) => { localStore.set(key, value); },
  removeItem: (key: string) => { localStore.delete(key); },
  clear: () => { localStore.clear(); },
  key: (index: number) => Array.from(localStore.keys())[index] ?? null,
  get length() { return localStore.size; },
});

vi.stubGlobal('window', {
  addEventListener: windowTarget.addEventListener.bind(windowTarget),
  removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
  dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
});

vi.stubGlobal('document', {
  visibilityState: 'visible',
  addEventListener: vi.fn(),
});

describe('storeSyncScheduler', () => {
  beforeEach(() => {
    localStore.clear();
    vi.useFakeTimers();
  });

  it('registers named sync workers and schedules them through the shared registry', async () => {
    const {
      createSyncScheduler,
      getRegisteredSyncWorkerIds,
      scheduleSyncWorker,
    } = await import('./storeSyncScheduler');
    const flush = vi.fn(async () => {});
    const scheduler = createSyncScheduler('test.pending-operations');

    scheduler.registerLifecycle(flush, 300);
    expect(getRegisteredSyncWorkerIds()).toContain('test.pending-operations');

    expect(scheduleSyncWorker('test.pending-operations', 100)).toBe(true);
    await vi.advanceTimersByTimeAsync(99);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('orders shared worker scheduling by priority', async () => {
    const {
      createSyncScheduler,
      getRegisteredSyncWorkerEntries,
      getSyncWorkerPriority,
      scheduleSyncWorkersByPriority,
    } = await import('./storeSyncScheduler');
    const highFlush = vi.fn(async () => {});
    const lowFlush = vi.fn(async () => {});
    const high = createSyncScheduler('priority.high', { priority: 100 });
    const low = createSyncScheduler('priority.low', { priority: 10 });

    low.registerLifecycle(lowFlush, 300);
    high.registerLifecycle(highFlush, 300);

    expect(getSyncWorkerPriority('priority.high')).toBe(100);
    expect(getSyncWorkerPriority('priority.low')).toBe(10);
    const entries = getRegisteredSyncWorkerEntries();
    expect(entries.findIndex((entry) => entry.id === 'priority.high')).toBeLessThan(
      entries.findIndex((entry) => entry.id === 'priority.low'),
    );

    const order = scheduleSyncWorkersByPriority(100);
    expect(order.findIndex((id) => id === 'priority.high')).toBeLessThan(
      order.findIndex((id) => id === 'priority.low'),
    );

    await vi.advanceTimersByTimeAsync(100);
    expect(highFlush).toHaveBeenCalledTimes(1);
    expect(lowFlush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    expect(lowFlush).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates dynamic worker priority when scheduling', async () => {
    const {
      createSyncScheduler,
      getSyncWorkerPriority,
      scheduleSyncWorkersByPriority,
    } = await import('./storeSyncScheduler');
    let dynamicPriority = 10;
    const dynamicFlush = vi.fn(async () => {});
    const staticFlush = vi.fn(async () => {});
    const dynamic = createSyncScheduler('priority.dynamic', { priority: () => dynamicPriority });
    const staticWorker = createSyncScheduler('priority.static', { priority: 50 });

    dynamic.registerLifecycle(dynamicFlush, 300);
    staticWorker.registerLifecycle(staticFlush, 300);

    expect(getSyncWorkerPriority('priority.dynamic')).toBe(10);
    let order = scheduleSyncWorkersByPriority(100);
    expect(order.findIndex((id) => id === 'priority.static')).toBeLessThan(
      order.findIndex((id) => id === 'priority.dynamic'),
    );

    dynamicPriority = 100;
    expect(getSyncWorkerPriority('priority.dynamic')).toBe(100);
    order = scheduleSyncWorkersByPriority(100);
    expect(order.findIndex((id) => id === 'priority.dynamic')).toBeLessThan(
      order.findIndex((id) => id === 'priority.static'),
    );
  });

  it('pauses lifecycle workers while bootstrap lock is active and resumes after unlock', async () => {
    const {
      beginCloudSyncBootstrapLock,
      endCloudSyncBootstrapLock,
      isCloudSyncBootstrapLocked,
    } = await import('../services/cloudSyncBootstrapLock');
    const {
      createSyncScheduler,
      scheduleSyncWorkersByPriority,
    } = await import('./storeSyncScheduler');
    const flush = vi.fn(async () => {});
    const scheduler = createSyncScheduler('bootstrap.paused', { priority: 100 });

    scheduler.registerLifecycle(flush, 300);
    expect(scheduleSyncWorkersByPriority(100)).toContain('bootstrap.paused');
    beginCloudSyncBootstrapLock();
    expect(isCloudSyncBootstrapLocked()).toBe(true);

    await vi.advanceTimersByTimeAsync(200);
    expect(flush).not.toHaveBeenCalled();
    expect(scheduleSyncWorkersByPriority(100)).toEqual([]);

    endCloudSyncBootstrapLock();
    expect(isCloudSyncBootstrapLocked()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('registers declared scope refresh workers through the shared registry', async () => {
    const { getRegisteredSyncWorkerIds } = await import('./storeSyncScheduler');
    const { useChatStore } = await import('./useChatStore');
    const { useCharacterStore } = await import('./useCharacterStore');
    const { useMessageStore } = await import('./useMessageStore');
    const { useCharacterArtifactStore } = await import('./useCharacterArtifactStore');
    const { useSettingsStore } = await import('./useSettingsStore');

    await useChatStore.getState().prefetchChats();
    await useChatStore.getState().prefetchWorldRuntime();
    await useCharacterStore.getState().prefetchCharacters();
    void useMessageStore;
    void useCharacterArtifactStore;
    void useSettingsStore;

    expect(getRegisteredSyncWorkerIds()).toEqual(expect.arrayContaining([
      'chat.scope-refresh',
      'character.scope-refresh',
      'message.window-scope-refresh',
      'artifact.scope-refresh',
      'settings.scope-refresh',
    ]));
  });
});
