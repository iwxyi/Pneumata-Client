import { describe, expect, it, vi } from 'vitest';
import { normalizeConversation } from '../types/chat';
import { buildPrivateThreadOpenedEvent, buildStartPrivateThreadExecutionResult, pickAutoPairPrivateThreadCandidate, runSocialEventAutoFlow } from './directSessionRuntime';
import type { AICharacter } from '../types/character';
import type { SocialEventCandidatePayload } from '../types/runtimeEvent';

function buildCandidatePayload(overrides: Partial<SocialEventCandidatePayload> = {}): SocialEventCandidatePayload {
  return {
    eventKind: 'pair_private_thread',
    initiatorId: 'a',
    participantIds: ['a', 'b'],
    targetIds: ['b'],
    reasonType: 'unresolved_question',
    confidence: 0.82,
    urgency: 'immediate',
    seedIntent: '继续私下聊',
    visibilityPlan: 'conversation_private',
    expectedArtifacts: ['private_thread_summary'],
    ...overrides,
  };
}

function buildCharacter(id: string, name: string): AICharacter {
  return { id, name } as AICharacter;
}

function buildCandidateEvent(payload: SocialEventCandidatePayload, createdAt = 1) {
  return {
    id: `evt-candidate-${createdAt}`,
    conversationId: 'chat-1',
    kind: 'event_candidate' as const,
    createdAt,
    actorIds: ['a'],
    targetIds: ['b'],
    summary: 'a 提议与 b 发起双人私聊候选',
    visibility: 'derived_public' as const,
    payload,
  };
}

function buildOpenedEvent(createdAt = 2) {
  return {
    id: `evt-opened-${createdAt}`,
    conversationId: 'chat-1',
    kind: 'artifact' as const,
    createdAt,
    actorIds: ['a'],
    targetIds: ['a', 'b'],
    summary: 'a 与 b 的双人私聊已自动派生',
    visibility: 'derived_public' as const,
    payload: {
      artifactType: 'private_thread_opened',
      eventKind: 'pair_private_thread',
      participantIds: ['a', 'b'],
    },
  };
}

