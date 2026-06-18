import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { RuntimeEventV2, SocialEventCandidatePayload } from '../types/runtimeEvent';
import {
  buildCompanionshipPrivateThreadScheduleDiagnostics,
  buildCompanionshipPrivateThreadScheduleEvent,
  getRecentCompanionshipPrivateThreadSchedule,
} from './companionshipPrivateThreadSchedule';
import { setCompanionshipRuntimeConfig } from './companionshipRuntimeConfig';

function chat(runtimeEventsV2: RuntimeEventV2[] = []) {
  return normalizeConversation({
    id: 'chat-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '羊村大家庭闲聊',
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b', 'c'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    relationshipLedger: [],
    runtimeEventsV2,
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: true, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function candidatePayload(overrides: Partial<SocialEventCandidatePayload> = {}): SocialEventCandidatePayload {
  const { urgency, ...rest } = overrides;
  return {
    eventKind: 'pair_private_thread',
    initiatorId: 'a',
    targetIds: ['b'],
    participantIds: ['a', 'b'],
    reasonType: 'companionship_promise_followup',
    triggerReason: '他们刚刚说好晚点继续聊这个约定。',
    openingMessage: '刚才那个约定，我想私下再确认一下。',
    dedupeKey: 'companionship-private-thread-chat-1-a-b',
    confidence: 0.82,
    seedIntent: '承接角色之间的未完成约定。',
    visibilityPlan: 'conversation_private',
    ...rest,
    urgency: urgency ?? 'soon',
  };
}

describe('companionshipPrivateThreadSchedule', () => {
  beforeEach(() => {
    setCompanionshipRuntimeConfig({});
  });

  it('projects readable diagnostics for skipped and suppressed schedule events', () => {
    const now = 10_000;
    const baseChat = chat();
    const skipped = buildCompanionshipPrivateThreadScheduleEvent({
      chat: baseChat,
      payload: candidatePayload(),
      action: 'skipped',
      nextAvailableAt: now + 60_000,
      createdAt: now - 1_000,
    });
    const suppressed = buildCompanionshipPrivateThreadScheduleEvent({
      chat: baseChat,
      payload: candidatePayload({ initiatorId: 'c', targetIds: ['a'], participantIds: ['c', 'a'], reasonType: 'companionship_shared_secret' }),
      action: 'suppressed',
      createdAt: now - 2_000,
    });

    const diagnostics = buildCompanionshipPrivateThreadScheduleDiagnostics({
      chat: chat([suppressed, skipped]),
      characterId: 'a',
      now,
    });

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      action: 'skipped',
      actorId: 'a',
      targetId: 'b',
      isCoolingDown: true,
      reasonType: 'companionship_promise_followup',
      triggerReason: '他们刚刚说好晚点继续聊这个约定。',
      openingMessage: '刚才那个约定，我想私下再确认一下。',
    });
    expect(diagnostics[1]).toMatchObject({
      action: 'suppressed',
      actorId: 'c',
      targetId: 'a',
      isCoolingDown: false,
      reasonType: 'companionship_shared_secret',
    });
  });

  it('does not treat suppressed schedule events as cooldown blockers', () => {
    const now = 20_000;
    const suppressed = buildCompanionshipPrivateThreadScheduleEvent({
      chat: chat(),
      payload: candidatePayload(),
      action: 'suppressed',
      createdAt: now - 1_000,
    });

    expect(getRecentCompanionshipPrivateThreadSchedule({
      chat: chat([suppressed]),
      participantIds: ['a', 'b'],
      now,
    })).toBeNull();
  });

  it('filters diagnostics to the requested character pair participation', () => {
    const now = 30_000;
    const abOpened = buildCompanionshipPrivateThreadScheduleEvent({
      chat: chat(),
      payload: candidatePayload(),
      action: 'opened',
      createdAt: now - 1_000,
    });
    const bcOpened = buildCompanionshipPrivateThreadScheduleEvent({
      chat: chat(),
      payload: candidatePayload({ initiatorId: 'b', targetIds: ['c'], participantIds: ['b', 'c'] }),
      action: 'opened',
      createdAt: now - 2_000,
    });

    const diagnostics = buildCompanionshipPrivateThreadScheduleDiagnostics({
      chat: chat([bcOpened, abOpened]),
      characterId: 'a',
      now,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.participantIds).toEqual(['a', 'b']);
  });

  it('keeps explicit model decision source on schedule diagnostics', () => {
    const event = buildCompanionshipPrivateThreadScheduleEvent({
      chat: chat(),
      payload: candidatePayload({ decisionSource: 'model' }),
      action: 'opened',
      createdAt: 40_000,
    });

    const diagnostics = buildCompanionshipPrivateThreadScheduleDiagnostics({
      chat: chat([event]),
      characterId: 'a',
      now: 41_000,
    });

    expect(diagnostics[0]?.decisionSource).toBe('model');
  });
});
