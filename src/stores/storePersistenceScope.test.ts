import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBufferedJsonStorage } from './storePersistenceScope';
import { clearPersistenceFailures, readPersistenceHealth } from '../services/persistenceHealth';

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
    clearPersistenceFailures();
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

  it('records quota failures instead of hiding local persistence loss', () => {
    const rawStorage = createStorageMock();
    rawStorage.setItem = vi.fn(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createBufferedJsonStorage<{ value: string }>(rawStorage, { flushDelayMs: 20 });

    storage.setItem('large-scope', { state: { value: 'x'.repeat(256) }, version: 2 });
    vi.advanceTimersByTime(20);

    const health = readPersistenceHealth();
    expect(health.latestFailure).toMatchObject({
      name: 'large-scope',
      reason: 'quota_exceeded',
    });
    expect(health.latestFailure?.sizeBytes).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});
