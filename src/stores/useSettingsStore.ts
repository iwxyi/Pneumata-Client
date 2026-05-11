import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettingsWithMemory, ThemeMode, Language, APIConfig, AIModelProfile, ChatDraftDefaults, DeveloperUIPrefs, AvatarGenerationSettings } from '../types/settings';

type AppSettings = AppSettingsWithMemory;
import type { BubbleStyleDefinition } from '../types/bubbleStyle';
import { DEFAULT_SETTINGS, DEFAULT_AI_PROFILE, DEFAULT_AVATAR_GENERATION_SETTINGS, DEFAULT_CHAT_DRAFT_DEFAULTS, DEFAULT_DEVELOPER_UI_PREFS, getPreferredAIProfile, normalizeAIProfiles } from '../types/settings';
import { api } from '../services/api';
import { useAuthStore } from './useAuthStore';

interface SettingsStore extends AppSettings {
  _loaded: boolean;
  lastSyncedAt: number;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error';
  syncError: string | null;
  memoryUI?: { showDeveloperMemory?: boolean };
  setDeveloperMode: (enabled: boolean) => void;
  setAvatarGeneration: (prefs: Partial<AvatarGenerationSettings>) => void;
  setAutoGenerateCharacterAvatar: (enabled: boolean) => void;
  setDeveloperUI: (prefs: Partial<DeveloperUIPrefs>) => void;
  setMemoryDeveloperView: (enabled: boolean) => void;
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
  setCustomBubbleStyles: (styles: BubbleStyleDefinition[]) => void;
  resetSettings: () => void;
}

type SettingsSet = (partial: SettingsStore | Partial<SettingsStore> | ((state: SettingsStore) => SettingsStore | Partial<SettingsStore>), replace?: false) => unknown;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let savedStateTimer: ReturnType<typeof setTimeout> | null = null;

function clearSavedStateTimer() {
  if (savedStateTimer) {
    clearTimeout(savedStateTimer);
    savedStateTimer = null;
  }
}

function syncToServer(data: Record<string, unknown>, set: SettingsSet) {
  if (syncTimer) clearTimeout(syncTimer);
  clearSavedStateTimer();
  if (useAuthStore.getState().authMode === 'local') {
    set((state) => ({ ...state, syncStatus: 'idle', syncError: null }));
    return;
  }
  set((state) => ({ ...state, syncStatus: 'saving', syncError: null }));
  syncTimer = setTimeout(() => {
    api.updateSettings(data)
      .then(() => {
        set((state) => ({ ...state, syncStatus: 'saved', syncError: null, lastSyncedAt: Date.now() }));
        savedStateTimer = setTimeout(() => {
          set((state) => state.syncStatus === 'saved' ? { ...state, syncStatus: 'idle' } : state);
          savedStateTimer = null;
        }, 1800);
      })
      .catch((err) => {
        console.error('Failed to sync settings to server:', err);
        set((state) => ({ ...state, syncStatus: 'error', syncError: err instanceof Error ? err.message : String(err) }));
      });
  }, 500);
}

function buildApiFromProfiles(aiProfiles: AIModelProfile[]): APIConfig {
  const defaultProfile = getPreferredAIProfile(aiProfiles, 'text') || aiProfiles[0] || DEFAULT_AI_PROFILE;
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
    customBubbleStyles: state.customBubbleStyles,
    developerMode: state.developerMode,
    autoGenerateCharacterAvatar: state.avatarGeneration.autoGenerateCharacterAvatar,
    avatarGeneration: state.avatarGeneration,
    developerUI: state.developerUI,
    memoryUI: state.memoryUI,
  };
}

