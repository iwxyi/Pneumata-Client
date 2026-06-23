import { create } from 'zustand';
import { ApiError, api } from '../services/api';
import { buildApiErrorUserMessage } from '../services/apiErrorMessage';
import { resetChatStoreForAccountBoundary, useChatStore } from './useChatStore';
import { resetCharacterStoreForAccountBoundary, useCharacterStore } from './useCharacterStore';
import { resetMessageStoreForAccountBoundary } from './useMessageStore';
import { resetCharacterArtifactStoreForAccountBoundary } from './useCharacterArtifactStore';
import { useSettingsStore } from './useSettingsStore';
import { storageKey } from '../constants/brand';
import { bootstrapLocalDataToCloud, captureLocalCloudBootstrapSnapshot, hasBootstrapEntityData } from '../services/localToCloudBootstrap';
import { reportRecoverableError } from '../services/diagnostics';
import { rememberCloudUserId } from '../services/authStorageScope';
import { rememberLastCloudPhone } from '../services/authSession';
import { runWithCloudSyncBootstrapLock } from '../services/cloudSyncBootstrapLock';
import { setCloudSyncEnabled } from '../services/cloudSyncPreference';

interface User {
  id: string;
  phone: string;
  nickname: string;
  avatar: string;
  cloudSyncEntitled?: boolean;
}

type AuthMode = 'cloud' | 'local';

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  authMode: AuthMode;

  // Actions
  sendCode: (phone: string, purpose?: 'login' | 'register' | 'forgot-password' | 'change-phone') => Promise<{ success: boolean; mock?: boolean; code?: string }>;
  login: (phone: string, code: string) => Promise<void>;
  enterLocalMode: () => void;
  logout: () => void;
  expireCloudSession: () => void;
  checkAuth: () => Promise<boolean>;
  setUser: (user: User) => void;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  sendChangePhoneCode: (phone: string) => Promise<{ success: boolean; mock?: boolean; code?: string }>;
  changePhone: (phone: string, code: string) => Promise<void>;
}

async function refreshStoresAfterCloudAuth(options: { forceRemote?: boolean } = {}) {
  const settingsStore = useSettingsStore.getState();
  const chatStore = useChatStore.getState();
  const characterStore = useCharacterStore.getState();
  chatStore.markChatsWarm();
  characterStore.markCharactersWarm();
  if (options.forceRemote) {
    await Promise.allSettled([
      settingsStore.refreshSettingsFromCloud(),
      chatStore.refreshChatSummaryFromCloud(),
      characterStore.refreshCharacterSummaryFromCloud(),
    ]);
    return;
  }
  void settingsStore.loadSettings();
  void chatStore.prefetchChats();
  void characterStore.prefetchCharacters();
}

function resetLocalWorkspaceStoresForAccountBoundary() {
  resetChatStoreForAccountBoundary();
  resetCharacterStoreForAccountBoundary();
  resetMessageStoreForAccountBoundary();
  resetCharacterArtifactStoreForAccountBoundary();
}

