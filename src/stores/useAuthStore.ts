import { create } from 'zustand';
import { api } from '../services/api';
import { clearPersistedChatStore, useChatStore } from './useChatStore';
import { clearPersistedCharacterStore, useCharacterStore } from './useCharacterStore';
import { clearPersistedMessageStore } from './useMessageStore';
import { useSettingsStore } from './useSettingsStore';

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

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: localStorage.getItem('miragetea-token'),
  user: (() => {
    try {
      const stored = localStorage.getItem('miragetea-user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  })(),
  isLoggedIn: !!localStorage.getItem('miragetea-token'),
  isLoading: false,
  authMode: (localStorage.getItem('miragetea-auth-mode') as AuthMode | null) || (localStorage.getItem('miragetea-token') ? 'cloud' : 'local'),

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
    try {
      const result = await api.login(phone, code);
      localStorage.setItem('miragetea-token', result.token);
      localStorage.setItem('miragetea-user', JSON.stringify(result.user));
      localStorage.setItem('miragetea-auth-mode', 'cloud');
      set({
        token: result.token,
        user: result.user,
        isLoggedIn: true,
        isLoading: false,
        authMode: 'cloud',
      });
      await refreshStoresAfterCloudAuth();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  enterLocalMode: () => {
    localStorage.removeItem('miragetea-token');
    localStorage.removeItem('miragetea-user');
    localStorage.setItem('miragetea-auth-mode', 'local');
    set({
      token: null,
      user: null,
      isLoggedIn: false,
      authMode: 'local',
    });
  },

  logout: () => {
    localStorage.removeItem('miragetea-token');
    localStorage.removeItem('miragetea-user');
    localStorage.setItem('miragetea-auth-mode', 'local');
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
      localStorage.setItem('miragetea-user', JSON.stringify(user));
      set({ user, isLoggedIn: true, authMode: 'cloud' });
      void refreshStoresAfterCloudAuth();
      return true;
    } catch {
      // Token invalid
      localStorage.removeItem('miragetea-token');
      localStorage.removeItem('miragetea-user');
      localStorage.setItem('miragetea-auth-mode', 'local');
      set({ token: null, user: null, isLoggedIn: false, authMode: 'local' });
      return false;
    }
  },

  setUser: (user: User) => {
    localStorage.setItem('miragetea-user', JSON.stringify(user));
    set({ user });
  },

  updateProfile: async (updates) => {
    const result = await api.updateMe({ nickname: updates.nickname, avatar: updates.avatar });
    localStorage.setItem('miragetea-user', JSON.stringify(result));
    set({ user: result });
  },

  changePhone: async (phone, code) => {
    const result = await api.changePhone(phone, code);
    localStorage.setItem('miragetea-user', JSON.stringify(result));
    set({ user: result });
  },
}));
