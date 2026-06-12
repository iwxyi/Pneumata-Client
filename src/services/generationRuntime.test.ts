import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { buildGenerationRuntimeBundle } from './generationRuntime';

function speaker(): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  } as AICharacter;
}

function chat(type: GroupChat['type'] = 'group', mode: GroupChat['mode'] = 'open_chat'): GroupChat {
  return {
    id: 'chat-1',
    type,
    mode,
    sessionKind: {
      topology: type === 'group' ? 'group' : type === 'ai_direct' ? 'thread' : 'direct',
      family: mode === 'group_discussion' ? 'analysis' : mode === 'interview' ? 'interview' : 'conversation',
      scenarioId: mode === 'group_discussion' ? 'group-discussion' : type === 'direct' ? 'direct-chat' : type === 'ai_direct' ? 'ai-private-thread' : 'open-chat',
      surfaceProfile: 'text',
    },
    name: '测试',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a', 'char-b'],
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
  } as GroupChat;
}

function message(type: Message['type'], senderId: string, senderName: string, content: string): Message {
  return {
    id: `${senderId}-${type}`,
    chatId: 'chat-1',
    type,
    senderId,
    senderName,
    content,
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
  };
}

describe('generationRuntime', () => {
  it('prefers person target scope in direct chat', () => {
    const bundle = buildGenerationRuntimeBundle({
      chat: chat('direct'),
      speaker: speaker(),
      messages: [message('user', 'user', 'User', '你好')],
      promptContext: null,
    });
    expect(bundle.turnPlan?.targetScope).toBe('person');
  });

  it('prefers topic target scope in discussion scenario', () => {
    const bundle = buildGenerationRuntimeBundle({
      chat: chat('group', 'group_discussion'),
      speaker: speaker(),
      messages: [message('user', 'user', 'User', '请讨论方案取舍')],
      promptContext: null,
    });
    expect(bundle.turnPlan?.targetScope).toBe('topic');
    expect(bundle.turnPlan?.moveClass).toBe('deepen');
  });

  it('derives analytical role constraint and function tag for discussion turns', () => {
    const bundle = buildGenerationRuntimeBundle({
      chat: chat('group', 'group_discussion'),
      speaker: speaker(),
      messages: [message('user', 'user', 'User', '帮我多分析一个维度')],
      promptContext: null,
    });
    expect(bundle.realizationPlan?.functionTag).toBe('add_angle');
    expect(bundle.realizationPlan?.roleConstraint).toBe('add_one_new_dimension');
    expect(bundle.trace?.functionTag).toBe('add_angle');
    expect(bundle.trace?.roleConstraint).toBe('add_one_new_dimension');
  });

  it('marks hotspot speakers and compresses depth', () => {
    const bundle = buildGenerationRuntimeBundle({
      chat: chat('group'),
      speaker: speaker(),
      messages: [
        message('ai', 'char-a', '苏苏', '第一句'),
        message('ai', 'char-a', '苏苏', '第二句'),
        message('ai', 'char-b', '阿北', '插一句'),
        message('ai', 'char-a', '苏苏', '第三句'),
        message('ai', 'char-a', '苏苏', '第四句'),
        message('user', 'user', 'User', '继续说说'),
      ],
      promptContext: { responseStyle: 'longform' },
    });
    expect(bundle.trace?.hotspotState).toBe('hot');
    expect(bundle.turnPlan?.depth).toBe('normal');
  });

  it('maps direct private threads to comfort-first function tags', () => {
    const bundle = buildGenerationRuntimeBundle({
      chat: chat('ai_direct'),
      speaker: speaker(),
      messages: [message('user', 'user', 'User', '我现在有点乱，你先陪我理一下')],
      promptContext: null,
    });
    expect(bundle.turnPlan?.targetScope).toBe('person');
    expect(bundle.realizationPlan?.functionTag).toBe('comfort');
    expect(bundle.realizationPlan?.roleConstraint).toBe('acknowledge_user_need_first');
    expect(bundle.expressionPlan?.surface).toBe('companion');
  });

  it('keeps task-style scenarios answer-first with markdown capability trace', () => {
    const bundle = buildGenerationRuntimeBundle({
      chat: chat('direct', 'interview'),
      speaker: speaker(),
      messages: [message('user', 'user', 'User', '请先直接回答，再展开原因')],
      promptContext: { allowMarkdown: true },
    });
    expect(bundle.turnPlan?.moveClass).toBe('respond');
    expect(bundle.realizationPlan?.functionTag).toBe('answer');
    expect(bundle.realizationPlan?.roleConstraint).toBe('answer_before_expanding');
    expect(bundle.expressionPlan?.allowMarkdown).toBe(true);
  });

  it('shifts repeated analytical turns toward a challenge retry path when validation blocks', () => {
    const bundle = buildGenerationRuntimeBundle({
      chat: chat('group', 'group_discussion'),
      speaker: speaker(),
      messages: [
        message('ai', 'char-a', '苏苏', 'deepen:topic:user'),
        message('user', 'user', 'User', '再补一个角度'),
      ],
      promptContext: null,
    });
    expect(bundle.validationDecision?.allowed).toBe(true);
    expect(bundle.turnPlan?.moveClass).toBe('challenge');
    expect(bundle.realizationPlan?.functionTag).toBe('challenge');
    expect(bundle.trace?.duplicateDecision).toBeTruthy();
  });
});
