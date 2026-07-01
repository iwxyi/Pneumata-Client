import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { buildScenarioRuntimeDecision } from './scenarioRuntime';

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

function chat(mode: GroupChat['mode'], phase: string): GroupChat {
  return {
    id: 'chat-1',
    type: 'group',
    mode,
    sessionKind: {
      topology: 'group',
      family: mode === 'group_discussion' ? 'analysis' : mode === 'interview' ? 'interview' : 'conversation',
      scenarioId: mode === 'group_discussion' ? 'opinion-review' : mode === 'interview' ? 'panel-interview' : 'open-chat',
      surfaceProfile: 'text',
    },
    scenarioState: { phase },
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
    worldState: { phase: phase as never, mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  } as GroupChat;
}

function message(): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: 'User',
    content: '继续',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
  };
}

describe('scenarioRuntime', () => {
  it('derives deliberation move class from deliberation phase', () => {
    const runtime = buildScenarioRuntimeDecision({
      conversation: chat('group_discussion', 'deliberation'),
      characters: [],
      messages: [message()],
      speaker: speaker(),
      promptContext: null,
    });
    expect(runtime.turnPlan.moveClass).toBe('deepen');
  });

  it('derives interview move class from interview family', () => {
    const runtime = buildScenarioRuntimeDecision({
      conversation: chat('interview', 'idle'),
      characters: [],
      messages: [message()],
      speaker: speaker(),
      promptContext: null,
    });
    expect(runtime.turnPlan.moveClass).toBe('respond');
  });
});
