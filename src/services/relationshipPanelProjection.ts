import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import { reportUnresolvedDisplayEntity } from './diagnostics';
import { isMeaningfulRelationshipLedgerEntry, toRelationshipDisplayDelta } from './relationshipLedger';
import type { RelationshipDisplayMember } from './relationshipPresentation';

export interface RelationshipPanelLedgerSection {
  member: RelationshipDisplayMember;
  sectionKey: string;
  items: RelationshipLedgerEntry[];
}

export interface RelationshipPanelFallbackItem {
  characterId: string;
  targetName: string;
  note?: string;
  relation: {
    warmth: number;
    competence: number;
    trust: number;
    threat: number;
    attachment: number;
    deference: number;
  };
}

export interface RelationshipPanelFallbackSection {
  member: RelationshipDisplayMember;
  sectionKey: string;
  items: RelationshipPanelFallbackItem[];
}

export interface RelationshipPanelDiagnosticItem {
  kind: 'unresolved-fallback-target' | 'unresolved-ledger-member';
  member: RelationshipDisplayMember;
  targetId: string;
  note?: string;
  relation: {
    warmth: number;
    competence: number;
    trust: number;
    threat: number;
    attachment: number;
    deference: number;
  };
}

export interface RelationshipPanelProjection {
  ledgerSections: RelationshipPanelLedgerSection[];
  fallbackSections: RelationshipPanelFallbackSection[];
  diagnostics: RelationshipPanelDiagnosticItem[];
  sectionKeys: string[];
}

function shouldIncludeUserInRelationshipPanel(chat: GroupChat) {
  return chat.type === 'direct' || chat.memberIds.includes('user');
}

function buildCurrentRelationshipIdSet(chat: GroupChat) {
  const ids = new Set((chat.memberIds || []).filter((id) => typeof id === 'string' && id));
  if (shouldIncludeUserInRelationshipPanel(chat)) ids.add('user');
  return ids;
}

function isDirectUserRelationshipEntry(chat: GroupChat, entry: RelationshipLedgerEntry) {
  if (chat.type !== 'direct') return true;
  const memberIds = new Set(chat.memberIds || []);
  return ((memberIds.has(entry.actorId) && entry.targetId === 'user') || (entry.actorId === 'user' && memberIds.has(entry.targetId)));
}

function isAiDirectPairRelationshipEntry(chat: GroupChat, entry: RelationshipLedgerEntry) {
  if (chat.type !== 'ai_direct') return true;
  const memberIds = new Set(chat.memberIds || []);
  return memberIds.has(entry.actorId) && memberIds.has(entry.targetId) && entry.actorId !== entry.targetId;
}

function isRelationshipEntryRelevantToPanel(chat: GroupChat, entry: RelationshipLedgerEntry) {
  if (!isDirectUserRelationshipEntry(chat, entry) || !isAiDirectPairRelationshipEntry(chat, entry)) return false;
  if (chat.type === 'group') {
    const currentIds = buildCurrentRelationshipIdSet(chat);
    return currentIds.has(entry.actorId) && currentIds.has(entry.targetId) && entry.actorId !== entry.targetId;
  }
  return true;
}

function isFallbackRelationRelevantToPanel(chat: GroupChat, memberId: string, targetId: string) {
  if (chat.type === 'direct') return targetId === 'user';
  if (chat.type === 'ai_direct') {
    const memberIds = new Set(chat.memberIds || []);
    return memberIds.has(memberId) && memberIds.has(targetId) && memberId !== targetId;
  }
  const memberIds = buildCurrentRelationshipIdSet(chat);
  return memberIds.has(memberId) && memberIds.has(targetId) && memberId !== targetId;
}

function isDraftRelationshipId(id: string) {
  return /^draft-\d+$/i.test(id);
}

function buildUnresolvedMemberName(id: string) {
  return `未解析成员(${id})`;
}

function buildRelationshipMembers(chat: GroupChat, members: AICharacter[]) {
  const currentIds = buildCurrentRelationshipIdSet(chat);
  const list: RelationshipDisplayMember[] = members
    .filter((member) => currentIds.has(member.id))
    .map((member) => ({ id: member.id, name: member.name }));
  const shouldIncludeUser = shouldIncludeUserInRelationshipPanel(chat);
  if (shouldIncludeUser && !list.some((member) => member.id === 'user')) {
    list.push({ id: 'user', name: '我' });
  }
  return list;
}

function relationshipScore(entry: RelationshipLedgerEntry) {
  const delta = toRelationshipDisplayDelta(entry.current);
  return Math.abs((delta.warmth || 0) + (delta.competence || 0) + (delta.trust || 0) - (delta.threat || 0));
}

function buildRelationshipSectionKey(prefix: 'forward' | 'reverse', memberId: string) {
  return `${prefix}-${memberId}`;
}

function buildFallbackSectionKey(prefix: 'forward' | 'reverse', memberId: string) {
  return `fallback-${prefix}-${memberId}`;
}

