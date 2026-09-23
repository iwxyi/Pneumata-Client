import { describe, expect, it } from 'vitest';
import type { AICharacter } from '../types/character';
import { normalizeConversation } from '../types/chat';
import { projectGroupRelationshipGraphs } from './groupRelationshipGraph';

function member(id: string, relationships: AICharacter['relationships'] = []): AICharacter {
  return { id, name: id, avatar: '', relationships, deletedAt: null } as AICharacter;
}

function chat() {
  return normalizeConversation({
    id: 'group', type: 'group', mode: 'open_chat', modeConfig: {}, modeState: { phase: 'free' }, name: '群', topic: '', style: 'free', runtimeEvolutionIntensity: 'balanced', memberIds: ['a', 'b', 'c', 'd'], speed: 1, isActive: false, allowIntervention: true, topicSeed: '', governance: {}, dramaRules: {}, worldState: {}, directorControls: {}, createdAt: 1, updatedAt: 1, lastMessageAt: 1,
  });
}

describe('group relationship graph projection', () => {
  it('keeps unrelated members outside relationship graph components', () => {
    const projection = projectGroupRelationshipGraphs(chat(), [
      member('a', [{ characterId: 'b', warmth: 22, competence: 0, trust: 8, threat: 0 }]),
      member('b'),
      member('c', [{ characterId: 'd', warmth: -8, competence: 0, trust: -14, threat: 20 }]),
      member('d'),
    ]);
    expect(projection.graphs).toHaveLength(2);
    expect(projection.graphs.map((graph) => graph.nodes.map((node) => node.id).sort())).toEqual([['a', 'b'], ['c', 'd']]);
    expect(projection.unconnectedMembers).toEqual([]);
  });

  it('uses the room ledger over a default edge and preserves direction', () => {
    const room = normalizeConversation({
      ...chat(),
      relationshipLedger: [{ pairKey: 'a->b', actorId: 'a', targetId: 'b', current: { warmth: -18, competence: 0, trust: -12, threat: 24, attachment: 0, deference: 0 }, trend: 'down', recentEvents: [], lastUpdatedAt: 2 }],
    });
    const projection = projectGroupRelationshipGraphs(room, [
      member('a', [{ characterId: 'b', warmth: 30, competence: 0, trust: 30, threat: 0 }]),
      member('b'), member('c'), member('d'),
    ]);
    expect(projection.graphs[0]?.edges[0]).toMatchObject({ source: 'room', fromId: 'a', toId: 'b', axes: { warmth: -18, threat: 24 } });
    expect(projection.unconnectedMembers.map((node) => node.id)).toEqual(['c', 'd']);
  });

  it('adds model-inferred authority structure without fabricating an affect edge', () => {
    const room = normalizeConversation({
      ...chat(),
      relationshipStructure: {
        version: 1,
        updatedAt: 3,
        edges: [{ id: 'authority-a-b', fromId: 'a', toId: 'b', kind: 'authority', statement: '甲是乙的直属上司', confidence: 0.92, evidence: '角色身份明确', updatedAt: 3 }],
      },
    });
    const projection = projectGroupRelationshipGraphs(room, [member('a'), member('b'), member('c'), member('d')]);
    expect(projection.graphs[0]?.edges[0]).toMatchObject({
      source: 'structural',
      structuralFacts: [{ kind: 'authority', statement: '甲是乙的直属上司' }],
    });
    expect(projection.unconnectedMembers.map((node) => node.id)).toEqual(['c', 'd']);
  });

  it('projects shared structure facts without turning them into a directional attitude', () => {
    const room = normalizeConversation({
      ...chat(),
      relationshipStructure: {
        version: 1,
        updatedAt: 3,
        edges: [],
        sharedFacts: [{ id: 'siblings-a-b', memberIds: ['a', 'b'], kind: 'kinship', statement: '甲乙是结义兄弟', confidence: 0.92, evidence: '设定明确', updatedAt: 3 }],
      },
    });
    const projection = projectGroupRelationshipGraphs(room, [member('a'), member('b'), member('c'), member('d')]);
    expect(projection.graphs[0]?.edges[0]).toMatchObject({ sharedFacts: [{ kind: 'kinship', statement: '甲乙是结义兄弟' }], axes: { warmth: 0, trust: 0 } });
    expect(projection.unconnectedMembers.map((node) => node.id)).toEqual(['c', 'd']);
  });
});
