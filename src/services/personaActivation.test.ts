import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { resolvePersonaActivation } from './personaActivation';

function character(patch: Partial<AICharacter> = {}): AICharacter {
  return {
    id: 'char-1',
    name: '精明省钱达人',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    behavior: { proactivity: 50, aggressiveness: 50, humorIntensity: 50, empathyLevel: 50, summarizing: 50, offTopic: 50 },
    expertise: ['省钱', '二手交易'],
    speakingStyle: '务实直接',
    background: '喜欢比较价格的日常生活达人',
    relationships: [],
    memory: { longTerm: [], shortTermSummary: '', secrets: [], obsessions: [], tabooTopics: [], userMemories: [] },
    intervention: { allowSpeakAs: true, allowDirectorPrompt: true, allowPrivateThread: true },
    isPreset: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function chat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    name: '闲聊',
    topic: '今晚吃什么',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-1'],
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

function message(content: string): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: '用户',
    content,
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
  };
}

describe('resolvePersonaActivation', () => {
  it('keeps explicit persona display low for ordinary chat', () => {
    const activation = resolvePersonaActivation({
      chat: chat(),
      speaker: character(),
      messages: [message('今晚火锅谁带饮料？')],
    });

    expect(activation.level).toBe('low');
    expect(activation.prompt).toContain('Do not advertise job labels');
  });

  it('raises activation when the topic directly touches the persona', () => {
    const activation = resolvePersonaActivation({
      chat: chat({ topic: '二手交易怎么避坑' }),
      speaker: character(),
      messages: [message('这个二手交易平台靠谱吗？')],
    });

    expect(activation.level).toBe('high');
    expect(activation.reasons).toContain('latest_mentions_persona_terms');
  });

  it('uses masked activation for hidden-role or game-like contexts', () => {
    const activation = resolvePersonaActivation({
      chat: chat({ mode: 'werewolf' as GroupChat['mode'], topic: '狼人杀第一晚' }),
      speaker: character(),
      messages: [message('你昨晚在哪里？')],
    });

    expect(activation.level).toBe('masked');
    expect(activation.prompt).toContain('hidden identity');
  });
});
