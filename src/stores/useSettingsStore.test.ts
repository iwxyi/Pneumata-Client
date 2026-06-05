import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey } from '../constants/brand';

function createStorageMock() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
}

const apiMocks = vi.hoisted(() => ({
  getSyncChanges: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      getSyncChanges: apiMocks.getSyncChanges,
      getSettings: apiMocks.getSettings,
      updateSettings: apiMocks.updateSettings,
    },
  };
});

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
    localStorage.setItem(storageKey('token'), 'token');
    localStorage.setItem(storageKey('auth-mode'), 'cloud');
    apiMocks.getSyncChanges.mockReset();
    apiMocks.getSettings.mockReset();
    apiMocks.updateSettings.mockReset();
  });

  it('does not rewrite local settings when the remote scope is not modified', async () => {
    apiMocks.getSyncChanges.mockResolvedValueOnce({
      status: 'not_modified',
      scope: 'settings.account',
      cursor: 'settings.account:rev-1',
      revision: 'rev-1',
      changes: [],
    });
    const { useSettingsStore } = await import('./useSettingsStore');
    useSettingsStore.setState({
      _loaded: true,
      lastSyncedAt: 1,
      syncStatus: 'idle',
      syncError: null,
      themeColor: '#315A9C',
    });
    let writes = 0;
    const unsubscribe = useSettingsStore.subscribe(() => {
      writes += 1;
    });

    await useSettingsStore.getState().loadSettings();

    unsubscribe();
    expect(writes).toBe(0);
    expect(apiMocks.getSyncChanges).toHaveBeenCalledWith({
      scope: 'settings.account',
      since: null,
    });
    expect(apiMocks.getSettings).not.toHaveBeenCalled();
  });
});
