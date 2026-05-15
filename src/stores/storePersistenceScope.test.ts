import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBufferedJsonStorage } from './storePersistenceScope';

function createStorageMock() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe('storePersistenceScope', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces repeated buffered writes and flushes only the latest snapshot', () => {
    const rawStorage = createStorageMock();
    const storage = createBufferedJsonStorage<{ value: number }>(rawStorage, { flushDelayMs: 20 });

    storage.setItem('scope-key', { state: { value: 1 }, version: 2 });
    storage.setItem('scope-key', { state: { value: 2 }, version: 2 });

    expect(rawStorage.getItem('scope-key')).toBeNull();
    expect(storage.getItem('scope-key')).toEqual({ state: { value: 2 }, version: 2 });

    vi.advanceTimersByTime(20);

    expect(rawStorage.getItem('scope-key')).toBe(JSON.stringify({ state: { value: 2 }, version: 2 }));
  });
});
