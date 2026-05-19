import type { RuntimeEvolutionIntensity } from './chat';

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'alibaba' | 'zhipu' | 'moonshot' | 'minimax' | 'bytedance' | 'microsoft' | 'custom';
export type AIModelType = 'text' | 'image' | 'audio' | 'document';
export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'zh' | 'en';

export interface APIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AIModelImageCapabilities {
  textToImage: boolean;
  referenceImage: boolean;
  multiReferenceImage: boolean;
  seed: boolean;
  negativePrompt: boolean;
}

export interface AIModelProfile extends APIConfig {
  id: string;
  name: string;
  type: AIModelType;
  isDefault?: boolean;
  imageCapabilities?: Partial<AIModelImageCapabilities>;
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
  showAffectEvents: boolean;
  showConflictEvents: boolean;
  showStateEvents: boolean;
  showMemoryDistillationEvents: boolean;
  showSpeechStyle: boolean;
  showAdvancedRuntimePanels: boolean;
  dramaBoost: boolean;
}

export type DeveloperUISettings = DeveloperUIPrefs;

export function isAffectEventsVisible(prefs: DeveloperUIPrefs) {
  return Boolean(prefs.showAffectEvents);
}

export function getDeveloperAffectDefault() {
  return false;
}

export function getDeveloperUiDefaults() {
  return DEFAULT_DEVELOPER_UI_PREFS;
}

export function normalizeDeveloperUiPrefs(input?: Partial<DeveloperUIPrefs> | null): DeveloperUIPrefs {
  return {
    showMemoryDebug: Boolean(input?.showMemoryDebug),
    showRelationshipEvents: Boolean(input?.showRelationshipEvents),
    showAffectEvents: Boolean(input?.showAffectEvents),
    showConflictEvents: Boolean(input?.showConflictEvents),
    showStateEvents: Boolean(input?.showStateEvents),
    showMemoryDistillationEvents: Boolean(input?.showMemoryDistillationEvents),
    showSpeechStyle: Boolean(input?.showSpeechStyle),
    showAdvancedRuntimePanels: Boolean(input?.showAdvancedRuntimePanels),
    dramaBoost: Boolean(input?.dramaBoost),
  };
}

export function mergeDeveloperUiPrefs(input?: Partial<DeveloperUIPrefs> | null) {
  return {
    ...DEFAULT_DEVELOPER_UI_PREFS,
    ...(input || {}),
    showAffectEvents: Boolean(input?.showAffectEvents),
  } satisfies DeveloperUIPrefs;
}

export function getDeveloperUiPrefValue(input: Partial<DeveloperUIPrefs> | null | undefined, key: keyof DeveloperUIPrefs) {
  return Boolean(input?.[key]);
}

export function getDeveloperUiVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiToggleKeys() {
  return ['showMemoryDebug', 'showRelationshipEvents', 'showAffectEvents', 'showConflictEvents', 'showStateEvents', 'showMemoryDistillationEvents', 'showSpeechStyle', 'showAdvancedRuntimePanels', 'dramaBoost'] as const;
}

export function getDeveloperUiAffectKey() {
  return 'showAffectEvents' as const;
}

