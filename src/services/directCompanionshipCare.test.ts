import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_EMOTIONAL_STATE, type AICharacter } from '../types/character';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { buildCompanionshipCareTopicEventsFromDirectUserMessage, readActiveCompanionshipCareTopicsFromEvents } from './directCompanionshipCare';

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

function chat(runtimeEventsV2: RuntimeEventV2[] = []) {
  return normalizeConversation({
    id: 'chat-1',
    type: 'direct',
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

function message(content: string, id = 'msg-1', timestamp = 1000): Message {
  return {
    id,
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: '用户',
    content,
    emotion: 0,
    timestamp,
    isDeleted: false,
  };
}

describe('directCompanionshipCare', () => {
  it('opens a runtime care topic from direct user plans or pressure', () => {
    const events = buildCompanionshipCareTopicEventsFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: message('明天面试有点紧张。'),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'artifact',
      visibility: 'pair_private',
      evidenceMessageIds: ['msg-1'],
      payload: {
        eventType: 'companionship_care_topic',
        characterId: 'char-a',
        action: 'opened',
        urgency: 'high',
        topicText: '明天面试有点紧张。',
      },
    });
  });

  it('closes an active runtime care topic when user reports it is done', () => {
    const opened = buildCompanionshipCareTopicEventsFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: message('明天面试有点紧张。', 'msg-open', 1000),
    });
    const closed = buildCompanionshipCareTopicEventsFromDirectUserMessage({
      chat: chat(opened),
      character: character(),
      message: message('面试结束了，已经搞定了。', 'msg-close', 2000),
    });

    expect(closed).toHaveLength(1);
    expect(closed[0]?.payload).toMatchObject({
      eventType: 'companionship_care_topic',
      action: 'closed',
      topicId: (opened[0]?.payload as { topicId: string }).topicId,
    });
    expect(readActiveCompanionshipCareTopicsFromEvents(chat([...opened, ...closed]), 'char-a', 3000)).toEqual([]);
  });

  it('blocks an active runtime care topic when user rejects reminders', () => {
    const opened = buildCompanionshipCareTopicEventsFromDirectUserMessage({
      chat: chat(),
      character: character(),
      message: message('周末要去复查。', 'msg-open', 1000),
    });
    const blocked = buildCompanionshipCareTopicEventsFromDirectUserMessage({
      chat: chat(opened),
      character: character(),
      message: message('这件事不用提醒，也别问了。', 'msg-block', 2000),
    });

    expect(blocked[0]?.payload).toMatchObject({
      eventType: 'companionship_care_topic',
      action: 'blocked',
      topicId: (opened[0]?.payload as { topicId: string }).topicId,
    });
    expect(readActiveCompanionshipCareTopicsFromEvents(chat([...opened, ...blocked]), 'char-a', 3000)).toEqual([]);
  });
});
