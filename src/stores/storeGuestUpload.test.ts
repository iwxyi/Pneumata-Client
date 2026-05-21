import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuestUploadFlag } from './storeGuestUpload';

describe('createGuestUploadFlag', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn((key: string) => { values.delete(key); }),
      clear: vi.fn(() => { values.clear(); }),
    });
    localStorage.clear();
  });

  it('ignores malformed non-array cache values', () => {
    localStorage.setItem('guest-cache', JSON.stringify({ state: { characters: [] } }));

    expect(createGuestUploadFlag<string>('guest-cache').read()).toEqual([]);
  });

  it('reads valid array cache values', () => {
    localStorage.setItem('guest-cache', JSON.stringify(['a', 'b']));

    expect(createGuestUploadFlag<string>('guest-cache').read()).toEqual(['a', 'b']);
  });
});
