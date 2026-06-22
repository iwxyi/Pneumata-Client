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
    expect(getExperienceLensLabel('llm_memory_character_perspective', 'en')).toBe('Character perspective');
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
    expect(changes[0].chips.some((chip) => /信任|威胁|亲和|能力/.test(chip))).toBe(false);
    expect(changes[1].chips).toContain('客观事件');
  });

  it('redacts private relationship facts in recent experience changes', () => {
    const chat = {
      layeredMemories: [],
      relationshipLedger: [relationship({
        derived: {
          semantic: {
            stage: '互相信任',
            labels: ['默契', '秘密暗号'],
            summary: '互相信任：共同秘密是雨夜便利店暗号，不能公开说',
            intensity: 62,
          },
        },
        recentEvents: [{
          id: 'evt-secret',
          kind: 'relationship_delta',
          createdAt: 210,
          summary: '共同秘密是雨夜便利店暗号，不能公开说',
        }],
        lastUpdatedAt: 210,
      })],
    } as Pick<GroupChat, 'layeredMemories' | 'relationshipLedger'>;

    const changes = buildRecentExperienceChanges({
      chat,
      members: [{ id: 'a', name: '灰太狼' }, { id: 'b', name: '小灰灰' }] as never,
    });

    expect(changes[0].text).toContain('互相信任');
    expect(changes[0].text).toContain('默契');
    expect(changes[0].text).not.toContain('雨夜便利店');
    expect(changes[0].text).not.toContain('不能公开说');
    expect(changes[0].chips).not.toContain('秘密暗号');
  });

  it('uses memory summary and masks unknown UUIDs without corrupting short member ids', () => {
    const chat = {
      layeredMemories: [memory({
        text: 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67 对 a 的原始证据',
        summary: 'a 记住了这次冲突的结果',
        sourceTag: 'llm_memory_objective_event',
      })],
      relationshipLedger: [],
    } as Pick<GroupChat, 'layeredMemories' | 'relationshipLedger'>;

    const changes = buildRecentExperienceChanges({
      chat,
      members: [{ id: 'a', name: '灰太狼' }] as never,
    });

    expect(changes[0].text).toBe('灰太狼 记住了这次冲突的结果');
    expect(changes[0].text).not.toContain('e055aa1d');
  });

  it('projects known UUID members without leaking replace offsets', () => {
    const actorId = '3c78729f-e52d-4dde-b27f-01a949960bb8b';
    const targetId = '8b3d7266-c0c7-4ceb-8dc2-45126f3f2321';
    const chat = {
      layeredMemories: [memory({
        text: `${actorId} 记得 ${targetId} 上次帮过忙`,
        sourceTag: 'llm_memory_relationship_imprint',
        updatedAt: 300,
      })],
      relationshipLedger: [relationship({
        pairKey: `${actorId}->${targetId}`,
        actorId,
        targetId,
        recentEvents: [{ id: 'evt-uuid', kind: 'relationship_delta', createdAt: 310, summary: `${actorId} 支持 ${targetId}`, actorIds: [actorId], targetIds: [targetId] }],
        lastUpdatedAt: 310,
      })],
    } as Pick<GroupChat, 'layeredMemories' | 'relationshipLedger'>;

    const changes = buildRecentExperienceChanges({
      chat,
      members: [{ id: actorId, name: '喜羊羊' }, { id: targetId, name: '沸羊羊' }] as never,
    });

    expect(changes[0].title).toBe('喜羊羊 → 沸羊羊');
    expect(changes.map((item) => `${item.title} ${item.text}`).join(' / ')).toContain('喜羊羊');
    expect(changes.map((item) => `${item.title} ${item.text}`).join(' / ')).toContain('沸羊羊');
    expect(changes.map((item) => `${item.title} ${item.text}`).join(' / ')).not.toContain('0喜羊羊');
    expect(changes.map((item) => `${item.title} ${item.text}`).join(' / ')).not.toContain(actorId);
    expect(changes.map((item) => `${item.title} ${item.text}`).join(' / ')).not.toContain(targetId);
  });

  it('does not show raw runtime parameter changes as recent memory changes', () => {
    const chat = {
      layeredMemories: [
        memory({ id: 'room', scope: 'system_runtime', layer: 'working', sourceTag: 'room_shift', text: '房间态势更新：热度 100' }),
        memory({ id: 'relation', sourceTag: 'relationship_delta', text: '喜羊羊 触发关系变化：信任+3' }),
        memory({ id: 'distilled', sourceTag: 'relationship_delta', origin: 'distilled', layer: 'long_term', text: '喜羊羊和沸羊羊的关系裂痕已经稳定影响群聊。' }),
      ],
      relationshipLedger: [],
    } as Pick<GroupChat, 'layeredMemories' | 'relationshipLedger'>;

    const changes = buildRecentExperienceChanges({
      chat,
      members: [{ id: 'a', name: '灰太狼' }, { id: 'b', name: '小灰灰' }] as never,
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].text).toContain('关系裂痕');
  });

  it('sanitizes relationship semantic chips to avoid raw ids and payload traces', () => {
    const uuid = 'e055aa1d-88d4-4e96-abd2-1b35a3d56f67';
    const chat = {
      layeredMemories: [],
      relationshipLedger: [relationship({
        derived: {
          semantic: {
            stage: `${uuid} {"eventType":"room_state_snapshot_v2"}`,
            labels: ['relationship_delta', `${uuid} 的关系标记`],
            summary: '关系升温：好感、亲近',
            intensity: 42,
          },
        },
      })],
    } as Pick<GroupChat, 'layeredMemories' | 'relationshipLedger'>;

    const changes = buildRecentExperienceChanges({
      chat,
      members: [{ id: 'a', name: '灰太狼' }, { id: 'b', name: '小灰灰' }] as never,
    });
    const chips = changes[0]?.chips.join(' / ') || '';
    expect(chips).not.toContain(uuid);
    expect(chips).not.toContain('eventType');
    expect(chips).toContain('关系变化');
  });
});
