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

export interface AppSettings {
  api: APIConfig;
  aiProfiles: AIModelProfile[];
  theme: ThemeMode;
  themeColor: string;
  language: Language;
  defaultSpeed: number;
}

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

export const DEFAULT_SETTINGS: AppSettings = {
  api: DEFAULT_API_CONFIG,
  aiProfiles: [DEFAULT_AI_PROFILE],
  theme: 'system',
  themeColor: '#6750A4',
  language: 'zh',
  defaultSpeed: 1.0,
};
