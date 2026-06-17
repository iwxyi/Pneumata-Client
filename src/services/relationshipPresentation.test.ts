import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import { buildPresentedRelationshipEntry, buildPresentedRelationshipLedger } from './relationshipPresentation';

const uuidA = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
const uuidB = '3c78729f-e52d-4dde-b27f-01a949960bb8';

describe('relationshipPresentation', () => {
  it('exposes unresolved relationship member ids in names but keeps evidence text sanitized', () => {
    const members = [{ id: uuidA, name: '红太狼' }] as AICharacter[];
    const entry: RelationshipLedgerEntry = {
      pairKey: `${uuidA}->${uuidB}`,
      actorId: uuidA,
      targetId: uuidB,
      current: { warmth: 18, competence: 0, trust: 12, threat: 0 },
      trend: 'up',
      recentEvents: [{
        id: 'evt-1',
        kind: 'interaction',
        createdAt: 1,
        summary: `${uuidA} support → ${uuidB} 我支持你刚才那个方向。`,
        actorIds: [uuidA],
        targetIds: [uuidB],
      }],
      lastUpdatedAt: 1,
    };

    const presented = buildPresentedRelationshipEntry(entry, members);

    expect(presented.actorName).toBe('红太狼');
    expect(presented.targetName).toBe(`未解析成员(${uuidB})`);
    expect(presented.evidence).toContain('红太狼');
    expect(presented.evidence).toContain('我支持你刚才那个方向');
    expect(presented.evidence).not.toContain(uuidA);
    expect(presented.evidence).not.toContain(uuidB);
  });

  it('sanitizes semantic summaries before they reach relationship cards', () => {
    const members = [{ id: uuidA, name: '红太狼' }] as AICharacter[];
    const entry: RelationshipLedgerEntry = {
      pairKey: `${uuidA}->${uuidB}`,
      actorId: uuidA,
      targetId: uuidB,
      current: { warmth: 18, competence: 0, trust: 12, threat: 0 },
      trend: 'up',
      derived: {
        semantic: {
          stage: '关系升温',
          labels: ['同盟感'],
          summary: `Relationship ledger has become salient · ${uuidA} relationship_delta ${uuidB} {"eventType":"room_state_snapshot_v2"}`,
          intensity: 62,
        },
      },
      axisReasons: {},
      recentEvents: [],
      lastUpdatedAt: 1,
    };

    const presented = buildPresentedRelationshipEntry(entry, members);

    expect(presented.semanticSummary).toContain('关系账本中的变化已经足够显著');
    expect(presented.semanticSummary).toContain('红太狼');
    expect(presented.semanticSummary).toContain('成员');
    expect(presented.semanticSummary).toContain('系统事件');
    expect(presented.semanticSummary).not.toContain('Relationship ledger');
    expect(presented.semanticSummary).not.toContain('relationship_delta');
    expect(presented.semanticSummary).not.toContain(uuidA);
    expect(presented.semanticSummary).not.toContain(uuidB);
    expect(presented.semanticSummary).not.toContain('eventType');
  });

  it('filters draft actor/target relationships from presented ledger', () => {
    const chat = {
      relationshipLedger: [
        {
          pairKey: 'draft-1->b',
          actorId: 'draft-1',
          targetId: 'b',
          current: { warmth: 10, competence: 0, trust: 0, threat: 0 },
          trend: 'up',
          recentEvents: [],
          lastUpdatedAt: 2,
        },
        {
          pairKey: 'a->draft-2',
          actorId: 'a',
          targetId: 'draft-2',
          current: { warmth: 0, competence: 8, trust: 0, threat: 0 },
          trend: 'stable',
          recentEvents: [],
          lastUpdatedAt: 3,
        },
        {
          pairKey: 'a->b',
          actorId: 'a',
          targetId: 'b',
          current: { warmth: 6, competence: 5, trust: 4, threat: -2 },
          trend: 'up',
          recentEvents: [],
          lastUpdatedAt: 4,
        },
      ],
    } as unknown as GroupChat;
    const members = [
      { id: 'a', name: '甲' },
      { id: 'b', name: '乙' },
    ] as AICharacter[];

    const presented = buildPresentedRelationshipLedger(chat, members);
    expect(presented).toHaveLength(1);
    expect(presented[0]?.key).toBe('a->b');
  });

  it('strips technical prefixes from evidence text', () => {
    const members = [
      { id: 'a', name: '甲' },
      { id: 'b', name: '乙' },
    ] as AICharacter[];
    const entry: RelationshipLedgerEntry = {
      pairKey: 'a->b',
      actorId: 'a',
      targetId: 'b',
      current: { warmth: 10, competence: 0, trust: 0, threat: 0 },
      trend: 'up',
      recentEvents: [{
        id: 'evt-1',
        kind: 'interaction',
        createdAt: 1,
        summary: 'a↔b：a 对 b 表示支持，relationship_delta 继续升温',
        actorIds: ['a'],
        targetIds: ['b'],
      }],
      lastUpdatedAt: 1,
    };

    const presented = buildPresentedRelationshipEntry(entry, members);
    expect(presented.evidence).toContain('甲：');
    expect(presented.evidence).toContain('甲 对 乙 表示支持');
    expect(presented.evidence).not.toContain('a↔b');
    expect(presented.evidence).not.toContain('relationship_delta');
  });

  it('renders user actor/target as 我 instead of raw id', () => {
    const members = [{ id: 'a', name: '甲' }] as AICharacter[];
    const entry: RelationshipLedgerEntry = {
      pairKey: 'a->user',
      actorId: 'a',
      targetId: 'user',
      current: { warmth: 10, competence: 0, trust: 4, threat: 0 },
      trend: 'up',
      recentEvents: [{
        id: 'evt-user',
        kind: 'interaction',
        createdAt: 1,
        summary: 'a 对 user 表示关心',
        actorIds: ['a'],
        targetIds: ['user'],
      }],
      lastUpdatedAt: 1,
    };

    const presented = buildPresentedRelationshipEntry(entry, members);
    expect(presented.actorName).toBe('甲');
    expect(presented.targetName).toBe('我');
    expect(presented.evidence).toContain('我');
    expect(presented.evidence).not.toContain('user');
  });
});
