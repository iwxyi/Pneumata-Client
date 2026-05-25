import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import { buildRelationshipDisplaySummary, buildRelationshipEvidenceText, isMeaningfulRelationshipLedgerEntry, normalizeRelationshipLedgerEntry, toRelationshipDisplayDelta } from './relationshipLedger';
import { sanitizeUserFacingText } from './displayTextSanitizer';

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

function resolveRelationshipName(id: string, members: AICharacter[]) {
  const member = members.find((item) => item.id === id);
  if (member?.name) return member.name;
  if (!id || isLikelyInternalId(id)) return '未知成员';
  return id;
}

export function buildPresentedRelationshipEntry(entry: RelationshipLedgerEntry, members: AICharacter[]): PresentedRelationshipEntry {
  const normalizedEntry = normalizeRelationshipLedgerEntry(entry);
  const latestEventActorId = normalizedEntry.recentEvents.at(-1)?.actorIds?.[0] || normalizedEntry.actorId;
  const actorName = resolveRelationshipName(normalizedEntry.actorId, members);
  const targetName = resolveRelationshipName(normalizedEntry.targetId, members);
  const speakerName = resolveRelationshipName(latestEventActorId, members);
  const delta = toRelationshipDisplayDelta(normalizedEntry.current);
  const evidenceText = sanitizeUserFacingText(cleanRelationshipText(buildRelationshipEvidenceText(normalizedEntry)), members);
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
    summary: buildRelationshipDisplaySummary(normalizedEntry),
    semanticSummary: normalizedEntry.derived?.semantic?.summary || '',
    evidence,
    hasMeaningfulDelta: isMeaningfulRelationshipLedgerEntry(normalizedEntry),
    score: computeScore(delta),
  };
}

export function buildPresentedRelationshipLedger(chat: GroupChat, members: AICharacter[]) {
  return (chat.relationshipLedger || [])
    .filter((entry) => !/^draft-\d+$/i.test(entry.actorId) && !/^draft-\d+$/i.test(entry.targetId))
    .map((entry) => buildPresentedRelationshipEntry(entry, members))
    .sort((a, b) => b.entry.lastUpdatedAt - a.entry.lastUpdatedAt);
}
