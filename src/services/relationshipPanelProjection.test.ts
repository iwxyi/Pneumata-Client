import { describe, expect, it } from 'vitest';
import { normalizeConversation } from '../types/chat';
import type { AICharacter } from '../types/character';
import { projectRelationshipPanelData } from './relationshipPanelProjection';

function member(id: string, name: string, relationships: AICharacter['relationships'] = []): AICharacter {
  return {
    id,
    name,
    avatar: '',
    personality: {
      openness: 50,
      extroversion: 50,
      agreeableness: 50,
      neuroticism: 50,
      humor: 50,
      creativity: 50,
      assertiveness: 50,
      empathy: 50,
    },
    behavior: {
      proactivity: 50,
      aggressiveness: 50,
      humorIntensity: 50,
      empathyLevel: 50,
      summarizing: 50,
      offTopic: 50,
    },
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships,
    memory: {
      longTerm: [],
      shortTermSummary: '',
      secrets: [],
      obsessions: [],
      tabooTopics: [],
      userMemories: [],
    },
    intervention: {
      allowSpeakAs: true,
      allowDirectorPrompt: true,
      allowPrivateThread: true,
    },
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
    relationshipLedger: [],
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
  });
}

describe('relationshipPanelProjection', () => {
  it('projects ledger sections by actor in forward mode', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: [{
        pairKey: 'a->b',
        actorId: 'a',
        targetId: 'b',
        current: { warmth: 8, trust: 7, competence: 5, threat: 1 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 10,
      }],
    });
    const members = [member('a', '甲'), member('b', '乙')];
    const projection = projectRelationshipPanelData(chat, members, false);
    expect(projection.ledgerSections).toHaveLength(1);
    expect(projection.ledgerSections[0]?.member.id).toBe('a');
    expect(projection.ledgerSections[0]?.sectionKey).toBe('forward-a');
    expect(projection.fallbackSections).toHaveLength(0);
    expect(projection.sectionKeys).toEqual(['forward-a']);
  });

  it('projects ledger sections by target in reverse mode', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: [{
        pairKey: 'a->b',
        actorId: 'a',
        targetId: 'b',
        current: { warmth: 8, trust: 7, competence: 5, threat: 1 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 10,
      }],
    });
    const members = [member('a', '甲'), member('b', '乙')];
    const projection = projectRelationshipPanelData(chat, members, true);
    expect(projection.ledgerSections).toHaveLength(1);
    expect(projection.ledgerSections[0]?.member.id).toBe('b');
    expect(projection.ledgerSections[0]?.sectionKey).toBe('reverse-b');
    expect(projection.sectionKeys).toEqual(['reverse-b']);
  });

  it('falls back to character relationship notes when no ledger section exists', () => {
    const chat = buildChat();
    const members = [
      member('a', '甲', [{ characterId: 'b', warmth: 3, trust: 2, competence: 1, threat: 0, note: '最近更愿意接话' }]),
      member('b', '乙'),
    ];
    const projection = projectRelationshipPanelData(chat, members, false);
    expect(projection.ledgerSections).toHaveLength(0);
    expect(projection.fallbackSections).toHaveLength(1);
    expect(projection.fallbackSections[0]?.member.id).toBe('a');
    expect(projection.fallbackSections[0]?.sectionKey).toBe('fallback-forward-a');
    expect(projection.fallbackSections[0]?.items[0]).toMatchObject({
      characterId: 'b',
      targetName: '乙',
      note: '最近更愿意接话',
    });
  });

  it('includes user as a relationship section member when chat contains user', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      memberIds: ['user', 'a', 'b'],
      relationshipLedger: [{
        pairKey: 'a->user',
        actorId: 'a',
        targetId: 'user',
        current: { warmth: 9, trust: 6, competence: 2, threat: 0 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 11,
      }],
    });
    const members = [member('a', '甲'), member('b', '乙')];
    const forward = projectRelationshipPanelData(chat, members, false);
    const reverse = projectRelationshipPanelData(chat, members, true);

    expect(forward.ledgerSections[0]?.member.id).toBe('a');
    expect(reverse.ledgerSections[0]?.member.id).toBe('user');
    expect(reverse.ledgerSections[0]?.member.name).toBe('我');
  });

  it('projects direct chat relationship between AI and user even when user is not in member list', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      type: 'direct',
      memberIds: ['a'],
      relationshipLedger: [{
        pairKey: 'a->user',
        actorId: 'a',
        targetId: 'user',
        current: { warmth: 12, trust: 9, competence: 2, threat: 0 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 12,
      }, {
        pairKey: 'user->a',
        actorId: 'user',
        targetId: 'a',
        current: { warmth: 6, trust: 4, competence: 1, threat: 0 },
        trend: 'flat',
        recentEvents: [],
        lastUpdatedAt: 13,
      }],
    });
    const members = [member('a', '甲')];
    const forward = projectRelationshipPanelData(chat, members, false);
    const reverse = projectRelationshipPanelData(chat, members, true);

    expect(forward.ledgerSections.map((section) => section.member.id)).toEqual(['a', 'user']);
    expect(reverse.ledgerSections.map((section) => section.member.id)).toEqual(['a', 'user']);
    expect(forward.ledgerSections.find((section) => section.member.id === 'user')?.member.name).toBe('我');
  });

  it('exposes unexpected user relationship entries in ai direct chats', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      type: 'ai_direct',
      memberIds: ['a', 'b'],
      relationshipLedger: [{
        pairKey: 'a->b',
        actorId: 'a',
        targetId: 'b',
        current: { warmth: 10, trust: 7, competence: 5, threat: 1 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 12,
      }, {
        pairKey: 'a->user',
        actorId: 'a',
        targetId: 'user',
        current: { warmth: 99, trust: 99, competence: 99, threat: 0 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 13,
      }],
    });
    const members = [member('a', '甲'), member('b', '乙')];
    const projection = projectRelationshipPanelData(chat, members, false);

    expect(projection.ledgerSections.map((section) => section.member.id)).toEqual(['a']);
    expect(projection.ledgerSections.find((section) => section.member.id === 'a')?.items.map((item) => item.pairKey)).toEqual(['a->user', 'a->b']);
  });

  it('sorts ledger entries by relationship score then recency and caps each section to 8', () => {
    const entries = Array.from({ length: 10 }).map((_, index) => ({
      pairKey: `a->b-${index}`,
      actorId: 'a',
      targetId: 'b',
      current: { warmth: index + 1, trust: 0, competence: 0, threat: 0 },
      trend: 'up' as const,
      recentEvents: [],
      lastUpdatedAt: 100 + index,
    }));
    // same score, newer first
    entries.push({
      pairKey: 'a->c-recent',
      actorId: 'a',
      targetId: 'c',
      current: { warmth: 5, trust: 0, competence: 0, threat: 0 },
      trend: 'up',
      recentEvents: [],
      lastUpdatedAt: 999,
    });
    entries.push({
      pairKey: 'a->c-old',
      actorId: 'a',
      targetId: 'c',
      current: { warmth: 5, trust: 0, competence: 0, threat: 0 },
      trend: 'up',
      recentEvents: [],
      lastUpdatedAt: 101,
    });
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: entries,
    });
    const members = [member('a', '甲'), member('b', '乙'), member('c', '丙')];
    const projection = projectRelationshipPanelData(chat, members, false);
    const section = projection.ledgerSections.find((item) => item.member.id === 'a');
    expect(section).toBeTruthy();
    expect(section?.items).toHaveLength(8);
    // highest score survives and remains ahead
    expect(section?.items[0]?.pairKey).toBe('a->b-9');
    // same-score recency tie-break should keep recent before old if both present
    const recentIdx = section?.items.findIndex((item) => item.pairKey === 'a->c-recent') ?? -1;
    const oldIdx = section?.items.findIndex((item) => item.pairKey === 'a->c-old') ?? -1;
    if (recentIdx >= 0 && oldIdx >= 0) {
      expect(recentIdx).toBeLessThan(oldIdx);
    }
  });

  it('filters draft fallback relations and reports unresolved fallback targets as diagnostics', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: [{
        pairKey: 'draft->b',
        actorId: 'draft-1',
        targetId: 'b',
        current: { warmth: 8, trust: 7, competence: 5, threat: 1 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 10,
      }],
    });
    const members = [
      member('a', '甲', [
        { characterId: 'draft-2', warmth: 5, trust: 0, competence: 0, threat: 0, note: '草稿对象应过滤' },
        { characterId: 'x', warmth: 2, trust: 0, competence: 0, threat: 0, note: '未知对象应降级命名' },
      ]),
      member('b', '乙'),
    ];
    const projection = projectRelationshipPanelData(chat, members, false);
    expect(projection.ledgerSections).toHaveLength(0);
    expect(projection.fallbackSections).toHaveLength(0);
    expect(projection.diagnostics).toHaveLength(1);
    expect(projection.diagnostics[0]).toMatchObject({
      kind: 'unresolved-fallback-target',
      targetId: 'x',
      note: '未知对象应降级命名',
    });
  });

  it('reports character preset relationships to unrelated roles in direct chats as diagnostics', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      type: 'direct',
      memberIds: ['a'],
      relationshipLedger: [],
    });
    const members = [
      member('a', '甲', [
        { characterId: 'unrelated-role-1', warmth: 10, trust: 2, competence: 60, threat: 30, note: '外部角色关系不应出现在单聊面板' },
        { characterId: 'unrelated-role-2', warmth: 0, trust: 10, competence: 50, threat: 25, note: '另一个外部角色关系不应出现在单聊面板' },
      ]),
    ];
    const projection = projectRelationshipPanelData(chat, members, false);
    expect(projection.ledgerSections).toHaveLength(0);
    expect(projection.fallbackSections).toHaveLength(0);
    expect(projection.diagnostics.map((item) => item.targetId)).toEqual(['unrelated-role-1', 'unrelated-role-2']);
  });

  it('deduplicates fallback pairs already covered by ledger without hiding other fallback data', () => {
    const chat = normalizeConversation({
      ...buildChat(),
      relationshipLedger: [{
        pairKey: 'a->b',
        actorId: 'a',
        targetId: 'b',
        current: { warmth: 3, trust: 2, competence: 1, threat: 0 },
        trend: 'up',
        recentEvents: [],
        lastUpdatedAt: 15,
      }],
    });
    const members = [
      member('a', '甲', [
        { characterId: 'b', warmth: 9, trust: 9, competence: 9, threat: 0, note: '同一对关系不应走 fallback' },
        { characterId: 'x', warmth: 12, trust: 0, competence: 0, threat: 0, note: '其它异常关系应继续暴露' },
      ]),
      member('b', '乙'),
    ];
    const projection = projectRelationshipPanelData(chat, members, false);
    expect(projection.ledgerSections.some((section) => section.member.id === 'a')).toBe(true);
    expect(projection.fallbackSections.find((section) => section.member.id === 'a')).toBeUndefined();
    expect(projection.diagnostics.map((item) => item.targetId)).toEqual(['x']);
  });
});
