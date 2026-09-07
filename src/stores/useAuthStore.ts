import { create } from 'zustand';
import { ApiError, api } from '../services/api';
import { buildApiErrorUserMessage } from '../services/apiErrorMessage';
import { useSettingsStore } from './useSettingsStore';
import { storageKey } from '../constants/brand';
import { reportRecoverableError } from '../services/diagnostics';
import { rememberCloudUserId } from '../services/authStorageScope';
import { rememberLastCloudPhone } from '../services/authSession';
import { isCloudSyncBootstrapLocked, runWithCloudSyncBootstrapLock } from '../services/cloudSyncBootstrapLock';
import { isCloudSyncEnabled, isCloudSyncUserDisabled, setCloudSyncEnabled } from '../services/cloudSyncPreference';
import { setAssistantArtifactCloudSyncEnabled } from '../services/assistantArtifactCloudSyncPreference';

interface User {
  id: string;
  phone: string;
  email?: string;
  nickname: string;
  avatar: string;
  cloudSyncEntitled?: boolean;
  assistantArtifactCloudSyncEntitled?: boolean;
  aiProxyEntitled?: boolean;
  agentEntitled?: boolean;
  aiSearchEntitled?: boolean;
  alapiDoutuEnabled?: boolean;
  marketAccessEntitled?: boolean;
  marketUploadEntitled?: boolean;
  chatShareEntitled?: boolean;
  developerModeEntitled?: boolean;
  retentionLimits?: Record<string, { storage: number; recall: number }>;
  cloudStorageBytes?: number;
  cloudStorageMembershipBytes?: number;
  cloudStorageAccountBytes?: number;
  cloudStorageGrants?: Array<{ bytes: number; expiresAt: number | null }>;
}

type AuthMode = 'cloud' | 'local';

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  isWorkspaceReady: boolean;
  authMode: AuthMode;

  // Actions
  sendCode: (phone: string, purpose?: 'login' | 'register' | 'forgot-password' | 'change-phone', captchaToken?: string) => Promise<{ success: boolean; mock?: boolean; code?: string }>;
  login: (phone: string, code: string) => Promise<void>;
  loginWithPassword: (phone: string, password: string) => Promise<void>;
  enterLocalMode: () => Promise<void>;
  logout: () => Promise<void>;
  expireCloudSession: () => void;
  checkAuth: () => Promise<boolean>;
  setUser: (user: User) => void;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  sendChangePhoneCode: (phone: string, captchaToken?: string) => Promise<{ success: boolean; mock?: boolean; code?: string }>;
  changePhone: (phone: string, code: string) => Promise<void>;
  sendPasswordCode: (captchaToken?: string) => Promise<{ success: boolean; mock?: boolean; code?: string }>;
  changePassword: (data: { mode: 'old_password' | 'phone_code'; oldPassword?: string; code?: string; newPassword: string }) => Promise<void>;
}

async function loadWorkspaceStores() {
  const [chatStoreModule, characterStoreModule, messageStoreModule] = await Promise.all([
    import('./useChatStore'),
    import('./useCharacterStore'),
    import('./useMessageStore'),
  ]);
  return {
    resetChatStoreForAccountBoundary: chatStoreModule.resetChatStoreForAccountBoundary,
    resetCharacterStoreForAccountBoundary: characterStoreModule.resetCharacterStoreForAccountBoundary,
    resetMessageStoreForAccountBoundary: messageStoreModule.resetMessageStoreForAccountBoundary,
    useChatStore: chatStoreModule.useChatStore,
    useCharacterStore: characterStoreModule.useCharacterStore,
  };
}

function canRefreshRemoteAfterAuth(user: User | null) {
  return user?.cloudSyncEntitled !== false && isCloudSyncEnabled() && !isCloudSyncBootstrapLocked();
}

async function hydrateWorkspaceStoresFromCurrentScope() {
  const { useChatStore, useCharacterStore } = await loadWorkspaceStores();
  const artifactStoreModule = await import('./useCharacterArtifactStore');
  await Promise.allSettled([
    useChatStore.persist.rehydrate(),
    useCharacterStore.persist.rehydrate(),
    artifactStoreModule.useCharacterArtifactStore.persist.rehydrate(),
  ]);
  return {
    useChatStore,
    useCharacterStore,
  };
}

