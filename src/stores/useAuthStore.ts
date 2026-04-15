import { create } from 'zustand';
import { api } from '../services/api';
import { clearPersistedChatStore } from './useChatStore';
import { clearPersistedCharacterStore } from './useCharacterStore';
import { clearPersistedMessageStore } from './useMessageStore';

interface User {
  id: string;
  phone: string;
  nickname: string;
  avatar: string;
}

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  // Actions
  sendCode: (phone: string) => Promise<{ success: boolean; mock?: boolean; code?: string }>;
  login: (phone: string, code: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  setUser: (user: User) => void;
  updateProfile: (updates: Partial<User>) => Promise<void>;
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

  sendCode: async (phone: string) => {
    const result = await api.sendCode(phone);
    return result;
  },

  login: async (phone: string, code: string) => {
    set({ isLoading: true });
    try {
      const result = await api.login(phone, code);
      localStorage.setItem('miragetea-token', result.token);
      localStorage.setItem('miragetea-user', JSON.stringify(result.user));
      set({
        token: result.token,
        user: result.user,
        isLoggedIn: true,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('miragetea-token');
    localStorage.removeItem('miragetea-user');
    clearPersistedChatStore();
    clearPersistedCharacterStore();
    clearPersistedMessageStore();
    set({
      token: null,
      user: null,
      isLoggedIn: false,
    });
  },

  checkAuth: async () => {
    const token = get().token;
    if (!token) return false;

    try {
      const user = await api.getMe();
      localStorage.setItem('miragetea-user', JSON.stringify(user));
      set({ user, isLoggedIn: true });
      return true;
    } catch {
      // Token invalid
      localStorage.removeItem('miragetea-token');
      localStorage.removeItem('miragetea-user');
      set({ token: null, user: null, isLoggedIn: false });
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
}));