function syncState(state: Partial<AppSettings> & { api?: APIConfig; aiProfiles?: AIModelProfile[]; memoryUI?: { showDeveloperMemory?: boolean } }): Partial<AppSettings> {
  const aiProfiles = normalizeAIProfiles(state.aiProfiles, state.api);
  const legacyShowMemoryDebug = Boolean(state.memoryUI?.showDeveloperMemory);
  return {
    ...state,
    aiProfiles,
    api: buildApiFromProfiles(aiProfiles),
    developerMode: Boolean(state.developerMode),
    avatarGeneration: {
      ...DEFAULT_AVATAR_GENERATION_SETTINGS,
      ...(state.avatarGeneration || {}),
      autoGenerateCharacterAvatar: state.avatarGeneration?.autoGenerateCharacterAvatar ?? Boolean((state as { autoGenerateCharacterAvatar?: boolean }).autoGenerateCharacterAvatar),
      preferNonPhotorealAvatar: state.avatarGeneration?.preferNonPhotorealAvatar ?? false,
    },
    developerUI: {
      ...DEFAULT_DEVELOPER_UI_PREFS,
      ...(state.developerUI || {}),
      showMemoryDebug: state.developerUI?.showMemoryDebug ?? legacyShowMemoryDebug,
    },
    memoryUI: {
      showDeveloperMemory: state.developerUI?.showMemoryDebug ?? legacyShowMemoryDebug,
    },
    chatDraftDefaults: {
      ...DEFAULT_CHAT_DRAFT_DEFAULTS,
      ...(state.chatDraftDefaults || {}),
      runtimeEvolutionIntensity: state.chatDraftDefaults?.runtimeEvolutionIntensity || DEFAULT_CHAT_DRAFT_DEFAULTS.runtimeEvolutionIntensity,
    },
    customBubbleStyles: Array.isArray(state.customBubbleStyles) ? state.customBubbleStyles : [],
  };
}

