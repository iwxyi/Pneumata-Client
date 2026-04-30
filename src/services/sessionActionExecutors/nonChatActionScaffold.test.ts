import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../../types/chat';
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
      payload: { prompt: '进入追问轮次，要求回答更具体。' },
    });
    expect(result?.chatPatch?.worldState?.recentEvent).toContain('导演推进');
    expect(result?.runtimeEvents?.[0]?.eventType).toBe('interview_phase_control');
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
});
