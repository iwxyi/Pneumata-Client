import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettingsWithMemory, ThemeMode, Language, APIConfig, AIModelProfile, ChatDraftDefaults, DeveloperUIPrefs, AvatarGenerationSettings, AIGenerationSettings, CompanionshipSettings } from '../types/settings';
import type { ArtifactAppearanceSettings } from '../types/artifactAppearance';

type AppSettings = AppSettingsWithMemory;
import type { BubbleStyleDefinition } from '../types/bubbleStyle';
import { DEFAULT_SETTINGS, DEFAULT_AI_PROFILE, DEFAULT_AVATAR_GENERATION_SETTINGS, DEFAULT_AI_GENERATION_SETTINGS, DEFAULT_COMPANIONSHIP_SETTINGS, DEFAULT_CHAT_DRAFT_DEFAULTS, DEFAULT_DEVELOPER_UI_PREFS, getPreferredAIProfile, normalizeAIProfiles } from '../types/settings';
import { DEFAULT_ARTIFACT_APPEARANCE_SETTINGS, PAPER_SURFACE_VARIANTS } from '../types/artifactAppearance';
import { api, type SyncChangeScope } from '../services/api';
import { reportRecoverableError } from '../services/diagnostics';
import { useAuthStore } from './useAuthStore';
import { CLIENT_STORE_SCHEMA_VERSION, migrateSettingsStoreState } from './storeMigrations';
import { scopedStorageKey } from '../constants/brand';
import { getLocalDataUserId } from '../services/authStorageScope';
import { setAIGenerationRuntimeConfig } from '../services/aiGenerationRuntimeConfig';
import { setCompanionshipRuntimeConfig } from '../services/companionshipRuntimeConfig';
import { isCloudSyncEnabled } from '../services/cloudSyncPreference';
import { createSyncScopeMetadata } from './syncScopeMetadata';

interface SettingsStore extends AppSettings {
  _loaded: boolean;
  lastSyncedAt: number;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error';
  syncError: string | null;
  memoryUI?: { showDeveloperMemory?: boolean };
  setDeveloperMode: (enabled: boolean) => void;
  setAvatarGeneration: (prefs: Partial<AvatarGenerationSettings>) => void;
  setAIGeneration: (prefs: Partial<AIGenerationSettings>) => void;
  setCompanionship: (prefs: Partial<CompanionshipSettings>) => void;
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
  setUserBubbleStyle: (styleId: string | null, style?: BubbleStyleDefinition | null) => void;
  setArtifactAppearance: (appearance: Partial<ArtifactAppearanceSettings>) => void;
  syncCurrentSettingsToServer: () => Promise<void>;
  resetSettings: () => void;
}

type SettingsSet = (partial: SettingsStore | Partial<SettingsStore> | ((state: SettingsStore) => SettingsStore | Partial<SettingsStore>), replace?: false) => unknown;
type RemoteSettingsPayload = Partial<AppSettings> & {
  autoGenerateCharacterAvatar?: boolean;
  api?: APIConfig;
  aiProfiles?: AIModelProfile[];
  memoryUI?: { showDeveloperMemory?: boolean };
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let savedStateTimer: ReturnType<typeof setTimeout> | null = null;
const SETTINGS_ACCOUNT_SCOPE: SyncChangeScope = 'settings.account';
const settingsSyncScopes = createSyncScopeMetadata(30_000, {
  getStorageKey: () => scopedStorageKey(`settings-sync-scopes-${getLocalDataUserId()}`),
});

function clearSavedStateTimer() {
  if (savedStateTimer) {
    clearTimeout(savedStateTimer);
    savedStateTimer = null;
  }
}

function syncToServer(data: Record<string, unknown>, set: SettingsSet) {
  if (syncTimer) clearTimeout(syncTimer);
  clearSavedStateTimer();
  if (useAuthStore.getState().authMode === 'local' || !isCloudSyncEnabled()) {
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
        reportRecoverableError({
          location: 'cloud-sync:settings-save',
          error: err,
          userMessage: '设置同步失败，请检查网络后重试。',
        });
        set((state) => ({ ...state, syncStatus: 'error', syncError: err instanceof Error ? err.message : String(err) }));
      });
  }, 500);
}

