import { describe, expect, it } from 'vitest';
import { openChatEngine } from './engines/openChatEngine';
import { createProjectionContext, projectRuntimeState, projectActionSchema } from './sessionProjection';
import { normalizeConversation } from '../types/chat';

function buildChat() {
  return normalizeConversation({
    id: 'chat-1',
    type: 'ai_direct',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: 'Private chat',
    topic: 'secret',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    runtimeEventsV2: [
      { id: 'evt-1', conversationId: 'chat-1', kind: 'message_generated', createdAt: 1, actorIds: ['a'], summary: '公开消息', visibility: 'public', payload: { text: '公开消息' } },
      { id: 'evt-2', conversationId: 'chat-1', kind: 'artifact', createdAt: 2, actorIds: ['a'], summary: '狼人私有信息', visibility: 'role_private', visibleToRoles: ['werewolf'], payload: { text: '狼人私有信息' } },
      { id: 'evt-3', conversationId: 'chat-1', kind: 'event_candidate', createdAt: 3, actorIds: ['a'], targetIds: ['b'], summary: 'A 提议与 B 发起双人私聊候选', visibility: 'derived_public', payload: { eventKind: 'pair_private_thread', initiatorId: 'a', participantIds: ['a', 'b'], targetIds: ['b'], reasonType: 'unresolved_question', confidence: 0.82, urgency: 'immediate', seedIntent: '继续私下聊', visibilityPlan: 'conversation_private', expectedArtifacts: ['private_thread_summary'] } },
    ],
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('sessionProjection', () => {
  it('filters runtime events by visibility', () => {
    const chat = buildChat();
    const context = createProjectionContext(chat, openChatEngine.buildParticipants(chat), 'a', 'pair_private');
    const state = projectRuntimeState(chat, context);
    expect(state.runtimeEventsV2).toHaveLength(2);
    expect(state.runtimeEventsV2.map((event) => event.kind)).toEqual(['message_generated', 'event_candidate']);
  });

  it('projects open_chat private-thread action schema in group chats', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      id: 'group-1',
      type: 'group',
      memberIds: ['a', 'b', 'c'],
    });
    const context = createProjectionContext(chat, openChatEngine.buildParticipants(chat));
    const schema = projectActionSchema(openChatEngine, context);
    expect(schema?.actions.some((action) => action.type === 'start_private_thread')).toBe(true);
  });

  it('preserves social event candidate metadata in projected timeline', () => {
    const chat = buildChat();
    const timeline = projectRuntimeState(chat, createProjectionContext(chat, openChatEngine.buildParticipants(chat), 'a', 'pair_private')).runtimeTimeline;
    const candidate = timeline.find((item) => item.event?.kind === 'event_candidate');
    expect(candidate?.meta?.socialEventCandidate?.eventKind).toBe('pair_private_thread');
  });

  it('preserves social event artifact metadata in projected timeline', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      runtimeEventsV2: [{
        id: 'evt-artifact',
        conversationId: 'chat-1',
        kind: 'artifact',
        createdAt: 10,
        actorIds: ['a'],
        summary: '甲、乙 一起去参加了刚才聊到的吃饭。',
        visibility: 'derived_public',
        payload: {
          artifactType: 'outing_summary',
          eventKind: 'social_outing',
          title: '线下活动',
          activityType: '吃饭',
          dedupeKey: 'outing-1',
          participantIds: ['a', 'b'],
          targetIds: ['b'],
          timeHint: '今晚',
          locationHint: '校门口',
        },
      }],
    });
    const timeline = projectRuntimeState(chat, createProjectionContext(chat, openChatEngine.buildParticipants(chat), 'a', 'participant')).runtimeTimeline;
    expect(timeline[0]?.meta?.socialEventArtifact?.eventKind).toBe('social_outing');
    expect(timeline[0]?.meta?.socialEventArtifact?.artifactType).toBe('outing_summary');
    expect(timeline[0]?.meta?.socialEventArtifact?.participantIds).toEqual(['a', 'b']);
    expect(timeline[0]?.meta?.socialEventArtifact?.timeHint).toBe('今晚');
    expect(timeline[0]?.meta?.socialEventCluster?.stage).toBe('artifact');
  });

  it('marks opened private-thread artifacts as opened cluster stage', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      runtimeEventsV2: [{
        id: 'evt-opened',
        conversationId: 'chat-1',
        kind: 'artifact',
        createdAt: 11,
        actorIds: ['a'],
        targetIds: ['a', 'b'],
        summary: 'a 与 b 的双人私聊已自动派生',
        visibility: 'derived_public',
        payload: {
          artifactType: 'private_thread_opened',
          eventKind: 'pair_private_thread',
          candidateId: 'evt-candidate-1',
          participantIds: ['a', 'b'],
          reasonType: 'unresolved_question',
        },
      }],
    });
    const timeline = projectRuntimeState(chat, createProjectionContext(chat, openChatEngine.buildParticipants(chat), 'a', 'participant')).runtimeTimeline;
    expect(timeline[0]?.meta?.socialEventCluster?.stage).toBe('opened');
    expect(timeline[0]?.meta?.socialEventCluster?.candidateId).toBe('evt-candidate-1');
  });

  it('projects private-thread backflow as social event effect metadata', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      runtimeEventsV2: [{
        id: 'evt-effect',
        conversationId: 'chat-1',
        kind: 'relationship_delta',
        createdAt: 12,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: '私聊回流：两人关系更近了一点',
        visibility: 'derived_public',
        payload: {
          eventKind: 'pair_private_thread',
          effectType: 'relationship',
          summary: '私聊回流：两人关系更近了一点',
          confidence: 0.82,
        },
      }],
    });
    const timeline = projectRuntimeState(chat, createProjectionContext(chat, openChatEngine.buildParticipants(chat), 'a', 'participant')).runtimeTimeline;
    expect(timeline[0]?.meta?.socialEventEffect?.eventKind).toBe('pair_private_thread');
    expect(timeline[0]?.meta?.socialEventEffect?.effectType).toBe('relationship');
    expect(timeline[0]?.meta?.socialEventCluster?.stage).toBe('effect');
  });

  it('projects moment, outing, status-update, conflict, and gift backflow as social event effect metadata', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      runtimeEventsV2: [{
        id: 'evt-moment-effect',
        conversationId: 'chat-1',
        kind: 'relationship_delta',
        createdAt: 13,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: '动态回流：甲 发了一条动态，记录了刚才的开心时刻。',
        visibility: 'derived_public',
        payload: {
          eventKind: 'post_moment',
          effectType: 'artifact',
          summary: '动态回流：甲 发了一条动态，记录了刚才的开心时刻。',
          confidence: 0.86,
        },
      }, {
        id: 'evt-outing-effect',
        conversationId: 'chat-1',
        kind: 'relationship_delta',
        createdAt: 14,
        actorIds: ['a'],
        targetIds: ['a', 'b'],
        summary: '活动回流：甲、乙 参与了刚才提到的吃火锅。',
        visibility: 'derived_public',
        payload: {
          eventKind: 'social_outing',
          effectType: 'artifact',
          summary: '活动回流：甲、乙 参与了刚才提到的吃火锅。',
          confidence: 0.88,
        },
      }, {
        id: 'evt-status-effect',
        conversationId: 'chat-1',
        kind: 'relationship_delta',
        createdAt: 15,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: '状态回流：甲 在群里同步了自己的近况。',
        visibility: 'derived_public',
        payload: {
          eventKind: 'status_update',
          effectType: 'artifact',
          summary: '状态回流：甲 在群里同步了自己的近况。',
          confidence: 0.87,
        },
      }, {
        id: 'evt-conflict-effect',
        conversationId: 'chat-1',
        kind: 'relationship_delta',
        createdAt: 16,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: '冲突回流：甲 把刚才的不满直接摊开说了。',
        visibility: 'derived_public',
        payload: {
          eventKind: 'conflict_expression',
          effectType: 'artifact',
          summary: '冲突回流：甲 把刚才的不满直接摊开说了。',
          confidence: 0.89,
        },
      }, {
        id: 'evt-gift-effect',
        conversationId: 'chat-1',
        kind: 'relationship_delta',
        createdAt: 17,
        actorIds: ['a'],
        targetIds: ['b'],
        summary: '礼物回流：甲 刚刚送出了一个小礼物或心意。',
        visibility: 'derived_public',
        payload: {
          eventKind: 'gift_exchange',
          effectType: 'artifact',
          summary: '礼物回流：甲 刚刚送出了一个小礼物或心意。',
          confidence: 0.88,
        },
      }],
    });
    const timeline = projectRuntimeState(chat, createProjectionContext(chat, openChatEngine.buildParticipants(chat), 'a', 'participant')).runtimeTimeline;
    expect(timeline[0]?.meta?.socialEventEffect?.eventKind).toBe('post_moment');
    expect(timeline[1]?.meta?.socialEventEffect?.eventKind).toBe('social_outing');
    expect(timeline[2]?.meta?.socialEventEffect?.eventKind).toBe('status_update');
    expect(timeline[3]?.meta?.socialEventEffect?.eventKind).toBe('conflict_expression');
    expect(timeline[4]?.meta?.socialEventEffect?.eventKind).toBe('gift_exchange');
    expect(timeline[0]?.meta?.socialEventCluster?.stage).toBe('effect');
    expect(timeline[1]?.meta?.socialEventCluster?.stage).toBe('effect');
    expect(timeline[2]?.meta?.socialEventCluster?.stage).toBe('effect');
    expect(timeline[3]?.meta?.socialEventCluster?.stage).toBe('effect');
    expect(timeline[4]?.meta?.socialEventCluster?.stage).toBe('effect');
  });

  it('projects open_chat private-thread action schema in group chats', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      id: 'group-1',
      type: 'group',
      memberIds: ['a', 'b', 'c'],
    });
    const context = createProjectionContext(chat, openChatEngine.buildParticipants(chat));
    const schema = projectActionSchema(openChatEngine, context);
    expect(schema?.actions.some((action) => action.type === 'start_private_thread')).toBe(true);
  });
});
