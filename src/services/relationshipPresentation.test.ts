import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import { buildPresentedRelationshipEntry } from './relationshipPresentation';

const uuidA = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
const uuidB = '3c78729f-e52d-4dde-b27f-01a949960bb8';

describe('relationshipPresentation', () => {
  it('does not expose internal ids as relationship names or evidence', () => {
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
    expect(presented.targetName).toBe('未知成员');
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
});
