import { describe, expect, it } from 'vitest';
import { buildRecentExperienceChanges, getExperienceLensLabel } from './experienceChangePresentation';
import type { MemoryItem } from './memoryTypes';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';

function memory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: 'mem-1',
    scope: 'conversation',
    layer: 'episodic',
    kind: 'status_shift',
    ownerId: 'chat-1',
    text: '小灰灰把灰太狼的矛盾点说破了。',
    salience: 0.8,
    confidence: 0.9,
    recency: 1,
    reinforcementCount: 1,
    sourceEventIds: ['evt-1'],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function relationship(overrides: Partial<RelationshipLedgerEntry>): RelationshipLedgerEntry {
  return {
    pairKey: 'a->b',
    actorId: 'a',
    targetId: 'b',
    current: { warmth: 28, competence: 2, trust: 18, threat: 3 },
    derived: { semantic: { stage: '关系升温', labels: ['好感', '亲近'], summary: '关系升温：好感、亲近', intensity: 42 } },
    axisReasons: {},
    trend: 'up',
    recentEvents: [{ id: 'evt-2', kind: 'relationship_delta', createdAt: 200, summary: 'a 支持 b：我站你这边', actorIds: ['a'], targetIds: ['b'] }],
    lastUpdatedAt: 200,
    ...overrides,
  };
}

describe('experienceChangePresentation', () => {
  it('labels multi-lens memory source tags', () => {
    expect(getExperienceLensLabel('llm_memory_character_perspective')).toBe('主观理解');
    expect(getExperienceLensLabel('unknown')).toBeNull();
  });

  it('builds concise recent memory and relationship changes', () => {
    const chat = {
      layeredMemories: [memory({ sourceTag: 'llm_memory_objective_event', updatedAt: 100 })],
      relationshipLedger: [relationship({ lastUpdatedAt: 200 })],
    } as Pick<GroupChat, 'layeredMemories' | 'relationshipLedger'>;

    const changes = buildRecentExperienceChanges({
      chat,
      members: [{ id: 'a', name: '灰太狼' }, { id: 'b', name: '小灰灰' }] as never,
    });

    expect(changes).toHaveLength(2);
    expect(changes[0].title).toBe('灰太狼 → 小灰灰');
    expect(changes[0].chips).toContain('关系升温');
    expect(changes[0].text).toContain('灰太狼');
    expect(changes[1].chips).toContain('客观事件');
  });
});
