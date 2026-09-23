import type { AICharacter } from '../types/character';
import type { GroupChat, RoomRelationshipSharedFact } from '../types/chat';
import type { RelationshipAxes } from '../types/runtimeEvent';
import { isMeaningfulRelationshipLedgerEntry, normalizeRelationshipLedgerEntry, toRelationshipDisplayDelta } from './relationshipLedger';

export interface GroupRelationshipGraphNode {
  id: string;
  name: string;
  avatar?: string;
}

export interface GroupRelationshipGraphEdge {
  key: string;
  fromId: string;
  toId: string;
  axes: RelationshipAxes;
  baseline: RelationshipAxes;
  adjustment: RelationshipAxes;
  note?: string;
  source: 'room' | 'default' | 'structural';
}

export interface GroupRelationshipGraph {
  key: string;
  nodes: GroupRelationshipGraphNode[];
  edges: GroupRelationshipGraphEdge[];
}

export interface GroupRelationshipGraphProjection {
  graphs: GroupRelationshipGraph[];
  unconnectedMembers: GroupRelationshipGraphNode[];
  sharedFacts: RoomRelationshipSharedFact[];
}

function projectSharedFacts(chat: GroupChat, nodeIds: Set<string>): RoomRelationshipSharedFact[] {
  const explicitFacts = (chat.relationshipStructure?.sharedFacts || []).filter((fact) =>
    fact.memberIds.filter((id) => nodeIds.has(id)).length >= 2,
  );
  // Older rooms stored public facts, such as authority or shared affiliation,
  // on a directed structure edge. Keep those facts visible as public context.
  const legacyFacts = (chat.relationshipStructure?.edges || []).flatMap((edge): RoomRelationshipSharedFact[] => {
    if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) return [];
    return [{
      id: `legacy-shared-${edge.id}`,
      memberIds: [edge.fromId, edge.toId],
      kind: edge.kind,
      statement: edge.statement,
      confidence: edge.confidence,
      evidence: edge.evidence,
      updatedAt: edge.updatedAt,
    }];
  });
  const byKey = new Map<string, RoomRelationshipSharedFact>();
  [...explicitFacts, ...legacyFacts].forEach((fact) => {
    const memberIds = Array.from(new Set(fact.memberIds.filter((id) => nodeIds.has(id))).values()).sort();
    if (memberIds.length < 2) return;
    const key = `${memberIds.join('|')}:${fact.kind}:${fact.statement}`;
    if (!byKey.has(key)) byKey.set(key, { ...fact, memberIds });
  });
  return Array.from(byKey.values());
}

function emptyAxes(): RelationshipAxes {
  return { warmth: 0, competence: 0, trust: 0, threat: 0, attachment: 0, deference: 0 };
}

function hasRelationshipSignal(axes: RelationshipAxes, note?: string) {
  return Object.values(axes).some((value) => value !== 0) || Boolean(note?.trim());
}

function toDefaultAxes(relation: AICharacter['relationships'][number]): RelationshipAxes {
  return {
    warmth: relation.warmth || 0,
    competence: relation.competence || 0,
    trust: relation.trust || 0,
    threat: relation.threat || 0,
    attachment: relation.attachment || 0,
    deference: relation.deference || 0,
  };
}

function buildComponents(nodes: GroupRelationshipGraphNode[], edges: GroupRelationshipGraphEdge[]) {
  const adjacent = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  edges.forEach((edge) => {
    adjacent.get(edge.fromId)?.add(edge.toId);
    adjacent.get(edge.toId)?.add(edge.fromId);
  });
  const visited = new Set<string>();
  const components: string[][] = [];
  nodes.forEach((node) => {
    if (visited.has(node.id) || !adjacent.get(node.id)?.size) return;
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length) {
      const id = queue.shift()!;
      component.push(id);
      adjacent.get(id)?.forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        queue.push(next);
      });
    }
    components.push(component.sort());
  });
  return { components, connectedIds: visited };
}

