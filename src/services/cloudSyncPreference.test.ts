import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey } from '../constants/brand';
import {
  isCloudSyncEnabled,
  isCloudSyncUserDisabled,
  setCloudSyncEnabled,
} from './cloudSyncPreference';

const ENABLED_KEY = storageKey('cloud-sync-enabled');
const USER_DISABLED_KEY = storageKey('cloud-sync-user-disabled');
const storage = new Map<string, string>();
class TestCustomEvent<T = unknown> extends Event {
  detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = init?.detail as T;
  }
}

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
});

vi.stubGlobal('CustomEvent', TestCustomEvent);
vi.stubGlobal('window', {
  dispatchEvent: vi.fn(),
});

describe('cloudSyncPreference', () => {
  beforeEach(() => {
    storage.clear();
    vi.mocked(window.dispatchEvent).mockClear();
  });

  it('records explicit user-disabled cloud sync separately from availability', () => {
    setCloudSyncEnabled(false, { source: 'user' });

    expect(localStorage.getItem(ENABLED_KEY)).toBe('0');
    expect(localStorage.getItem(USER_DISABLED_KEY)).toBe('1');
    expect(isCloudSyncEnabled()).toBe(false);
    expect(isCloudSyncUserDisabled()).toBe(true);
  });

  it('does not mark entitlement disables as user disables', () => {
    setCloudSyncEnabled(false, { source: 'entitlement' });

    expect(isCloudSyncEnabled()).toBe(false);
    expect(isCloudSyncUserDisabled()).toBe(false);
  });

  it('clears user-disabled marker when cloud sync is enabled again', () => {
    setCloudSyncEnabled(false, { source: 'user' });
    setCloudSyncEnabled(true, { source: 'user' });

    expect(localStorage.getItem(ENABLED_KEY)).toBe('1');
    expect(localStorage.getItem(USER_DISABLED_KEY)).toBeNull();
    expect(isCloudSyncEnabled()).toBe(true);
    expect(isCloudSyncUserDisabled()).toBe(false);
  });

  it('does not override an explicit user-disabled marker from auth refreshes', () => {
    setCloudSyncEnabled(false, { source: 'user' });
    setCloudSyncEnabled(true, { source: 'auth' });

    expect(localStorage.getItem(ENABLED_KEY)).toBe('0');
    expect(localStorage.getItem(USER_DISABLED_KEY)).toBe('1');
    expect(isCloudSyncEnabled()).toBe(false);
    expect(isCloudSyncUserDisabled()).toBe(true);
  });
});
