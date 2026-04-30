import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { SocialEventCandidatePayload } from '../types/runtimeEvent';
import { findLatestAutoStatusUpdateCandidate, updateSourceChatAfterStatusUpdate } from './directSessionRuntime';

function buildPayload(overrides: Partial<SocialEventCandidatePayload> = {}): SocialEventCandidatePayload {
  return {
    eventKind: 'status_update',
    initiatorId: 'a',
    participantIds: ['a'],
    targetIds: ['b'],
    reasonType: 'self_disclosure',
    confidence: 0.87,
    urgency: 'soon',
    seedIntent: '想同步一下自己最近的状态。',
    visibilityPlan: 'public',
    expectedArtifacts: ['status_note'],
    sourceText: '最近我在忙新项目，这两天可能回复慢一点。',
    title: '状态更新',
    activityType: '项目近况',
    dedupeKey: 'status-a-1',
    ...overrides,
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
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    runtimeEventsV2: [{
      id: 'evt-status',
      conversationId: 'chat-1',
      kind: 'event_candidate',
      createdAt: 1,
      actorIds: ['a'],
      targetIds: ['b'],
      summary: 'a 提议发布一条状态更新',
      visibility: 'derived_public',
      payload: buildPayload(),
    }],
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [], structuredRoomState: null },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('status update backflow', () => {
  it('finds an eligible status update candidate', () => {
    expect(findLatestAutoStatusUpdateCandidate(buildChat())?.id).toBe('evt-status');
  });

  it('backflows effect, memory, artifact, and room shift into source chat', () => {
    const chat = buildChat();
    const patch = updateSourceChatAfterStatusUpdate(chat, buildPayload(), '甲');
    const kinds = (patch.runtimeEventsV2 || []).map((event) => event.kind);
    expect(kinds).toContain('relationship_delta');
    expect(kinds).toContain('memory_candidate');
    expect(kinds).toContain('artifact');
    expect(kinds).toContain('room_shift');
    const effect = (patch.runtimeEventsV2 || []).find((event) => event.kind === 'relationship_delta');
    expect((effect?.payload as { eventKind?: string; effectType?: string }).eventKind).toBe('status_update');
    expect((effect?.payload as { eventKind?: string; effectType?: string }).effectType).toBe('artifact');
    expect(patch.worldState?.recentEvent).toContain('甲');
  });
});
