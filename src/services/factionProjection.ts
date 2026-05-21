import type { AICharacter } from '../types/character';
import { normalizeCharacterGroup } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';

export interface FactionProjection {
  factionId: string;
  actorId: string;
  declaredAffinity: number;
  behavioralAffinity: number;
  emotionalAffinity: number;
  strategicAffinity: number;
  suspicion: number;
  publicRole?: string;
  hiddenRole?: string;
  confidence: number;
  evidenceEventIds: string[];
  reasons: string[];
}

export interface FactionClusterProjection {
  factionId: string;
  label: string;
  memberIds: string[];
  averageAffinity: number;
  averageSuspicion: number;
  salience: number;
  evidenceEventIds: string[];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeAffinity(value: number) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function safeFactionId(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 48);
}

function getRelationshipPull(entry: RelationshipLedgerEntry) {
  const current = entry.current;
  return normalizeAffinity(((current.warmth || 0) + (current.trust || 0) - (current.threat || 0) * 0.65) / 120);
}

function getActorFactionFromScenario(chat: GroupChat, actorId: string) {
  return (chat.scenarioState?.roleAssignments || []).find((item) => item.actorId === actorId) || null;
}

function getActorDeclaredFaction(chat: GroupChat, character: AICharacter) {
  const scenarioAssignment = getActorFactionFromScenario(chat, character.id);
  if (scenarioAssignment?.factionId) {
    const label = chat.scenarioState?.factions?.find((item) => item.factionId === scenarioAssignment.factionId)?.label || scenarioAssignment.factionId;
    return { factionId: scenarioAssignment.factionId, label, roleId: scenarioAssignment.roleId, reason: 'scenario_role_assignment' };
  }
  const group = normalizeCharacterGroup(character.group);
  if (group) return { factionId: `group:${safeFactionId(group)}`, label: group, roleId: undefined, reason: 'character_group' };
  return null;
}

function getFactionMembers(chat: GroupChat, characters: AICharacter[], factionId: string) {
  return characters.filter((character) => getActorDeclaredFaction(chat, character)?.factionId === factionId);
}

function getRelationshipEntriesForActor(chat: GroupChat, actorId: string) {
  return (chat.relationshipLedger || []).filter((entry) => entry.actorId === actorId);
}

export function projectFactionAffiliations(params: {
  chat: GroupChat;
  characters: AICharacter[];
}): FactionProjection[] {
  return params.characters.flatMap((character) => {
    const declared = getActorDeclaredFaction(params.chat, character);
    if (!declared) return [];
    const members = getFactionMembers(params.chat, params.characters, declared.factionId).filter((member) => member.id !== character.id);
    const memberIds = new Set(members.map((member) => member.id));
    const entries = getRelationshipEntriesForActor(params.chat, character.id).filter((entry) => memberIds.has(entry.targetId));
    const relationshipPulls = entries.map(getRelationshipPull);
    const behavioralAffinity = relationshipPulls.length
      ? normalizeAffinity(relationshipPulls.reduce((sum, value) => sum + value, 0) / relationshipPulls.length)
      : 0;
    const emotional = character.emotionalState;
    const emotionalAffinity = emotional
      ? normalizeAffinity(((emotional.affection || 0) + (emotional.excitement || 0) * 0.35 - (emotional.irritation || 0) * 0.35 - (emotional.insecurity || 0) * 0.2) / 100)
      : 0;
    const suspicion = clamp01(entries.reduce((max, entry) => Math.max(max, (entry.current.threat || 0) / 100, Math.max(0, -(entry.current.trust || 0)) / 100), 0));
    const evidenceEventIds = entries.flatMap((entry) => entry.recentEvents.map((event) => event.id)).slice(-8);
    const confidence = clamp01(0.45 + (declared.reason === 'scenario_role_assignment' ? 0.35 : 0.18) + Math.min(0.18, entries.length * 0.06));
    return [{
      factionId: declared.factionId,
      actorId: character.id,
      declaredAffinity: 1,
      behavioralAffinity,
      emotionalAffinity,
      strategicAffinity: declared.reason === 'scenario_role_assignment' ? 0.8 : 0.35,
      suspicion,
      publicRole: declared.roleId,
      confidence,
      evidenceEventIds,
      reasons: [declared.reason, entries.length ? 'relationship_ledger' : 'no_relationship_evidence'],
    }];
  });
}

export function projectFactionClusters(params: {
  chat: GroupChat;
  characters: AICharacter[];
  affiliations?: FactionProjection[];
}): FactionClusterProjection[] {
  const affiliations = params.affiliations || projectFactionAffiliations(params);
  const labels = new Map<string, string>();
  (params.chat.scenarioState?.factions || []).forEach((item) => labels.set(item.factionId, item.label));
  params.characters.forEach((character) => {
    const declared = getActorDeclaredFaction(params.chat, character);
    if (declared) labels.set(declared.factionId, declared.label);
  });
  const byFaction = new Map<string, FactionProjection[]>();
  affiliations.forEach((item) => byFaction.set(item.factionId, [...(byFaction.get(item.factionId) || []), item]));
  return Array.from(byFaction.entries())
    .map(([factionId, items]) => {
      const averageAffinity = items.reduce((sum, item) => sum + item.declaredAffinity * 0.45 + item.behavioralAffinity * 0.35 + item.emotionalAffinity * 0.2, 0) / Math.max(1, items.length);
      const averageSuspicion = items.reduce((sum, item) => sum + item.suspicion, 0) / Math.max(1, items.length);
      const salience = clamp01(Math.min(1, items.length / 3) * 0.34 + Math.abs(averageAffinity) * 0.28 + averageSuspicion * 0.38);
      return {
        factionId,
        label: labels.get(factionId) || factionId,
        memberIds: items.map((item) => item.actorId),
        averageAffinity,
        averageSuspicion,
        salience,
        evidenceEventIds: items.flatMap((item) => item.evidenceEventIds).slice(-12),
      };
    })
    .filter((cluster) => cluster.memberIds.length >= 2 || cluster.averageSuspicion >= 0.35)
    .sort((a, b) => b.salience - a.salience);
}
