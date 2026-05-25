import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../../types/chat';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../../types/character';
import type { Message } from '../../types/message';
import type { MemoryItem } from '../memoryTypes';
import { interviewPromptAdapter } from './interviewPromptAdapter';
import { werewolfPromptAdapter } from './werewolfPromptAdapter';

function memory(text: string): MemoryItem {
  return {
    id: 'memory-1',
    ownerId: 'char-a',
    scope: 'character_self',
    layer: 'long_term',
    kind: 'trait_evidence',
    text,
    salience: 0.82,
    confidence: 0.82,
    recency: 0.7,
    reinforcementCount: 2,
    sourceEventIds: ['event-1'],
    sourceTag: 'llm_memory_character_perspective',
    origin: 'distilled',
    createdAt: 1,
    updatedAt: 2,
    archivedAt: null,
  };
}

function character(layeredMemories: MemoryItem[] = []): AICharacter {
  return {
    id: 'char-a',
    name: '甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories,
    background: '谨慎但记仇',
    speakingStyle: '简短直接',
    expertise: [],
    coreProfile: { coreDesire: '', coreFear: '', valuePriority: [], socialMask: '', biases: [], interactionHabits: [] },
    group: '',
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    memory: DEFAULT_CHARACTER_MEMORY,
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    personalityDrift: {},
    modelProfileId: null,
    modelProfileIds: {},
    bubbleStyleId: null,
    runtimeTimeline: [],
    deletedAt: null,
    fieldVersions: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function chat(mode: 'interview' | 'werewolf') {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode,
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: mode === 'interview' ? '模拟面试' : '狼人杀',
    topic: '测试',
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
    type: 'ai',
    senderId: 'char-a',
    senderName: '甲',
    content,
    emotion: 0,
    timestamp: 2,
    isDeleted: false,
  };
}

describe('mode prompt adapters memory context', () => {
  it('keeps character memory in interview prompts', () => {
    const speaker = character([memory('甲记得自己在压力面试里会追问候选人的旧承诺。')]);
    const prompt = interviewPromptAdapter.buildSystemPrompt({
      character: speaker,
      chat: chat('interview'),
      emotion: 0,
      messages: [message('请开始面试。')],
      characters: new Map([[speaker.id, speaker]]),
    });

    expect(prompt).toContain('追问候选人的旧承诺');
  });

  it('keeps character memory in werewolf prompts', () => {
    const speaker = character([memory('甲记得乙上次悍跳时总会先装无辜。')]);
    const prompt = werewolfPromptAdapter.buildSystemPrompt({
      character: speaker,
      chat: chat('werewolf'),
      emotion: 0,
      messages: [message('轮到你发言。')],
      characters: new Map([[speaker.id, speaker]]),
    });

    expect(prompt).toContain('上次悍跳');
  });
});
