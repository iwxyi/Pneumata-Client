import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_EMOTIONAL_STATE, type AICharacter } from '../types/character';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { DEFAULT_COMPANIONSHIP_SETTINGS } from '../types/settings';
import { buildCompanionshipRitualEventsFromDirectUserMessage, resolveCompanionshipRitualEventsFromDirectUserMessage } from './directCompanionshipRitual';
import { setCompanionshipRuntimeConfig } from './companionshipRuntimeConfig';

vi.mock('./aiClient', () => ({
  generateJsonResponse: vi.fn(),
}));

const { generateJsonResponse } = await import('./aiClient');

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
    memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
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

function chat(runtimeEventsV2: RuntimeEventV2[] = []) {
  return normalizeConversation({
    id: 'chat-1',
    type: 'direct',
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
    runtimeEventsV2,
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function userMessage(content: string, timestamp = 1_000): Message {
  return {
    id: `m-${timestamp}`,
    chatId: 'chat-1',
    senderId: 'user',
    senderName: '我',
    content,
    timestamp,
    type: 'user',
    emotion: 0,
    isDeleted: false,
  };
}

function performedRitualEvent(createdAt = 1_000): RuntimeEventV2 {
  return {
    id: 'evt-ritual-performed',
    conversationId: 'chat-1',
    kind: 'artifact',
    createdAt,
    actorIds: ['user'],
    targetIds: ['char-a'],
    summary: '苏苏记录了一次自然问候仪式',
    visibility: 'pair_private',
    eventClass: 'artifact',
    payload: {
      eventType: 'companionship_ritual',
      characterId: 'char-a',
      userId: 'user',
      ritualId: 'ritual-char-a-daily-greeting',
      kind: 'daily_greeting',
      action: 'performed',
      participantIds: ['char-a', 'user'],
      reason: '用户明确开启问候仪式。',
      nextAvailableAt: createdAt + 12 * 60 * 60_000,
      confidence: 0.72,
      decisionSource: 'local_fallback',
    },
  };
}

describe('directCompanionshipRitual', () => {
  beforeEach(() => {
    setCompanionshipRuntimeConfig(DEFAULT_COMPANIONSHIP_SETTINGS);
    vi.mocked(generateJsonResponse).mockReset();
  });

  it('writes a performed greeting ritual event from explicit direct greeting text', () => {
    const events = buildCompanionshipRitualEventsFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: userMessage('晚安，今天先睡啦。', 1_000),
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      eventType: 'companionship_ritual',
      ritualId: 'ritual-char-a-daily-greeting',
      kind: 'daily_greeting',
      action: 'performed',
      content: '用我能接受的轻度方式表达早安/晚安，不机械打卡。',
      confidence: 0.72,
      decisionSource: 'local_fallback',
    });
  });

  it('writes a suppressed greeting ritual event when user rejects greeting rituals', () => {
    const events = buildCompanionshipRitualEventsFromDirectUserMessage({
      chat: chat(),
      character: character({
        memory: { shortTermSummary: '', longTerm: [], secrets: [], obsessions: [], tabooTopics: [], userMemories: ['用户说不要早安晚安。'] },
      }),
      message: userMessage('早安。', 1_000),
    });

    expect(events[0].payload).toMatchObject({
      eventType: 'companionship_ritual',
      ritualId: 'ritual-char-a-daily-greeting',
      action: 'suppressed',
      reason: 'user boundary suppresses greeting ritual',
    });
  });

  it('writes a suppressed greeting ritual event when daily greeting rituals are disabled by settings', () => {
    setCompanionshipRuntimeConfig({
      ritualKindToggles: {
        ...DEFAULT_COMPANIONSHIP_SETTINGS.ritualKindToggles,
        daily_greeting: false,
      },
    });

    const events = buildCompanionshipRitualEventsFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: userMessage('早安。', 1_000),
    });

    expect(events[0].payload).toMatchObject({
      eventType: 'companionship_ritual',
      ritualId: 'ritual-char-a-daily-greeting',
      action: 'suppressed',
      reason: 'daily greeting rituals disabled by settings',
    });
  });

  it('writes a skipped greeting ritual event while greeting ritual is cooling down', () => {
    const events = buildCompanionshipRitualEventsFromDirectUserMessage({
      chat: chat([performedRitualEvent(1_000)]),
      character: character(),
      message: userMessage('晚安。', 1_000 + 60 * 60_000),
    });

    expect(events[0].payload).toMatchObject({
      eventType: 'companionship_ritual',
      ritualId: 'ritual-char-a-daily-greeting',
      action: 'skipped',
      reason: 'greeting ritual is still in cooldown',
      nextAvailableAt: 1_000 + 12 * 60 * 60_000,
    });
  });

  it('does not write ritual events when relationship rituals are disabled globally', () => {
    setCompanionshipRuntimeConfig({ enableRelationshipRituals: false });

    const events = buildCompanionshipRitualEventsFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: userMessage('晚安，今天先睡啦。', 1_000),
    });

    expect(events).toEqual([]);
  });

  it('uses model judgment for greeting ritual triggers when api config is available', async () => {
    vi.mocked(generateJsonResponse).mockResolvedValue(JSON.stringify({
      shouldCreate: true,
      kind: 'daily_greeting',
      confidence: 0.91,
      reason: '用户直接对当前角色说晚安，形成睡前问候仪式。',
      evidence: '晚安，今天先睡啦。',
    }));

    const events = await resolveCompanionshipRitualEventsFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: userMessage('晚安，今天先睡啦。', 1_000),
      textApiConfig: { provider: 'openai', baseUrl: '', apiKey: 'k', model: 'm' },
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      eventType: 'companionship_ritual',
      ritualId: 'ritual-char-a-daily-greeting',
      action: 'performed',
      reason: '用户直接对当前角色说晚安，形成睡前问候仪式。',
      evidence: '晚安，今天先睡啦。',
      confidence: 0.91,
      decisionSource: 'model',
    });
  });

  it('warns and falls back to local judgment when model judgment fails', async () => {
    vi.mocked(generateJsonResponse).mockRejectedValue(new Error('model down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = await resolveCompanionshipRitualEventsFromDirectUserMessage({
        chat: chat(),
        character: character(),
        message: userMessage('晚安，今天先睡啦。', 1_000),
        textApiConfig: { provider: 'openai', baseUrl: '', apiKey: 'k', model: 'm' },
      });

      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        eventType: 'companionship_ritual',
        action: 'performed',
        decisionSource: 'local_fallback',
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[recoverable-warning] companionship:ritual-model-fallback'), expect.objectContaining({
        fallback: 'local_fallback',
      }));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
