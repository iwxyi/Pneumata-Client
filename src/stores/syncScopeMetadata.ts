export interface SyncScopeState {
  lastCheckedAt: number;
  lastAppliedAt: number;
  cursor?: string | null;
  revision?: string | number | null;
  inflight: Promise<unknown> | null;
  lastError?: string | null;
  errorCount: number;
  retryAt: number;
}

export interface SyncScopeSnapshot extends Omit<SyncScopeState, 'inflight'> {
  scope: string;
  inflight: boolean;
}

interface PersistedSyncScopeState extends Omit<SyncScopeState, 'inflight'> {}

type PersistedSyncScopeMap = Record<string, PersistedSyncScopeState>;

interface SyncScopeMetadataPersistenceAdapter {
  load: (storageKey: string) => Promise<PersistedSyncScopeMap | null>;
  replace: (storageKey: string, scopes: PersistedSyncScopeMap) => Promise<void>;
}

interface SyncScopeMetadataOptions {
  getStorageKey?: () => string;
  minRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  persistenceAdapter?: SyncScopeMetadataPersistenceAdapter;
}

interface IndexedDbSyncScopeRow extends PersistedSyncScopeState {
  key: string;
  storageKey: string;
  scope: string;
  updatedAt: number;
}

const SYNC_SCOPE_DB_NAME = 'pneumata-sync-metadata';
const SYNC_SCOPE_DB_VERSION = 1;
const SYNC_SCOPE_STORE = 'sync_scopes';
const SYNC_SCOPE_STORAGE_INDEX = 'storageKey';
const SYNC_SCOPE_KEY_SEPARATOR = '\n';
let syncScopeDbOpenPromise: Promise<IDBDatabase | null> | null = null;

function sanitizePersistedState(value: unknown): PersistedSyncScopeState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const lastCheckedAt = Number(record.lastCheckedAt || 0);
  const lastAppliedAt = Number(record.lastAppliedAt || 0);
  const errorCount = Number(record.errorCount || 0);
  const retryAt = Number(record.retryAt || 0);
  return {
    lastCheckedAt: Number.isFinite(lastCheckedAt) ? lastCheckedAt : 0,
    lastAppliedAt: Number.isFinite(lastAppliedAt) ? lastAppliedAt : 0,
    cursor: typeof record.cursor === 'string' ? record.cursor : null,
    revision: typeof record.revision === 'string' || typeof record.revision === 'number' ? record.revision : null,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
    errorCount: Number.isFinite(errorCount) ? errorCount : 0,
    retryAt: Number.isFinite(retryAt) ? retryAt : 0,
  };
}

function serializePersistedState(state: SyncScopeState | PersistedSyncScopeState): PersistedSyncScopeState {
  return {
    lastCheckedAt: state.lastCheckedAt,
    lastAppliedAt: state.lastAppliedAt,
    cursor: state.cursor ?? null,
    revision: state.revision ?? null,
    lastError: state.lastError ?? null,
    errorCount: state.errorCount,
    retryAt: state.retryAt,
  };
}

function syncScopeRowKey(storageKey: string, scope: string) {
  return `${storageKey}${SYNC_SCOPE_KEY_SEPARATOR}${scope}`;
}

function openSyncScopeDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (syncScopeDbOpenPromise) return syncScopeDbOpenPromise;
  syncScopeDbOpenPromise = new Promise((resolve) => {
    const request = indexedDB.open(SYNC_SCOPE_DB_NAME, SYNC_SCOPE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SYNC_SCOPE_STORE)) {
        const store = database.createObjectStore(SYNC_SCOPE_STORE, { keyPath: 'key' });
        store.createIndex(SYNC_SCOPE_STORAGE_INDEX, 'storageKey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('[sync-scope] indexeddb open failed', request.error);
      resolve(null);
    };
    request.onblocked = () => {
      console.warn('[sync-scope] indexeddb open blocked');
    };
  });
  return syncScopeDbOpenPromise;
}

