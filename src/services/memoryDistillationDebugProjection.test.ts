import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { ProjectedRuntimeTimelineItem } from './sessionProjection';
import { projectMemoryDistillationDebug } from './memoryDistillationDebugProjection';

function member(id: string, name: string): AICharacter {
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
  };
}

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '群聊',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    runtimeEventsV2: [],
    layeredMemories: [],
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('memoryDistillationDebugProjection', () => {
  it('projects runtime distillation event items', () => {
    const timeline: ProjectedRuntimeTimelineItem[] = [{
      type: 'artifact',
      text: '蒸馏',
      createdAt: 10,
      label: '产物',
      event: { id: 'evt-1', conversationId: 'chat-1', kind: 'artifact', createdAt: 10, summary: '蒸馏', payload: {} },
      meta: {
        memoryDistillation: {
          ownerType: 'chat',
          mergeMode: 'append_new',
          newEvidenceCount: 2,
          candidateTexts: ['a 记得 b 的承诺'],
        },
      },
    }];
    const projection = projectMemoryDistillationDebug(buildChat(), timeline, true, [member('a', '甲'), member('b', '乙')]);
    expect(projection?.runtimeEventItems).toHaveLength(1);
    expect(projection?.runtimeEventItems[0]?.headline).toContain('群聊记忆蒸馏');
    expect(projection?.runtimeEventItems[0]?.bodyTexts[0]).toContain('甲');
  });

  it('falls back to persisted distilled memories when runtime events are missing', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      layeredMemories: [{
        id: 'm1',
        scope: 'conversation',
        layer: 'long_term',
        ownerId: 'chat-1',
        text: '大家关系缓和了',
        kind: 'artifact',
        sourceTag: 'memory_distillation',
        confidence: 0.9,
        salience: 0.7,
        recency: 0.8,
        reinforcementCount: 2,
        sourceEventIds: [],
        origin: 'distilled',
        createdAt: 1,
        updatedAt: 2,
        distilledAt: 2,
      }],
    });
    const projection = projectMemoryDistillationDebug(chat, [], true, [member('a', '甲')]);
    expect(projection?.runtimeEventItems).toHaveLength(0);
    expect(projection?.persistedItems).toHaveLength(1);
    expect(projection?.persistedItems[0]?.headline).toContain('群聊记忆');
  });

  it('sanitizes ownerLabel and mergeModeLabel in runtime distillation captions', () => {
    const timeline: ProjectedRuntimeTimelineItem[] = [{
      type: 'artifact',
      text: '蒸馏',
      createdAt: 11,
      label: '产物',
      event: { id: 'evt-2', conversationId: 'chat-1', kind: 'artifact', createdAt: 11, summary: '蒸馏', payload: {} },
      meta: {
        memoryDistillation: {
          ownerLabel: 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67 记忆',
          mergeModeLabel: '{"eventType":"memory_distillation"}',
          newEvidenceCount: 1,
          candidateTexts: ['a 的更新'],
        },
      },
    }];
    const projection = projectMemoryDistillationDebug(buildChat(), timeline, true, [member('a', '甲')]);
    const item = projection?.runtimeEventItems[0];
    expect(item?.headline).toContain('成员 记忆蒸馏');
    expect(item?.headline).not.toContain('e055aa1d');
    expect(item?.caption).not.toContain('eventType');
    expect(item?.caption).not.toContain('memory_distillation');
  });
});
