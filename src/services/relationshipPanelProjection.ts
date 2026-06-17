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
  };
}

export interface RelationshipPanelFallbackSection {
  member: RelationshipDisplayMember;
  sectionKey: string;
  items: RelationshipPanelFallbackItem[];
}

export interface RelationshipPanelDiagnosticItem {
  kind: 'unresolved-fallback-target';
  member: RelationshipDisplayMember;
  targetId: string;
  note?: string;
  relation: {
    warmth: number;
    competence: number;
    trust: number;
    threat: number;
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
  return isDirectUserRelationshipEntry(chat, entry) && isAiDirectPairRelationshipEntry(chat, entry);
}

function isFallbackRelationRelevantToPanel(chat: GroupChat, memberId: string, targetId: string) {
  if (chat.type === 'direct') return targetId === 'user';
  if (chat.type === 'ai_direct') {
    const memberIds = new Set(chat.memberIds || []);
    return memberIds.has(memberId) && memberIds.has(targetId) && memberId !== targetId;
  }
  return true;
}

function isDraftRelationshipId(id: string) {
  return /^draft-\d+$/i.test(id);
}

function buildUnresolvedMemberName(id: string) {
  return `未解析成员(${id})`;
}

function buildRelationshipMembers(chat: GroupChat, members: AICharacter[]) {
  const list: RelationshipDisplayMember[] = members.map((member) => ({ id: member.id, name: member.name }));
  const shouldIncludeUser = shouldIncludeUserInRelationshipPanel(chat);
  if (shouldIncludeUser && !list.some((member) => member.id === 'user')) {
    list.push({ id: 'user', name: '我' });
  }
  const extraIds = new Set<string>();
  (chat.relationshipLedger || [])
    .filter((entry) => isRelationshipEntryRelevantToPanel(chat, entry))
    .forEach((entry) => {
    if (!isDraftRelationshipId(entry.actorId)) extraIds.add(entry.actorId);
    if (!isDraftRelationshipId(entry.targetId)) extraIds.add(entry.targetId);
  });
  extraIds.forEach((id) => {
    if (list.some((member) => member.id === id)) return;
    list.push({ id, name: buildUnresolvedMemberName(id) });
    reportUnresolvedDisplayEntity({
      id,
      kind: 'relationship-target',
      location: 'relationshipPanelProjection.buildRelationshipMembers',
      fallback: buildUnresolvedMemberName(id),
    });
  });
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
  const ledgerEntries = (chat.relationshipLedger || [])
    .filter((entry) => !isDraftRelationshipId(entry.actorId) && !isDraftRelationshipId(entry.targetId))
    .filter((entry) => isRelationshipEntryRelevantToPanel(chat, entry))
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
  const diagnostics: RelationshipPanelDiagnosticItem[] = [];

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
