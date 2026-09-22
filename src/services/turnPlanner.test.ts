import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { SpeakIntent } from './intentEngine';
import { buildTurnPlanPrompt, deriveTurnPlan } from './turnPlanner';
import type { RichDeliveryPolicy } from './styleProfileRegistry';

function character(patch: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
    avatar: '',
    personality: { openness: 50, extroversion: 80, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 85, aggressiveness: 40, humorIntensity: 78, empathyLevel: 50, summarizing: 45, offTopic: 30 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    speechProfile: { catchphrases: [], fillers: [], tabooPhrases: [], preferredOpeners: [], preferredClosers: [], sentenceLengthBias: 'mixed', questionBias: 50, sarcasmBias: 50 },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function chat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'direct',
    mode: 'open_chat',
    name: '测试',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  } as GroupChat;
}

function message(patch: Partial<Message>): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: '用户',
    content: '',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
    ...patch,
  };
}

const intent: SpeakIntent = {
  shouldSpeak: true,
  reason: 'test',
  target: 'user',
  stance: 'support',
  emotionalTone: 'warm',
  delivery: 'short_reply',
  messageShape: 'single_sentence',
};

const highDelivery: RichDeliveryPolicy = {
  multiBubble: { proactivity: 'high', maxBubbles: 5 },
  image: { proactivity: 'medium', explicitRequest: true },
  audio: { proactivity: 'medium', explicitRequest: true },
  sticker: { proactivity: 'high', explicitRequest: true },
};

function fragmentIntent(): SpeakIntent {
  return {
    ...intent,
    delivery: 'side_remark',
    messageShape: 'fragment',
  };
}