function createIndexedDbSyncScopeAdapter(): SyncScopeMetadataPersistenceAdapter {
  return {
    async load(storageKey) {
      const database = await openSyncScopeDb();
      if (!database) return null;
      return new Promise<PersistedSyncScopeMap>((resolve, reject) => {
        const transaction = database.transaction(SYNC_SCOPE_STORE, 'readonly');
        const store = transaction.objectStore(SYNC_SCOPE_STORE);
        const result: PersistedSyncScopeMap = {};
        const request = store.index(SYNC_SCOPE_STORAGE_INDEX).openCursor(IDBKeyRange.only(storageKey));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(result);
            return;
          }
          const row = cursor.value as IndexedDbSyncScopeRow;
          const persisted = sanitizePersistedState(row);
          if (persisted && row.scope) result[row.scope] = persisted;
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('Sync scope metadata read failed'));
      });
    },
    async replace(storageKey, scopes) {
      const database = await openSyncScopeDb();
      if (!database) return;
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SYNC_SCOPE_STORE, 'readwrite');
        const store = transaction.objectStore(SYNC_SCOPE_STORE);
        const index = store.index(SYNC_SCOPE_STORAGE_INDEX);
        const readRequest = index.openCursor(IDBKeyRange.only(storageKey));
        const updatedAt = Date.now();
        readRequest.onsuccess = () => {
          const cursor = readRequest.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
            return;
          }
          for (const [scope, state] of Object.entries(scopes)) {
            const row: IndexedDbSyncScopeRow = {
              key: syncScopeRowKey(storageKey, scope),
              storageKey,
              scope,
              updatedAt,
              ...state,
            };
            store.put(row);
          }
        };
        readRequest.onerror = () => reject(readRequest.error || new Error('Sync scope metadata replace failed'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Sync scope metadata replace failed'));
      });
    },
  };
}

const defaultIndexedDbSyncScopeAdapter = createIndexedDbSyncScopeAdapter();

