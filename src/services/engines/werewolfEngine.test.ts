import { describe, expect, it } from 'vitest';
import { WEREWOLF_ENGINE } from './werewolfEngine';
import { normalizeConversation } from '../../types/chat';
import type { AICharacter } from '../../types/character';

function buildChat(overrides: Record<string, unknown> = {}) {
  return normalizeConversation({
    id: 'wolf-1',
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
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    ...overrides,
  });
}

function buildCharacter(id: string, name: string): AICharacter {
  return { id, name } as AICharacter;
}

describe('WEREWOLF_ENGINE', () => {
  it('assigns werewolf roles by seat', () => {
    const participants = WEREWOLF_ENGINE.buildParticipants(buildChat());
    expect(participants[0]?.flags.role).toBe('seer');
    expect(participants[2]?.flags.role).toBe('villager');
    expect(participants[3]?.flags.role).toBe('werewolf');
  });

  it('exposes werewolf action schema with visibility scopes', () => {
    const chat = buildChat();
    const schema = WEREWOLF_ENGINE.getActionSchema?.({ conversation: chat, participants: WEREWOLF_ENGINE.buildParticipants(chat) });
    expect(schema?.actions.map((action) => action.type)).toEqual(['wolf_vote', 'inspect_player', 'vote_player', 'director_intervention']);
    expect(schema?.actions.find((action) => action.type === 'wolf_vote')?.visibility).toBe('pair_private');
    expect(schema?.actions.find((action) => action.type === 'inspect_player')?.visibility).toBe('role_private');
    expect(schema?.actions.find((action) => action.type === 'vote_player')?.visibility).toBe('public');
    const director = schema?.actions.find((action) => action.type === 'director_intervention');
    expect(director?.visibility).toBe('moderator_only');
    expect(director?.fields?.map((field) => field.key)).toEqual(['intent', 'targetId', 'maxTurns', 'prompt']);
    expect(director?.fields?.find((field) => field.key === 'intent')?.options?.map((option) => option.value)).toContain('reveal');
  });

  it('resolves werewolf turn policy by phase', () => {
    const idle = WEREWOLF_ENGINE.resolveTurnPolicy?.({ conversation: buildChat(), characters: [], messages: [] });
    const warming = WEREWOLF_ENGINE.resolveTurnPolicy?.({ conversation: buildChat({ worldState: { ...buildChat().worldState, phase: 'warming' } }), characters: [], messages: [] });
    const debating = WEREWOLF_ENGINE.resolveTurnPolicy?.({ conversation: buildChat({ worldState: { ...buildChat().worldState, phase: 'debating' } }), characters: [], messages: [] });
    expect(idle).toEqual({ runChat: false, runAction: true, interleaveAction: false });
    expect(warming).toEqual({ runChat: true, runAction: true, interleaveAction: false });
    expect(debating).toEqual({ runChat: true, runAction: false, interleaveAction: true });
  });

  it('builds role-aware werewolf prompt context', () => {
    const chat = buildChat({ worldState: { ...buildChat().worldState, phase: 'warming' } });
    const context = WEREWOLF_ENGINE.buildGenerationPromptContext?.({ conversation: chat, characters: [], messages: [], speaker: buildCharacter('wolf-b', '狼人乙') });
    expect(context?.promptPrefix).toContain('werewolf social deduction game');
    expect(context?.promptPrefix).toContain('werewolf');
    expect(context?.additionalConstraints?.[0]).toContain('Night-phase speech');
  });

  it('commits night speech into private werewolf artifacts and day transition', async () => {
    const chat = buildChat({ worldState: { ...buildChat().worldState, phase: 'warming' } });
    const result = await WEREWOLF_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('seer', '预言家'), buildCharacter('wolf-a', '狼人甲'), buildCharacter('wolf-b', '狼人乙')],
      message: { type: 'ai', senderId: 'wolf-b', content: '先刀发言最强的那个。' },
      previousAiMessage: null,
    });
    expect(result.chatPatch.worldState?.phase).toBe('debating');
    const runtimeEvents = result.chatPatch.runtimeEventsV2 || [];
    expect(runtimeEvents).toHaveLength(3);
    expect(runtimeEvents[0]?.kind).toBe('message_generated');
    expect(runtimeEvents[1]?.kind).toBe('room_shift');
    expect(runtimeEvents[2]?.kind).toBe('artifact');
    expect(runtimeEvents[2]?.visibility).toBe('pair_private');
    expect(runtimeEvents[2]?.visibleToRoles).toEqual(['werewolf']);
    expect((runtimeEvents[2]?.payload as { role?: string; nightOnly?: boolean }).role).toBe('werewolf');
    expect((runtimeEvents[2]?.payload as { role?: string; nightOnly?: boolean }).nightOnly).toBe(true);
  });

  it('commits seer night speech into role-private artifacts', async () => {
    const chat = buildChat({ worldState: { ...buildChat().worldState, phase: 'warming' } });
    const result = await WEREWOLF_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('seer', '预言家'), buildCharacter('villager-a', '村民甲')],
      message: { type: 'ai', senderId: 'seer', content: '今晚我先看一下村民甲。' },
      previousAiMessage: null,
    });
    const artifact = (result.chatPatch.runtimeEventsV2 || []).find((event) => event.kind === 'artifact');
    expect(artifact?.visibility).toBe('role_private');
    expect(artifact?.visibleToRoles).toEqual(['seer']);
    expect((artifact?.payload as { role?: string }).role).toBe('seer');
  });

  it('keeps day discussion public and preserves discussion phase', async () => {
    const chat = buildChat({ worldState: { ...buildChat().worldState, phase: 'debating' } });
    const result = await WEREWOLF_ENGINE.onMessageCommitted({
      conversation: chat,
      characters: [buildCharacter('villager-a', '村民甲')],
      message: { type: 'ai', senderId: 'villager-a', content: '我觉得刚才狼队视角太明显了。' },
      previousAiMessage: { senderId: 'wolf-a' },
    });
    expect(result.chatPatch.worldState?.phase).toBe('debating');
    expect(result.chatPatch.worldState?.recentEvent).toContain('村民甲 发言');
    expect((result.chatPatch.runtimeEventsV2 || []).some((event) => event.kind === 'artifact')).toBe(false);
    expect(result.runtimeEvents[0]?.eventType).toBe('werewolf_discussion');
  });
});
