import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';

export const DISTILLATION_VERSION = 'v1';
const CHAT_DISTILLATION_MIN_ITEMS = 4;
const CHARACTER_DISTILLATION_MIN_ITEMS = 3;
const CHAT_DISTILLATION_TURN_GAP = 8;
const CHARACTER_DISTILLATION_TURN_GAP = 6;

export interface MemoryDistillationDebugInfo {
  ownerType: 'chat' | 'character';
  ownerId: string;
  triggered: boolean;
  reason: string;
  eligibleCount: number;
  newEvidenceCount: number;
  candidateTexts: string[];
}

function activeItems(items: MemoryItem[]) {
  return items.filter((item) => !item.archivedAt);
}

function recentEligibleItems(items: MemoryItem[]) {
  return activeItems(items)
    .filter((item) => item.layer === 'working' || item.layer === 'episodic')
    .slice(-8);
}

function latestDistilledAt(items: MemoryItem[]) {
  return Math.max(0, ...items.map((item) => item.distilledAt || 0));
}

function latestDistilledSourceIds(items: MemoryItem[]) {
  return new Set(items.filter((item) => item.origin === 'distilled').flatMap((item) => item.distilledFromIds || []));
}

function summarizeItems(items: MemoryItem[], max = 3) {
  return items.slice(0, max).map((item) => item.text).join(' / ').slice(0, 140);
}

function buildSubjectIds(items: MemoryItem[]) {
  return Array.from(new Set(items.flatMap((item) => item.subjectIds || []))).slice(0, 4);
}

function uniqueEvidenceCount(items: MemoryItem[]) {
  return Array.from(new Set(items.flatMap((item) => item.sourceEventIds || []))).length;
}

function hasEnoughNewEvidence(items: MemoryItem[]) {
  return uniqueEvidenceCount(items) >= 2;
}

function buildDebugInfo(ownerType: 'chat' | 'character', ownerId: string, triggered: boolean, reason: string, items: MemoryItem[], candidates: MemoryCandidate[] = []): MemoryDistillationDebugInfo {
  return {
    ownerType,
    ownerId,
    triggered,
    reason,
    eligibleCount: items.length,
    newEvidenceCount: uniqueEvidenceCount(items),
    candidateTexts: candidates.map((item) => item.text),
  };
}

function formatMemoryDistillationReason(reason: string) {
  const labels: Record<string, string> = {
    distilled: '已完成本地蒸馏',
    llm_distilled: '已完成 LLM 蒸馏',
    below_threshold: '暂未达到蒸馏阈值',
    cooldown: '仍在蒸馏冷却期',
    already_distilled_recently: '这批证据最近已蒸馏过',
    insufficient_new_evidence: '新增证据还不够',
    no_candidates: '本轮没有形成稳定候选',
  };
  return labels[reason] || reason;
}

export function summarizeMemoryDistillationDebugInfo(info: MemoryDistillationDebugInfo) {
  return info.candidateTexts.length ? info.candidateTexts.join(' / ') : formatMemoryDistillationReason(info.reason);
}

export function explainMemoryDistillationMerge() {
  return 'same bucket memories reinforce/update; different buckets coexist in layeredMemories';
}

export function describeMemoryDistillationStrategy() {
  return 'distillation uses recent working/episodic evidence and writes distilled long_term candidates back into layeredMemories';
}

export function getMemoryDistillationConsoleHint() {
  return 'Check [memory-distillation] console logs and memory_distillation runtime events.';
}

export function buildMemoryDistillationRuntimePayload(info: MemoryDistillationDebugInfo) {
  return {
    ownerType: info.ownerType,
    ownerLabel: info.ownerType === 'chat' ? '群聊记忆' : '角色记忆',
    ownerId: info.ownerId,
    reason: info.reason,
    reasonLabel: formatMemoryDistillationReason(info.reason),
    eligibleCount: info.eligibleCount,
    newEvidenceCount: info.newEvidenceCount,
    candidateTexts: info.candidateTexts,
    mergeMode: 'bucket_reinforce',
    mergeModeLabel: '同 bucket 强化合并',
    note: explainMemoryDistillationMerge(),
    strategy: describeMemoryDistillationStrategy(),
    usesLLM: false,
  };
}

