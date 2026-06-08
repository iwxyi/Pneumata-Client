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

interface SyncScopeMetadataOptions {
  getStorageKey?: () => string;
  minRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

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

export function createSyncScopeMetadata(defaultTtlMs: number, options: SyncScopeMetadataOptions = {}) {
  const scopes = new Map<string, SyncScopeState>();
  let loadedStorageKey: string | null = null;
  let preferenceListenerRegistered = false;
  const minRetryDelayMs = options.minRetryDelayMs ?? 5_000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 120_000;

  const currentStorageKey = () => {
    try {
      return options.getStorageKey?.() || null;
    } catch {
      return null;
    }
  };

  const persist = () => {
    const storageKey = currentStorageKey();
    if (!storageKey || typeof localStorage === 'undefined') return;
    const payload: Record<string, PersistedSyncScopeState> = {};
    for (const [scope, state] of scopes) {
      payload[scope] = {
        lastCheckedAt: state.lastCheckedAt,
        lastAppliedAt: state.lastAppliedAt,
        cursor: state.cursor ?? null,
        revision: state.revision ?? null,
        lastError: state.lastError ?? null,
        errorCount: state.errorCount,
        retryAt: state.retryAt,
      };
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ scopes: payload, updatedAt: Date.now() }));
    } catch {
      // Sync metadata is an optimization; persistence failure must not block local-first UI.
    }
  };

  const ensureLoaded = () => {
    const storageKey = currentStorageKey();
    if (!storageKey || typeof localStorage === 'undefined') return;
    if (loadedStorageKey === storageKey) return;
    loadedStorageKey = storageKey;
    scopes.clear();
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { scopes?: Record<string, unknown> };
      for (const [scope, value] of Object.entries(parsed.scopes || {})) {
        const persisted = sanitizePersistedState(value);
        if (!persisted) continue;
        scopes.set(scope, { ...persisted, inflight: null });
      }
    } catch {
      scopes.clear();
    }
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

    markChecked(scope: string, metadata?: { cursor?: string | null; revision?: string | number | null; applied?: boolean }) {
      const state = getState(scope);
      state.lastCheckedAt = Date.now();
      if (metadata?.applied) state.lastAppliedAt = state.lastCheckedAt;
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