function buildChatWithEvents(events: Array<ReturnType<typeof buildCandidateEvent> | ReturnType<typeof buildOpenedEvent>>) {
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
    runtimeEventsV2: events,
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildBaseChat() {
  return buildChatWithEvents([]);
}

function buildCandidateChat() {
  return buildChatWithEvents([buildCandidateEvent(buildCandidatePayload())]);
}

function buildCooldownChat() {
  return buildChatWithEvents([buildCandidateEvent(buildCandidatePayload(), 1000), buildOpenedEvent(1005)]);
}

function buildLowConfidenceChat() {
  return buildChatWithEvents([buildCandidateEvent(buildCandidatePayload({ confidence: 0.65 }))]);
}

function buildOpenedBaseChat() {
  return buildBaseChat();
}

function buildOpenedCandidate() {
  return buildCandidateEvent(buildCandidatePayload());
}

function buildShouldSkipChat() {
  return buildCooldownChat();
}

function buildShouldSkipLowConfidenceChat() {
  return buildLowConfidenceChat();
}

function buildShouldPickChat() {
  return buildCandidateChat();
}

function buildOpenedEventChat() {
  return buildOpenedBaseChat();
}

function buildOpenedEventCandidate() {
  return buildOpenedCandidate();
}

function buildOpenedEventLowConfidenceCandidate() {
  return buildCandidateEvent(buildCandidatePayload({ confidence: 0.65 }));
}

function buildOpenedEventCooldownCandidate() {
  return buildCandidateEvent(buildCandidatePayload(), 1000);
}

function buildOpenedEventCooldownArtifact() {
  return buildOpenedEvent(1005);
}

function buildOpenedEventCooldownChat() {
  return buildChatWithEvents([buildOpenedEventCooldownCandidate(), buildOpenedEventCooldownArtifact()]);
}

function buildOpenedEventLowConfidenceChat() {
  return buildChatWithEvents([buildOpenedEventLowConfidenceCandidate()]);
}

function buildOpenedEventPairThreadChat() {
  return buildOpenedEventChat();
}

function buildOpenedEventPairThreadCandidate() {
  return buildOpenedEventCandidate();
}

function buildOpenedEventShouldSkipChat() {
  return buildOpenedEventCooldownChat();
}

function buildOpenedEventShouldSkipLowConfidenceChat() {
  return buildOpenedEventLowConfidenceChat();
}

function buildOpenedEventShouldPickChat() {
  return buildShouldPickChat();
}

function buildOpenedEventShouldPickCandidate() {
  return buildOpenedEventPairThreadCandidate();
}

function buildOpenedEventShouldSkipCandidate() {
  return buildOpenedEventCooldownCandidate();
}

function buildOpenedEventShouldSkipLowConfidenceCandidate() {
  return buildOpenedEventLowConfidenceCandidate();
}

function buildOpenedEventVisibilityChat() {
  return buildOpenedEventPairThreadChat();
}

function buildOpenedEventVisibilityCandidate() {
  return buildOpenedEventPairThreadCandidate();
}

function buildOpenedEventVisibilityOpened() {
  return buildOpenedEvent();
}

function buildOpenedEventLowConfidencePayload() {
  return buildCandidatePayload({ confidence: 0.65 });
}

function buildOpenedEventCooldownPayload() {
  return buildCandidatePayload();
}

function buildOpenedEventStandardPayload() {
  return buildCandidatePayload();
}

function buildOpenedEventWithPayload(payload: SocialEventCandidatePayload, createdAt = 1) {
  return buildCandidateEvent(payload, createdAt);
}

function buildOpenedEventWithOpened(createdAtCandidate: number, createdAtOpened: number) {
  return buildChatWithEvents([buildCandidateEvent(buildOpenedEventCooldownPayload(), createdAtCandidate), buildOpenedEvent(createdAtOpened)]);
}

function buildOpenedEventStandardChat() {
  return buildChatWithEvents([buildOpenedEventWithPayload(buildOpenedEventStandardPayload())]);
}

function buildOpenedEventLowChat() {
  return buildChatWithEvents([buildOpenedEventWithPayload(buildOpenedEventLowConfidencePayload())]);
}

function buildOpenedEventCooldownWindowChat() {
  return buildOpenedEventWithOpened(1000, 1005);
}

function buildOpenedEventNoCooldownWindowChat() {
  return buildOpenedEventWithOpened(1000, 1000 - 1000 * 60 * 31);
}

function buildOpenedEventNoCooldownCandidate() {
  return buildCandidateEvent(buildOpenedEventStandardPayload(), 1000);
}

function buildOpenedEventNoCooldownOpened() {
  return buildOpenedEvent(1000 - 1000 * 60 * 31);
}

function buildOpenedEventNoCooldownStructuredChat() {
  return buildChatWithEvents([buildOpenedEventNoCooldownCandidate(), buildOpenedEventNoCooldownOpened()]);
}

function buildOpenedEventNoCooldownExpectedId() {
  return 'evt-candidate-1000';
}

function buildOpenedEventLowExpectedNull() {
  return null;
}

function buildOpenedEventCooldownExpectedNull() {
  return null;
}

function buildOpenedEventStandardExpectedId() {
  return 'evt-candidate-1';
}

describe('directSessionRuntime pair-thread adjudication helpers', () => {
  it('builds shared private-thread execution result', () => {
    const result = buildStartPrivateThreadExecutionResult(buildBaseChat(), 'a', 'b', '继续聊刚才的话题', [
      buildCharacter('a', '喜羊羊'),
      buildCharacter('b', '灰太狼'),
    ]);
    expect(result.runtimeEvents?.[0]?.eventType).toBe('start_private_thread');
    expect(result.runtimeEvents?.[0]?.summary).toContain('喜羊羊');
    expect(result.runtimeEvents?.[0]?.summary).toContain('灰太狼');
    expect(result.runtimeEvents?.[0]?.summary).not.toContain('a → b');
  });

  it('runs unified auto social flow for post moment candidates', async () => {
    const chat = buildChatWithEvents([buildCandidateEvent(buildCandidatePayload({ eventKind: 'post_moment', participantIds: ['a'], confidence: 0.9, reasonType: 'celebration', visibilityPlan: 'public', dedupeKey: 'moment-1' }))]);
    const updateChat = vi.fn(async () => undefined);
    const result = await runSocialEventAutoFlow(chat, {
      chats: [chat],
      characters: [buildCharacter('a', '甲')],
      updateChat,
      addChat: vi.fn(async () => buildBaseChat()),
      addMessage: vi.fn(async () => ({})),
      appendEventMessage: vi.fn(async () => undefined),
    });
    expect(result.handledEventId).toBe('evt-candidate-1');
    expect(updateChat).toHaveBeenCalledTimes(1);
  });

  it('runs unified auto social flow for outing candidates', async () => {
    const chat = buildChatWithEvents([buildCandidateEvent(buildCandidatePayload({ eventKind: 'social_outing', participantIds: ['a', 'b'], confidence: 0.9, reasonType: 'celebration', visibilityPlan: 'public', dedupeKey: 'outing-1' }))]);
    const updateChat = vi.fn(async () => undefined);
    const result = await runSocialEventAutoFlow(chat, {
      chats: [chat],
      characters: [],
      updateChat,
      addChat: vi.fn(async () => buildBaseChat()),
      addMessage: vi.fn(async () => ({})),
      appendEventMessage: vi.fn(async () => undefined),
    });
    expect(result.handledEventId).toBe('evt-candidate-1');
    expect(updateChat).toHaveBeenCalledTimes(1);
  });

  it('picks the latest eligible pair private thread candidate', () => {
    const chat = buildOpenedEventStandardChat();
    expect(pickAutoPairPrivateThreadCandidate(chat)?.id).toBe(buildOpenedEventStandardExpectedId());
  });

  it('skips low-confidence candidates', () => {
    expect(pickAutoPairPrivateThreadCandidate(buildOpenedEventLowChat())).toBe(buildOpenedEventLowExpectedNull());
  });

  it('skips candidates still within cooldown after opened thread', () => {
    expect(pickAutoPairPrivateThreadCandidate(buildOpenedEventCooldownWindowChat())).toBe(buildOpenedEventCooldownExpectedNull());
  });

  it('creates a public opened-thread artifact event', () => {
    const chat = buildOpenedEventPairThreadChat();
    const opened = buildPrivateThreadOpenedEvent(chat, buildOpenedEventPairThreadCandidate());
    expect(opened.kind).toBe('artifact');
    expect(opened.visibility).toBe('derived_public');
    expect((opened.payload as { artifactType?: string; eventKind?: string; candidateId?: string }).artifactType).toBe('private_thread_opened');
    expect((opened.payload as { artifactType?: string; eventKind?: string; candidateId?: string }).eventKind).toBe('pair_private_thread');
    expect((opened.payload as { artifactType?: string; eventKind?: string; candidateId?: string }).candidateId).toBe('evt-candidate-1');
  });
});
