import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import { deriveEmotionalState, formatLocalizedEmotionSummary } from './personalityDrift';

function buildCharacter(patch: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'char-a',
    name: '甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
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
    ...patch,
  };
}

describe('deriveEmotionalState', () => {
  it('captures common Chinese challenge phrasing as visible irritation', () => {
    const emotion = deriveEmotionalState(buildCharacter(), '沸羊羊你今天火气也太大了吧，急什么？', 1, 1);

    expect(emotion.irritation).toBeGreaterThanOrEqual(12);
    expect(formatLocalizedEmotionSummary(emotion, 'zh-CN', 2, 12)).toContain('烦躁');
  });

  it('captures single warm support as visible affection', () => {
    const emotion = deriveEmotionalState(buildCharacter(), '你真好，我站你这边，说得对呀。', 1, 1);

    expect(emotion.affection).toBeGreaterThanOrEqual(12);
    expect(formatLocalizedEmotionSummary(emotion, 'zh-CN', 2, 12)).toContain('亲近');
  });
});