async function refreshStoresAfterCloudAuth(user: User | null, options: { deferRemoteRefresh?: boolean } = {}) {
  const { useChatStore, useCharacterStore } = await hydrateWorkspaceStoresFromCurrentScope();
  const settingsStore = useSettingsStore.getState();
  const chatStore = useChatStore.getState();
  const characterStore = useCharacterStore.getState();
  chatStore.markChatsWarm();
  characterStore.markCharactersWarm();
  if (options.deferRemoteRefresh) return;
  if (canRefreshRemoteAfterAuth(user)) {
    void Promise.allSettled([
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

async function refreshRemoteStoresAfterCloudAuth(user: User | null) {
  const settingsStore = useSettingsStore.getState();
  const [{ useChatStore }, { useCharacterStore }] = await Promise.all([
    import('./useChatStore'),
    import('./useCharacterStore'),
  ]);
  const chatStore = useChatStore.getState();
  const characterStore = useCharacterStore.getState();
  if (canRefreshRemoteAfterAuth(user)) {
    void Promise.allSettled([
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

async function refreshStoresAfterLocalAuthMode() {
  const { useChatStore, useCharacterStore } = await hydrateWorkspaceStoresFromCurrentScope();
  const chatStore = useChatStore.getState();
  const characterStore = useCharacterStore.getState();
  chatStore.markChatsWarm();
  characterStore.markCharactersWarm();
  void useSettingsStore.getState().loadSettings();
  void chatStore.prefetchChats();
  void characterStore.prefetchCharacters();
}

async function resetLocalWorkspaceStoresForAccountBoundary() {
  const {
    resetChatStoreForAccountBoundary,
    resetCharacterStoreForAccountBoundary,
    resetMessageStoreForAccountBoundary,
  } = await loadWorkspaceStores();
  const { resetCharacterArtifactStoreForAccountBoundary } = await import('./useCharacterArtifactStore');
  await resetChatStoreForAccountBoundary();
  await resetCharacterStoreForAccountBoundary();
  await resetMessageStoreForAccountBoundary();
  await resetCharacterArtifactStoreForAccountBoundary();
}

const AUTH_TOKEN_KEY = storageKey('token');
const AUTH_REFRESH_TOKEN_KEY = storageKey('refresh-token');
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

function setAuthRefreshToken(token: string) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, token);
}

function setAuthUser(user: User) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  rememberCloudUserId(user);
  rememberLastCloudPhone(user.phone);
}

function applyCloudSyncEntitlement(user: User | null) {
  if (user?.cloudSyncEntitled === false) {
    setCloudSyncEnabled(false, { source: 'entitlement' });
  }
  if (user?.assistantArtifactCloudSyncEntitled === false) {
    setAssistantArtifactCloudSyncEnabled(false);
  }
  if (user?.developerModeEntitled !== undefined) {
    useSettingsStore.setState((state) => user.developerModeEntitled
      ? { ...state, developerModeEntitled: true }
      : {
          ...state,
          developerModeEntitled: false,
          developerMode: false,
          memoryUI: { ...state.memoryUI, showDeveloperMemory: false },
        });
  }
}

function enableCloudSyncForLogin(user: User | null) {
  if (user?.cloudSyncEntitled !== false && !isCloudSyncUserDisabled()) {
    setCloudSyncEnabled(true, { source: 'auth' });
  }
  applyCloudSyncEntitlement(user);
}

function clearAuthTokenAndUser() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
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
  isWorkspaceReady: getAuthModeRaw() === 'local' || !getAuthToken(),
  authMode: (getAuthModeRaw() as AuthMode | null) || (getAuthToken() ? 'cloud' : 'local'),

  sendCode: async (phone: string, purpose = 'login', captchaToken?: string) => {
    const result = await api.sendCode(phone, purpose, captchaToken);
    return result;
  },

  sendChangePhoneCode: async (phone: string, captchaToken?: string) => {
    const result = await api.sendChangePhoneCode(phone, captchaToken);
    return result;
  },

  login: async (phone: string, code: string) => {
    set({ isLoading: true, isWorkspaceReady: false });
    const shouldBootstrapLocalData = get().authMode === 'local' && isCloudSyncEnabled();
    const bootstrapModule = shouldBootstrapLocalData ? await import('../services/localToCloudBootstrap') : null;
    const localSnapshot = bootstrapModule ? await bootstrapModule.captureLocalCloudBootstrapSnapshot() : null;
    try {
      const result = await api.login(phone, code);
      setAuthToken(result.token);
      setAuthRefreshToken(result.refreshToken);
      setAuthUser(result.user);
      enableCloudSyncForLogin(result.user);
      setAuthMode('cloud');
      set({
        token: result.token,
        user: result.user,
        isLoggedIn: true,
        isLoading: true,
        authMode: 'cloud',
      });
      await resetLocalWorkspaceStoresForAccountBoundary();
      if (bootstrapModule && localSnapshot && bootstrapModule.hasBootstrapEntityData(localSnapshot) && result.user.cloudSyncEntitled !== false && isCloudSyncEnabled()) {
        try {
          await runWithCloudSyncBootstrapLock(() => bootstrapModule.bootstrapLocalDataToCloud(localSnapshot));
        } catch (error) {
          await resetLocalWorkspaceStoresForAccountBoundary();
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
      const guestImportModule = await import('../services/guestDataImport');
      const guestImportSnapshot = await guestImportModule.readGuestImportSnapshot();
      const shouldDeferRemoteRefresh = Boolean(
        result.user?.id
        && guestImportModule.hasPendingGuestImportForUser(result.user.id, guestImportSnapshot),
      );
      await refreshStoresAfterCloudAuth(result.user, { deferRemoteRefresh: shouldDeferRemoteRefresh });
      set({ isLoading: false, isWorkspaceReady: true });
    } catch (error) {
      set({ isLoading: false, isWorkspaceReady: true });
      throw error;
    }
  },

  loginWithPassword: async (phone, password) => {
    set({ isLoading: true, isWorkspaceReady: false });
    try {
      const result = await api.passwordLogin(phone, password);
      setAuthToken(result.token); setAuthRefreshToken(result.refreshToken); setAuthUser(result.user); enableCloudSyncForLogin(result.user); setAuthMode('cloud');
      set({ token: result.token, user: result.user, isLoggedIn: true, isLoading: true, isWorkspaceReady: false, authMode: 'cloud' });
      await resetLocalWorkspaceStoresForAccountBoundary();
      await refreshStoresAfterCloudAuth(result.user);
      set({ isLoading: false, isWorkspaceReady: true });
    } catch (error) { set({ isLoading: false, isWorkspaceReady: true }); throw error; }
  },

  enterLocalMode: async () => {
    set({ isLoading: true, isWorkspaceReady: false });
    await resetLocalWorkspaceStoresForAccountBoundary();
    clearAuthTokenAndUser();
    setAuthMode('local');
    set({
      token: null,
      user: null,
      isLoggedIn: false,
      isLoading: true,
      isWorkspaceReady: false,
      authMode: 'local',
    });
    await refreshStoresAfterLocalAuthMode();
    set({ isLoading: false, isWorkspaceReady: true });
  },

  logout: async () => {
    set({ isLoading: true, isWorkspaceReady: false });
    const refreshToken = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_REFRESH_TOKEN_KEY) : null;
    await api.logout(refreshToken || undefined).catch(() => undefined);
    await resetLocalWorkspaceStoresForAccountBoundary();
    clearAuthTokenAndUser();
    setAuthMode('local');
    set({
      token: null,
      user: null,
      isLoggedIn: false,
      isLoading: true,
      isWorkspaceReady: false,
      authMode: 'local',
    });
    await refreshStoresAfterLocalAuthMode();
    set({ isLoading: false, isWorkspaceReady: true });
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
      isWorkspaceReady: true,
      authMode: 'cloud',
    });
  },

  checkAuth: async () => {
    const token = get().token;
    if (!token) return false;

    set({ isLoading: true, isWorkspaceReady: false });
    try {
      const user = await api.getMe();
      setAuthUser(user);
      enableCloudSyncForLogin(user);
      set({ user, isLoggedIn: true, authMode: 'cloud' });
      await refreshStoresAfterCloudAuth(user, { deferRemoteRefresh: true });
      if (!isCloudSyncUserDisabled()) await refreshRemoteStoresAfterCloudAuth(user);
      set({ isLoading: false, isWorkspaceReady: true });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        get().expireCloudSession();
        return false;
      }
      console.warn('[cloud-sync] auth check unavailable; keeping cloud-local cache active', { error });
      set({ isLoggedIn: true, isLoading: false, isWorkspaceReady: true, authMode: 'cloud' });
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

  sendPasswordCode: async (captchaToken) => api.sendPasswordCode(captchaToken),
  changePassword: async (data) => { await api.changePassword(data); },
}));
