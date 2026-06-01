import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import type { ProjectedRuntimeTimelineItem } from './sessionProjection';
import {
  projectConflictDebugState,
  projectDialogueRecentSignal,
  projectDialogueStructuredEventCard,
  projectProjectionMetaLine,
  projectTimelineGuidanceMetaLine,
} from './dialogueDebugProjection';

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
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: 'a 提到 b', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('dialogueDebugProjection', () => {
  it('projects recent signal and conflict debug state', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      worldState: {
        ...buildChat().worldState,
        focus: '新话题',
        mood: '紧张',
        conflictState: {
          primaryConflict: {
            id: 'c1',
            scope: 'group',
            type: 'value_conflict',
            severity: 0.77,
            stage: 'escalating',
            summary: 'a 与 b 争执',
            participantIds: ['a'],
            targetIds: ['b'],
            nextPressure: 'escalate',
            developmentHooks: ['raise_stakes'],
            sourceEventIds: ['evt-1'],
            updatedAt: 1,
          },
          activeConflicts: [],
          developmentHooks: [],
          volatility: 0.4,
          cooling: 0.1,
          updatedAt: 1,
        },
      },
    });
    const signal = projectDialogueRecentSignal(chat, [member('a', '甲')]);
    expect(signal).toMatchObject({ recentEvent: '甲 提到 b', focus: '新话题', mood: '紧张' });
    const conflict = projectConflictDebugState(chat, [member('a', '甲')]);
    expect(conflict?.severity).toBe('0.77');
    expect(conflict?.type).toBe('价值观冲突');
  });

  it('sanitizes recent signal focus and mood fields for user-facing debug panel', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      worldState: {
        ...buildChat().worldState,
        focus: 'a 正在追问 e055aa1d-88d4-4e96-abd2-1b35a3d56f67',
        mood: '{"eventType":"room_state_snapshot_v2"}',
      },
    });
    const signal = projectDialogueRecentSignal(chat, [member('a', '甲')]);
    expect(signal.focus).toContain('甲');
    expect(signal.focus).not.toContain('e055aa1d');
    expect(signal.mood).not.toContain('eventType');
    expect(signal.mood).not.toContain('room_state_snapshot_v2');
  });

  it('projects projection and guidance meta lines', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'artifact',
      text: 'test',
      createdAt: 1,
      label: '产物',
      event: { id: 'evt-1', conversationId: 'chat-1', kind: 'artifact', createdAt: 1, summary: 'test', payload: {} },
      meta: {
        projectionInfo: { projectionKind: 'relationship_backflow', topicSnippet: '回到主线', participantNames: ['甲', '乙'] },
        guidanceInfo: { kind: 'direct_reply', actorNames: ['甲'], subjectNames: ['乙'] },
      },
    };
    expect(projectProjectionMetaLine(item, true)).toContain('关系回流');
    expect(projectTimelineGuidanceMetaLine(item, true)).toContain('点名回应');
  });

  it('projects structured debug event card with calendar patch and meta lines', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'artifact',
      text: '甲 提到 周六吃火锅',
      createdAt: Date.UTC(2026, 4, 29, 10, 0, 0),
      label: '产物',
      event: {
        id: 'evt-2',
        conversationId: 'chat-1',
        kind: 'calendar_item_patch',
        createdAt: 1,
        summary: 'test',
        payload: {
          operation: 'create',
          patch: {
            title: '周六火锅',
            participantIds: ['a', 'b'],
            participantStates: { a: 'going' },
          },
        },
      },
      meta: {
        projectionInfo: { projectionKind: 'source_chat_patch', topicSnippet: '周六晚上', participantNames: ['甲', '乙'] },
        guidanceInfo: { kind: 'media_request', actorNames: ['甲'], subjectNames: ['乙'] },
        socialEventCandidate: {
          eventKind: 'check_in',
          initiatorId: 'a',
          participantIds: ['a', 'b'],
          reasonType: 'care',
          confidence: 0.8,
          urgency: 'soon',
          seedIntent: '确认近况',
          visibilityPlan: 'conversation_private',
          attentionTrace: {
            score: 0.62,
            restraint: 0.18,
            suggestedActions: ['check_in'],
            reasons: ['关系回暖，建议低频确认'],
            latestEvidenceAt: 1,
          },
        },
      },
    };
    const card = projectDialogueStructuredEventCard(item, true, [member('a', '甲'), member('b', '乙')]);
    expect(card.title).toContain('日历');
    expect(card.bodyText).toContain('甲');
    expect(card.chips.length).toBeGreaterThan(0);
    expect(card.guidanceMetaLine).toContain('媒体请求');
    expect(card.attentionMetaLine).toContain('关注');
    expect(card.projectionMetaLine).toContain('群聊投影');
  });

  it('falls back to event kind title when no calendar patch meta exists', () => {
    const item: ProjectedRuntimeTimelineItem = {
      type: 'artifact',
      text: 'summary',
      createdAt: 1,
      label: '产物',
      event: { id: 'evt-3', conversationId: 'chat-1', kind: 'artifact', createdAt: 1, summary: 'summary', payload: {} },
      meta: {},
    };
    const card = projectDialogueStructuredEventCard(item, true);
    expect(card.title).toBe('产物');
    expect(card.summaryText).toBeNull();
    expect(card.chips).toEqual([]);
  });
});