async function probeSettingsChanges() {
  const scopeState = settingsSyncScopes.getState(SETTINGS_ACCOUNT_SCOPE);
  const since = scopeState.cursor ?? scopeState.revision ?? null;
  try {
    return await api.getSyncChanges({ scope: SETTINGS_ACCOUNT_SCOPE, since });
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function settingsFromChanges(changes: Array<Record<string, unknown>> | undefined) {
  if (!changes?.length) return null;
  const change = changes.find((item) => item.entity === 'settings_account' && item.op === 'upsert');
  if (!change || !isRecord(change.patch)) return null;
  return change.patch;
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
    userBubbleStyleId: state.userBubbleStyleId,
    userBubbleStyle: state.userBubbleStyle,
    developerMode: state.developerMode,
    autoGenerateCharacterAvatar: state.avatarGeneration.autoGenerateCharacterAvatar,
    avatarGeneration: state.avatarGeneration,
    aiGeneration: state.aiGeneration,
    companionship: state.companionship,
    developerUI: state.developerUI,
    memoryUI: state.memoryUI,
    artifactAppearance: state.artifactAppearance,
  };
}

function syncState(state: Partial<AppSettings> & { api?: APIConfig; aiProfiles?: AIModelProfile[]; memoryUI?: { showDeveloperMemory?: boolean } }): Partial<AppSettings> {
  const aiProfiles = normalizeAIProfiles(state.aiProfiles, state.api);
  const legacyShowMemoryDebug = Boolean(state.memoryUI?.showDeveloperMemory);
  const normalized = {
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
    aiGeneration: {
      ...DEFAULT_AI_GENERATION_SETTINGS,
      ...(state.aiGeneration || {}),
      enableMoments: state.aiGeneration?.enableMoments ?? DEFAULT_AI_GENERATION_SETTINGS.enableMoments,
      enableDiaries: state.aiGeneration?.enableDiaries ?? DEFAULT_AI_GENERATION_SETTINGS.enableDiaries,
    },
    companionship: {
      ...DEFAULT_COMPANIONSHIP_SETTINGS,
      ...(state.companionship || {}),
      quietHours: {
        ...DEFAULT_COMPANIONSHIP_SETTINGS.quietHours,
        ...(state.companionship?.quietHours || {}),
      },
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
    userBubbleStyleId: typeof state.userBubbleStyleId === 'string' ? state.userBubbleStyleId : null,
    userBubbleStyle: state.userBubbleStyle || null,
    artifactAppearance: {
      ...DEFAULT_ARTIFACT_APPEARANCE_SETTINGS,
      ...(state.artifactAppearance || {}),
      paperVariant: PAPER_SURFACE_VARIANTS.includes(state.artifactAppearance?.paperVariant || 'lined')
        ? state.artifactAppearance?.paperVariant || DEFAULT_ARTIFACT_APPEARANCE_SETTINGS.paperVariant
        : DEFAULT_ARTIFACT_APPEARANCE_SETTINGS.paperVariant,
    },
  };
  setAIGenerationRuntimeConfig(normalized.aiGeneration);
  setCompanionshipRuntimeConfig(normalized.companionship);
  return normalized;
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
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      _loaded: false,
      lastSyncedAt: 0,
      syncStatus: 'idle',
      syncError: null,

      loadSettings: async () => {
        if (useAuthStore.getState().authMode === 'local' || !isCloudSyncEnabled()) {
          set((state) => ({ ...state, _loaded: true, syncStatus: 'idle', syncError: null }));
          return;
        }
        try {
          const hasLocalSettings = get()._loaded || get().lastSyncedAt > 0;
          if (hasLocalSettings && settingsSyncScopes.isFresh(SETTINGS_ACCOUNT_SCOPE)) {
            set((state) => ({ ...state, _loaded: true, syncStatus: 'idle', syncError: null }));
            return;
          }
          const changeProbe = hasLocalSettings ? await probeSettingsChanges() : null;
          if (changeProbe?.status === 'not_modified') {
            settingsSyncScopes.markChecked(SETTINGS_ACCOUNT_SCOPE, {
              cursor: changeProbe.cursor,
              revision: changeProbe.revision,
              applied: false,
            });
            set((state) => ({ ...state, _loaded: true, syncStatus: 'idle', syncError: null }));
            return;
          }
          const settings = (settingsFromChanges(changeProbe?.changes) || await api.getSettings()) as RemoteSettingsPayload;
          settingsSyncScopes.markChecked(SETTINGS_ACCOUNT_SCOPE, {
            cursor: changeProbe?.cursor,
            revision: changeProbe?.revision,
            applied: true,
          });
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
              aiGeneration: {
                ...DEFAULT_AI_GENERATION_SETTINGS,
                ...((settings as { aiGeneration?: AIGenerationSettings }).aiGeneration || {}),
              },
              companionship: {
                ...DEFAULT_COMPANIONSHIP_SETTINGS,
                ...((settings as { companionship?: CompanionshipSettings }).companionship || {}),
                quietHours: {
                  ...DEFAULT_COMPANIONSHIP_SETTINGS.quietHours,
                  ...((settings as { companionship?: CompanionshipSettings }).companionship?.quietHours || {}),
                },
              },
              developerUI: settings.developerUI as DeveloperUIPrefs | undefined,
              memoryUI: settings.memoryUI as { showDeveloperMemory?: boolean } | undefined,
              chatDraftDefaults: {
                ...DEFAULT_CHAT_DRAFT_DEFAULTS,
                ...((settings.chatDraftDefaults || DEFAULT_CHAT_DRAFT_DEFAULTS) as ChatDraftDefaults),
              },
              customBubbleStyles: settings.customBubbleStyles as BubbleStyleDefinition[] | undefined,
              userBubbleStyleId: typeof settings.userBubbleStyleId === 'string' ? settings.userBubbleStyleId : null,
              userBubbleStyle: (settings.userBubbleStyle as BubbleStyleDefinition | null | undefined) || null,
              artifactAppearance: (settings as { artifactAppearance?: ArtifactAppearanceSettings }).artifactAppearance,
            }),
            _loaded: true,
            lastSyncedAt: Date.now(),
            syncStatus: 'idle',
            syncError: null,
          });
        } catch (error) {
          settingsSyncScopes.markError(SETTINGS_ACCOUNT_SCOPE, error);
          reportRecoverableError({
            location: 'cloud-sync:settings-load',
            error,
            userMessage: '设置加载失败，请检查网络后重试。',
          });
          set({ _loaded: true, syncStatus: 'error', syncError: error instanceof Error ? error.message : String(error) });
        }
      },

      updateApi: (config) => {
        set((state) => {
          const nextApi = { ...state.api, ...config };
          const nextProfiles = [...state.aiProfiles];
          nextProfiles[0] = { ...nextProfiles[0], ...nextApi, id: nextProfiles[0].id || 'default' };
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
                id: profile.id,
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

      setAIGeneration: (prefs) => {
        set((state) => {
          const next = {
            ...state,
            aiGeneration: {
              ...state.aiGeneration,
              ...prefs,
            },
            lastSyncedAt: Date.now(),
          };
          setAIGenerationRuntimeConfig(next.aiGeneration);
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setCompanionship: (prefs) => {
        set((state) => {
          const nextCompanionship = {
            ...state.companionship,
            ...prefs,
            quietHours: {
              ...state.companionship.quietHours,
              ...(prefs.quietHours || {}),
            },
          };
          const next = {
            ...state,
            companionship: nextCompanionship,
            lastSyncedAt: Date.now(),
          };
          setCompanionshipRuntimeConfig(nextCompanionship);
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
        localStorage.setItem(scopedStorageKey('language'), language);
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

      setUserBubbleStyle: (userBubbleStyleId, userBubbleStyle = null) => {
        set((state) => {
          const next = {
            ...state,
            userBubbleStyleId,
            userBubbleStyle,
            lastSyncedAt: Date.now(),
          };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      setArtifactAppearance: (artifactAppearance) => {
        set((state) => {
          const next = {
            ...state,
            artifactAppearance: {
              ...state.artifactAppearance,
              ...artifactAppearance,
            },
            lastSyncedAt: Date.now(),
          };
          syncToServer(buildSettingsPayload(next), set);
          return next;
        });
      },

      syncCurrentSettingsToServer: async () => {
        if (useAuthStore.getState().authMode === 'local' || !isCloudSyncEnabled()) {
          set((state) => ({ ...state, syncStatus: 'idle', syncError: null }));
          return;
        }
        const current = useSettingsStore.getState();
        await api.updateSettings(buildSettingsPayload(current));
        set((state) => ({ ...state, syncStatus: 'saved', syncError: null, lastSyncedAt: Date.now() }));
      },

      resetSettings: () => {
        const next = { ...(syncState(DEFAULT_SETTINGS) as SettingsStore), lastSyncedAt: Date.now() };
        set(next);
        syncToServer(buildSettingsPayload(next), set);
      },
    }),
    {
      name: scopedStorageKey('settings'),
      version: CLIENT_STORE_SCHEMA_VERSION,
      migrate: (persistedState) => migrateSettingsStoreState(persistedState as Partial<SettingsStore>) as typeof DEFAULT_SETTINGS,
      partialize: (state) => ({
        api: state.api,
        aiProfiles: state.aiProfiles,
        theme: state.theme,
        themeColor: state.themeColor,
        language: state.language,
        defaultSpeed: state.defaultSpeed,
        developerMode: state.developerMode,
        avatarGeneration: state.avatarGeneration,
        aiGeneration: state.aiGeneration,
        companionship: state.companionship,
        developerUI: state.developerUI,
        memoryUI: state.memoryUI,
        chatDraftDefaults: state.chatDraftDefaults,
        customBubbleStyles: state.customBubbleStyles,
        userBubbleStyleId: state.userBubbleStyleId,
        userBubbleStyle: state.userBubbleStyle,
        artifactAppearance: state.artifactAppearance,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...syncState({ ...(currentState as AppSettings), ...(persistedState as Partial<AppSettings>) }),
      }),
    }
  )
);
