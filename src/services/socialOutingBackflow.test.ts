import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { SocialEventCandidatePayload } from '../types/runtimeEvent';
import { updateSourceChatAfterSocialOuting } from './directSessionRuntime';

function buildPayload(overrides: Partial<SocialEventCandidatePayload> = {}): SocialEventCandidatePayload {
  return {
    eventKind: 'social_outing',
    initiatorId: 'a',
    participantIds: ['a', 'b', 'c'],
    targetIds: ['b'],
    reasonType: 'celebration',
    confidence: 0.88,
    urgency: 'soon',
    seedIntent: '想把刚才群里的热络气氛延续成一次线下活动。',
    visibilityPlan: 'public',
    expectedArtifacts: ['outing_summary', 'group_photo', 'food_photo'],
    sourceText: '那就今晚一起去吃火锅庆祝一下，顺便拍张合照。',
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
    memberIds: ['a', 'b', 'c'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [], structuredRoomState: null },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('social outing backflow', () => {
  it('dedupe helper treats same-cluster outing as already backflowed', () => {
    const chat = buildChat();
    const payload = buildPayload({ dedupeKey: 'outing-1' });
    chat.runtimeEventsV2 = [{
      id: 'evt-outing-artifact',
      conversationId: 'chat-1',
      kind: 'artifact',
      createdAt: 2,
      actorIds: ['a'],
      targetIds: ['a', 'b', 'c'],
      summary: '甲、乙、丙 一起去参加了刚才聊到的活动。',
      visibility: 'derived_public',
      payload: {
        artifactType: 'outing_summary',
        eventKind: 'social_outing',
        text: '甲、乙、丙 一起去参加了刚才聊到的活动。',
        dedupeKey: 'outing-1',
        participantIds: ['a', 'b', 'c'],
      },
    }];
    expect(updateSourceChatAfterSocialOuting(chat, payload, ['甲', '乙', '丙']).runtimeEventsV2?.length).toBeGreaterThan(0);
  });

  it('backflows effect, memory, artifact, and room shift into source chat', () => {
    const chat = buildChat();
    const patch = updateSourceChatAfterSocialOuting(chat, buildPayload(), ['甲', '乙', '丙']);
    const kinds = (patch.runtimeEventsV2 || []).map((event) => event.kind);
    expect(kinds).toContain('relationship_delta');
    expect(kinds).toContain('memory_candidate');
    expect(kinds).toContain('artifact');
    expect(kinds).toContain('room_shift');
    const effect = (patch.runtimeEventsV2 || []).find((event) => event.kind === 'relationship_delta');
    expect((effect?.payload as { eventKind?: string; effectType?: string }).eventKind).toBe('social_outing');
    expect((effect?.payload as { eventKind?: string; effectType?: string }).effectType).toBe('artifact');
    expect(patch.worldState?.recentEvent).toContain('甲、乙、丙');
  });
});
