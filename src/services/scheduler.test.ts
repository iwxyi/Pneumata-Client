import { afterAll, describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { calculateWeights } from './scheduler';
import type { DirectorIntent } from './directorIntent';

const realMathRandom = Math.random;
Math.random = () => 0;

afterAll(() => {
  Math.random = realMathRandom;
});

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

function buildChat(): GroupChat {
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
    memberIds: ['a', 'b'],
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
  };
}

function buildMessage(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'm1',
    chatId: 'chat-1',
    type: patch.type || 'ai',
    senderId: patch.senderId || 'a',
    senderName: patch.senderName || '甲',
    content: patch.content || '',
    emotion: 0,
    timestamp: patch.timestamp || 1,
    isDeleted: false,
  };
}

describe('scheduler speaker scoring', () => {
  it('boosts the actor targeted by DirectorIntent and exposes score reasons', () => {
    const intent: DirectorIntent = {
      source: 'user_message',
      beatType: 'answer',
      targetActorIds: ['b'],
      pressure: 0.9,
      reason: '用户点名乙',
    };
    const candidates = calculateWeights(
      [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      [buildMessage({ senderId: 'a', senderName: '甲', content: '乙，你说呢？' })],
      {},
      1,
      0,
      null,
      buildChat(),
      intent,
    );
    const a = candidates.find((candidate) => candidate.characterId === 'a');
    const b = candidates.find((candidate) => candidate.characterId === 'b');
    expect(b?.weight).toBeGreaterThan(a?.weight || 0);
    expect(b?.scoreBreakdown?.lineInvolvement).toBeGreaterThan(0);
    expect(b?.scoreBreakdown?.reasons).toContain('director:answer:target');
  });

  it('surfaces emotional aftermath as a speaker reason', () => {
    const candidates = calculateWeights(
      [
        buildCharacter('a', '甲'),
        buildCharacter('b', '乙', { emotionalState: { irritation: 18, affection: 0, insecurity: 6, excitement: 0, embarrassment: 0 } }),
      ],
      [buildMessage({ senderId: 'a', senderName: '甲', content: '你这也太不靠谱了吧？' })],
      {},
      1,
      0,
      null,
      buildChat(),
    );

    const b = candidates.find((candidate) => candidate.characterId === 'b');
    expect(b?.scoreBreakdown?.emotionalPressure).toBeGreaterThan(0);
    expect(b?.scoreBreakdown?.reasons).toContain('emotion:tension');
  });
});
