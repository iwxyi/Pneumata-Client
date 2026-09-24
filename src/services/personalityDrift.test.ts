import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import { applyInteractionEmotion, deriveEmotionalState, formatEmotionStateLabel, formatLocalizedEmotionSummary } from './personalityDrift';

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

  it('formats moderate emotion as semantic labels for ordinary UI', () => {
    expect(formatEmotionStateLabel('irritation', 13, 'zh-CN')).toBe('略有刺感');
    expect(formatEmotionStateLabel('affection', 34, 'zh-CN')).toBe('更亲近');
    expect(formatEmotionStateLabel('excitement', 60, 'zh-CN')).toBe('兴致很高');
  });

  it('lets a model-judged remark create a fast target spike and a smaller speaker after-effect', () => {
    const speaker = buildCharacter({ id: 'speaker', relationships: [{ characterId: 'target', warmth: 0, trust: -10, competence: 0, threat: 20, attachment: 0, deference: 0 }] });
    const target = buildCharacter({ id: 'target', relationships: [{ characterId: 'speaker', warmth: 0, trust: 5, competence: 0, threat: 10, attachment: 30, deference: 0 }] });
    const interaction = {
      kind: 'dismiss' as const,
      actorId: 'speaker',
      targetId: 'target',
      intensity: 5,
      tone: 'sarcastic' as const,
      evidenceText: '你根本不配管这件事。',
      confidence: 0.96,
    };

    const speakerEmotion = applyInteractionEmotion(speaker, interaction, 'speaker');
    const targetEmotion = applyInteractionEmotion(target, interaction, 'target');

    expect(targetEmotion.irritation).toBeGreaterThan(speakerEmotion.irritation);
    expect(targetEmotion.embarrassment).toBeGreaterThanOrEqual(25);
  });

  it('lets expression discharge an existing spike while preserving some residue', () => {
    const speaker = buildCharacter({
      id: 'speaker',
      emotionalState: { irritation: 68, affection: 0, insecurity: 36, excitement: 0, embarrassment: 0 },
    });
    const afterSpeaking = applyInteractionEmotion(speaker, {
      kind: 'redirect', actorId: 'speaker', targetId: 'target', intensity: 1, tone: 'cold', evidenceText: '先停一下。', confidence: 0.9,
    }, 'speaker');

    expect(afterSpeaking.irritation).toBeLessThan(68);
    expect(afterSpeaking.irritation).toBeGreaterThan(0);
    expect(afterSpeaking.insecurity).toBeLessThan(36);
  });
});
