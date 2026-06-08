import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';
import { recordPersistenceFailure } from '../services/persistenceHealth';

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

export interface IndexedDbStorageEntryDiagnostic {
  key: string;
  sizeBytes: number;
}

export interface IndexedDbStorageDiagnostics {
  available: boolean;
  databaseName: string;
  objectStoreName: string;
  totalBytes: number;
  entries: IndexedDbStorageEntryDiagnostic[];
  largest: IndexedDbStorageEntryDiagnostic[];
  error?: string;
}

const bufferedFlushers = new Set<() => void>();
let bufferedLifecycleRegistered = false;
const INDEXED_DB_NAME = 'pneumata-local-store';
const INDEXED_DB_VERSION = 1;
const INDEXED_DB_OBJECT_STORE = 'kv';
let indexedDbOpenPromise: Promise<IDBDatabase | null> | null = null;

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

function textSizeBytes(value: string) {
  if (typeof Blob !== 'undefined') return new Blob([value]).size;
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return value.length;
}

function openIndexedDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (indexedDbOpenPromise) return indexedDbOpenPromise;
  indexedDbOpenPromise = new Promise((resolve) => {
    const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(INDEXED_DB_OBJECT_STORE)) {
        database.createObjectStore(INDEXED_DB_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('[storage] indexeddb open failed', request.error);
      resolve(null);
    };
    request.onblocked = () => {
      console.warn('[storage] indexeddb open blocked');
    };
  });
  return indexedDbOpenPromise;
}

async function readIndexedDbItem(key: string) {
  const database = await openIndexedDb();
  if (!database) return null;
  return new Promise<string | null>((resolve, reject) => {
    const transaction = database.transaction(INDEXED_DB_OBJECT_STORE, 'readonly');
    const request = transaction.objectStore(INDEXED_DB_OBJECT_STORE).get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
  });
}

async function writeIndexedDbItem(key: string, value: string) {
  const database = await openIndexedDb();
  if (!database) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
    return 'localStorage' as const;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(INDEXED_DB_OBJECT_STORE, 'readwrite');
    const request = transaction.objectStore(INDEXED_DB_OBJECT_STORE).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('IndexedDB write failed'));
  });
  return 'indexedDb' as const;
}

async function removeIndexedDbItem(key: string) {
  const database = await openIndexedDb();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(INDEXED_DB_OBJECT_STORE, 'readwrite');
    const request = transaction.objectStore(INDEXED_DB_OBJECT_STORE).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('IndexedDB remove failed'));
  });
}

export async function readIndexedDbStorageDiagnostics(limit = 20): Promise<IndexedDbStorageDiagnostics> {
  const unavailable = {
    available: false,
    databaseName: INDEXED_DB_NAME,
    objectStoreName: INDEXED_DB_OBJECT_STORE,
    totalBytes: 0,
    entries: [],
    largest: [],
  };
  try {
    const database = await openIndexedDb();
    if (!database) return unavailable;
    const entries = await new Promise<IndexedDbStorageEntryDiagnostic[]>((resolve, reject) => {
      const transaction = database.transaction(INDEXED_DB_OBJECT_STORE, 'readonly');
      const store = transaction.objectStore(INDEXED_DB_OBJECT_STORE);
      const request = store.openCursor();
      const result: IndexedDbStorageEntryDiagnostic[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(result);
          return;
        }
        const key = String(cursor.key);
        const value = typeof cursor.value === 'string' ? cursor.value : JSON.stringify(cursor.value ?? null);
        result.push({ key, sizeBytes: textSizeBytes(value) });
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB diagnostics failed'));
    });
    const sortedEntries = entries.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return {
      available: true,
      databaseName: INDEXED_DB_NAME,
      objectStoreName: INDEXED_DB_OBJECT_STORE,
      totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      entries,
      largest: sortedEntries.slice(0, limit),
    };
  } catch (error) {
    return {
      ...unavailable,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

export function createScopedIndexedDbStorage(params: ScopedStorageParams): StateStorage {
  return {
    getItem: async (name: string) => {
      const scopedName = params.getScopedKey();
      const storageName = params.storageName;
      if (name !== storageName) {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(name);
      }
      const indexedValue = await readIndexedDbItem(scopedName);
      if (indexedValue != null) return indexedValue;
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(scopedName);
    },
    setItem: async (name: string, value: string) => {
      const scopedName = params.getScopedKey();
      const storageName = params.storageName;
      if (name !== storageName) {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(name, value);
        return;
      }
      const storageBackend = await writeIndexedDbItem(scopedName, value);
      if (storageBackend === 'indexedDb' && typeof localStorage !== 'undefined') localStorage.removeItem(scopedName);
    },
    removeItem: async (name: string) => {
      const scopedName = params.getScopedKey();
      const storageName = params.storageName;
      if (name !== storageName) {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(name);
        return;
      }
      await removeIndexedDbItem(scopedName);
      if (typeof localStorage !== 'undefined') localStorage.removeItem(scopedName);
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
      const removeResult = storage.removeItem(name);
      if (removeResult instanceof Promise) {
        removeResult.catch((error) => {
          recordPersistenceFailure({ name, reason: 'write_failed', error });
          console.warn('[storage] persistence remove failed', { name, error });
        });
      }
      return;
    }
    let serializedValue = '';
    try {
      serializedValue = JSON.stringify(pending.value, options.replacer);
      const setResult = storage.setItem(name, serializedValue);
      if (setResult instanceof Promise) {
        setResult.catch((error) => {
          recordPersistenceFailure({ name, reason: 'write_failed', error, serializedValue });
          console.warn('[storage] persistence async write failed', { name, error });
        });
      }
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : '';
      if (errorName === 'QuotaExceededError' || errorName === 'NS_ERROR_DOM_QUOTA_REACHED') {
        recordPersistenceFailure({ name, reason: 'quota_exceeded', error, serializedValue });
        console.warn('[storage] persistence skipped: storage quota exceeded', { name, error });
        return;
      }
      recordPersistenceFailure({ name, reason: 'write_failed', error, serializedValue });
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

export function createScopedIndexedDbBufferedJsonStorage<T>(
  params: ScopedStorageParams & { flushDelayMs?: number },
): PersistStorage<T, void> {
  return createBufferedJsonStorage<T>(createScopedIndexedDbStorage(params), {
    flushDelayMs: params.flushDelayMs,
  });
}
