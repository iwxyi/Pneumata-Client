import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncScopeMetadata } from './syncScopeMetadata';

const localStore = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) => { localStore.set(key, value); },
  removeItem: (key: string) => { localStore.delete(key); },
  clear: () => { localStore.clear(); },
  key: (index: number) => Array.from(localStore.keys())[index] ?? null,
  get length() { return localStore.size; },
});

describe('syncScopeMetadata', () => {
  beforeEach(() => {
    localStore.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('backs off failed scopes and clears retry state after success', () => {
    const metadata = createSyncScopeMetadata(30_000, {
      getStorageKey: () => 'sync-scopes-test',
      minRetryDelayMs: 5_000,
      maxRetryDelayMs: 20_000,
    });

    expect(metadata.isFresh('characters.summary')).toBe(false);

    metadata.markError('characters.summary', new Error('server unavailable'));
    let state = metadata.getState('characters.summary');
    expect(state.lastError).toBe('server unavailable');
    expect(state.errorCount).toBe(1);
    expect(state.retryAt).toBe(6_000);
    expect(metadata.isFresh('characters.summary')).toBe(true);

    vi.setSystemTime(6_001);
    expect(metadata.isFresh('characters.summary')).toBe(false);

    metadata.markError('characters.summary', new Error('still down'));
    state = metadata.getState('characters.summary');
    expect(state.errorCount).toBe(2);
    expect(state.retryAt).toBe(16_001);

    metadata.markChecked('characters.summary', { revision: 'rev-1', applied: true });
    state = metadata.getState('characters.summary');
    expect(state.lastError).toBeNull();
    expect(state.errorCount).toBe(0);
    expect(state.retryAt).toBe(0);
    expect(state.revision).toBe('rev-1');
  });

  it('lists persisted scope snapshots for diagnostics', () => {
    const metadata = createSyncScopeMetadata(30_000, {
      getStorageKey: () => 'sync-scopes-test',
    });

    metadata.markChecked('messages.window:chat-1', { cursor: 'cursor-1', revision: 'rev-1', applied: true });
    metadata.markError('characters.summary', new Error('temporary failure'));

    expect(metadata.listStates()).toEqual([
      expect.objectContaining({
        scope: 'characters.summary',
        lastError: 'temporary failure',
        errorCount: 1,
        inflight: false,
      }),
      expect.objectContaining({
        scope: 'messages.window:chat-1',
        cursor: 'cursor-1',
        revision: 'rev-1',
        lastError: null,
        errorCount: 0,
        inflight: false,
      }),
    ]);

    const reloaded = createSyncScopeMetadata(30_000, {
      getStorageKey: () => 'sync-scopes-test',
    });
    expect(reloaded.listStates().map((state) => state.scope)).toEqual(['characters.summary', 'messages.window:chat-1']);
  });

  it('mirrors legacy localStorage metadata into the async metadata table', async () => {
    const replace = vi.fn(async () => undefined);
    const metadata = createSyncScopeMetadata(30_000, {
      getStorageKey: () => 'sync-scopes-test',
      persistenceAdapter: {
        load: vi.fn(async () => null),
        replace,
      },
    });
    localStore.set('sync-scopes-test', JSON.stringify({
      scopes: {
        'characters.summary': {
          lastCheckedAt: 900,
          lastAppliedAt: 900,
          cursor: 'cursor-1',
          revision: 'rev-1',
          lastError: null,
          errorCount: 0,
          retryAt: 0,
        },
      },
    }));

    expect(metadata.listStates()).toEqual([
      expect.objectContaining({ scope: 'characters.summary', cursor: 'cursor-1' }),
    ]);
    await Promise.resolve();

    expect(replace).toHaveBeenCalledWith('sync-scopes-test', {
      'characters.summary': expect.objectContaining({ cursor: 'cursor-1', revision: 'rev-1' }),
    });
  });

  it('hydrates from the async metadata table when the immediate local snapshot is missing', async () => {
    const metadata = createSyncScopeMetadata(30_000, {
      getStorageKey: () => 'sync-scopes-test',
      persistenceAdapter: {
        load: vi.fn(async () => ({
          'messages.window:chat-1': {
            lastCheckedAt: 800,
            lastAppliedAt: 800,
            cursor: 'cursor-from-db',
            revision: 'rev-from-db',
            lastError: null,
            errorCount: 0,
            retryAt: 0,
          },
        })),
        replace: vi.fn(async () => undefined),
      },
    });

    expect(metadata.listStates()).toEqual([]);
    await Promise.resolve();

    expect(metadata.listStates()).toEqual([
      expect.objectContaining({
        scope: 'messages.window:chat-1',
        cursor: 'cursor-from-db',
        revision: 'rev-from-db',
      }),
    ]);
  });

  it('does not let a delayed async metadata load overwrite newer local writes', async () => {
    let resolveLoad: (value: {
      'characters.summary': {
        lastCheckedAt: number;
        lastAppliedAt: number;
        cursor: string;
        revision: string;
        lastError: null;
        errorCount: number;
        retryAt: number;
      };
    }) => void = () => undefined;
    const load = vi.fn(() => new Promise<{
      'characters.summary': {
        lastCheckedAt: number;
        lastAppliedAt: number;
        cursor: string;
        revision: string;
        lastError: null;
        errorCount: number;
        retryAt: number;
      };
    }>((resolve) => {
      resolveLoad = resolve;
    }));
    const metadata = createSyncScopeMetadata(30_000, {
      getStorageKey: () => 'sync-scopes-test',
      persistenceAdapter: {
        load,
        replace: vi.fn(async () => undefined),
      },
    });

    expect(metadata.listStates()).toEqual([]);
    metadata.markChecked('characters.summary', { cursor: 'fresh-cursor', revision: 'fresh-rev', applied: true });
    resolveLoad({
      'characters.summary': {
        lastCheckedAt: 1,
        lastAppliedAt: 1,
        cursor: 'stale-cursor',
        revision: 'stale-rev',
        lastError: null,
        errorCount: 0,
        retryAt: 0,
      },
    });
    await Promise.resolve();

    expect(metadata.getState('characters.summary')).toEqual(expect.objectContaining({
      cursor: 'fresh-cursor',
      revision: 'fresh-rev',
    }));
  });
});
