import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

interface ScopedStorageParams {
  getScopedKey: () => string;
  storageName: string;
}

interface BufferedJsonStorageOptions {
  flushDelayMs?: number;
  replacer?: (key: string, value: unknown) => unknown;
  reviver?: (key: string, value: unknown) => unknown;
}

type BufferedFlushHandle = ReturnType<typeof globalThis.setTimeout> | number;

interface PendingBufferedWrite<T> {
  value: StorageValue<T> | null;
  handle: BufferedFlushHandle | null;
}

const bufferedFlushers = new Set<() => void>();
let bufferedLifecycleRegistered = false;

function scheduleBufferedFlush(flush: () => void, delayMs: number) {
  const scheduler = (globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof scheduler === 'function') {
    return scheduler(flush, { timeout: delayMs });
  }
  return globalThis.setTimeout(flush, delayMs);
}

function cancelBufferedFlush(handle: BufferedFlushHandle | null) {
  if (handle == null) return;
  const canceller = (globalThis as typeof globalThis & {
    cancelIdleCallback?: (id: number) => void;
  }).cancelIdleCallback;
  if (typeof canceller === 'function' && typeof handle === 'number') {
    canceller(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

function ensureBufferedStorageLifecycle() {
  if (bufferedLifecycleRegistered || typeof window === 'undefined') return;
  const flushAll = () => {
    for (const flush of bufferedFlushers) flush();
  };
  window.addEventListener('pagehide', flushAll);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAll();
    });
  }
  bufferedLifecycleRegistered = true;
}

function parsePersistedValue<T>(raw: string | null, reviver?: BufferedJsonStorageOptions['reviver']) {
  if (raw == null) return null;
  return JSON.parse(raw, reviver) as StorageValue<T>;
}

export function createScopedStorage(params: ScopedStorageParams): StateStorage {
  return {
    getItem: (name: string) => {
      if (typeof localStorage === 'undefined') return null;
      const scopedName = params.getScopedKey();
      const storageName = params.storageName;
      if (name !== storageName) return localStorage.getItem(name);
      return localStorage.getItem(scopedName);
    },
    setItem: (name: string, value: string) => {
      if (typeof localStorage === 'undefined') return;
      const scopedName = params.getScopedKey();
      const storageName = params.storageName;
      if (name !== storageName) {
        localStorage.setItem(name, value);
        return;
      }
      localStorage.setItem(scopedName, value);
    },
    removeItem: (name: string) => {
      if (typeof localStorage === 'undefined') return;
      const scopedName = params.getScopedKey();
      const storageName = params.storageName;
      if (name !== storageName) {
        localStorage.removeItem(name);
        return;
      }
      localStorage.removeItem(scopedName);
    },
  };
}

export function createBufferedJsonStorage<T>(
  storage: StateStorage,
  options: BufferedJsonStorageOptions = {},
): PersistStorage<T, void> {
  const pendingWrites = new Map<string, PendingBufferedWrite<T>>();
  const flushDelayMs = options.flushDelayMs ?? 96;

  const flushName = (name: string) => {
    const pending = pendingWrites.get(name);
    if (!pending) return;
    pendingWrites.delete(name);
    cancelBufferedFlush(pending.handle);
    if (pending.value == null) {
      storage.removeItem(name);
      return;
    }
    try {
      storage.setItem(name, JSON.stringify(pending.value, options.replacer));
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : '';
      if (errorName === 'QuotaExceededError' || errorName === 'NS_ERROR_DOM_QUOTA_REACHED') {
        console.warn('[storage] persistence skipped: storage quota exceeded', { name, error });
        return;
      }
      throw error;
    }
  };

  const flushAll = () => {
    for (const name of Array.from(pendingWrites.keys())) {
      flushName(name);
    }
  };

  ensureBufferedStorageLifecycle();
  bufferedFlushers.add(flushAll);

  return {
    getItem: (name: string) => {
      const pending = pendingWrites.get(name);
      if (pending) return pending.value;
      const raw = storage.getItem(name);
      if (raw instanceof Promise) {
        return raw.then((value) => parsePersistedValue<T>(value, options.reviver));
      }
      return parsePersistedValue<T>(raw, options.reviver);
    },
    setItem: (name: string, value: StorageValue<T>) => {
      const pending = pendingWrites.get(name);
      pendingWrites.set(name, {
        value,
        handle: pending?.handle ?? scheduleBufferedFlush(() => flushName(name), flushDelayMs),
      });
    },
    removeItem: (name: string) => {
      const pending = pendingWrites.get(name);
      pendingWrites.set(name, {
        value: null,
        handle: pending?.handle ?? scheduleBufferedFlush(() => flushName(name), flushDelayMs),
      });
    },
  };
}

export function createScopedBufferedJsonStorage<T>(
  params: ScopedStorageParams & { flushDelayMs?: number },
): PersistStorage<T, void> {
  return createBufferedJsonStorage<T>(createScopedStorage(params), {
    flushDelayMs: params.flushDelayMs,
  });
}
