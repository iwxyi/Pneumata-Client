import { describe, expect, it, vi } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_EMOTIONAL_STATE, type AICharacter } from '../types/character';
import type { Message } from '../types/message';
import { generateJsonResponse } from './aiClient';
import { buildCompanionshipPhaseEventFromDirectUserMessage, resolveCompanionshipPhaseEventFromDirectUserMessage } from './directCompanionshipPhase';

vi.mock('./aiClient', () => ({
  generateJsonResponse: vi.fn(),
}));

const generateJsonResponseMock = vi.mocked(generateJsonResponse);

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

describe('directUserReplyFlow companionship phase events', () => {
  it('creates confirmed romantic phase event from explicit relationship confirmation', () => {
    const event = buildCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('那我们就按恋人关系相处吧。'),
    });

    expect(event).toMatchObject({
      kind: 'phase_transition',
      createdAt: 1000,
      actorIds: ['user'],
      targetIds: ['char-a'],
      evidenceMessageIds: ['msg-1'],
      visibility: 'pair_private',
      payload: {
        eventType: 'companionship_phase_event',
        characterId: 'char-a',
        userId: 'user',
        phase: 'confirmed',
        style: 'romantic',
        initiatedBy: 'user',
      },
    });
  });

  it('creates reconciling and crisis events from explicit repair or conflict text', () => {
    const repair = buildCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('我们别冷战了，慢慢说开吧。'),
    });
    const crisis = buildCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('你刚刚那句话让我很不舒服，我们先冷静一下。'),
    });

    expect(repair?.payload).toMatchObject({ phase: 'reconciling' });
    expect(crisis?.payload).toMatchObject({ phase: 'crisis' });
  });

  it('does not create phase events for ordinary direct or group messages', () => {
    expect(buildCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('今天晚上吃什么？'),
    })).toBeNull();
    expect(buildCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('group'),
      character: character(),
      message: message('那我们就按恋人关系相处吧。'),
    })).toBeNull();
  });

  it('does not create local crisis phase events from non-relationship discomfort text', () => {
    expect(buildCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('今天工作让我很不舒服，我得先冷静一下。'),
    })).toBeNull();
    expect(buildCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('这个游戏剧情让我很受伤。'),
    })).toBeNull();
  });

  it('uses model judgment before local fallback when text api config exists', async () => {
    generateJsonResponseMock.mockResolvedValueOnce(JSON.stringify({
      shouldCreate: true,
      phase: 'confirmed',
      style: 'romantic',
      confidence: 0.86,
      reason: '用户明确确认恋人关系。',
      evidence: ['按恋人关系相处'],
    }));

    const event = await resolveCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('那我们就按恋人关系相处吧。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(generateJsonResponseMock).toHaveBeenCalledTimes(1);
    expect(event?.payload).toMatchObject({
      phase: 'confirmed',
      style: 'romantic',
      confidence: 0.86,
      decisionSource: 'model',
    });
  });

  it('accepts model-led mature and cooling phase transitions', async () => {
    generateJsonResponseMock.mockResolvedValueOnce(JSON.stringify({
      shouldCreate: true,
      phase: 'deep',
      style: 'romantic',
      confidence: 0.84,
      reason: '用户明确表达长期稳定的亲密承诺。',
      evidence: ['我们慢慢走很久也可以'],
    }));
    const deepEvent = await resolveCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('我不需要每天轰轰烈烈，但想和你慢慢走很久。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    generateJsonResponseMock.mockResolvedValueOnce(JSON.stringify({
      shouldCreate: true,
      phase: 'cooling',
      style: 'friend',
      confidence: 0.82,
      reason: '用户明确表达希望降温并减少亲密互动。',
      evidence: ['最近先少联系一点'],
    }));
    const coolingEvent = await resolveCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('最近我们先少联系一点吧，我想把距离拉回来。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(deepEvent?.payload).toMatchObject({
      phase: 'deep',
      style: 'romantic',
      decisionSource: 'model',
    });
    expect(coolingEvent?.payload).toMatchObject({
      phase: 'cooling',
      style: 'friend',
      decisionSource: 'model',
    });
  });

  it('trusts conservative model rejection to avoid local keyword false positives', async () => {
    generateJsonResponseMock.mockResolvedValueOnce(JSON.stringify({
      shouldCreate: false,
      phase: 'none',
      style: null,
      confidence: 0.2,
      reason: '用户只是在讨论一个假设，不是确认当前关系。',
      evidence: [],
    }));

    const event = await resolveCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('如果我们按恋人关系相处，会不会很奇怪？'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(event).toBeNull();
  });

  it('falls back to local judgment only when model judgment fails', async () => {
    generateJsonResponseMock.mockRejectedValueOnce(new Error('model unavailable'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const event = await resolveCompanionshipPhaseEventFromDirectUserMessage({
      chat: chat('direct'),
      character: character(),
      message: message('我们别冷战了，慢慢说开吧。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(event?.payload).toMatchObject({
      phase: 'reconciling',
      decisionSource: 'local_fallback',
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[recoverable-warning] companionship:phase-model-fallback'), expect.objectContaining({
      fallback: 'local_fallback',
      messagePreview: '我们别冷战了，慢慢说开吧。',
    }));
    warnSpy.mockRestore();
  });
});
