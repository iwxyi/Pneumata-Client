import type { AICharacter } from '../types/character';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY, DEFAULT_CORE_PROFILE, DEFAULT_EMOTIONAL_STATE, DEFAULT_PERSONALITY } from '../types/character';

export function buildDeletedCharacter(id: string, name?: string): AICharacter {
  return {
    id,
    name: name || '已删除',
    avatar: '∅',
    personality: DEFAULT_PERSONALITY,
    personalityDrift: {},
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    coreProfile: DEFAULT_CORE_PROFILE,
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    expertise: [],
    speakingStyle: '',
    background: '',
    group: null,
    relationships: [],
    memory: DEFAULT_CHARACTER_MEMORY,
    layeredMemories: [],
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    runtimeTimeline: [],
    modelProfileId: null,
    bubbleStyleId: null,
    isPreset: false,
    deletedAt: Date.now(),
    createdAt: 0,
    updatedAt: 0,
  };
}

export function resolveCharacterOrDeleted(characters: AICharacter[], id: string, fallbackName?: string) {
  return characters.find((item) => item.id === id) || buildDeletedCharacter(id, fallbackName);
}
