import { describe, expect, it } from 'vitest';
import { normalizeConversation, type GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import type { SessionEngineDefinition } from '../../types/sessionEngine';
import { BOARD_GAME_ENGINE } from './boardGameEngine';
import { MYSTERY_ENGINE } from './mysteryEngine';
import { STORY_ENGINE } from './storyEngine';
import { STUDY_ENGINE } from './studyEngine';
import { WEREWOLF_ENGINE } from './werewolfEngine';

function buildChat(mode: GroupChat['mode'], scenarioId: string, family: NonNullable<GroupChat['sessionKind']>['family']) {
  return normalizeConversation({
    id: `${scenarioId}-1`,
    type: 'group',
    mode,
    sessionKind: { topology: 'group', family, scenarioId, surfaceProfile: 'hybrid' },
    modeConfig: {} as never,
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    scenarioState: {
      seats: [
        { seatId: 'seat-a', seatIndex: 0, actorId: 'a' },
        { seatId: 'seat-b', seatIndex: 1, actorId: 'b', muted: true, canSpeak: false },
      ],
    },
    name: '玩法房间',
    topic: '测试禁言',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: false, allowContempt: false },
    worldState: { phase: 'debating', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

function buildCharacter(id: string, name: string): AICharacter {
  return { id, name } as AICharacter;
}

describe('engine governance integration', () => {
  it.each([
    ['狼人杀', WEREWOLF_ENGINE, buildChat('werewolf', 'werewolf-classic', 'deduction')],
    ['剧本杀', MYSTERY_ENGINE, buildChat('murder_mystery', 'murder-mystery', 'mystery')],
    ['学习房', STUDY_ENGINE, buildChat('classroom', 'ielts-coach', 'study')],
    ['棋盘房', BOARD_GAME_ENGINE, buildChat('board_game', 'board-game', 'board_game')],
  ] satisfies Array<[string, SessionEngineDefinition, GroupChat]>)('%s respects shared mute governance', (_label, engine, chat) => {
    const participants = engine.buildParticipants(chat);
    const schema = engine.getActionSchema?.({ conversation: chat, participants });

    expect(participants.find((participant) => participant.entityRefId === 'b')?.canSpeak).toBe(false);
    expect(schema?.actions.map((action) => action.type)).toContain('mute_member');
    expect(schema?.actions.map((action) => action.type)).toContain('unmute_member');
    expect(schema?.actions.find((action) => action.type === 'mute_member')?.fields?.find((field) => field.key === 'targetId')?.options?.map((option) => option.value)).toEqual(['a']);
    expect(schema?.actions.find((action) => action.type === 'unmute_member')?.fields?.find((field) => field.key === 'targetId')?.options?.map((option) => option.value)).toEqual(['b']);
  });

  it('lets story rooms obey mute state without adding active mute controls', () => {
    const chat = buildChat('scripted_play', 'story-reader', 'conversation');
    const participants = STORY_ENGINE.buildParticipants(chat);
    const schema = STORY_ENGINE.getActionSchema?.({ conversation: chat, participants });
    const promptContext = STORY_ENGINE.buildGenerationPromptContext?.({
      conversation: chat,
      characters: [buildCharacter('a', '甲'), buildCharacter('b', '乙')],
      messages: [],
      speaker: buildCharacter('narrator', '旁白'),
    });

    expect(participants.find((participant) => participant.entityRefId === 'b')?.canSpeak).toBe(false);
    expect(schema?.actions.map((action) => action.type)).toEqual([]);
    expect(promptContext?.additionalConstraints?.join('\n')).toContain('乙');
    expect(promptContext?.additionalConstraints?.join('\n')).toContain('cannot speak aloud');
  });
});
