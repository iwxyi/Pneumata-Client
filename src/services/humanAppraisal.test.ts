import { afterEach, describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import type { SessionRuntimeContextBundle } from '../types/sessionEngine';
import { setHumanAppraisalRuntimeConfig } from './humanAppraisalRuntimeConfig';
import { buildHumanAppraisalPatch, buildPublicHumanAppraisalTrace, enrichRuntimeBundleWithHumanAppraisal } from './humanAppraisal';

function speaker(): AICharacter {
  return {
    id: 'char-a',
    name: '苏苏',
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
  } as AICharacter;
}

function chat(input: Partial<GroupChat> = {}): GroupChat {
  return {
    id: 'chat-1',
    type: 'direct',
    mode: 'open_chat',
    sessionKind: { topology: 'direct', family: 'conversation', scenarioId: 'direct-chat', surfaceProfile: 'text' },
    name: '测试',
    topic: '测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['char-a'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...input,
  } as GroupChat;
}

function message(content: string, senderId = 'user'): Message {
  return {
    id: `msg-${senderId}`,
    chatId: 'chat-1',
    type: senderId === 'user' ? 'user' : 'ai',
    senderId,
    senderName: senderId,
    content,
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
  };
}

function promiseEvent(visibility: RuntimeEventV2['visibility'] = 'pair_private'): RuntimeEventV2 {
  return {
    id: 'promise-1',
    conversationId: 'chat-1',
    kind: 'decision_trace',
    createdAt: 1,
    actorIds: ['char-a'],
    targetIds: ['user'],
    summary: 'opened promise',
    visibility,
    payload: {
      eventType: 'companionship_promise',
      action: 'opened',
      characterId: 'char-a',
      participantIds: ['char-a', 'user'],
      promiseText: '周末一起看电影',
    },
  };
}

describe('buildHumanAppraisalPatch', () => {
  afterEach(() => {
    setHumanAppraisalRuntimeConfig({ enabled: true });
  });

  it('returns no-op when no structured signal is relevant', () => {
    const result = buildHumanAppraisalPatch({
      chat: chat(),
      speaker: speaker(),
      messages: [message('你好')],
    });
    expect(result.moveBias).toBe('none');
    expect(result.strength).toBe('none');
  });

  it('asks a low-strength follow-up for an open promise and vague future commitment in direct chat', () => {
    const result = buildHumanAppraisalPatch({
      chat: chat({ runtimeEventsV2: [promiseEvent()] }),
      speaker: speaker(),
      messages: [message('那我们下次一定去')],
    });
    expect(result.moveBias).toBe('ask_followup');
    expect(result.strength).toBe('low');
    expect(result.reasonTags).toContain('unfinished_promise');
    expect(result.hiddenHint).toContain('是否认真');
  });

  it('returns no-op when the developer switch disables human appraisal', () => {
    setHumanAppraisalRuntimeConfig({ enabled: false });
    const result = buildHumanAppraisalPatch({
      chat: chat({ runtimeEventsV2: [promiseEvent()] }),
      speaker: speaker(),
      messages: [message('那我们下次一定去')],
    });
    expect(result.moveBias).toBe('none');
    expect(result.strength).toBe('none');
  });

  it('builds a public trace without prompt hints or raw source ids', () => {
    const result = buildHumanAppraisalPatch({
      chat: chat({ runtimeEventsV2: [promiseEvent()] }),
      speaker: speaker(),
      messages: [message('那我们下次一定去')],
    });
    const publicTrace = buildPublicHumanAppraisalTrace(result);

    expect(publicTrace).toMatchObject({
      moveBias: 'ask_followup',
      strength: 'low',
      publicSafe: true,
      sourceEventCount: 1,
    });
    expect(JSON.stringify(publicTrace)).not.toContain('hiddenHint');
    expect(JSON.stringify(publicTrace)).not.toContain('promise-1');
  });

  it('does not leak pair-private promise reasons into group appraisal', () => {
    const result = buildHumanAppraisalPatch({
      chat: chat({
        type: 'group',
        sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text' },
        memberIds: ['char-a', 'user'],
        runtimeEventsV2: [promiseEvent('pair_private')],
      }),
      speaker: speaker(),
      messages: [message('那我们下次一定去')],
    });
    expect(result.moveBias).toBe('none');
  });

  it('softens when the latest user turn shows remembered residue', () => {
    const result = buildHumanAppraisalPatch({
      chat: chat(),
      speaker: speaker(),
      messages: [message('你还记得这个啊')],
    });
    expect(result.moveBias).toBe('soften');
    expect(result.expressionBias?.warmth).toBe('up');
  });

  it('keeps explicit tasks out of the appraisal layer', () => {
    const result = buildHumanAppraisalPatch({
      chat: chat({ runtimeEventsV2: [promiseEvent()] }),
      speaker: speaker(),
      messages: [message('请帮我分析一下这个方案，下次的事先不说')],
    });
    expect(result.moveBias).toBe('none');
  });

  it('withdraws conservatively when relationship evidence is guarded', () => {
    const relationship: RelationshipLedgerEntry = {
      pairKey: 'char-a->user',
      actorId: 'char-a',
      targetId: 'user',
      current: { warmth: -12, competence: 0, trust: -30, threat: 48 },
      trend: 'volatile',
      recentEvents: [{ id: 'rel-1', kind: 'relationship_delta', createdAt: 1, summary: 'trust down' }],
      lastUpdatedAt: 1,
    };
    const result = buildHumanAppraisalPatch({
      chat: chat({ relationshipLedger: [relationship] }),
      speaker: speaker(),
      messages: [message('你怎么不说话了')],
    });
    expect(result.moveBias).toBe('withdraw');
    expect(result.expressionBias?.length).toBe('shorter');
    expect(result.sourceEventIds).toContain('rel-1');
  });

  it('enriches engine-provided runtime bundles for story choices', () => {
    const narrator = { ...speaker(), id: 'narrator', name: '旁白' };
    const baseBundle: SessionRuntimeContextBundle = {
      turnPlan: {
        speakerId: 'narrator',
        obligation: 'must',
        moveClass: 'perform',
        targetScope: 'scene',
        depth: 'normal',
        reason: 'story-reader',
      },
      expressionPlan: { surface: 'dramatic', texture: 'rich' },
      realizationPlan: {
        moveClass: 'perform',
        targetScope: 'scene',
        noveltyGoal: 'none',
        emotionalPosture: 'tense',
        surfaceDepth: 'normal',
        functionTag: 'advance',
        roleConstraint: 'stay_in_lane',
      },
      trace: { policyHits: ['story-reader'] },
    };

    const result = enrichRuntimeBundleWithHumanAppraisal({
      bundle: baseBundle,
      chat: chat({
        sessionKind: { topology: 'thread', family: 'simulation', scenarioId: 'story-reader', surfaceProfile: 'timeline' },
        scenarioState: { selectedChoice: { label: '推门进去' } },
      }),
      speaker: narrator,
      messages: [],
    });

    expect(result.trace?.humanAppraisal?.moveBias).toBe('insist');
    expect(result.turnPlan?.moveClass).toBe('challenge');
    expect(result.realizationPlan?.functionTag).toBe('challenge');
    expect(result.trace?.policyHits).toContain('human_appraisal:insist');
  });

  it('does not apply human appraisal twice to the same runtime bundle', () => {
    const baseBundle: SessionRuntimeContextBundle = {
      turnPlan: {
        speakerId: 'char-a',
        obligation: 'should',
        moveClass: 'advance',
        targetScope: 'person',
        depth: 'normal',
        reason: 'direct-chat',
      },
      expressionPlan: { surface: 'companion', texture: 'ordinary' },
      trace: { policyHits: ['direct-chat'] },
    };
    const once = enrichRuntimeBundleWithHumanAppraisal({
      bundle: baseBundle,
      chat: chat({ runtimeEventsV2: [promiseEvent()] }),
      speaker: speaker(),
      messages: [message('那我们下次一定去')],
    });
    const twice = enrichRuntimeBundleWithHumanAppraisal({
      bundle: once,
      chat: chat({ runtimeEventsV2: [promiseEvent()] }),
      speaker: speaker(),
      messages: [message('那我们下次一定去')],
    });

    expect(twice.trace?.policyHits?.filter((hit) => hit === 'human_appraisal:ask_followup')).toHaveLength(1);
  });
});
