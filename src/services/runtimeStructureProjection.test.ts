import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { normalizeConversation } from '../types/chat';
import { projectRuntimeStructureRows } from './runtimeStructureProjection';

function member(id: string, name: string): AICharacter {
  return {
    id,
    name,
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
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['a', 'b'],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    runtimeEventsV2: [],
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('runtimeStructureProjection', () => {
  it('returns empty rows when no scenario state is present', () => {
    expect(projectRuntimeStructureRows(buildChat(), [member('a', '甲')], 'zh-CN')).toEqual([]);
  });

  it('projects scenario and board rows with member names and board summary', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      scenarioState: {
        roleAssignments: [{ actorId: 'a', roleId: 'werewolf' }],
        factions: [{ factionId: 'f1', label: '狼队' }],
        currentTurnActorId: 'b',
        board: {
          schema: { kind: 'gomoku', columns: 15, rows: 15 },
          pieces: [{ id: 'p1', type: 'black', position: '7,7' }],
        },
      },
    });
    const rows = projectRuntimeStructureRows(chat, [member('a', '甲'), member('b', '乙')], 'zh-CN');
    expect(rows).toEqual(expect.arrayContaining([
      { key: 'roles', label: '角色位', value: '甲：狼人' },
      { key: 'factions', label: '阵营', value: '狼队' },
      { key: 'currentTurn', label: '当前轮次', value: '乙' },
      { key: 'boardKind', label: '棋盘', value: '五子棋盘' },
      { key: 'boardSize', label: '尺寸', value: '15 × 15' },
      { key: 'pieces', label: '棋子', value: '1' },
    ]));
  });

  it('sanitizes faction labels before projecting structure rows', () => {
    const uuid = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
    const chat = normalizeConversation({
      ...buildChat(),
      scenarioState: {
        roleAssignments: [{ actorId: 'a', roleId: 'werewolf' }],
        factions: [{ factionId: 'f1', label: `${uuid} {"eventType":"room_state_snapshot_v2"}` }],
        currentTurnActorId: 'b',
        board: undefined,
      },
    });
    const rows = projectRuntimeStructureRows(chat, [member('a', '甲'), member('b', '乙')], 'zh-CN');
    const factionRow = rows.find((item) => item.key === 'factions');
    expect(factionRow?.value).toContain('系统事件');
    expect(factionRow?.value).not.toContain(uuid);
    expect(factionRow?.value).not.toContain('eventType');
  });
});
