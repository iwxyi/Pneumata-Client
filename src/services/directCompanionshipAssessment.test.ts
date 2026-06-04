import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_EMOTIONAL_STATE, type AICharacter } from '../types/character';
import { normalizeConversation } from '../types/chat';
import type { Message } from '../types/message';
import { generateJsonResponse } from './aiClient';
import { resolveDirectCompanionshipAssessmentEvents } from './directCompanionshipAssessment';

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

function chat() {
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

describe('directCompanionshipAssessment', () => {
  it('uses one model call to produce phase, care topic, and user profile events', async () => {
    generateJsonResponseMock.mockResolvedValueOnce(JSON.stringify({
      phase: {
        shouldCreate: true,
        phase: 'confirmed',
        style: 'romantic',
        confidence: 0.91,
        reason: '用户明确确认关系。',
        evidence: ['我们就按恋人关系相处吧'],
      },
      careTopics: [{
        shouldCreate: true,
        action: 'opened',
        topicText: '明天面试有点紧张',
        urgency: 'high',
        dueInHours: 48,
        confidence: 0.86,
        reason: '用户提到明天面试压力。',
        evidence: '明天面试有点紧张',
      }],
      userProfile: {
        shouldCreate: true,
        items: [{
          kind: 'address_preference',
          text: '用户希望被称呼为小夏',
          evidence: '以后叫我小夏',
          confidence: 0.9,
          sensitive: false,
        }],
        reason: '用户给出称呼偏好。',
      },
    }));

    const events = await resolveDirectCompanionshipAssessmentEvents({
      chat: chat(),
      character: character(),
      message: message('以后叫我小夏。我们就按恋人关系相处吧，明天面试有点紧张。'),
      textApiConfig: { provider: 'openai', apiKey: 'key', baseUrl: 'https://example.test', model: 'model' },
    });

    expect(generateJsonResponseMock).toHaveBeenCalledTimes(1);
    expect(events.map((event) => (event.payload as { eventType?: string }).eventType)).toEqual([
      'companionship_phase_event',
      'companionship_care_topic',
      'companionship_user_profile_memory',
    ]);
  });
});
