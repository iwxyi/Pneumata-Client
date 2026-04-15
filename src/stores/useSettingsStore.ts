import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings, ThemeMode, Language, APIConfig, AIModelProfile, ChatDraftDefaults } from '../types/settings';
import { DEFAULT_SETTINGS, DEFAULT_AI_PROFILE, DEFAULT_CHAT_DRAFT_DEFAULTS } from '../types/settings';
import { api } from '../services/api';

interface SettingsStore extends AppSettings {
  _loaded: boolean;
  lastSyncedAt: number;
  loadSettings: () => Promise<void>;
  updateApi: (config: Partial<APIConfig>) => void;
  updateAIProfile: (id: string, config: Partial<AIModelProfile>) => void;
  addAIProfile: () => void;
  removeAIProfile: (id: string) => void;
  setTheme: (mode: ThemeMode) => void;
  setThemeColor: (color: string) => void;
  setLanguage: (lang: Language) => void;
  setDefaultSpeed: (speed: number) => void;
  setChatDraftDefaults: (defaults: Partial<ChatDraftDefaults>) => void;
  resetSettings: () => void;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

function syncToServer(data: Record<string, unknown>) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    api.updateSettings(data).catch((err) => {
      console.error('Failed to sync settings to server:', err);
    });
  }, 500);
}

function normalizeProfiles(aiProfiles?: AIModelProfile[], api?: APIConfig): AIModelProfile[] {
  if (Array.isArray(aiProfiles) && aiProfiles.length > 0) {
    return aiProfiles.map((profile, index) => ({
      ...DEFAULT_AI_PROFILE,
      ...profile,
      id: index === 0 ? 'default' : (profile.id || `profile-${index + 1}`),
      name: index === 0 ? (profile.name || 'Default') : (profile.name || `Model ${index + 1}`),
    }));
  }

  return [{
    ...DEFAULT_AI_PROFILE,
    ...(api || DEFAULT_AI_PROFILE),
    id: 'default',
    name: 'Default',
  }];
}

function buildApiFromProfiles(aiProfiles: AIModelProfile[]): APIConfig {
  const defaultProfile = aiProfiles[0] || DEFAULT_AI_PROFILE;
  return {
    provider: defaultProfile.provider,
    apiKey: defaultProfile.apiKey,
    baseUrl: defaultProfile.baseUrl,
    model: defaultProfile.model,
  };
}

function buildSettingsPayload(state: AppSettings) {
  return {
    api: state.api,
    aiProfiles: state.aiProfiles,
    theme: state.theme,
    themeColor: state.themeColor,
    language: state.language,
    defaultSpeed: state.defaultSpeed,
    chatDraftDefaults: state.chatDraftDefaults,
  };
}

function syncState(state: Partial<AppSettings> & { api?: APIConfig; aiProfiles?: AIModelProfile[] }): Partial<AppSettings> {
  const aiProfiles = normalizeProfiles(state.aiProfiles, state.api);
  return {
    ...state,
    aiProfiles,
    api: buildApiFromProfiles(aiProfiles),
    chatDraftDefaults: {
      ...DEFAULT_CHAT_DRAFT_DEFAULTS,
      ...(state.chatDraftDefaults || {}),
    },
  };
}

function createProfile(index: number): AIModelProfile {
  return {
    ...DEFAULT_AI_PROFILE,
    id: `profile-${Date.now()}-${index}`,
    name: `Model ${index + 1}`,
  };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      _loaded: false,
      lastSyncedAt: 0,

      loadSettings: async () => {
        try {
          const settings = await api.getSettings();
          set({
            ...syncState({
              api: settings.api as APIConfig,
              aiProfiles: settings.aiProfiles as AIModelProfile[] | undefined,
              theme: settings.theme as ThemeMode,
              themeColor: settings.themeColor,
              language: settings.language as Language,
              defaultSpeed: settings.defaultSpeed,
              chatDraftDefaults: settings.chatDraftDefaults || DEFAULT_CHAT_DRAFT_DEFAULTS,
            }),
            _loaded: true,
            lastSyncedAt: Date.now(),
          });
        } catch (error) {
          console.error('Failed to load settings from server:', error);
          set({ _loaded: true, ...syncState(DEFAULT_SETTINGS) });
        }
      },

      updateApi: (config) => {
        set((state) => {
          const nextApi = { ...state.api, ...config };
          const nextProfiles = [...state.aiProfiles];
          nextProfiles[0] = { ...nextProfiles[0], ...nextApi, id: 'default' };
          const next = { ...(syncState({ ...state, api: nextApi, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      updateAIProfile: (id, config) => {
        set((state) => {
          const nextProfiles = state.aiProfiles.map((profile, index) => {
            if (profile.id !== id) return profile;
            return {
              ...profile,
              ...config,
              id: index === 0 ? 'default' : profile.id,
            };
          });
          const next = { ...(syncState({ ...state, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      addAIProfile: () => {
        set((state) => {
          const nextProfiles = [...state.aiProfiles, createProfile(state.aiProfiles.length)];
          const next = { ...(syncState({ ...state, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      removeAIProfile: (id) => {
        set((state) => {
          const filtered = state.aiProfiles.filter((profile) => profile.id !== id);
          const nextProfiles = filtered.length > 0 ? filtered : [DEFAULT_AI_PROFILE];
          const next = { ...(syncState({ ...state, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      setTheme: (theme) => {
        set((state) => {
          const next = { ...state, theme, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      setThemeColor: (themeColor) => {
        set((state) => {
          const next = { ...state, themeColor, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      setLanguage: (language) => {
        localStorage.setItem('mirageTea-language', language);
        set((state) => {
          const next = { ...state, language, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      setDefaultSpeed: (defaultSpeed) => {
        set((state) => {
          const next = { ...state, defaultSpeed, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      setChatDraftDefaults: (defaults) => {
        set((state) => {
          const next = {
            ...state,
            lastSyncedAt: Date.now(),
            chatDraftDefaults: {
              ...state.chatDraftDefaults,
              ...defaults,
            },
          };
          syncToServer(buildSettingsPayload(next));
          return next;
        });
      },

      resetSettings: () => {
        const next = { ...(syncState(DEFAULT_SETTINGS) as SettingsStore), lastSyncedAt: Date.now() };
        set(next);
        syncToServer(buildSettingsPayload(next));
      },
    }),
    {
      name: 'mirageTea-settings',
      partialize: (state) => ({
        api: state.api,
        aiProfiles: state.aiProfiles,
        theme: state.theme,
        themeColor: state.themeColor,
        language: state.language,
        defaultSpeed: state.defaultSpeed,
        chatDraftDefaults: state.chatDraftDefaults,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...syncState({ ...(currentState as AppSettings), ...(persistedState as Partial<AppSettings>) }),
      }),
    }
  )
);