describe('deriveTurnPlan', () => {
  it('uses a high room delivery policy to make natural chat splitting more available', () => {
    const plan = deriveTurnPlan({
      chat: chat({ id: 'delivery-chat' }),
      speaker: character({ id: 'delivery-char' }),
      messages: [message({ id: 'delivery-message', content: '我想先听你说说这件事为什么会变成这样，再补一句你觉得我下一步最该做什么，别只给我一个笼统安慰。请把原因和行动建议分开说，也告诉我最容易忽略的风险是什么。', timestamp: 31 })],
      intent,
      surface: { kind: 'chat' },
      richDelivery: highDelivery,
      now: 31,
    });

    expect(plan.targetBubbleCount).toBeLessThanOrEqual(5);
    expect(plan.reasons).toContain('delivery:multi_bubble_high');
  });

  it('prevents proactive splitting when the room policy turns it off', () => {
    const plan = deriveTurnPlan({
      chat: chat({ id: 'delivery-off-chat' }),
      speaker: character({ id: 'delivery-off-char' }),
      messages: [message({ id: 'delivery-off-message', content: '请把这个复杂问题按两个角度分别说清楚。', timestamp: 33 })],
      intent: { ...intent, stance: 'summarize' },
      surface: { kind: 'chat' },
      richDelivery: { ...highDelivery, multiBubble: { proactivity: 'off', maxBubbles: 1 } },
      now: 33,
    });

    expect(plan.allowExtraMessages).toBe(false);
    expect(plan.targetBubbleCount).toBe(1);
    expect(plan.reasons).toContain('delivery:multi_bubble_off');
  });

  it('marks short open user turns as wait-sensitive without keyword checks', () => {
    const plan = deriveTurnPlan({
      chat: chat(),
      speaker: character(),
      messages: [message({ content: '等下', timestamp: 10 })],
      intent,
      surface: { kind: 'chat' },
      now: 10,
    });

    expect(plan.rhythm).toBe('defer_or_wait');
    expect(plan.waitSensitive).toBe(true);
    expect(plan.allowExtraMessages).toBe(false);
  });

  it('leaves short high-delivery turns open for the model to honor a multi-message request', () => {
    const plan = deriveTurnPlan({
      chat: chat({ id: 'short-request-chat' }),
      speaker: character(),
      messages: [message({ content: '你能不能一口气给我回3条消息？', timestamp: 11 })],
      intent,
      surface: { kind: 'chat' },
      richDelivery: highDelivery,
      now: 11,
    });

    expect(plan.allowExtraMessages).toBe(true);
    expect(plan.targetBubbleCount).toBeGreaterThan(1);
  });

  it('allows planned multi-bubble turns from structural spacing signals', () => {
    const plan = deriveTurnPlan({
      chat: chat({ id: 'chat-6' }),
      speaker: character({ id: 'char-z' }),
      messages: [
        message({ id: 'u1', content: '你刚才说那个青色苹果，是不是还没熟的意思？', timestamp: 100 }),
      ],
      intent,
      surface: { kind: 'chat' },
      now: 100,
    });

    expect(['multi_bubble', 'short_reply', 'full_reply']).toContain(plan.rhythm);
    if (plan.rhythm === 'multi_bubble') {
      expect(plan.allowExtraMessages).toBe(true);
      expect(plan.targetBubbleCount).toBeGreaterThan(1);
    }
  });

  it('keeps professional surfaces single-bubble and long-form capable', () => {
    const plan = deriveTurnPlan({
      chat: chat(),
      speaker: character(),
      messages: [message({ content: '请详细解释一下这个方案的设计取舍和风险点。', timestamp: 10 })],
      intent,
      surface: { kind: 'professional' },
    });

    expect(plan.rhythm).toBe('full_reply');
    expect(plan.allowExtraMessages).toBe(false);
    expect(plan.targetBubbleCount).toBe(1);
  });

  it('does not make analysis-room AI continuations long just because the surface is professional', () => {
    const plan = deriveTurnPlan({
      chat: chat({
        type: 'group',
        sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
      }),
      speaker: character(),
      messages: [
        message({
          type: 'ai',
          senderId: 'other',
          senderName: '甲',
          content: '我觉得这个结论已经差不多了，大家其实都在说同一个意思，只是换了几个比喻。',
          timestamp: 10,
        }),
      ],
      intent: {
        ...intent,
        stance: 'probe',
        delivery: 'quick_question',
        messageShape: 'question_only',
      },
      surface: { kind: 'professional' },
    });

    expect(plan.rhythm).toBe('short_reply');
    expect(plan.lengthBand).toBe('short');
    expect(plan.reasons).toContain('analysis_room');
    expect(plan.reasons).toContain('ai_continuation');
  });

  it('keeps long analysis AI-to-AI continuations short by default', () => {
    const plan = deriveTurnPlan({
      chat: chat({
        type: 'group',
        sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
      }),
      speaker: character(),
      messages: [
        message({
          type: 'ai',
          senderId: 'other',
          senderName: '甲',
          content: '我觉得这个问题需要先拆成规则、意愿、空间和经济压力四层来看。'.repeat(8),
          timestamp: 10,
        }),
      ],
      intent: { ...intent, stance: 'support', delivery: 'short_reply', messageShape: 'single_sentence' },
      surface: { kind: 'professional' },
    });

    expect(plan.rhythm).toBe('short_reply');
    expect(plan.lengthBand).toBe('short');
    expect(plan.allowExtraMessages).toBe(false);
    expect(plan.reasons).toContain('avoid_ai_chain_essay');
  });

  it('keeps long casual group AI-to-AI continuations short', () => {
    const plan = deriveTurnPlan({
      chat: chat({ type: 'group' }),
      speaker: character(),
      messages: [
        message({
          type: 'ai',
          senderId: 'other',
          senderName: '甲',
          content: '我刚才又想了一圈，感觉这事不能只看房租，也不能只看陪伴，还要看作息、卫生、边界和社交电量。'.repeat(4),
          timestamp: 10,
        }),
      ],
      intent,
      surface: { kind: 'chat' },
    });

    expect(plan.rhythm).toBe('short_reply');
    expect(plan.lengthBand).toBe('short');
    expect(plan.reasons).toContain('group_ai_chain_needs_brevity');
  });

  it('allows direct human depth requests to split into consecutive bubbles', () => {
    const plan = deriveTurnPlan({
      chat: chat({ type: 'direct' }),
      speaker: character(),
      messages: [
        message({
          content: '我现在有点说不清楚，就是既想要有人陪，又特别怕别人一直打扰我。你能不能别只安慰我，帮我拆一下这个矛盾到底卡在哪里，以及我到底该选合租还是独居？',
          timestamp: 10,
        }),
      ],
      intent,
      surface: { kind: 'chat' },
      now: 10,
    });

    expect(plan.rhythm).toBe('multi_bubble');
    expect(plan.allowExtraMessages).toBe(true);
    expect(plan.targetBubbleCount).toBe(2);
    expect(plan.reasons).toContain('human_depth_can_split_bubbles');
  });

  it('allows addressed group human depth requests to use extra bubbles without changing AI-chain brevity', () => {
    const plan = deriveTurnPlan({
      chat: chat({ type: 'group' }),
      speaker: character(),
      messages: [
        message({
          content: '你们刚才说得都有道理，但我想问一个更具体的：如果室友之间作息完全错开，只靠冰箱标签和群消息，还能算是陪伴吗，还是说这只是比较高级的安全感？',
          timestamp: 10,
        }),
      ],
      intent: { ...intent, delivery: 'group_redirect', messageShape: 'question_only' },
      surface: { kind: 'chat' },
      now: 10,
    });

    expect(plan.rhythm).toBe('multi_bubble');
    expect(plan.allowExtraMessages).toBe(true);
    expect(plan.reasons).toContain('human_depth_can_split_bubbles');
  });

  it('still allows full analysis replies when a human turn asks for substance', () => {
    const plan = deriveTurnPlan({
      chat: chat({
        type: 'group',
        sessionKind: { topology: 'group', family: 'analysis', scenarioId: 'opinion-review', surfaceProfile: 'text' },
      }),
      speaker: character(),
      messages: [message({ content: '请你把刚才几个观点裁决一下，给出证据和反例。', timestamp: 10 })],
      intent: { ...intent, stance: 'summarize', delivery: 'group_redirect', messageShape: 'two_sentences' },
      surface: { kind: 'professional' },
    });

    expect(plan.rhythm).toBe('full_reply');
    expect(plan.lengthBand).toBe('medium');
    expect(plan.reasons).toContain('human_turn');
  });

  it('does not force short human inputs into micro_ack solely from local intent shape', () => {
    const plan = deriveTurnPlan({
      chat: chat(),
      speaker: character({ speechProfile: { catchphrases: [], fillers: [], tabooPhrases: [], preferredOpeners: [], preferredClosers: [], sentenceLengthBias: 'short', questionBias: 30, sarcasmBias: 10 } }),
      messages: [message({ content: '合同责任？', timestamp: 10 })],
      intent: fragmentIntent(),
      surface: { kind: 'chat' },
      now: 10,
    });

    expect(plan.rhythm).not.toBe('micro_ack');
    expect(plan.reasons).not.toContain('fragment_or_tiny_context');
  });

  it('does not label a normal AI follow-up as micro_ack solely because the intent is question-shaped', () => {
    const plan = deriveTurnPlan({
      chat: chat({ type: 'group', memberIds: ['char-a', 'char-b'] }),
      speaker: character(),
      messages: [
        message({
          id: 'ai-1',
          type: 'ai',
          senderId: 'char-b',
          senderName: '郝然',
          content: '北门那家我熟一点，木桌靠窗那两排，去晚了只剩高脚凳。',
          timestamp: 10,
        }),
      ],
      intent: { ...intent, messageShape: 'question_only', delivery: 'quick_question' },
      surface: { kind: 'chat' },
      now: 20,
    });

    expect(plan.rhythm).not.toBe('micro_ack');
    expect(plan.lengthBand).not.toBe('micro');
  });

  it('does not turn the internal length band into a fixed prompt target', () => {
    const prompt = buildTurnPlanPrompt({
      rhythm: 'short_reply',
      targetBubbleCount: 1,
      lengthBand: 'medium',
      allowExtraMessages: false,
      waitSensitive: false,
      reasons: ['test'],
    });

    expect(prompt).toContain('Do not target a fixed length band');
    expect(prompt).toContain('not a keyword rule, output template, or length cap');
    expect(prompt).toContain('one compact social or deliberative move');
    expect(prompt).not.toContain('Target length band');
  });

  it('uses the delivery policy to vary proactive later-send availability', () => {
    const plan = deriveTurnPlan({
      chat: chat({ type: 'direct' }), speaker: character(),
      messages: [message({ content: '我今天路过那家店，忽然想起你上次说的话。', timestamp: 42 })],
      intent, surface: { kind: 'chat' }, richDelivery: highDelivery, now: 42,
    });

    expect(plan.allowExtraMessages).toBe(true);
    expect(plan.targetBubbleCount).toBe(5);
    expect(plan.reasons.some((reason) => reason.startsWith('delivery:'))).toBe(true);
    const prompt = buildTurnPlanPrompt(plan);
    expect(prompt).toContain('never required');
    expect(prompt).toContain('full stop is a possible send boundary');
    expect(prompt).toContain('not a mechanical splitting rule');
    expect(prompt).toContain('one to several real sends');
    expect(prompt).toContain('uneven in length');
  });

  it('gives high, medium, and low delivery policies different proactive thresholds', () => {
    const input = {
      chat: chat({ id: 'room-0', type: 'direct' }), speaker: character(),
      messages: [message({ content: '我今天路过那家店，忽然想起你上次说的话。', timestamp: 42 })],
      intent, surface: { kind: 'chat' as const }, now: 42,
    };
    const high = deriveTurnPlan({ ...input, richDelivery: highDelivery });
    const medium = deriveTurnPlan({ ...input, richDelivery: { ...highDelivery, multiBubble: { proactivity: 'medium', maxBubbles: 2 } } });
    const low = deriveTurnPlan({ ...input, richDelivery: { ...highDelivery, multiBubble: { proactivity: 'low', maxBubbles: 2 } } });

    expect(high.allowExtraMessages).toBe(true);
    expect(medium.allowExtraMessages).toBe(false);
    expect(low.allowExtraMessages).toBe(false);
    expect(high.reasons.some((reason) => reason.startsWith('delivery:high_'))).toBe(true);
  });
});