function createProfile(index: number): AIModelProfile {
  return {
    ...DEFAULT_AI_PROFILE,
    id: `profile-${Date.now()}-${index}`,
    name: `Model ${index + 1}`,
    isDefault: false,
  };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      _loaded: false,
      lastSyncedAt: 0,
      syncStatus: 'idle',
      syncError: null,

      loadSettings: async () => {
        if (useAuthStore.getState().authMode === 'local') {
          set((state) => ({ ...state, _loaded: true, syncStatus: 'idle', syncError: null }));
          return;
        }
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
              developerMode: settings.developerMode,
              avatarGeneration: {
                ...DEFAULT_AVATAR_GENERATION_SETTINGS,
                ...((settings as { avatarGeneration?: AvatarGenerationSettings }).avatarGeneration || {}),
                autoGenerateCharacterAvatar: ((settings as { avatarGeneration?: AvatarGenerationSettings }).avatarGeneration?.autoGenerateCharacterAvatar)
                  ?? Boolean((settings as { autoGenerateCharacterAvatar?: boolean }).autoGenerateCharacterAvatar),
              },
              developerUI: settings.developerUI as DeveloperUIPrefs | undefined,
              memoryUI: settings.memoryUI as { showDeveloperMemory?: boolean } | undefined,
              chatDraftDefaults: {
                ...DEFAULT_CHAT_DRAFT_DEFAULTS,
                ...((settings.chatDraftDefaults || DEFAULT_CHAT_DRAFT_DEFAULTS) as ChatDraftDefaults),
              },
              customBubbleStyles: settings.customBubbleStyles as BubbleStyleDefinition[] | undefined,
            }),
            _loaded: true,
            lastSyncedAt: Date.now(),
            syncStatus: 'idle',
            syncError: null,
          });
        } catch (error) {
          console.error('Failed to load settings from server:', error);
          set({ _loaded: true, syncStatus: 'error', syncError: error instanceof Error ? error.message : String(error) });
        }
      },

      updateApi: (config) => {
        set((state) => {
          const nextApi = { ...state.api, ...config };
          const nextProfiles = [...state.aiProfiles];
          nextProfiles[0] = { ...nextProfiles[0], ...nextApi, id: 'default' };
          const next = { ...(syncState({ ...state, api: nextApi, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      updateAIProfile: (id, config) => {
        set((state) => {
          const targetProfile = state.aiProfiles.find((profile) => profile.id === id);
          const nextType = config.type || targetProfile?.type || 'text';
          const shouldBecomeDefault = config.isDefault === true
            || (!!config.type && !state.aiProfiles.some((profile) => profile.id !== id && (profile.type || 'text') === nextType));

          const nextProfiles = state.aiProfiles.map((profile, index) => {
            if (profile.id === id) {
              return {
                ...profile,
                ...config,
                id: index === 0 ? 'default' : profile.id,
                type: nextType,
                isDefault: shouldBecomeDefault ? true : (config.isDefault === false ? false : profile.isDefault),
              };
            }

            if (shouldBecomeDefault && (profile.type || 'text') === nextType) {
              return {
                ...profile,
                isDefault: false,
              };
            }

            return profile;
          });
          const next = { ...(syncState({ ...state, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      addAIProfile: () => {
        set((state) => {
          const nextProfile = createProfile(state.aiProfiles.length);
          const typeCount = state.aiProfiles.filter((profile) => (profile.type || 'text') === nextProfile.type).length;
          if (typeCount === 0) {
            nextProfile.isDefault = true;
          }
          const nextProfiles = [...state.aiProfiles, nextProfile];
          const next = { ...(syncState({ ...state, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      removeAIProfile: (id) => {
        set((state) => {
          const filtered = state.aiProfiles.filter((profile) => profile.id !== id);
          const nextProfiles = filtered.length > 0 ? filtered : [DEFAULT_AI_PROFILE];
          const next = { ...(syncState({ ...state, aiProfiles: nextProfiles }) as SettingsStore), lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setDeveloperMode: (developerMode) => {
        set((state) => {
          const next = { ...state, developerMode, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setAvatarGeneration: (prefs) => {
        set((state) => {
          const next = {
            ...state,
            avatarGeneration: {
              ...state.avatarGeneration,
              ...prefs,
            },
            lastSyncedAt: Date.now(),
          };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setAutoGenerateCharacterAvatar: (autoGenerateCharacterAvatar) => {
        set((state) => {
          const next = {
            ...state,
            avatarGeneration: {
              ...state.avatarGeneration,
              autoGenerateCharacterAvatar,
            },
            lastSyncedAt: Date.now(),
          };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setDeveloperUI: (prefs) => {
        set((state) => {
          const developerUI = { ...state.developerUI, ...prefs };
          const next = {
            ...state,
            developerUI,
            memoryUI: { showDeveloperMemory: developerUI.showMemoryDebug },
            lastSyncedAt: Date.now(),
          };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setMemoryDeveloperView: (enabled) => {
        set((state) => {
          const developerUI = { ...state.developerUI, showMemoryDebug: enabled };
          const next = {
            ...state,
            developerUI,
            memoryUI: { showDeveloperMemory: enabled },
            lastSyncedAt: Date.now(),
          };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setTheme: (theme) => {
        set((state) => {
          const next = { ...state, theme, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setThemeColor: (themeColor) => {
        set((state) => {
          const next = { ...state, themeColor, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setLanguage: (language) => {
        localStorage.setItem('mirageTea-language', language);
        set((state) => {
          const next = { ...state, language, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setDefaultSpeed: (defaultSpeed) => {
        set((state) => {
          const next = { ...state, defaultSpeed, lastSyncedAt: Date.now() };
          syncToServer(buildSettingsPayload(next), set);
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
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setCustomBubbleStyles: (customBubbleStyles) => {
        set((state) => {
          const next = {
            ...state,
            customBubbleStyles,
            lastSyncedAt: Date.now(),
          };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      resetSettings: () => {
        const next = { ...(syncState(DEFAULT_SETTINGS) as SettingsStore), lastSyncedAt: Date.now() };
        set(next);
        syncToServer(buildSettingsPayload(next), set);
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
        developerMode: state.developerMode,
        avatarGeneration: state.avatarGeneration,
        developerUI: state.developerUI,
        memoryUI: state.memoryUI,
        chatDraftDefaults: state.chatDraftDefaults,
        customBubbleStyles: state.customBubbleStyles,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...syncState({ ...(currentState as AppSettings), ...(persistedState as Partial<AppSettings>) }),
      }),
    }
  )
);