export function projectRelationshipPanelData(chat: GroupChat, members: AICharacter[], reverseLedger: boolean): RelationshipPanelProjection {
  const prefix = reverseLedger ? 'reverse' : 'forward';
  const relationshipMembers = buildRelationshipMembers(chat, members);
  const memberById = new Map(relationshipMembers.map((member) => [member.id, member] as const));
  const authoredPairs = new Set(
    members.flatMap((member) => member.relationships
      .filter((relation) => memberById.has(member.id) && memberById.has(relation.characterId))
      .map((relation) => `${member.id}->${relation.characterId}`)),
  );
  const diagnostics: RelationshipPanelDiagnosticItem[] = [];
  const ledgerEntries = (chat.relationshipLedger || [])
    .filter((entry) => !isDraftRelationshipId(entry.actorId) && !isDraftRelationshipId(entry.targetId))
    .filter((entry) => isRelationshipEntryRelevantToPanel(chat, entry))
    // Character relationships are the global source of truth. A room ledger
    // entry is only a compatibility fallback when that authored direction is
    // genuinely absent.
    .filter((entry) => !authoredPairs.has(`${entry.actorId}->${entry.targetId}`))
    .filter((entry) => {
      const actor = memberById.get(entry.actorId);
      const target = memberById.get(entry.targetId);
      if (actor && target) return true;
      const unresolvedId = actor ? entry.targetId : entry.actorId;
      reportUnresolvedDisplayEntity({
        id: unresolvedId,
        kind: 'relationship-target',
        location: 'relationshipPanelProjection.ledgerMember',
        fallback: buildUnresolvedMemberName(unresolvedId),
        extra: { pairKey: entry.pairKey },
      });
      diagnostics.push({
        kind: 'unresolved-ledger-member',
        member: actor || target || { id: entry.actorId, name: buildUnresolvedMemberName(entry.actorId) },
        targetId: unresolvedId,
        note: entry.derived?.semantic?.summary || entry.recentEvents?.at(-1)?.summary,
        relation: {
          warmth: entry.current.warmth,
          competence: entry.current.competence,
          trust: entry.current.trust,
          threat: entry.current.threat,
          attachment: entry.current.attachment || 0,
          deference: entry.current.deference || 0,
        },
      });
      return false;
    })
    .filter(isMeaningfulRelationshipLedgerEntry)
    .slice()
    .sort((a, b) => {
      const scoreDiff = relationshipScore(b) - relationshipScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.lastUpdatedAt - a.lastUpdatedAt;
    });

  const ledgerSections = relationshipMembers
    .map((member) => ({
      member,
      sectionKey: buildRelationshipSectionKey(prefix, member.id),
      items: ledgerEntries.filter((entry) => (reverseLedger ? entry.targetId === member.id : entry.actorId === member.id)).slice(0, 8),
    }))
    .filter((section) => section.items.length > 0);
  const coveredFallbackPairs = new Set(ledgerEntries.map((entry) => `${entry.actorId}->${entry.targetId}`));

  if (chat.type === 'direct') {
    return {
      ledgerSections,
      fallbackSections: [],
      diagnostics: [],
      sectionKeys: ledgerSections.map((section) => section.sectionKey),
    };
  }

  const fallbackSections = members
    .map((member) => {
      const displayMember = memberById.get(member.id) || { id: member.id, name: member.name };
      const items = member.relationships
        .filter((relation) => !isDraftRelationshipId(relation.characterId))
        .filter((relation) => isFallbackRelationRelevantToPanel(chat, member.id, relation.characterId))
        .filter((relation) => !coveredFallbackPairs.has(`${member.id}->${relation.characterId}`))
        .filter((relation) => relation.warmth !== 0 || relation.competence !== 0 || relation.trust !== 0 || relation.threat !== 0 || Boolean(relation.note?.trim()))
        .slice(0, 3)
        .map((relation): RelationshipPanelFallbackItem | null => {
          const target = memberById.get(relation.characterId);
          if (!target) {
            reportUnresolvedDisplayEntity({
              id: relation.characterId,
              kind: 'relationship-target',
              location: 'relationshipPanelProjection.fallbackTarget',
              fallback: buildUnresolvedMemberName(relation.characterId),
              extra: { memberId: member.id },
            });
            diagnostics.push({
              kind: 'unresolved-fallback-target',
              member: displayMember,
              targetId: relation.characterId,
              note: relation.note,
              relation: {
                warmth: relation.warmth,
                competence: relation.competence,
                trust: relation.trust,
                threat: relation.threat,
                attachment: relation.attachment || 0,
                deference: relation.deference || 0,
              },
            });
            return null;
          }
          return {
            characterId: relation.characterId,
            targetName: target.name,
            note: relation.note,
            relation: {
              warmth: relation.warmth,
              competence: relation.competence,
              trust: relation.trust,
              threat: relation.threat,
              attachment: relation.attachment || 0,
              deference: relation.deference || 0,
            },
          };
        })
        .filter((item): item is RelationshipPanelFallbackItem => Boolean(item));
      return {
        member,
        sectionKey: buildFallbackSectionKey(prefix, member.id),
        items,
      };
    })
    .filter((section) => section.items.length > 0);

  const sectionKeys = [
    ...ledgerSections.map((section) => section.sectionKey),
    ...fallbackSections.map((section) => section.sectionKey),
  ];

  return {
    ledgerSections,
    fallbackSections,
    diagnostics,
    sectionKeys,
  };
}
