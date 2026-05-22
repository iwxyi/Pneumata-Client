import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import type { Message } from '../types/message';
import { buildExpressionFeedbackPatch, EXPRESSION_FEEDBACK_MENU_GROUPS } from './characterExpressionFeedback';

function buildCharacter(): AICharacter {
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
  };
}

function buildMessage(content = '作为一个AI助手，我建议你可以从以下几点开始。'): Message {
  return {
    id: 'msg-a',
    chatId: 'chat-a',
    type: 'ai',
    senderId: 'char-a',
    senderName: '甲',
    content,
    emotion: 0,
    timestamp: 2,
    isDeleted: false,
  };
}

describe('buildExpressionFeedbackPatch', () => {
  it('keeps expression feedback menu items grouped behind a single submenu', () => {
    expect(EXPRESSION_FEEDBACK_MENU_GROUPS.map((group) => group.title)).toEqual(['需要调整', '正向校准']);
    expect(EXPRESSION_FEEDBACK_MENU_GROUPS.flatMap((group) => group.items.map((item) => item.kind))).toEqual([
      'out_of_character',
      'too_long',
      'too_formal',
      'too_assistant',
      'fits_character',
      'length_ok',
    ]);
  });

  it('stores assistant-like feedback as a taboo memory and runtime note', () => {
    const patch = buildExpressionFeedbackPatch({
      character: buildCharacter(),
      message: buildMessage(),
      kind: 'too_assistant',
      now: 10,
    });

    expect(patch.layeredMemories?.[0]).toMatchObject({
      scope: 'character_self',
      layer: 'episodic',
      kind: 'taboo',
      sourceTag: 'expression_feedback',
    });
    expect(patch.layeredMemories?.[0]?.text).toContain('太像通用助手');
    expect(patch.layeredMemories?.[0]?.evidenceText).toContain('作为一个AI助手');
    expect(patch.runtimeTimeline?.[0]).toEqual({
      type: 'memory',
      text: '用户反馈：太像助手',
      createdAt: 10,
    });
  });

  it('stores length feedback as a working expression memory', () => {
    const patch = buildExpressionFeedbackPatch({
      character: buildCharacter(),
      message: buildMessage('这段回复很长，需要以后更像即时聊天。'),
      kind: 'too_long',
      now: 10,
    });

    expect(patch.layeredMemories?.[0]).toMatchObject({
      scope: 'character_self',
      layer: 'working',
      kind: 'trait_evidence',
      sourceTag: 'expression_feedback',
    });
    expect(patch.layeredMemories?.[0]?.text).toContain('回复偏长');
  });

  it('stores positive calibration feedback without deleting older corrections', () => {
    const character = buildCharacter();
    const negative = buildExpressionFeedbackPatch({
      character,
      message: buildMessage('这段太长了。'),
      kind: 'too_long',
      now: 10,
    });
    const positive = buildExpressionFeedbackPatch({
      character: { ...character, layeredMemories: negative.layeredMemories || [] },
      message: buildMessage('这次刚刚好。'),
      kind: 'length_ok',
      now: 20,
    });

    expect(positive.layeredMemories?.some((item) => item.text.includes('回复偏长'))).toBe(true);
    expect(positive.layeredMemories?.some((item) => item.text.includes('长度合适'))).toBe(true);
    expect(positive.runtimeTimeline?.at(-1)).toMatchObject({
      type: 'memory',
      text: '用户反馈：长度合适',
      createdAt: 20,
    });
  });
});