export function buildMemoryDistillationEventTitle(info: MemoryDistillationDebugInfo) {
  return info.ownerType === 'chat' ? '群聊核心记忆蒸馏' : '角色核心记忆蒸馏';
}

export function buildMemoryDistillationEventSummary(info: MemoryDistillationDebugInfo) {
  return summarizeMemoryDistillationDebugInfo(info);
}

export function createMemoryDistillationRuntimeEvent(info: MemoryDistillationDebugInfo) {
  return {
    eventType: 'memory_distillation',
    title: buildMemoryDistillationEventTitle(info),
    summary: buildMemoryDistillationEventSummary(info),
    metrics: buildMemoryDistillationRuntimePayload(info),
    eventClass: 'artifact' as const,
    visibilityScope: 'public' as const,
  };
}

export function shouldEmitMemoryDistillationEvent(info: MemoryDistillationDebugInfo) {
  return info.triggered && info.candidateTexts.length > 0;
}

export function shouldDistillChatMemories(chat: GroupChat, turnCount: number) {
  const items = chat.layeredMemories || [];
  const eligible = recentEligibleItems(items);
  if (eligible.length < CHAT_DISTILLATION_MIN_ITEMS) return false;
  if (turnCount < CHAT_DISTILLATION_TURN_GAP) return false;
  const latest = latestDistilledAt(items);
  const enoughGap = !latest || eligible.every((item) => item.updatedAt > latest);
  return enoughGap && hasEnoughNewEvidence(eligible);
}

export function shouldDistillCharacterMemories(character: AICharacter, turnCount: number) {
  const items = character.layeredMemories || [];
  const eligible = recentEligibleItems(items);
  if (eligible.length < CHARACTER_DISTILLATION_MIN_ITEMS) return false;
  if (turnCount < CHARACTER_DISTILLATION_TURN_GAP) return false;
  const latest = latestDistilledAt(items);
  const enoughGap = !latest || eligible.every((item) => item.updatedAt > latest);
  return enoughGap && hasEnoughNewEvidence(eligible);
}

export function distillChatMemoryCandidates(chat: GroupChat): MemoryCandidate[] {
  const items = recentEligibleItems(chat.layeredMemories || []);
  const recentDistilledIds = latestDistilledSourceIds(chat.layeredMemories || []);
  const undistilled = items.filter((item) => !recentDistilledIds.has(item.id));
  const source = undistilled.length >= CHAT_DISTILLATION_MIN_ITEMS ? undistilled : items;
  if (source.length < CHAT_DISTILLATION_MIN_ITEMS) return [];
  const topConflict = source.find((item) => item.kind === 'conflict');
  const topRelationship = source.find((item) => item.scope === 'relationship');
  const candidates: MemoryCandidate[] = [];

  if (topConflict) {
    candidates.push({
      scope: 'conversation',
      layerHint: 'long_term',
      kind: 'conflict',
      ownerId: chat.id,
      subjectIds: buildSubjectIds(source),
      text: `群聊长期矛盾主轴：${summarizeItems([topConflict, ...source.filter((item) => item !== topConflict)], 3)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: Date.now(),
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.82, recurrence: 0.74, impact: 0.78, specificity: 0.76, durability: 0.86 },
    });
  }

  if (topRelationship) {
    candidates.push({
      scope: topRelationship.scope,
      layerHint: 'long_term',
      kind: topRelationship.kind === 'bond' || topRelationship.kind === 'resentment' ? topRelationship.kind : 'status_shift',
      ownerId: chat.id,
      subjectIds: topRelationship.subjectIds || buildSubjectIds(source),
      text: `群聊稳定关系趋势：${summarizeItems([topRelationship, ...source.filter((item) => item !== topRelationship)], 3)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: Date.now(),
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.8, recurrence: 0.7, impact: 0.72, specificity: 0.74, durability: 0.84 },
    });
  }

  return candidates.slice(0, 2);
}

