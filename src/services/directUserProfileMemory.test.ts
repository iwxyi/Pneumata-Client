import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_EMOTIONAL_STATE, type AICharacter } from '../types/character';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import { generateJsonResponse } from './aiClient';
import { buildUserProfileMemoryEventFromDirectUserMessage, resolveUserProfileMemoryEventFromDirectUserMessage } from './directUserProfileMemory';

vi.mock('./aiClient', () => ({
  generateJsonResponse: vi.fn(),
}));

const generateJsonResponseMock = vi.mocked(generateJsonResponse);

beforeEach(() => {
  generateJsonResponseMock.mockReset();
});

function character(): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 65, neuroticism: 45, humor: 50, creativity: 50, assertiveness: 42, empathy: 72 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories: [],
    background: '',
    speakingStyle: '',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function chat(type: 'direct' | 'group' = 'direct') {
  return normalizeConversation({
    id: 'chat-1',
    type,
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '测试单聊',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function message(content: string): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: '用户',
    content,
    emotion: 0,
    timestamp: 1000,
    isDeleted: false,
  };
}

describe('directUserProfileMemory', () => {
  it('uses model judgment to create user profile memory events', async () => {
    generateJsonResponseMock.mockResolvedValueOnce(JSON.stringify({
      shouldCreate: true,
      items: [
        {
          kind: 'address_preference',
          text: '用户希望被称呼为小夏',
          evidence: '以后叫我小夏就好',
          confidence: 0.9,
          sensitive: false,
        },
        {
          kind: 'boundary',
          text: '用户不希望被早安晚安打扰',
          evidence: '不要早安晚安',
          confidence: 0.86,
          sensitive: true,
        },
      ],
      reason: '用户明确给出称呼和边界。',
    }));

    const event = await resolveUserProfileMemoryEventFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: message('以后叫我小夏就好，但不要早安晚安。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(generateJsonResponseMock).toHaveBeenCalledTimes(1);
    expect(event).toMatchObject({
      kind: 'artifact',
      visibility: 'pair_private',
      payload: {
        eventType: 'companionship_user_profile_memory',
        characterId: 'char-a',
        action: 'upsert',
        decisionSource: 'model',
      },
    });
    expect((event?.payload as { items: unknown[] }).items).toHaveLength(2);
  });

  it('trusts conservative model rejection instead of local keyword false positives', async () => {
    generateJsonResponseMock.mockResolvedValueOnce(JSON.stringify({
      shouldCreate: false,
      items: [],
      reason: '用户在说压力锅，不是自己的压力事项。',
    }));

    const event = await resolveUserProfileMemoryEventFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: message('这个压力锅最近真的很好用。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(event).toBeNull();
  });

  it('falls back to local profile extraction only when model fails', async () => {
    generateJsonResponseMock.mockRejectedValueOnce(new Error('model unavailable'));

    const event = await resolveUserProfileMemoryEventFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: message('以后叫我小夏就好。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(event?.payload).toMatchObject({
      eventType: 'companionship_user_profile_memory',
      decisionSource: 'local_fallback',
    });
  });

  it('does not create local profile events for ordinary direct or group messages', () => {
    expect(buildUserProfileMemoryEventFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: message('今天晚上吃什么？'),
    })).toBeNull();
    expect(buildUserProfileMemoryEventFromDirectUserMessage({
      chat: chat('group'),
      character: character(),
      message: message('以后叫我小夏就好。'),
    })).toBeNull();
  });
});
