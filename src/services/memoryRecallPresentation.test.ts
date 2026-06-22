import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import {
  DEFAULT_CHARACTER_BEHAVIOR,
  DEFAULT_CHARACTER_INTERVENTION,
  DEFAULT_CHARACTER_MEMORY,
  DEFAULT_EMOTIONAL_STATE,
  type AICharacter,
} from '../types/character';
import type { Message } from '../types/message';
import type { MemoryItem } from './memoryTypes';
import { buildRuntimeEventMessageContent } from './runtimeEventFactory';
import { projectMemoryReactivationItems, projectMemoryRecallItems } from './memoryRecallPresentation';

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

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: overrides.id || 'old-memory',
    ownerId: 'char-a',
    scope: 'relationship',
    layer: 'long_term',
    kind: 'resentment',
    subjectIds: ['char-b'],
    text: overrides.text || '甲记得乙曾在雨夜失约。',
    summary: overrides.summary,
    evidenceText: overrides.evidenceText,
    salience: overrides.salience ?? 0.82,
    confidence: overrides.confidence ?? 0.82,
    recency: overrides.recency ?? 0.2,
    reinforcementCount: overrides.reinforcementCount ?? 2,
    sourceEventIds: overrides.sourceEventIds || ['old-event'],
    sourceTag: overrides.sourceTag || 'memory_distillation',
    origin: overrides.origin || 'distilled',
    createdAt: overrides.createdAt || 1,
    updatedAt: overrides.updatedAt || 1,
    archivedAt: overrides.archivedAt ?? 10,
    ...overrides,
  };
}

function character(id: string, name: string, layeredMemories: MemoryItem[] = []): AICharacter {
  return {
    id,
    name,
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
    id: overrides.id || 'm1',
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

describe('memoryRecallPresentation', () => {
  it('labels prompt-injected archives as actual recall', () => {
    const chat = buildChat();
    const members = [character('char-a', '甲'), character('char-b', '乙')];
    const items = projectMemoryRecallItems(chat, members, [
      message('我还记得雨夜失约。', {
        metadata: {
          runtimeDecision: {
            memoryContext: {
              recalledArchives: [{
                id: 'archive-1',
                scope: 'relationship',
                kind: 'resentment',
                layer: 'long_term',
                summary: '甲记得乙曾在雨夜失约。',
                recallReason: '旧档被本轮提示词注入',
                recallTokens: ['雨夜', '失约'],
                recallScore: 0.92,
              }],
            },
          },
        },
      }),
    ]);

    expect(items[0]).toMatchObject({
      status: 'actual',
      statusLabel: '本轮注入',
      memberName: '甲',
      summary: '甲记得乙曾在雨夜失约。',
      tokens: ['雨夜', '失约'],
    });
    expect(items[0]?.tooltip).toContain('prompt 已注入');
    expect(items[0]?.secondaryLabel).toBeUndefined();
  });

  it('labels heuristic archive matches as candidates that are not injected', () => {
    const chat = buildChat();
    const oldMemory = memory({ id: 'archive-1', text: '甲记得乙曾在雨夜失约。' });
    const members = [character('char-a', '甲', [oldMemory]), character('char-b', '乙')];
    const items = projectMemoryRecallItems(chat, members, [
      message('今天又下雨了。', { senderId: 'char-b', senderName: '乙' }),
      message('你还会失约吗？', { senderId: 'char-a', senderName: '甲' }),
    ]);

    expect(items[0]).toMatchObject({
      status: 'candidate',
      statusLabel: '候选线索',
      secondaryLabel: '未注入',
      memberName: '甲',
    });
    expect(items[0]?.caption).toContain('尚未进入');
    expect(items[0]?.tooltip).toContain('尚未进入本轮 prompt');
    expect(items[0]?.tooltip).toContain('不会自动强化');
    expect(items[0]?.caption).not.toContain('本轮注入');
  });

  it('projects reactivation events as already reactivated evidence', () => {
    const content = buildRuntimeEventMessageContent({
      eventType: 'memory_reactivation',
      title: '旧记忆回温',
      summary: '甲 的旧记忆被当前发言重新唤醒：雨夜失约',
      metrics: {
        characterId: 'char-a',
        characterName: '甲',
        matchedTokens: ['雨夜', '失约'],
        recalledMemories: [{
          id: 'archive-1',
          summary: '雨夜失约',
          recallReason: '当前发言重新提到了雨夜旧事',
          matchedTokens: ['雨夜', '失约'],
        }],
      },
    });
    const items = projectMemoryReactivationItems([character('char-a', '甲')], [
      message(content, { id: 'event-1', type: 'event', senderId: 'system', senderName: '系统', content }),
    ]);

    expect(items[0]).toMatchObject({
      memberName: '甲',
      summary: '雨夜失约',
      matchedTokens: ['雨夜', '失约'],
      reason: '当前发言重新提到了雨夜旧事',
    });
  });

  it('redacts high-risk private archive recall and reactivation text', () => {
    const chat = buildChat();
    const members = [character('char-a', '甲'), character('char-b', '乙')];
    const recallItems = projectMemoryRecallItems(chat, members, [
      message('我记得。', {
        metadata: {
          runtimeDecision: {
            memoryContext: {
              recalledArchives: [{
                id: 'archive-secret',
                scope: 'relationship',
                kind: 'bond',
                layer: 'long_term',
                summary: '秘密暗号是雨夜便利店，不能公开说',
                recallReason: '用户私下约定不要公开这个暗号',
                recallTokens: ['雨夜便利店暗号'],
                recallScore: 0.92,
              }],
            },
          },
        },
      }),
    ]);
    expect(recallItems[0]?.summary).toBe('有一条私域记忆线索已隐藏原文');
    expect(recallItems[0]?.caption).toBe('有一条私域记忆线索已隐藏原文');
    expect(recallItems[0]?.tokens).toEqual(['有一条私域记忆线索已隐藏原文']);
    expect(recallItems[0]?.tooltip).not.toContain('雨夜便利店');

    const content = buildRuntimeEventMessageContent({
      eventType: 'memory_reactivation',
      title: '旧记忆回温',
      summary: '甲 的旧记忆被当前发言重新唤醒：秘密暗号是雨夜便利店',
      metrics: {
        characterId: 'char-a',
        characterName: '甲',
        matchedTokens: ['13800000000'],
        recalledMemories: [{
          id: 'archive-secret',
          summary: '手机号 13800000000 不要公开',
          recallReason: '用户说电话不能公开',
          matchedTokens: ['13800000000'],
        }],
      },
    });
    const reactivationItems = projectMemoryReactivationItems([character('char-a', '甲')], [
      message(content, { id: 'event-secret', type: 'event', senderId: 'system', senderName: '系统', content }),
    ]);
    expect(reactivationItems[0]?.summary).toBe('有一条私域记忆线索已隐藏原文');
    expect(reactivationItems[0]?.reason).toBe('有一条私域记忆线索已隐藏原文');
    expect(reactivationItems[0]?.matchedTokens).toEqual(['有一条私域记忆线索已隐藏原文']);
    expect(reactivationItems[0]?.tooltip).not.toContain('13800000000');
  });
});
