import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../../types/character';
import { normalizeConversation } from '../../types/chat';
import type { Message } from '../../types/message';
import { buildChatSubtitle } from './chatCardSubtitle';

function character(overrides: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 65, neuroticism: 45, humor: 50, creativity: 50, assertiveness: 42, empathy: 72 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories: [],
    background: '穿搭博主',
    speakingStyle: '轻快',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: {
      shortTermSummary: '',
      longTerm: [],
      secrets: [],
      obsessions: [],
      tabooTopics: [],
      userMemories: [],
    },
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
    ...overrides,
  };
}

function chat(type: 'group' | 'direct' | 'ai_direct' = 'direct') {
  return normalizeConversation({
    id: 'chat-1',
    type,
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '测试单聊',
    topic: '日常聊天',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '她还记得昨天说过的计划。', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || 'm-1',
    chatId: 'chat-1',
    type: overrides.type || 'user',
    senderId: overrides.senderId || 'user',
    senderName: overrides.senderName || '用户',
    content: overrides.content || '明天面试有点紧张。',
    emotion: 0,
    timestamp: overrides.timestamp || 200,
    isDeleted: false,
    ...overrides,
  };
}

describe('ChatCard subtitle', () => {
  it('keeps the real latest user message before companionship projection', () => {
    const subtitle = buildChatSubtitle(
      chat('direct'),
      [character()],
      message({ type: 'user', senderId: 'user', content: '明天面试有点紧张。' }),
      '本来想问问小夏，明天面试后来怎么样了。',
    );

    expect(subtitle).toBe('你：明天面试有点紧张。');
  });

  it('keeps the real latest AI message before companionship projection', () => {
    const subtitle = buildChatSubtitle(
      chat('direct'),
      [character()],
      message({ type: 'ai', senderId: 'char-a', senderName: '苏苏', content: '我在，慢慢说。' }),
      '本来想问问小夏，明天面试后来怎么样了。',
    );

    expect(subtitle).toBe('苏苏：我在，慢慢说。');
  });

  it('does not use companionship projection for ai direct chats', () => {
    const subtitle = buildChatSubtitle(
      chat('ai_direct'),
      [character()],
      message({ type: 'user', senderId: 'user', content: '明天面试有点紧张。' }),
      '本来想问问小夏，明天面试后来怎么样了。',
    );

    expect(subtitle).toBe('你：明天面试有点紧张。');
  });
});