export function distillCharacterMemoryCandidates(character: AICharacter): MemoryCandidate[] {
  const items = recentEligibleItems(character.layeredMemories || []);
  const recentDistilledIds = latestDistilledSourceIds(character.layeredMemories || []);
  const undistilled = items.filter((item) => !recentDistilledIds.has(item.id));
  const source = undistilled.length >= CHARACTER_DISTILLATION_MIN_ITEMS ? undistilled : items;
  if (source.length < CHARACTER_DISTILLATION_MIN_ITEMS) return [];
  const relationshipItem = source.find((item) => item.scope === 'relationship');
  const selfItem = source.find((item) => item.scope === 'character_self');
  const candidates: MemoryCandidate[] = [];

  if (relationshipItem) {
    candidates.push({
      scope: 'relationship',
      layerHint: 'long_term',
      kind: relationshipItem.kind === 'bond' || relationshipItem.kind === 'resentment' ? relationshipItem.kind : 'bias',
      ownerId: character.id,
      subjectIds: relationshipItem.subjectIds || buildSubjectIds(source),
      text: `对人长期判断：${summarizeItems([relationshipItem, ...source.filter((item) => item !== relationshipItem)], 3)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: Date.now(),
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.84, recurrence: 0.72, impact: 0.76, specificity: 0.8, durability: 0.88 },
    });
  }

  if (selfItem) {
    candidates.push({
      scope: 'character_self',
      layerHint: 'long_term',
      kind: selfItem.kind === 'obsession' || selfItem.kind === 'taboo' ? selfItem.kind : 'bias',
      ownerId: character.id,
      subjectIds: [character.id],
      text: `自我稳定倾向：${summarizeItems([selfItem, ...source.filter((item) => item !== selfItem)], 3)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: Date.now(),
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.82, recurrence: 0.68, impact: 0.72, specificity: 0.78, durability: 0.9 },
    });
  }

  return candidates.slice(0, 2);
}

export function debugChatMemoryDistillation(chat: GroupChat, turnCount: number) {
  const items = recentEligibleItems(chat.layeredMemories || []);
  if (items.length < CHAT_DISTILLATION_MIN_ITEMS) return buildDebugInfo('chat', chat.id, false, 'below_threshold', items);
  if (turnCount < CHAT_DISTILLATION_TURN_GAP) return buildDebugInfo('chat', chat.id, false, 'cooldown', items);
  const latest = latestDistilledAt(chat.layeredMemories || []);
  const enoughGap = !latest || items.every((item) => item.updatedAt > latest);
  if (!enoughGap) return buildDebugInfo('chat', chat.id, false, 'already_distilled_recently', items);
  if (!hasEnoughNewEvidence(items)) return buildDebugInfo('chat', chat.id, false, 'insufficient_new_evidence', items);
  const candidates = distillChatMemoryCandidates(chat);
  return buildDebugInfo('chat', chat.id, Boolean(candidates.length), candidates.length ? 'distilled' : 'no_candidates', items, candidates);
}

export function debugCharacterMemoryDistillation(character: AICharacter, turnCount: number) {
  const items = recentEligibleItems(character.layeredMemories || []);
  if (items.length < CHARACTER_DISTILLATION_MIN_ITEMS) return buildDebugInfo('character', character.id, false, 'below_threshold', items);
  if (turnCount < CHARACTER_DISTILLATION_TURN_GAP) return buildDebugInfo('character', character.id, false, 'cooldown', items);
  const latest = latestDistilledAt(character.layeredMemories || []);
  const enoughGap = !latest || items.every((item) => item.updatedAt > latest);
  if (!enoughGap) return buildDebugInfo('character', character.id, false, 'already_distilled_recently', items);
  if (!hasEnoughNewEvidence(items)) return buildDebugInfo('character', character.id, false, 'insufficient_new_evidence', items);
  const candidates = distillCharacterMemoryCandidates(character);
  return buildDebugInfo('character', character.id, Boolean(candidates.length), candidates.length ? 'distilled' : 'no_candidates', items, candidates);
}

export function logMemoryDistillationTriggered(info: MemoryDistillationDebugInfo) {
  if (info.triggered) console.info('[memory-distillation]', info);
}
