import { describe, expect, it } from 'vitest';
import { normalizeConversation, type GroupChat } from '../../types/chat';
import { executeNonChatActionScaffold } from './nonChatActionScaffold';

function buildInterviewChat() {
  return normalizeConversation({
    id: 'interview-1',
    type: 'group',
    mode: 'interview',
    modeConfig: {} as never,
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '面试',
    topic: '招聘',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['host', 'candidate-a'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: false, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildWerewolfChat() {
  return normalizeConversation({
    id: 'werewolf-1',
    type: 'group',
    mode: 'werewolf',
    modeConfig: {} as never,
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '狼人杀',
    topic: '找狼',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['seer', 'villager-a', 'wolf-a', 'wolf-b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: true, allowMockery: true, allowAlliances: true, allowContempt: true },
    worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildOpenChat() {
  return normalizeConversation({
    id: 'open-1',
    type: 'group',
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: '开放群聊',
    topic: '日常',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: true,
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

describe('executeNonChatActionScaffold', () => {
  it('turns ask_question into interview-flavored runtime output', () => {
    const result = executeNonChatActionScaffold(buildInterviewChat(), {
      type: 'ask_question',
      targetIds: ['candidate-a'],
      payload: { targetId: 'candidate-a', prompt: '请介绍一个你主导解决的复杂问题。', round: 1 },
    });
    expect(result?.chatPatch?.worldState?.recentEvent).toContain('提问');
    expect(result?.runtimeEvents?.[0]?.eventType).toBe('interview_question');
    expect(result?.runtimeEvents?.[0]?.title).toContain('面试官发起提问');
  });

  it('turns director_intervention into interview phase control output', () => {
    const result = executeNonChatActionScaffold(buildInterviewChat(), {
      type: 'director_intervention',
      targetIds: ['candidate-a'],
      payload: { prompt: '进入追问轮次，要求回答更具体。', intent: 'force_reply', pressure: '0.95', maxTurns: '2' },
    });
    expect(result?.chatPatch?.worldState?.recentEvent).toContain('导演推进');
    expect(result?.runtimeEvents?.[0]?.eventType).toBe('interview_phase_control');
    const structuredEvent = (result?.chatPatch as Partial<GroupChat> | undefined)?.runtimeEventsV2?.at(-1);
    expect(structuredEvent?.kind).toBe('director_intervention');
    expect(structuredEvent?.targetIds).toEqual(['candidate-a']);
    expect(structuredEvent?.payload).toMatchObject({ intent: 'force_reply', targetActorIds: ['candidate-a'], pressure: 0.95, maxTurns: 2 });
  });

  it('turns wolf_vote into night resolution output', () => {
    const result = executeNonChatActionScaffold(buildWerewolfChat(), {
      type: 'wolf_vote',
      targetIds: ['villager-a'],
      payload: { targetId: 'villager-a', prompt: '先处理发言最强势的。' },
    });
    expect(result?.chatPatch?.worldState?.phase).toBe('debating');
    expect(result?.runtimeEvents?.[0]?.eventType).toBe('werewolf_night_action');
    expect(result?.runtimeEvents?.[0]?.title).toContain('夜晚袭击');
  });

  it('turns inspect_player into seer inspection output', () => {
    const result = executeNonChatActionScaffold(buildWerewolfChat(), {
      type: 'inspect_player',
      targetIds: ['wolf-a'],
      payload: { targetId: 'wolf-a' },
    });
    expect(result?.chatPatch?.worldState?.phase).toBe('debating');
    expect(result?.runtimeEvents?.[0]?.eventType).toBe('werewolf_inspection');
    expect(result?.runtimeEvents?.[0]?.title).toContain('查验');
  });

  it('turns vote_player into day vote resolution output', () => {
    const result = executeNonChatActionScaffold(buildWerewolfChat(), {
      type: 'vote_player',
      targetIds: ['wolf-b'],
      payload: { targetId: 'wolf-b', prompt: '他的站边前后矛盾。' },
    });
    expect(result?.chatPatch?.worldState?.phase).toBe('aligned');
    expect(result?.runtimeEvents?.[0]?.eventType).toBe('werewolf_vote');
    expect(result?.runtimeEvents?.[0]?.title).toContain('白天投票');
  });

  it('rejects start_private_thread when actor/target are invalid in current chat', () => {
    const chat = buildOpenChat();
    const sameActorTarget = executeNonChatActionScaffold(chat, {
      type: 'start_private_thread',
      actorId: 'a',
      targetIds: ['a'],
      payload: { actorId: 'a', targetId: 'a' },
    });
    const outsiderTarget = executeNonChatActionScaffold(chat, {
      type: 'start_private_thread',
      actorId: 'a',
      targetIds: ['outsider'],
      payload: { actorId: 'a', targetId: 'outsider' },
    });
    const missingActor = executeNonChatActionScaffold(chat, {
      type: 'start_private_thread',
      targetIds: ['b'],
      payload: { targetId: 'b' },
    });
    expect(sameActorTarget).toBeNull();
    expect(outsiderTarget).toBeNull();
    expect(missingActor).toBeNull();
  });

  it('rejects start_private_thread when actor is inferred as system agent', () => {
    const chat = normalizeConversation({
      ...buildOpenChat(),
      memberIds: ['host_moderator', 'a', 'b'],
    });
    const result = executeNonChatActionScaffold(chat, {
      type: 'start_private_thread',
      actorId: 'host_moderator',
      targetIds: ['a'],
      payload: { actorId: 'host_moderator', targetId: 'a' },
    });
    expect(result).toBeNull();
  });

  it('rejects target-required actions when target is outside current chat', () => {
    const chat = buildInterviewChat();
    const askQuestion = executeNonChatActionScaffold(chat, {
      type: 'ask_question',
      targetIds: ['outsider'],
      payload: { targetId: 'outsider', prompt: '请介绍项目经历' },
    });
    const votePlayer = executeNonChatActionScaffold(buildWerewolfChat(), {
      type: 'vote_player',
      targetIds: ['outsider'],
      payload: { targetId: 'outsider', prompt: '站边异常' },
    });
    expect(askQuestion).toBeNull();
    expect(votePlayer).toBeNull();
  });

  it('rejects director_intervention when target is outside current chat', () => {
    const result = executeNonChatActionScaffold(buildInterviewChat(), {
      type: 'director_intervention',
      targetIds: ['outsider'],
      payload: { prompt: '进入追问轮次', intent: 'force_reply' },
    });
    expect(result).toBeNull();
  });

  it('builds deterministic director_intervention runtime event id when timestamp is fixed', () => {
    const action = {
      type: 'director_intervention' as const,
      targetIds: ['candidate-a'],
      payload: {
        prompt: '进入追问轮次，要求回答更具体。',
        intent: 'force_reply',
        pressure: '0.95',
        maxTurns: '2',
        createdAt: 1_717_000_123_000,
      },
    };
    const first = executeNonChatActionScaffold(buildInterviewChat(), action);
    const second = executeNonChatActionScaffold(buildInterviewChat(), action);

    const firstId = (first?.chatPatch as Partial<GroupChat> | undefined)?.runtimeEventsV2?.at(-1)?.id;
    const secondId = (second?.chatPatch as Partial<GroupChat> | undefined)?.runtimeEventsV2?.at(-1)?.id;
    expect(firstId).toBeTruthy();
    expect(firstId).toBe(secondId);
  });
});
