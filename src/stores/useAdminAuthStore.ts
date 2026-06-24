import { create } from 'zustand';
import { ApiError } from '../services/api';
import { adminApi, type AdminUser } from '../services/adminApi';

interface AdminAuthStore {
  token: string | null;
  admin: AdminUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

const initialAdminToken = adminApi.getToken();

export const useAdminAuthStore = create<AdminAuthStore>((set) => ({
  token: initialAdminToken,
  admin: null,
  isLoggedIn: Boolean(initialAdminToken),
  isLoading: Boolean(initialAdminToken),
  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const result = await adminApi.login(email, password);
      adminApi.setToken(result.token);
      set({ token: result.token, admin: result.admin, isLoggedIn: true, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },
  logout: () => {
    adminApi.setToken(null);
    set({ token: null, admin: null, isLoggedIn: false, isLoading: false });
  },
  checkAuth: async () => {
    const token = adminApi.getToken();
    if (!token) {
      set({ token: null, admin: null, isLoggedIn: false, isLoading: false });
      return false;
    }
    set({ token, isLoggedIn: true, isLoading: true });
    try {
      const admin = await adminApi.me();
      set({ token, admin, isLoggedIn: true, isLoading: false });
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        adminApi.setToken(null);
      }
      set({ token: null, admin: null, isLoggedIn: false, isLoading: false });
      return false;
    }
  },
}));
