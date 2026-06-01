import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { findLatestAutoPostMomentCandidate, updateSourceChatAfterPostMoment } from './directSessionRuntime';
import type { SocialEventCandidatePayload } from '../types/runtimeEvent';

function buildPayload(overrides: Partial<SocialEventCandidatePayload> = {}): SocialEventCandidatePayload {
  return {
    eventKind: 'post_moment',
    initiatorId: 'a',
    participantIds: ['a'],
    targetIds: ['b'],
    reasonType: 'celebration',
    confidence: 0.86,
    urgency: 'soon',
    seedIntent: '想发一条和刚才活动有关的动态。',
    visibilityPlan: 'public',
    expectedArtifacts: ['moment_text', 'moment_food_photo'],
    sourceText: '今晚去吃火锅顺便拍个合照吧。',
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
      id: 'evt-post',
      conversationId: 'chat-1',
      kind: 'event_candidate',
      createdAt: 1,
      actorIds: ['a'],
      targetIds: ['b'],
      summary: 'a 提议发布一条 post_moment 动态',
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

describe('post moment backflow', () => {
  it('dedupe helper treats same-cluster moment as already backflowed', () => {
    const chat = buildChat();
    const payload = buildPayload({ dedupeKey: 'moment-a-1' });
    chat.runtimeEventsV2?.push({
      id: 'evt-artifact',
      conversationId: 'chat-1',
      kind: 'artifact',
      createdAt: 2,
      actorIds: ['a'],
      targetIds: ['b'],
      summary: '甲 发了一条动态',
      visibility: 'derived_public',
      payload: {
        artifactType: 'moment_text',
        eventKind: 'post_moment',
        text: '甲 发了一条动态',
        dedupeKey: 'moment-a-1',
        participantIds: ['a'],
      },
    });
    expect(findLatestAutoPostMomentCandidate(chat)).toBeNull();
  });

  it('finds an eligible post moment candidate', () => {
    expect(findLatestAutoPostMomentCandidate(buildChat())?.id).toBe('evt-post');
  });

  it('backflows effect, memory, artifact, and room shift into source chat', () => {
    const chat = buildChat();
    const patch = updateSourceChatAfterPostMoment(chat, buildPayload(), '甲');
    const kinds = (patch.runtimeEventsV2 || []).map((event) => event.kind);
    expect(kinds).toContain('relationship_delta');
    expect(kinds).toContain('memory_candidate');
    expect(kinds).toContain('artifact');
    expect(kinds).toContain('room_shift');
    const effect = (patch.runtimeEventsV2 || []).find((event) => event.kind === 'relationship_delta');
    expect((effect?.payload as { eventKind?: string; effectType?: string }).eventKind).toBe('post_moment');
    expect((effect?.payload as { eventKind?: string; effectType?: string }).effectType).toBe('artifact');
    expect(patch.worldState?.recentEvent).toContain('甲 发了一条动态');
  });

  it('formats post moment summary as event record style for event-themed reason', () => {
    const chat = buildChat();
    const patch = updateSourceChatAfterPostMoment(chat, buildPayload({
      reasonType: 'world_attention_share_moment_event',
      sourceText: '今晚一起吃火锅，顺便拍了合照。',
    }), '甲');
    const moment = (patch.runtimeEventsV2 || []).find((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'moment_text');
    const text = (moment?.payload as { text?: string }).text || '';
    expect(text).toContain('记录了刚发生的片段');
    expect(text).toContain('今晚一起吃火锅');
  });

  it('formats post moment summary as inner reflection style for inner-themed reason', () => {
    const chat = buildChat();
    const patch = updateSourceChatAfterPostMoment(chat, buildPayload({
      reasonType: 'world_attention_share_moment_inner',
      sourceText: '聊完之后心里松了一口气。',
    }), '甲');
    const moment = (patch.runtimeEventsV2 || []).find((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string }).artifactType === 'moment_text');
    const text = (moment?.payload as { text?: string }).text || '';
    expect(text).toContain('写下了当下的内心感受');
    expect(text).toContain('聊完之后心里松了一口气');
  });
});
