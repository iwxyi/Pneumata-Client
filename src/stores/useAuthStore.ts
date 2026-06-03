import { create } from 'zustand';
import { ApiError, api } from '../services/api';
import { clearPersistedChatStore, useChatStore } from './useChatStore';
import { clearPersistedCharacterStore, useCharacterStore } from './useCharacterStore';
import { clearPersistedMessageStore } from './useMessageStore';
import { useSettingsStore } from './useSettingsStore';
import { storageKey } from '../constants/brand';
import { bootstrapLocalDataToCloud, captureLocalCloudBootstrapSnapshot } from '../services/localToCloudBootstrap';
import { reportRecoverableError } from '../services/diagnostics';
import { rememberCloudUserId } from '../services/authStorageScope';

interface User {
  id: string;
  phone: string;
  nickname: string;
  avatar: string;
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
  checkAuth: () => Promise<boolean>;
  setUser: (user: User) => void;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  sendChangePhoneCode: (phone: string) => Promise<{ success: boolean; mock?: boolean; code?: string }>;
  changePhone: (phone: string, code: string) => Promise<void>;
}

async function refreshStoresAfterCloudAuth() {
  await Promise.allSettled([
    useSettingsStore.getState().loadSettings(),
    useChatStore.getState().loadChats(),
    useCharacterStore.getState().loadCharacters(),
  ]);
}

const AUTH_TOKEN_KEY = storageKey('token');
const AUTH_USER_KEY = storageKey('user');
const AUTH_MODE_KEY = storageKey('auth-mode');
function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthUserRaw() {
  return localStorage.getItem(AUTH_USER_KEY);
}

function getAuthModeRaw() {
  return localStorage.getItem(AUTH_MODE_KEY);
}

function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function setAuthUser(user: User) {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  rememberCloudUserId(user);
}

function clearAuthTokenAndUser() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function setAuthMode(mode: AuthMode) {
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
      setAuthMode('cloud');
      set({
        token: result.token,
        user: result.user,
        isLoggedIn: true,
        isLoading: false,
        authMode: 'cloud',
      });
      if (localSnapshot) {
        try {
          await bootstrapLocalDataToCloud(localSnapshot);
        } catch (error) {
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
      await refreshStoresAfterCloudAuth();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  enterLocalMode: () => {
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
    clearAuthTokenAndUser();
    setAuthMode('local');
    clearPersistedChatStore();
    clearPersistedCharacterStore();
    clearPersistedMessageStore();
    set({
      token: null,
      user: null,
      isLoggedIn: false,
      authMode: 'local',
    });
  },

  checkAuth: async () => {
    const token = get().token;
    if (!token) return false;

    try {
      const user = await api.getMe();
      setAuthUser(user);
      set({ user, isLoggedIn: true, authMode: 'cloud' });
      void refreshStoresAfterCloudAuth();
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        console.warn('[cloud-sync] token rejected; falling back to local mode', { error });
        clearAuthTokenAndUser();
        setAuthMode('local');
        set({ token: null, user: null, isLoggedIn: false, authMode: 'local' });
        return false;
      }
      console.warn('[cloud-sync] auth check unavailable; keeping cloud-local cache active', { error });
      set({ isLoggedIn: true, authMode: 'cloud' });
      return false;
    }
  },

  setUser: (user: User) => {
    setAuthUser(user);
    set({ user });
  },

  updateProfile: async (updates) => {
    try {
      const result = await api.updateMe({ nickname: updates.nickname, avatar: updates.avatar });
      setAuthUser(result);
      set({ user: result });
    } catch (error) {
      reportRecoverableError({
        location: 'auth:update-profile',
        error,
        userMessage: '账号资料更新失败，请稍后重试。',
      });
      throw error;
    }
  },

  changePhone: async (phone, code) => {
    try {
      const result = await api.changePhone(phone, code);
      setAuthUser(result);
      set({ user: result });
    } catch (error) {
      reportRecoverableError({
        location: 'auth:change-phone',
        error,
        userMessage: '手机号修改失败，请稍后重试。',
      });
      throw error;
    }
  },
}));
