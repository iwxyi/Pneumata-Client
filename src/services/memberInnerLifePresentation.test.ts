import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import { buildMemberExpressionFeedbackChips, buildMemberInnerLifeChips, buildMemberInnerLifeSummary } from './memberInnerLifePresentation';

function buildCharacter(partial: Partial<AICharacter> = {}): AICharacter {
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
    ...partial,
  };
}

describe('buildMemberInnerLifeChips', () => {
  it('shows repair residue as a concise user-facing chip', () => {
    const chips = buildMemberInnerLifeChips(buildCharacter({
      soulState: {
        mood: { pleasure: 0, arousal: 30, dominance: 40 },
        energy: 45,
        attention: 50,
        loneliness: 20,
        repression: 50,
        shame: 48,
        envy: 0,
        trustInRoom: 58,
        ignoredStreak: 0,
        lastImpulse: 'repair',
        lastImpulseReason: '前面的刺留下了关系修复压力。',
      },
    }), 'zh-CN');

    expect(chips[0]?.label).toBe('别扭找补');
    expect(chips[0]?.hint).toContain('关系修复压力');
  });

  it('does not surface attention seeking unless ignored pressure is visible', () => {
    const chips = buildMemberInnerLifeChips(buildCharacter({
      soulState: {
        mood: { pleasure: 0, arousal: 30, dominance: 40 },
        energy: 45,
        attention: 50,
        loneliness: 20,
        repression: 20,
        shame: 12,
        envy: 0,
        trustInRoom: 48,
        ignoredStreak: 0,
        lastImpulse: 'seek_attention',
      },
    }), 'zh-CN');

    expect(chips.some((item) => item.label === '想被看见')).toBe(false);
  });

  it('builds a readable inner life summary while keeping raw values in debug hint', () => {
    const summary = buildMemberInnerLifeSummary(buildCharacter({
      soulState: {
        mood: { pleasure: 0, arousal: 30, dominance: 40 },
        energy: 41,
        attention: 50,
        loneliness: 68,
        repression: 25,
        shame: 12,
        envy: 0,
        trustInRoom: 48,
        ignoredStreak: 3,
        lastImpulse: 'seek_attention',
        lastImpulseReason: '连续几句没有被接住，开始试探自己是不是还在场。',
      },
    }), 'zh-CN');

    expect(summary?.title).toBe('想被看见');
    expect(summary?.text).toContain('试探');
    expect(summary?.debugHint).toContain('被忽视感 68');
    expect(summary?.debugHint).toContain('未被接住 3');
  });
});

describe('buildMemberExpressionFeedbackChips', () => {
  it('summarizes expression feedback without exposing raw debug counts in normal mode', () => {
    const chips = buildMemberExpressionFeedbackChips(buildCharacter({
      layeredMemories: [{
        id: 'feedback-1',
        ownerId: 'char-a',
        scope: 'character_self',
        layer: 'long_term',
        kind: 'trait_evidence',
        text: '用户反馈：这类回复太像通用助手',
        summary: '表达反馈：太像助手',
        sourceTag: 'expression_feedback',
        salience: 0.8,
        confidence: 0.8,
        recency: 0.8,
        reinforcementCount: 2,
        sourceEventIds: [],
        createdAt: 1,
        updatedAt: 1,
      }],
    }), 'zh-CN', false);

    expect(chips[0]?.label).toBe('表达在校准');
    expect(chips[0]?.hint).toContain('减少助手腔');
    expect(chips[0]?.hint).not.toContain('负向');
  });

  it('shows concrete influence only for developer details', () => {
    const chips = buildMemberExpressionFeedbackChips(buildCharacter({
      layeredMemories: [{
        id: 'feedback-1',
        ownerId: 'char-a',
        scope: 'character_self',
        layer: 'long_term',
        kind: 'trait_evidence',
        text: '用户反馈：这类回复太像通用助手',
        summary: '表达反馈：太像助手',
        sourceTag: 'expression_feedback',
        salience: 0.8,
        confidence: 0.8,
        recency: 0.8,
        reinforcementCount: 2,
        sourceEventIds: [],
        createdAt: 1,
        updatedAt: 1,
      }],
    }), 'zh-CN', true);

    expect(chips[0]?.label).toContain('减少助手腔');
    expect(chips[0]?.hint).toContain('负向 1 条');
  });
});
