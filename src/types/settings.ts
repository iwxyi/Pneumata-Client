import type { RuntimeEvolutionIntensity } from './chat';

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'alibaba' | 'zhipu' | 'moonshot' | 'minimax' | 'bytedance' | 'custom';
export type AIModelType = 'text' | 'image' | 'audio' | 'document';
export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'zh' | 'en';

export interface APIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AIModelProfile extends APIConfig {
  id: string;
  name: string;
  type: AIModelType;
  isDefault?: boolean;
}

export interface ChatDraftDefaults {
  style: 'free' | 'debate' | 'brainstorm' | 'roleplay';
  showRoleActions: boolean;
  runtimeEvolutionIntensity: RuntimeEvolutionIntensity;
}

import type { BubbleStyleDefinition } from './bubbleStyle';

export interface DeveloperUIPrefs {
  showMemoryDebug: boolean;
  showRelationshipEvents: boolean;
  showSpeechStyle: boolean;
  dramaBoost: boolean;
}

export interface AppSettings {
  api: APIConfig;
  aiProfiles: AIModelProfile[];
  theme: ThemeMode;
  themeColor: string;
  language: Language;
  defaultSpeed: number;
  developerMode: boolean;
  autoGenerateCharacterAvatar: boolean;
  developerUI: DeveloperUIPrefs;
  chatDraftDefaults: ChatDraftDefaults;
  customBubbleStyles: BubbleStyleDefinition[];
}

export const DEFAULT_DEVELOPER_UI_PREFS: DeveloperUIPrefs = {
  showMemoryDebug: false,
  showRelationshipEvents: false,
  showSpeechStyle: false,
  dramaBoost: false,
};

export type AppSettingsWithMemory = AppSettings & { memoryUI?: { showDeveloperMemory?: boolean } };

export const DEFAULT_API_CONFIG: APIConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

export const DEFAULT_AI_PROFILE: AIModelProfile = {
  id: 'default',
  name: 'Default',
  type: 'text',
  isDefault: true,
  ...DEFAULT_API_CONFIG,
};

export function normalizeAIProfiles(aiProfiles?: AIModelProfile[], api?: APIConfig): AIModelProfile[] {
  const sourceProfiles = Array.isArray(aiProfiles) && aiProfiles.length > 0
    ? aiProfiles
    : [{
        ...DEFAULT_AI_PROFILE,
        ...(api || DEFAULT_AI_PROFILE),
        id: 'default',
        name: 'Default',
        type: 'text' as AIModelType,
        isDefault: true,
      }];

  const seenDefaultTypes = new Set<AIModelType>();
  const normalized = sourceProfiles.map((profile, index) => {
    const type = profile.type || 'text';
    const isDefault = Boolean(profile.isDefault) && !seenDefaultTypes.has(type);
    if (isDefault) seenDefaultTypes.add(type);
    return {
      ...DEFAULT_AI_PROFILE,
      ...profile,
      id: index === 0 ? 'default' : (profile.id || `profile-${index + 1}`),
      name: index === 0 ? (profile.name || 'Default') : (profile.name || `Model ${index + 1}`),
      type,
      isDefault,
    };
  });

  for (const type of ['text', 'image', 'audio', 'document'] as AIModelType[]) {
    const items = normalized.filter((profile) => profile.type === type);
    if (items.length === 1) {
      items[0].isDefault = true;
    }
  }

  return normalized;
}

export function getDefaultAIProfile(aiProfiles: AIModelProfile[], type: AIModelType) {
  return normalizeAIProfiles(aiProfiles).find((profile) => profile.type === type && profile.isDefault) || null;
}

export function getPreferredAIProfile(aiProfiles: AIModelProfile[], type: AIModelType) {
  const normalized = normalizeAIProfiles(aiProfiles);
  return normalized.find((profile) => profile.type === type && profile.isDefault)
    || normalized.find((profile) => profile.type === type)
    || null;
}

export const DEFAULT_CHAT_DRAFT_DEFAULTS: ChatDraftDefaults = {
  style: 'free',
  showRoleActions: true,
  runtimeEvolutionIntensity: 'balanced',
};

export const DEFAULT_SETTINGS: AppSettingsWithMemory = {
  api: DEFAULT_API_CONFIG,
  aiProfiles: [DEFAULT_AI_PROFILE],
  theme: 'system',
  themeColor: '#6750A4',
  language: 'zh',
  defaultSpeed: 1.0,
  developerMode: false,
  autoGenerateCharacterAvatar: false,
  developerUI: DEFAULT_DEVELOPER_UI_PREFS,
  chatDraftDefaults: DEFAULT_CHAT_DRAFT_DEFAULTS,
  customBubbleStyles: [],
  memoryUI: { showDeveloperMemory: false },
};
