import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { RelationshipLedgerEntry } from '../types/runtimeEvent';
import { buildRelationshipDisplaySummary, buildRelationshipEvidenceText, isMeaningfulRelationshipLedgerEntry, normalizeRelationshipLedgerEntry, toRelationshipDisplayDelta } from './relationshipLedger';

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

export function buildPresentedRelationshipEntry(entry: RelationshipLedgerEntry, members: AICharacter[]): PresentedRelationshipEntry {
  const normalizedEntry = normalizeRelationshipLedgerEntry(entry);
  const actor = members.find((member) => member.id === normalizedEntry.actorId);
  const target = members.find((member) => member.id === normalizedEntry.targetId);
  const latestEventActorId = normalizedEntry.recentEvents.at(-1)?.actorIds?.[0] || normalizedEntry.actorId;
  const speaker = members.find((member) => member.id === latestEventActorId);
  const delta = toRelationshipDisplayDelta(normalizedEntry.current);
  const evidenceText = cleanRelationshipText(buildRelationshipEvidenceText(normalizedEntry));
  const evidence = evidenceText ? `${speaker?.name || actor?.name || normalizedEntry.actorId}：${evidenceText}` : '';

  return {
    key: normalizedEntry.pairKey,
    actorId: normalizedEntry.actorId,
    targetId: normalizedEntry.targetId,
    actorName: actor?.name || normalizedEntry.actorId,
    targetName: target?.name || normalizedEntry.targetId,
    speakerName: speaker?.name || actor?.name || normalizedEntry.actorId,
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
