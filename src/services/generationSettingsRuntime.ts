export interface GenerationSettingsRuntimeConfig {
  groupReplyActivity: 'focused' | 'balanced' | 'lively';
  duplicateGuardLevel: 'relaxed' | 'balanced' | 'strict';
  allowMarkdownInChat: boolean;
}

let runtimeConfig: GenerationSettingsRuntimeConfig = {
  groupReplyActivity: 'balanced',
  duplicateGuardLevel: 'balanced',
  allowMarkdownInChat: true,
};

export function setGenerationSettingsRuntimeConfig(settings: Partial<GenerationSettingsRuntimeConfig>) {
  runtimeConfig = {
    ...runtimeConfig,
    ...settings,
  };
}

export function getGenerationSettingsRuntimeConfig() {
  return runtimeConfig;
}
