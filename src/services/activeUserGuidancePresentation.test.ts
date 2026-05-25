import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RuntimeEventV2 } from '../types/runtimeEvent';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import type { AIModelProfile } from '../types/settings';
import { projectActiveUserGuidance } from './activeUserGuidancePresentation';

function buildCharacter(id: string, name: string, patch: Partial<AICharacter> = {}): AICharacter {
  return {
    id,
    name,
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
    ...patch,
  };
}

function buildChat(patch: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['mei', 'hui'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    sourceChatId: null,
    sourceMemberIds: [],
    runtimeTimeline: [],
    runtimeEventsV2: [],
    relationshipLedger: [],
    governance: DEFAULT_CONVERSATION_GOVERNANCE,
    dramaRules: DEFAULT_CONVERSATION_DRAMA_RULES,
    worldState: DEFAULT_CONVERSATION_WORLD_STATE,
    directorControls: DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...patch,
  };
}

function buildMessage(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'm1',
    chatId: 'chat-1',
    type: patch.type || 'user',
    senderId: patch.senderId || 'user',
    senderName: patch.senderName || '用户',
    content: patch.content || '',
    emotion: 0,
    timestamp: patch.timestamp || 1,
    isDeleted: false,
  };
}

function imageProfile(): AIModelProfile {
  return {
    id: 'image-default',
    name: '默认图片',
    type: 'image',
    provider: 'openai',
    apiKey: 'key',
    baseUrl: 'https://example.test',
    model: 'image-model',
    isDefault: true,
  };
}

describe('activeUserGuidancePresentation', () => {
  const members = [buildCharacter('mei', '美羊羊'), buildCharacter('hui', '灰太狼')];

  it('projects current developer media guidance before the AI response is committed', () => {
    const projection = projectActiveUserGuidance({
      chat: buildChat(),
      members,
      messages: [buildMessage({ type: 'god', senderName: '开发者', content: '美羊羊发个灰太狼证件照的图片' })],
      aiProfiles: [],
      now: 40,
    });

    expect(projection).toMatchObject({
      title: '图片请求：灰太狼',
      sourceLabel: '开发者引导',
      statusLabel: '显式请求',
      warning: '被点名角色没有可用图片模型，无法真正生成图片。',
    });
    expect(projection?.chips).toEqual(expect.arrayContaining(['图片请求', '待回应：美羊羊', '执行：美羊羊', '图片对象：灰太狼', '未配置图片模型']));
  });

  it('shows only unanswered requested actors for multi-actor guidance', () => {
    const intervention: RuntimeEventV2 = {
      id: 'evt-director',
      conversationId: 'chat-1',
      kind: 'director_intervention',
      createdAt: 30,
      summary: '让美羊羊和灰太狼都发图',
      visibility: 'moderator_only',
      payload: {
        intent: 'force_reply',
        targetActorIds: ['mei', 'hui'],
        pressure: 0.98,
        text: '让美羊羊和灰太狼都发一张图',
        maxTurns: 2,
        expiresAt: 1000,
        userGuidance: {
          kind: 'media_request',
          rawText: '让美羊羊和灰太狼都发一张图',
          actorIds: ['mei', 'hui'],
          mentionedActorIds: ['mei', 'hui'],
          mediaRequest: { kind: 'image', subjectActorIds: [], subjectText: '当前话题', actionText: '发一张图' },
          focusText: '让美羊羊和灰太狼都发一张图',
          beatType: 'answer',
          pressure: 0.98,
          maxTurns: 2,
          reason: '用户指定角色发送或创作图片。',
        },
      },
    };
    const projection = projectActiveUserGuidance({
      chat: buildChat({ runtimeEventsV2: [intervention], memberIds: ['mei', 'hui'] }),
      members,
      messages: [buildMessage({ type: 'ai', senderId: 'mei', senderName: '美羊羊', content: '我先发。', timestamp: 40 })],
      aiProfiles: [imageProfile()],
      now: 50,
    });

    expect(projection?.chips).toEqual(expect.arrayContaining(['待回应：灰太狼', '已回应：美羊羊', '图片能力可用']));
    expect(projection?.warning).toBeUndefined();
  });
});