export function createSyncScopeMetadata(defaultTtlMs: number, options: SyncScopeMetadataOptions = {}) {
  const scopes = new Map<string, SyncScopeState>();
  let loadedStorageKey: string | null = null;
  let storageGeneration = 0;
  let preferenceListenerRegistered = false;
  const minRetryDelayMs = options.minRetryDelayMs ?? 5_000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 120_000;
  const persistenceAdapter = options.persistenceAdapter ?? defaultIndexedDbSyncScopeAdapter;

  const currentStorageKey = () => {
    try {
      return options.getStorageKey?.() || null;
    } catch {
      return null;
    }
  };

  const persist = () => {
    const storageKey = currentStorageKey();
    if (!storageKey) return;
    storageGeneration += 1;
    const payload: PersistedSyncScopeMap = {};
    for (const [scope, state] of scopes) {
      payload[scope] = serializePersistedState(state);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ scopes: payload, updatedAt: Date.now() }));
      } catch {
        // Sync metadata is an optimization; persistence failure must not block local-first UI.
      }
    }
    void persistenceAdapter.replace(storageKey, payload).catch(() => {
      // IndexedDB metadata is also an optimization; keep localStorage fallback authoritative for this tick.
    });
  };

  const ensureLoaded = () => {
    const storageKey = currentStorageKey();
    if (!storageKey) return;
    if (loadedStorageKey === storageKey) return;
    loadedStorageKey = storageKey;
    const loadGeneration = storageGeneration;
    scopes.clear();
    let loadedFromLocalStorage = false;
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { scopes?: Record<string, unknown> };
        const payload: PersistedSyncScopeMap = {};
        for (const [scope, value] of Object.entries(parsed.scopes || {})) {
          const persisted = sanitizePersistedState(value);
          if (!persisted) continue;
          scopes.set(scope, { ...persisted, inflight: null });
          payload[scope] = persisted;
        }
        loadedFromLocalStorage = true;
        void persistenceAdapter.replace(storageKey, payload).catch(() => undefined);
      }
    } catch {
      scopes.clear();
    }
    if (loadedFromLocalStorage) return;
    void persistenceAdapter.load(storageKey).then((persistedScopes) => {
      if (!persistedScopes || loadedStorageKey !== storageKey || storageGeneration !== loadGeneration) return;
      scopes.clear();
      for (const [scope, persisted] of Object.entries(persistedScopes)) {
        scopes.set(scope, { ...persisted, inflight: null });
      }
    }).catch(() => undefined);
  };

  const ensurePreferenceListener = () => {
    if (preferenceListenerRegistered || typeof window === 'undefined') return;
    preferenceListenerRegistered = true;
    window.addEventListener('pneumata-cloud-sync-preference-changed', () => {
      scopes.clear();
      persist();
    });
  };

  const getState = (scope: string) => {
    ensurePreferenceListener();
    ensureLoaded();
    const existing = scopes.get(scope);
    if (existing) return existing;
    const next: SyncScopeState = { lastCheckedAt: 0, lastAppliedAt: 0, cursor: null, revision: null, inflight: null, lastError: null, errorCount: 0, retryAt: 0 };
    scopes.set(scope, next);
    return next;
  };

  const markStateSuccess = (state: SyncScopeState) => {
    state.lastError = null;
    state.errorCount = 0;
    state.retryAt = 0;
  };

  const markStateError = (state: SyncScopeState, error: unknown) => {
    state.lastError = error instanceof Error ? error.message : String(error);
    state.errorCount += 1;
    const delay = Math.min(maxRetryDelayMs, minRetryDelayMs * (2 ** Math.max(0, state.errorCount - 1)));
    state.retryAt = Date.now() + delay;
  };

  return {
    isFresh(scope: string, ttlMs = defaultTtlMs) {
      const state = getState(scope);
      if (state.retryAt > Date.now()) return true;
      return state.lastCheckedAt > 0 && Date.now() - state.lastCheckedAt < ttlMs;
    },

    markChecked(scope: string, metadata?: { cursor?: string | null; revision?: string | number | null; applied?: boolean; fresh?: boolean }) {
      const state = getState(scope);
      const checkedAt = Date.now();
      state.lastCheckedAt = metadata?.fresh === false ? 0 : checkedAt;
      if (metadata?.applied) state.lastAppliedAt = checkedAt;
      if ('cursor' in (metadata || {})) state.cursor = metadata?.cursor ?? null;
      if ('revision' in (metadata || {})) state.revision = metadata?.revision ?? null;
      markStateSuccess(state);
      persist();
    },

    markError(scope: string, error: unknown) {
      const state = getState(scope);
      markStateError(state, error);
      persist();
    },

    getLastCheckedAt(scope: string) {
      return getState(scope).lastCheckedAt;
    },

    getState(scope: string) {
      const state = getState(scope);
      return {
        scope,
        lastCheckedAt: state.lastCheckedAt,
        lastAppliedAt: state.lastAppliedAt,
        cursor: state.cursor,
        revision: state.revision,
        lastError: state.lastError,
        errorCount: state.errorCount,
        retryAt: state.retryAt,
        inflight: Boolean(state.inflight),
      };
    },

    listStates(): SyncScopeSnapshot[] {
      ensurePreferenceListener();
      ensureLoaded();
      return Array.from(scopes.entries())
        .map(([scope, state]) => ({
          scope,
          lastCheckedAt: state.lastCheckedAt,
          lastAppliedAt: state.lastAppliedAt,
          cursor: state.cursor,
          revision: state.revision,
          lastError: state.lastError,
          errorCount: state.errorCount,
          retryAt: state.retryAt,
          inflight: Boolean(state.inflight),
        }))
        .sort((a, b) => a.scope.localeCompare(b.scope));
    },

    run<T>(scope: string, task: () => Promise<T>, options?: { markCheckedOnSuccess?: boolean }) {
      const state = getState(scope);
      if (state.inflight) return state.inflight as Promise<T>;
      const promise = task()
        .then((result) => {
          if (options?.markCheckedOnSuccess !== false) {
            state.lastCheckedAt = Date.now();
            markStateSuccess(state);
            persist();
          }
          return result;
        })
        .catch((error) => {
          markStateError(state, error);
          persist();
          throw error;
        })
        .finally(() => {
          state.inflight = null;
        });
      state.inflight = promise;
      return promise;
    },

    clear(scope?: string) {
      if (scope) {
        scopes.delete(scope);
        persist();
        return;
      }
      scopes.clear();
      persist();
    },
  };
}