const AUTH_TOKEN_KEY = storageKey('token');
const AUTH_USER_KEY = storageKey('user');
const AUTH_MODE_KEY = storageKey('auth-mode');
function getAuthToken() {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthUserRaw() {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(AUTH_USER_KEY);
}

function getAuthModeRaw() {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(AUTH_MODE_KEY);
}

function setAuthToken(token: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function setAuthUser(user: User) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  rememberCloudUserId(user);
  rememberLastCloudPhone(user.phone);
}

function applyCloudSyncEntitlement(user: User | null) {
  if (user?.cloudSyncEntitled === false) {
    setCloudSyncEnabled(false);
  }
}

function enableCloudSyncForLogin(user: User | null) {
  if (user?.cloudSyncEntitled !== false) {
    setCloudSyncEnabled(true);
  }
  applyCloudSyncEntitlement(user);
}

function clearAuthTokenAndUser() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function setAuthMode(mode: AuthMode) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AUTH_MODE_KEY, mode);
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: getAuthToken(),
  user: (() => {
    try {
      const stored = getAuthUserRaw();
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  })(),
  isLoggedIn: !!getAuthToken(),
  isLoading: false,
  authMode: (getAuthModeRaw() as AuthMode | null) || (getAuthToken() ? 'cloud' : 'local'),

  sendCode: async (phone: string, purpose = 'login') => {
    const result = await api.sendCode(phone, purpose);
    return result;
  },

  sendChangePhoneCode: async (phone: string) => {
    const result = await api.sendChangePhoneCode(phone);
    return result;
  },

  login: async (phone: string, code: string) => {
    set({ isLoading: true });
    const shouldBootstrapLocalData = get().authMode === 'local';
    const localSnapshot = shouldBootstrapLocalData ? await captureLocalCloudBootstrapSnapshot() : null;
    try {
      const result = await api.login(phone, code);
      setAuthToken(result.token);
      setAuthUser(result.user);
      enableCloudSyncForLogin(result.user);
      setAuthMode('cloud');
      set({
        token: result.token,
        user: result.user,
        isLoggedIn: true,
        isLoading: false,
        authMode: 'cloud',
      });
      if (localSnapshot && hasBootstrapEntityData(localSnapshot) && result.user.cloudSyncEntitled !== false) {
        try {
          await runWithCloudSyncBootstrapLock(() => bootstrapLocalDataToCloud(localSnapshot));
        } catch (error) {
          resetLocalWorkspaceStoresForAccountBoundary();
          clearAuthTokenAndUser();
          setAuthMode('local');
          set({
            token: null,
            user: null,
            isLoggedIn: false,
            isLoading: false,
            authMode: 'local',
          });
          throw error;
        }
      }
      await refreshStoresAfterCloudAuth({ forceRemote: result.user.cloudSyncEntitled !== false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  enterLocalMode: () => {
    resetLocalWorkspaceStoresForAccountBoundary();
    clearAuthTokenAndUser();
    setAuthMode('local');
    set({
      token: null,
      user: null,
      isLoggedIn: false,
      authMode: 'local',
    });
  },

  logout: () => {
    resetLocalWorkspaceStoresForAccountBoundary();
    clearAuthTokenAndUser();
    setAuthMode('local');
    set({
      token: null,
      user: null,
      isLoggedIn: false,
      authMode: 'local',
    });
  },

  expireCloudSession: () => {
    const phone = get().user?.phone;
    if (phone) rememberLastCloudPhone(phone);
    clearAuthTokenAndUser();
    setAuthMode('cloud');
    set({
      token: null,
      user: null,
      isLoggedIn: false,
      isLoading: false,
      authMode: 'cloud',
    });
  },

  checkAuth: async () => {
    const token = get().token;
    if (!token) return false;

    try {
      const user = await api.getMe();
      setAuthUser(user);
      applyCloudSyncEntitlement(user);
      set({ user, isLoggedIn: true, authMode: 'cloud' });
      void refreshStoresAfterCloudAuth({ forceRemote: user.cloudSyncEntitled !== false });
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        get().expireCloudSession();
        return false;
      }
      console.warn('[cloud-sync] auth check unavailable; keeping cloud-local cache active', { error });
      set({ isLoggedIn: true, authMode: 'cloud' });
      return false;
    }
  },

  setUser: (user: User) => {
    setAuthUser(user);
    applyCloudSyncEntitlement(user);
    set({ user });
  },

  updateProfile: async (updates) => {
    try {
      const result = await api.updateMe({ nickname: updates.nickname, avatar: updates.avatar });
      setAuthUser(result);
      applyCloudSyncEntitlement(result);
      set({ user: result });
    } catch (error) {
      reportRecoverableError({
        location: 'auth:update-profile',
        error,
        userMessage: buildApiErrorUserMessage(error, '账号资料更新'),
      });
      throw error;
    }
  },

  changePhone: async (phone, code) => {
    try {
      const result = await api.changePhone(phone, code);
      setAuthUser(result);
      applyCloudSyncEntitlement(result);
      set({ user: result });
    } catch (error) {
      reportRecoverableError({
        location: 'auth:change-phone',
        error,
        userMessage: buildApiErrorUserMessage(error, '手机号修改'),
      });
      throw error;
    }
  },
}));
