import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import { updateCharacterLayeredMemories } from './characterLayeredMemory';

function buildCharacter(): AICharacter {
  return {
    id: 'char-a',
    name: '甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [{ characterId: 'char-b', warmth: 10, competence: 8, trust: 8, threat: 0 }],
    layeredMemories: [],
    background: '',
    speakingStyle: '',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: DEFAULT_CHARACTER_MEMORY,
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    speechProfile: undefined,
    personalityDrift: {},
    modelProfileId: null,
    modelProfileIds: {},
    bubbleStyleId: null,
    runtimeTimeline: [],
    deletedAt: null,
    fieldVersions: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('updateCharacterLayeredMemories', () => {
  it('uses a distillation-eligible default source tag for relationship memories', () => {
    const character = buildCharacter();
    const layeredMemories = updateCharacterLayeredMemories({
      character,
      targetId: 'char-b',
      targetName: '乙',
      content: '乙你这句我记住了。',
      personalityDrift: {},
    });

    expect(layeredMemories[0]?.sourceTag).toBe('interaction');
  });
});
