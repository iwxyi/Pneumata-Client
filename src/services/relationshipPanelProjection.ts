import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
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

export interface RelationshipPanelProjection {
  ledgerSections: RelationshipPanelLedgerSection[];
  fallbackSections: RelationshipPanelFallbackSection[];
  sectionKeys: string[];
}

function buildRelationshipMembers(chat: GroupChat, members: AICharacter[]) {
  const list: RelationshipDisplayMember[] = members.map((member) => ({ id: member.id, name: member.name }));
  if (chat.memberIds.includes('user') && !list.some((member) => member.id === 'user')) {
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
  const ledgerEntries = (chat.relationshipLedger || [])
    .filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId))
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

  const fallbackSections = members
    .filter((member) => !ledgerSections.some((section) => section.member.id === member.id))
    .map((member) => {
      const items = member.relationships
        .filter((relation) => !/^draft-\d+$/i.test(relation.characterId))
        .filter((relation) => relation.warmth !== 0 || relation.competence !== 0 || relation.trust !== 0 || relation.threat !== 0 || Boolean(relation.note?.trim()))
        .slice(0, 3)
        .map((relation) => {
          const target = memberById.get(relation.characterId);
          return {
            characterId: relation.characterId,
            targetName: target?.name || '未知角色',
            note: relation.note,
            relation: {
              warmth: relation.warmth,
              competence: relation.competence,
              trust: relation.trust,
              threat: relation.threat,
            },
          };
        });
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
    sectionKeys,
  };
}