export function projectGroupRelationshipGraphs(chat: GroupChat, members: AICharacter[]): GroupRelationshipGraphProjection {
  const memberIds = new Set(chat.memberIds.filter((id) => id !== 'user'));
  const nodes = members
    .filter((member) => memberIds.has(member.id) && !member.deletedAt)
    .map((member) => ({ id: member.id, name: member.name, avatar: member.avatar }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeByKey = new Map<string, GroupRelationshipGraphEdge>();
  const sharedFacts = projectSharedFacts(chat, nodeIds);

  (chat.relationshipLedger || []).forEach((rawEntry) => {
    const entry = normalizeRelationshipLedgerEntry(rawEntry);
    if (!nodeIds.has(entry.actorId) || !nodeIds.has(entry.targetId) || entry.actorId === entry.targetId) return;
    if (!isMeaningfulRelationshipLedgerEntry(entry)) return;
    edgeByKey.set(`${entry.actorId}->${entry.targetId}`, {
      key: `${entry.actorId}->${entry.targetId}`,
      fromId: entry.actorId,
      toId: entry.targetId,
      axes: toRelationshipDisplayDelta(entry.current),
      baseline: entry.baseline || entry.current,
      adjustment: entry.adjustment || emptyAxes(),
      note: entry.derived?.semantic?.summary || entry.recentEvents.at(-1)?.summary,
      source: 'room',
    });
  });

  members.forEach((member) => {
    if (!nodeIds.has(member.id)) return;
    member.relationships.forEach((relation) => {
      const key = `${member.id}->${relation.characterId}`;
      if (!nodeIds.has(relation.characterId) || edgeByKey.has(key)) return;
      const axes = toDefaultAxes(relation);
      if (!hasRelationshipSignal(axes, relation.note)) return;
      edgeByKey.set(key, {
        key,
        fromId: member.id,
        toId: relation.characterId,
        axes,
        baseline: axes,
        adjustment: emptyAxes(),
        note: relation.note,
        source: 'default',
      });
    });
  });

  sharedFacts.forEach((fact) => {
    const memberIds = fact.memberIds.filter((id) => nodeIds.has(id));
    if (memberIds.length < 2) return;
    memberIds.forEach((fromId, index) => memberIds.slice(index + 1).forEach((toId) => {
      const key = `${fromId}->${toId}`;
      if (edgeByKey.has(key) || edgeByKey.has(`${toId}->${fromId}`)) return;
      edgeByKey.set(key, {
        key,
        fromId,
        toId,
        axes: emptyAxes(),
        baseline: emptyAxes(),
        adjustment: emptyAxes(),
        source: 'structural',
      });
    }));
  });

  const edges = Array.from(edgeByKey.values());
  const { components, connectedIds } = buildComponents(nodes, edges);
  return {
    graphs: components.map((memberIds, index) => ({
      key: `relation-group-${index + 1}-${memberIds.join('-')}`,
      nodes: nodes.filter((node) => memberIds.includes(node.id)),
      edges: edges.filter((edge) => memberIds.includes(edge.fromId) && memberIds.includes(edge.toId)),
    })),
    unconnectedMembers: nodes.filter((node) => !connectedIds.has(node.id)),
    sharedFacts,
  };
}

export function describeGroupRelationshipEdge(edge: GroupRelationshipGraphEdge) {
  const note = edge.note?.replace(/\s+/g, ' ').trim();
  if (note) return note.length > 18 ? `${note.slice(0, 17)}…` : note;
  const { warmth, trust, threat, attachment, deference } = edge.axes;
  const labels = [
    attachment >= 12 ? '在意' : '',
    warmth >= 12 || trust >= 12 ? '亲近' : '',
    threat >= 12 || warmth <= -12 || trust <= -12 ? '戒备' : '',
    deference >= 12 ? '让位' : deference <= -12 ? '不让' : '',
  ].filter(Boolean);
  return labels.join('、') || '关系线';
}