export function getDeveloperUiShape(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiPrefs(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiConfig(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiModel(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiSummary(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiSnapshot(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiNormalized(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiRuntime(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiFlags(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiDisplay(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiPayload(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiData(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiEnvelope(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiRecord(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiCurrent(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiValue(input: Partial<DeveloperUIPrefs> | null | undefined, key: keyof DeveloperUIPrefs) {
  return getDeveloperUiPrefValue(input, key);
}

export function getDeveloperUiBoolean(input: Partial<DeveloperUIPrefs> | null | undefined, key: keyof DeveloperUIPrefs) {
  return getDeveloperUiPrefValue(input, key);
}

export function getDeveloperUiAffectVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return Boolean(input?.showAffectEvents);
}

export function getDeveloperUiRelationshipVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return Boolean(input?.showRelationshipEvents);
}

export function getDeveloperUiMemoryVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return Boolean(input?.showMemoryDebug);
}

export function getDeveloperUiSpeechVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return Boolean(input?.showSpeechStyle);
}

export function getDeveloperUiAdvancedVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return Boolean(input?.showAdvancedRuntimePanels);
}

export function getDeveloperUiDramaVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return Boolean(input?.dramaBoost);
}

export function getDeveloperUiHintVisibility(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiToggleState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiPanelState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiEventState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiEventVisibility(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiDiagnostics(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiDefaultsSnapshot() {
  return DEFAULT_DEVELOPER_UI_PREFS;
}

export function getDeveloperUiDefaultAffectValue() {
  return false;
}

export function getDeveloperUiAffectDefaultValue() {
  return false;
}

export function getDeveloperUiToggleStateByKey(input: Partial<DeveloperUIPrefs> | null | undefined, key: keyof DeveloperUIPrefs) {
  return getDeveloperUiPrefValue(input, key);
}

export function getDeveloperUiAffectToggle(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return Boolean(input?.showAffectEvents);
}

export function getDeveloperUiEventToggle(input: Partial<DeveloperUIPrefs> | null | undefined) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiShapeState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiSettings(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiDeveloperState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiDeveloperSettings(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiEffectiveState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiEffectivePrefs(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiResolved(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiResolvedState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiResolvedPrefs(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiComputed(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiComputedState(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiComputedPrefs(input?: Partial<DeveloperUIPrefs> | null) {
  return normalizeDeveloperUiPrefs(input);
}

export function getDeveloperUiAffectComputed(input?: Partial<DeveloperUIPrefs> | null) {
  return Boolean(input?.showAffectEvents);
}

export function getDeveloperUiRelationshipComputed(input?: Partial<DeveloperUIPrefs> | null) {
  return Boolean(input?.showRelationshipEvents);
}

export function getDeveloperUiMemoryComputed(input?: Partial<DeveloperUIPrefs> | null) {
  return Boolean(input?.showMemoryDebug);
}

export function getDeveloperUiSpeechComputed(input?: Partial<DeveloperUIPrefs> | null) {
  return Boolean(input?.showSpeechStyle);
}

export function getDeveloperUiAdvancedComputed(input?: Partial<DeveloperUIPrefs> | null) {
  return Boolean(input?.showAdvancedRuntimePanels);
}

export function getDeveloperUiDramaComputed(input?: Partial<DeveloperUIPrefs> | null) {
  return Boolean(input?.dramaBoost);
}

export interface AvatarGenerationSettings {
  autoGenerateCharacterAvatar: boolean;
  preferNonPhotorealAvatar: boolean;
}

export interface AppSettings {
  api: APIConfig;
  aiProfiles: AIModelProfile[];
  theme: ThemeMode;
  themeColor: string;
  language: Language;
  defaultSpeed: number;
  developerMode: boolean;
  avatarGeneration: AvatarGenerationSettings;
  developerUI: DeveloperUIPrefs;
  chatDraftDefaults: ChatDraftDefaults;
  customBubbleStyles: BubbleStyleDefinition[];
}

export const DEFAULT_DEVELOPER_UI_PREFS: DeveloperUIPrefs = {
  showMemoryDebug: false,
  showRelationshipEvents: false,
  showAffectEvents: false,
  showConflictEvents: false,
  showStateEvents: false,
  showMemoryDistillationEvents: false,
  showSpeechStyle: false,
  showAdvancedRuntimePanels: false,
  dramaBoost: false,
};

export const DEFAULT_AVATAR_GENERATION_SETTINGS: AvatarGenerationSettings = {
  autoGenerateCharacterAvatar: false,
  preferNonPhotorealAvatar: false,
};

export type AppSettingsWithMemory = AppSettings & { memoryUI?: { showDeveloperMemory?: boolean } };

export const DEFAULT_API_CONFIG: APIConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

export const DEFAULT_IMAGE_CAPABILITIES: AIModelImageCapabilities = {
  textToImage: true,
  referenceImage: false,
  multiReferenceImage: false,
  seed: false,
  negativePrompt: false,
};

export const DEFAULT_AI_PROFILE: AIModelProfile = {
  id: 'default',
  name: 'Default',
  type: 'text',
  isDefault: true,
  ...DEFAULT_API_CONFIG,
};

export function normalizeImageCapabilities(input?: Partial<AIModelImageCapabilities> | null): AIModelImageCapabilities {
  return {
    ...DEFAULT_IMAGE_CAPABILITIES,
    ...(input || {}),
    textToImage: input?.textToImage ?? DEFAULT_IMAGE_CAPABILITIES.textToImage,
    referenceImage: Boolean(input?.referenceImage),
    multiReferenceImage: Boolean(input?.multiReferenceImage),
    seed: Boolean(input?.seed),
    negativePrompt: Boolean(input?.negativePrompt),
  };
}

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
      imageCapabilities: type === 'image' ? normalizeImageCapabilities(profile.imageCapabilities) : undefined,
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
  avatarGeneration: DEFAULT_AVATAR_GENERATION_SETTINGS,
  developerUI: DEFAULT_DEVELOPER_UI_PREFS,
  chatDraftDefaults: DEFAULT_CHAT_DRAFT_DEFAULTS,
  customBubbleStyles: [],
  memoryUI: { showDeveloperMemory: false },
};
