import type { AICharacter, CharacterGenerationOverride } from '../types/character';
import { getAIGenerationRuntimeConfig } from './aiGenerationRuntimeConfig';

export type CharacterGenerationFeature = 'moments' | 'diaries';

function resolveOverrideEnabled(override: CharacterGenerationOverride | undefined, globalEnabled: boolean) {
  if (override === 'on') return true;
  if (override === 'off') return false;
  return globalEnabled;
}

export function isCharacterFeatureEnabled(character: Pick<AICharacter, 'generationPreferences'> | null | undefined, feature: CharacterGenerationFeature) {
  const settings = getAIGenerationRuntimeConfig();
  const globalEnabled = feature === 'moments'
    ? Boolean(settings.enableMoments)
    : Boolean(settings.enableDiaries);
  return resolveOverrideEnabled(character?.generationPreferences?.[feature], globalEnabled);
}
