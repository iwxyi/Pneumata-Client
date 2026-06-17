import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import { reportUnresolvedDisplayEntity } from './diagnostics';
import { buildRelationshipDisplaySummary, buildRelationshipEvidenceText, isMeaningfulRelationshipLedgerEntry, normalizeRelationshipLedgerEntry, toRelationshipDisplayDelta } from './relationshipLedger';
import { sanitizeUserFacingText } from './displayTextSanitizer';

export interface RelationshipDisplayMember {
  id: string;
  name: string;
}

export interface PresentedRelationshipEntry {
  key: string;
  actorId: string;
  targetId: string;
  actorName: string;
  targetName: string;
  speakerName: string;
  entry: RelationshipLedgerEntry;
  delta: ReturnType<typeof toRelationshipDisplayDelta>;
  summary: string;
  semanticSummary: string;
  evidence: string;
  hasMeaningfulDelta: boolean;
  score: number;
}

function cleanRelationshipText(text: string) {
  return text
    .replace(/^[^：:]+[：:]/, '')
    .replace(/^[^↔]+↔[^：:]+[：:]/, '')
    .replace(/^[^·]+·\s*/, '')
    .replace(/亲近/g, '亲和')
    .replace(/尊重/g, '能力')
    .replace(/态度发生变化/g, '关系发生变化')
    .trim();
}

function computeScore(delta: ReturnType<typeof toRelationshipDisplayDelta>) {
  return (delta.warmth || 0) + (delta.competence || 0) + (delta.trust || 0) - (delta.threat || 0);
}

function isLikelyInternalId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    || /^[0-9a-f-]{18,}$/i.test(value)
    || /^draft-\d+$/i.test(value);
}

function resolveRelationshipName(id: string, members: RelationshipDisplayMember[]) {
  if (id === 'user') return '我';
  const member = members.find((item) => item.id === id);
  if (member?.name) return member.name;
  if (!id) return '未解析成员(空)';
  if (isLikelyInternalId(id)) {
    const fallback = `未解析成员(${id})`;
    reportUnresolvedDisplayEntity({
      id,
      kind: 'relationship-target',
      location: 'relationshipPresentation.resolveRelationshipName',
      fallback,
    });
    return fallback;
  }
  return id;
}

function ensureRelationshipDisplayMembers(members: RelationshipDisplayMember[]) {
  if (members.some((item) => item.id === 'user')) return members;
  return [...members, { id: 'user', name: '我' }];
}

export function buildPresentedRelationshipEntry(entry: RelationshipLedgerEntry, members: RelationshipDisplayMember[]): PresentedRelationshipEntry {
  const displayMembers = ensureRelationshipDisplayMembers(members);
  const normalizedEntry = normalizeRelationshipLedgerEntry(entry);
  const latestEventActorId = normalizedEntry.recentEvents.at(-1)?.actorIds?.[0] || normalizedEntry.actorId;
  const actorName = resolveRelationshipName(normalizedEntry.actorId, displayMembers);
  const targetName = resolveRelationshipName(normalizedEntry.targetId, displayMembers);
  const speakerName = resolveRelationshipName(latestEventActorId, displayMembers);
  const delta = toRelationshipDisplayDelta(normalizedEntry.current);
  const evidenceText = sanitizeUserFacingText(cleanRelationshipText(buildRelationshipEvidenceText(normalizedEntry)), displayMembers);
  const evidence = evidenceText ? `${speakerName || actorName}：${evidenceText}` : '';

  return {
    key: normalizedEntry.pairKey,
    actorId: normalizedEntry.actorId,
    targetId: normalizedEntry.targetId,
    actorName,
    targetName,
    speakerName,
    entry: normalizedEntry,
    delta,
      summary: sanitizeUserFacingText(buildRelationshipDisplaySummary(normalizedEntry), displayMembers),
      semanticSummary: sanitizeUserFacingText(normalizedEntry.derived?.semantic?.summary || '', displayMembers),
    evidence,
    hasMeaningfulDelta: isMeaningfulRelationshipLedgerEntry(normalizedEntry),
    score: computeScore(delta),
  };
}

export function buildPresentedRelationshipLedger(chat: GroupChat, members: RelationshipDisplayMember[]) {
  return (chat.relationshipLedger || [])
    .filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId))
    .map((entry) => buildPresentedRelationshipEntry(entry, members))
    .sort((a, b) => b.entry.lastUpdatedAt - a.entry.lastUpdatedAt);
}
