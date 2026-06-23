import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey } from '../constants/brand';
import { getLastCloudPhone, rememberLastCloudPhone } from './authSession';

describe('authSession', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === storageKey('user')
        ? JSON.stringify({ id: 'user-1', phone: '18800001111' })
        : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the last cloud phone from the stored auth user when no explicit remembered phone exists', () => {
    expect(getLastCloudPhone()).toBe('18800001111');
  });

  it('stores the last cloud phone for login prefill', () => {
    rememberLastCloudPhone('19900002222');

    expect(localStorage.setItem).toHaveBeenCalledWith(storageKey('last-cloud-phone'), '19900002222');
  });
});
