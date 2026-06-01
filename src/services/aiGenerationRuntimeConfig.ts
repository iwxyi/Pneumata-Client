import type { AIGenerationSettings } from '../types/settings';
import { DEFAULT_AI_GENERATION_SETTINGS } from '../types/settings';

let runtimeConfig: AIGenerationSettings = { ...DEFAULT_AI_GENERATION_SETTINGS };

export function getAIGenerationRuntimeConfig() {
  return runtimeConfig;
}

export function setAIGenerationRuntimeConfig(next: Partial<AIGenerationSettings> | undefined | null) {
  runtimeConfig = {
    ...runtimeConfig,
    ...(next || {}),
  };
}

