import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { GroupChat } from '../types/chat';
import type { CharacterArtifactEntry } from '../stores/useCharacterArtifactStore';
import type { CharacterDailyDiaryContext } from './characterExperienceArtifacts';
import { buildDiaryCompanionshipReflectionEvents, pickChatsForDiaryCompanionshipBackflow } from './diaryCompanionshipBackflow';

function entry(overrides: Partial<CharacterArtifactEntry> = {}): CharacterArtifactEntry {
  return {
    id: 'diary-1',
    kind: 'diary',
    characterId: 'char-a',
    characterName: '苏苏',
    dateKey: '2026-06-09',
    title: '苏苏的日记',
    text: '今天还是想起用户说好的那件事。',
    source: 'ai',
    unread: false,
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function context(seeds: string[]): CharacterDailyDiaryContext {
  return { companionshipSeeds: seeds } as CharacterDailyDiaryContext;
}

function chat(id: string, type: GroupChat['type'], memberIds: string[], updatedAt = 100): GroupChat {
  return normalizeConversation({
    id,
    type,
    mode: 'open_chat',
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free', currentSpeakerId: null, currentTopicFocus: '', lastRelationshipEventAt: null },
    name: id,
    topic: '',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds,
    speed: 1,
    isActive: false,
    allowIntervention: true,
    topicSeed: '',
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: 1,
    updatedAt,
    lastMessageAt: updatedAt,
  });
}

describe('diaryCompanionshipBackflow', () => {
  it('builds companionship runtime events from private diary seeds', () => {
    const events = buildDiaryCompanionshipReflectionEvents({
      entry: entry(),
      context: context([
        '未完成约定可以在日记里成为轻微期待：用户说好周末告诉苏苏面试结果。',
        '待关心事项：用户最近面试压力很大。',
      ]),
      character: { id: 'char-a', name: '苏苏' },
      relatedCharacters: [],
      conversationId: 'chat-1',
      createdAt: 1_000,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      conversationId: 'chat-1',
      kind: 'artifact',
      actorIds: ['char-a'],
      targetIds: ['user'],
      payload: expect.objectContaining({
        eventType: 'companionship_diary_reflection',
        reflectionType: 'promise',
        participantIds: ['char-a', 'user'],
      }),
    });
    expect(events[1]?.payload).toMatchObject({ reflectionType: 'care' });
  });

  it('picks related direct chats before broader group chats', () => {
    const events = buildDiaryCompanionshipReflectionEvents({
      entry: entry(),
      context: context(['小秘密：这是苏苏和小雨只有彼此知道的暗号。']),
      character: { id: 'char-a', name: '苏苏' },
      relatedCharacters: [{ id: 'char-b', name: '小雨' }],
      conversationId: 'prototype',
      createdAt: 1_000,
    });
    const picked = pickChatsForDiaryCompanionshipBackflow([
      chat('group', 'group', ['char-a', 'char-b'], 500),
      chat('direct', 'direct', ['char-a'], 200),
      chat('unrelated', 'group', ['char-c'], 900),
    ], 'char-a', events);

    expect(picked.map((item) => item.id)).toEqual(['direct', 'group']);
  });
});
