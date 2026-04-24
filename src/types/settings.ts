import type { RuntimeEvolutionIntensity } from './chat';

export type AIProvider = 'openai' | 'anthropic' | 'deepseek' | 'custom';
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
}

export interface AppSettings {
  api: APIConfig;
  aiProfiles: AIModelProfile[];
  theme: ThemeMode;
  themeColor: string;
  language: Language;
  defaultSpeed: number;
  developerMode: boolean;
  developerUI: DeveloperUIPrefs;
  chatDraftDefaults: ChatDraftDefaults;
  customBubbleStyles: BubbleStyleDefinition[];
}

export const DEFAULT_DEVELOPER_UI_PREFS: DeveloperUIPrefs = {
  showMemoryDebug: false,
  showRelationshipEvents: false,
  showSpeechStyle: false,
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
  ...DEFAULT_API_CONFIG,
};

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
  developerUI: DEFAULT_DEVELOPER_UI_PREFS,
  chatDraftDefaults: DEFAULT_CHAT_DRAFT_DEFAULTS,
  customBubbleStyles: [],
  memoryUI: { showDeveloperMemory: false },
};
