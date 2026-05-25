import { describe, expect, it } from 'vitest';
import { normalizeConversation, type DriverMessageCommitTransition } from '../types/chat';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import type { Message } from '../types/message';
import type { MemoryItem } from './memoryTypes';
import { applyRecalledMemoryActivation } from './memoryRecallActivation';

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a', 'char-b'],
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

function memory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: overrides.id || 'old-memory',
    ownerId: 'char-a',
    scope: 'relationship',
    layer: 'long_term',
    kind: 'resentment',
    subjectIds: ['char-b'],
    text: overrides.text || '甲记得乙曾在雨夜失约。',
    salience: 0.82,
    confidence: 0.82,
    recency: 0.2,
    reinforcementCount: 2,
    sourceEventIds: ['old-event'],
    sourceTag: 'memory_distillation',
    origin: 'distilled',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: overrides.archivedAt ?? 10,
    ...overrides,
  };
}

function character(layeredMemories: MemoryItem[]): AICharacter {
  return {
    id: 'char-a',
    name: '甲',
    avatar: '',
    personality: { openness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50, humor: 50, creativity: 50, assertiveness: 50, empathy: 50 },
    emotionalState: DEFAULT_EMOTIONAL_STATE,
    relationships: [],
    layeredMemories,
    background: '',
    speakingStyle: '',
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

function message(content: string, overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-a',
    senderName: '甲',
    content,
    emotion: 0,
    timestamp: 2,
    isDeleted: false,
    ...overrides,
  };
}

describe('applyRecalledMemoryActivation', () => {
  it('reactivates an archived memory when the generated message refers to the recalled cue', () => {
    const oldMemory = memory({});
    const transition: DriverMessageCommitTransition = { chatPatch: {}, characterPatches: [], runtimeEvents: [] };
    const result = applyRecalledMemoryActivation({
      chat: buildChat(),
      characters: [character([oldMemory]), character([]) as AICharacter],
      message: message('你这次别又雨夜失约。'),
      recentMessages: [message('今天又下雨了。'), { ...message('我不会失约'), senderId: 'char-b', senderName: '乙' }],
      transition,
    });
    const patch = result.characterPatches.find((item) => item.characterId === 'char-a')?.patch;
    const activated = patch?.layeredMemories?.find((item) => item.id === oldMemory.id);

    expect(activated?.archivedAt).toBeFalsy();
    expect(activated?.recency).toBeGreaterThan(0.7);
    expect(patch?.runtimeTimeline?.at(-1)?.text).toContain('旧记忆被当前发言重新唤醒');
  });

  it('does not reactivate archived memories when the generated message does not use the cue', () => {
    const transition: DriverMessageCommitTransition = { chatPatch: {}, characterPatches: [], runtimeEvents: [] };
    const result = applyRecalledMemoryActivation({
      chat: buildChat(),
      characters: [character([memory({})]), character([]) as AICharacter],
      message: message('我先说另一个完全无关的问题。'),
      recentMessages: [message('今天又下雨了。')],
      transition,
    });

    expect(result.characterPatches).toHaveLength(0);
  });

  it('uses prompt memory metadata before falling back to heuristic recall', () => {
    const oldMemory = memory({ text: '甲记得乙曾藏起蓝色石头。' });
    const transition: DriverMessageCommitTransition = { chatPatch: {}, characterPatches: [], runtimeEvents: [] };
    const result = applyRecalledMemoryActivation({
      chat: buildChat(),
      characters: [character([oldMemory]), character([]) as AICharacter],
      message: message('我记得那块蓝色石头。', {
        metadata: {
          runtimeDecision: {
            memoryContext: {
              recalledArchives: [{
                id: oldMemory.id,
                scope: oldMemory.scope,
                kind: oldMemory.kind,
                layer: oldMemory.layer,
                summary: oldMemory.text,
                recallReason: '旧档被本轮提示词注入',
                recallScore: 1.3,
              }],
            },
          },
        },
      }),
      recentMessages: [],
      transition,
    });
    const patch = result.characterPatches.find((item) => item.characterId === 'char-a')?.patch;
    const activated = patch?.layeredMemories?.find((item) => item.id === oldMemory.id);

    expect(activated?.archivedAt).toBeFalsy();
    expect(patch?.runtimeTimeline?.at(-1)?.text).toContain('重新唤醒');
  });

  it('does not reactivate prompt-injected archives without a specific memory cue', () => {
    const oldMemory = memory({ text: '甲记得乙曾藏起蓝色石头。' });
    const transition: DriverMessageCommitTransition = { chatPatch: {}, characterPatches: [], runtimeEvents: [] };
    const result = applyRecalledMemoryActivation({
      chat: buildChat(),
      characters: [character([oldMemory]), character([]) as AICharacter],
      message: message('我记得这件事。', {
        metadata: {
          runtimeDecision: {
            memoryContext: {
              recalledArchives: [{
                id: oldMemory.id,
                scope: oldMemory.scope,
                kind: oldMemory.kind,
                layer: oldMemory.layer,
                summary: oldMemory.text,
                recallReason: '旧档被本轮提示词注入',
                recallScore: 1.3,
              }],
            },
          },
        },
      }),
      recentMessages: [],
      transition,
    });

    expect(result.characterPatches).toHaveLength(0);
  });
});
