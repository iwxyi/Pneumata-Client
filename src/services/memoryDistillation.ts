import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import { sanitizeMemoryTexts } from './distillationText';
import { sanitizeUserFacingText, type DisplayTextMember } from './displayTextSanitizer';
import { logDeveloperDiagnostic } from './developerDiagnostics';
import { isRuntimeEvidenceMemory } from './memoryPresentation';

export const DISTILLATION_VERSION = 'v1';
const CHAT_DISTILLATION_MIN_ITEMS = 6;
const CHARACTER_DISTILLATION_MIN_ITEMS = 4;
const CHAT_DISTILLATION_TURN_GAP = 16;
const CHARACTER_DISTILLATION_TURN_GAP = 10;
const CHAT_MIN_EVENT_EVIDENCE = 6;
const CHARACTER_MIN_EVENT_EVIDENCE = 4;
const CHAT_MIN_RELATIONSHIP_ITEMS = 4;
const CHARACTER_MIN_RELATIONSHIP_ITEMS = 3;
const MAX_LOCAL_DISTILLATION_WINDOW = 10;
const ALLOWED_SOURCE_TAGS = new Set(['interaction', 'relationship_delta', 'private_thread_effect', 'private_thread_summary']);
const ALLOWED_LAYERS = new Set<MemoryItem['layer']>(['working', 'episodic']);
const ALLOWED_SCOPES = new Set<MemoryItem['scope']>(['relationship', 'thread']);
const ALLOWED_KINDS = new Set<MemoryItem['kind']>(['bond', 'resentment', 'thread_effect']);

function countDistinctEventEvidence(items: MemoryItem[]) {
  return Array.from(new Set(items.flatMap((item) => item.sourceEventIds || []))).length;
}

function countDistinctRelationshipSubjects(items: MemoryItem[]) {
  return new Set(
    items
      .map((item) => (item.subjectIds || []).filter(Boolean).sort().join('::'))
      .filter(Boolean)
  ).size;
}

function hasEnoughEventEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return countDistinctEventEvidence(items) >= (ownerType === 'chat' ? CHAT_MIN_EVENT_EVIDENCE : CHARACTER_MIN_EVENT_EVIDENCE);
}

function hasEnoughRelationshipCoverage(items: MemoryItem[], ownerType: 'chat' | 'character') {
  const minItems = ownerType === 'chat' ? CHAT_MIN_RELATIONSHIP_ITEMS : CHARACTER_MIN_RELATIONSHIP_ITEMS;
  return items.length >= minItems && countDistinctRelationshipSubjects(items) >= 2;
}

function isEligibleSourceTag(item: MemoryItem) {
  return ALLOWED_SOURCE_TAGS.has(item.sourceTag || '');
}

function isEligibleLayer(item: MemoryItem) {
  return ALLOWED_LAYERS.has(item.layer);
}

function isEligibleScope(item: MemoryItem) {
  return ALLOWED_SCOPES.has(item.scope);
}

function isEligibleKind(item: MemoryItem) {
  return ALLOWED_KINDS.has(item.kind);
}

function isLocalDistillationSource(item: MemoryItem) {
  return !isRuntimeEvidenceMemory(item) && isEligibleLayer(item) && isEligibleScope(item) && isEligibleKind(item) && isEligibleSourceTag(item);
}

function buildLocalDistillationWindow(items: MemoryItem[]) {
  return activeItems(items)
    .filter(isLocalDistillationSource)
    .slice(-MAX_LOCAL_DISTILLATION_WINDOW);
}

function summarizeLocalDistillationPolicy() {
  return {
    chatMinItems: CHAT_DISTILLATION_MIN_ITEMS,
    characterMinItems: CHARACTER_DISTILLATION_MIN_ITEMS,
    chatGap: CHAT_DISTILLATION_TURN_GAP,
    characterGap: CHARACTER_DISTILLATION_TURN_GAP,
    chatEventEvidence: CHAT_MIN_EVENT_EVIDENCE,
    characterEventEvidence: CHARACTER_MIN_EVENT_EVIDENCE,
  };
}

export function getLocalDistillationPolicy() {
  return summarizeLocalDistillationPolicy();
}

export interface MemoryDistillationDebugInfo {
  ownerType: 'chat' | 'character';
  ownerId: string;
  ownerName?: string;
  triggered: boolean;
  reason: string;
  eligibleCount: number;
  newEvidenceCount: number;
  candidateTexts: string[];
}

function localizeDistillationCandidateTexts(info: MemoryDistillationDebugInfo, participants: DisplayTextMember[]) {
  const nameMap = new Map(participants.map((item) => [item.id, item.name]));
  return {
    ...info,
    ownerName: info.ownerName || nameMap.get(info.ownerId),
    candidateTexts: sanitizeMemoryTexts(info.candidateTexts.map((text) => sanitizeUserFacingText(text, participants))),
  };
}

export function localizeDistillationEventInfo(info: MemoryDistillationDebugInfo, participants: DisplayTextMember[]) {
  return localizeDistillationCandidateTexts(info, participants);
}

function activeItems(items: MemoryItem[]) {
  return items.filter((item) => !item.archivedAt);
}

function recentEligibleItems(items: MemoryItem[]) {
  return buildLocalDistillationWindow(items);
}

function latestDistilledAt(items: MemoryItem[]) {
  return Math.max(0, ...items.map((item) => item.distilledAt || 0));
}

function latestDistilledSourceIds(items: MemoryItem[]) {
  return new Set(items.filter((item) => item.origin === 'distilled').flatMap((item) => item.distilledFromIds || []));
}

function summarizeItems(items: MemoryItem[], max = 3, participants: DisplayTextMember[] = []) {
  return sanitizeMemoryTexts(items.slice(0, max).map((item) => sanitizeUserFacingText(item.text, participants))).join(' / ').slice(0, 140);
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

function filterRelationshipEvidence(items: MemoryItem[]) {
  return items.filter((item) => item.scope === 'relationship');
}

function selectDistillationSource(items: MemoryItem[], minItems: number) {
  const recentDistilledIds = latestDistilledSourceIds(items);
  const relationshipItems = filterRelationshipEvidence(items);
  const undistilled = relationshipItems.filter((item) => !recentDistilledIds.has(item.id));
  if (undistilled.length >= minItems) return undistilled;
  if (relationshipItems.length >= minItems) return relationshipItems;
  return [];
}

function formatMemoryDistillationReason(reason: string) {
  const labels: Record<string, string> = {
    distilled: '已完成本地蒸馏',
    llm_distilled: '已完成 LLM 蒸馏',
    below_threshold: '暂未达到蒸馏阈值',
    cooldown: '仍在蒸馏冷却期',
    already_distilled_recently: '这批证据最近已蒸馏过',
    insufficient_new_evidence: '新增证据还不够',
    insufficient_relationship_coverage: '关系证据覆盖还不够',
    insufficient_event_evidence: '一手事件证据还不够',
    no_candidates: '本轮没有形成稳定候选',
  };
  return labels[reason] || reason;
}

function summarizeMemoryDistillationDebugInfo(info: MemoryDistillationDebugInfo) {
  const candidateTexts = sanitizeMemoryTexts(info.candidateTexts);
  return candidateTexts.length ? candidateTexts.join(' / ') : formatMemoryDistillationReason(info.reason);
}

export function explainMemoryDistillationMerge() {
  return '同类记忆会强化或修订，主题不同的记忆会并存于多层记忆中';
}

export function describeMemoryDistillationStrategy() {
  return '记忆蒸馏会读取近期工作记忆和片段记忆，把稳定沉淀写回长期记忆';
}

export function buildMemoryDistillationRuntimePayload(info: MemoryDistillationDebugInfo) {
  const candidateTexts = sanitizeMemoryTexts(info.candidateTexts);
  const source = info.reason === 'llm_distilled' ? 'llm' : 'local';
  const sourceLabel = source === 'llm' ? 'LLM 蒸馏' : '本地蒸馏';
  const ownerLabel = info.ownerType === 'chat'
    ? (info.ownerName ? `群聊：${info.ownerName}` : '群聊记忆')
    : (info.ownerName ? `角色：${info.ownerName}` : '角色记忆');
  return {
    ownerType: info.ownerType,
    ownerLabel,
    ownerId: info.ownerId,
    ownerName: info.ownerName,
    reason: info.reason,
    reasonLabel: formatMemoryDistillationReason(info.reason),
    eligibleCount: info.eligibleCount,
    newEvidenceCount: info.newEvidenceCount,
    candidateTexts,
    mergeMode: 'reinforce_same_bucket',
    mergeModeLabel: '同类证据强化合并',
    note: explainMemoryDistillationMerge(),
    strategy: describeMemoryDistillationStrategy(),
    usesLLM: info.reason === 'llm_distilled',
    source,
    sourceLabel,
  };
}

function buildMemoryDistillationEventTitle(info: MemoryDistillationDebugInfo) {
  const sourceLabel = info.reason === 'llm_distilled' ? 'LLM 蒸馏' : '本地蒸馏';
  const owner = info.ownerType === 'chat' ? (info.ownerName || '群聊') : (info.ownerName || '角色');
  return `${sourceLabel} · ${owner}`;
}

function buildMemoryDistillationEventSummary(info: MemoryDistillationDebugInfo) {
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
  const eligible = selectDistillationSource(recentEligibleItems(items), CHAT_DISTILLATION_MIN_ITEMS);
  if (eligible.length < CHAT_DISTILLATION_MIN_ITEMS) return false;
  if (turnCount < CHAT_DISTILLATION_TURN_GAP) return false;
  if (!hasEnoughRelationshipCoverage(eligible, 'chat')) return false;
  if (!hasEnoughEventEvidence(eligible, 'chat')) return false;
  const latest = latestDistilledAt(items);
  const enoughGap = !latest || eligible.every((item) => item.updatedAt > latest);
  return enoughGap && hasEnoughNewEvidence(eligible);
}

export function shouldDistillCharacterMemories(character: AICharacter, turnCount: number) {
  const items = character.layeredMemories || [];
  const eligible = selectDistillationSource(recentEligibleItems(items), CHARACTER_DISTILLATION_MIN_ITEMS);
  if (eligible.length < CHARACTER_DISTILLATION_MIN_ITEMS) return false;
  if (turnCount < CHARACTER_DISTILLATION_TURN_GAP) return false;
  if (!hasEnoughRelationshipCoverage(eligible, 'character')) return false;
  if (!hasEnoughEventEvidence(eligible, 'character')) return false;
  const latest = latestDistilledAt(items);
  const enoughGap = !latest || eligible.every((item) => item.updatedAt > latest);
  return enoughGap && hasEnoughNewEvidence(eligible);
}

export function distillChatMemoryCandidates(
  chat: GroupChat,
  participants: DisplayTextMember[] = [],
  options?: { now?: number },
): MemoryCandidate[] {
  const now = typeof options?.now === 'number' && Number.isFinite(options.now) ? Math.round(options.now) : Date.now();
  const source = selectDistillationSource(recentEligibleItems(chat.layeredMemories || []), CHAT_DISTILLATION_MIN_ITEMS);
  if (source.length < CHAT_DISTILLATION_MIN_ITEMS) return [];
  const topBond = source.find((item) => item.kind === 'bond');
  const topResentment = source.find((item) => item.kind === 'resentment');
  const topRelationship = topBond || topResentment || source[0] || null;
  const candidates: MemoryCandidate[] = [];

  if (topRelationship) {
    candidates.push({
      scope: 'relationship',
      layerHint: 'long_term',
      kind: topRelationship.kind === 'bond' || topRelationship.kind === 'resentment' ? topRelationship.kind : 'status_shift',
      ownerId: chat.id,
      subjectIds: topRelationship.subjectIds || buildSubjectIds(source),
      text: `群聊稳定关系趋势：${summarizeItems([topRelationship, ...source.filter((item) => item !== topRelationship)], 3, participants)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: now,
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.8, recurrence: 0.7, impact: 0.72, specificity: 0.74, durability: 0.84 },
    });
  }

  if (topBond && topResentment && topBond !== topResentment) {
    candidates.push({
      scope: 'conversation',
      layerHint: 'long_term',
      kind: 'conflict',
      ownerId: chat.id,
      subjectIds: buildSubjectIds(source),
      text: `群聊长期拉扯主轴：${summarizeItems([topResentment, topBond, ...source.filter((item) => item !== topResentment && item !== topBond)], 3, participants)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: now,
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.82, recurrence: 0.74, impact: 0.78, specificity: 0.76, durability: 0.86 },
    });
  }

  return candidates.slice(0, 2);
}

export function distillCharacterMemoryCandidates(
  character: AICharacter,
  participants: DisplayTextMember[] = [],
  options?: { now?: number },
): MemoryCandidate[] {
  const now = typeof options?.now === 'number' && Number.isFinite(options.now) ? Math.round(options.now) : Date.now();
  const source = selectDistillationSource(recentEligibleItems(character.layeredMemories || []), CHARACTER_DISTILLATION_MIN_ITEMS);
  if (source.length < CHARACTER_DISTILLATION_MIN_ITEMS) return [];
  const relationshipItem = source[0] || null;
  const candidates: MemoryCandidate[] = [];

  if (relationshipItem) {
    candidates.push({
      scope: 'relationship',
      layerHint: 'long_term',
      kind: relationshipItem.kind === 'bond' || relationshipItem.kind === 'resentment' ? relationshipItem.kind : 'bias',
      ownerId: character.id,
      subjectIds: relationshipItem.subjectIds || buildSubjectIds(source),
      text: `对人长期判断：${summarizeItems([relationshipItem, ...source.filter((item) => item !== relationshipItem)], 3, participants)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: now,
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.84, recurrence: 0.72, impact: 0.76, specificity: 0.8, durability: 0.88 },
    });
  }

  return candidates.slice(0, 1);
}

export function debugChatMemoryDistillation(chat: GroupChat, turnCount: number, participants: DisplayTextMember[] = []) {
  const items = selectDistillationSource(recentEligibleItems(chat.layeredMemories || []), CHAT_DISTILLATION_MIN_ITEMS);
  const withName = (info: MemoryDistillationDebugInfo) => ({ ...info, ownerName: chat.name });
  if (items.length < CHAT_DISTILLATION_MIN_ITEMS) return withName(buildDebugInfo('chat', chat.id, false, 'below_threshold', items));
  if (turnCount < CHAT_DISTILLATION_TURN_GAP) return withName(buildDebugInfo('chat', chat.id, false, 'cooldown', items));
  if (!hasEnoughRelationshipCoverage(items, 'chat')) return withName(buildDebugInfo('chat', chat.id, false, 'insufficient_relationship_coverage', items));
  if (!hasEnoughEventEvidence(items, 'chat')) return withName(buildDebugInfo('chat', chat.id, false, 'insufficient_event_evidence', items));
  const latest = latestDistilledAt(chat.layeredMemories || []);
  const enoughGap = !latest || items.every((item) => item.updatedAt > latest);
  if (!enoughGap) return withName(buildDebugInfo('chat', chat.id, false, 'already_distilled_recently', items));
  if (!hasEnoughNewEvidence(items)) return withName(buildDebugInfo('chat', chat.id, false, 'insufficient_new_evidence', items));
  const candidates = distillChatMemoryCandidates(chat, participants);
  return withName(buildDebugInfo('chat', chat.id, Boolean(candidates.length), candidates.length ? 'distilled' : 'no_candidates', items, candidates));
}

export function debugCharacterMemoryDistillation(character: AICharacter, turnCount: number, participants: DisplayTextMember[] = []) {
  const items = selectDistillationSource(recentEligibleItems(character.layeredMemories || []), CHARACTER_DISTILLATION_MIN_ITEMS);
  const withName = (info: MemoryDistillationDebugInfo) => ({ ...info, ownerName: character.name });
  if (items.length < CHARACTER_DISTILLATION_MIN_ITEMS) return withName(buildDebugInfo('character', character.id, false, 'below_threshold', items));
  if (turnCount < CHARACTER_DISTILLATION_TURN_GAP) return withName(buildDebugInfo('character', character.id, false, 'cooldown', items));
  if (!hasEnoughRelationshipCoverage(items, 'character')) return withName(buildDebugInfo('character', character.id, false, 'insufficient_relationship_coverage', items));
  if (!hasEnoughEventEvidence(items, 'character')) return withName(buildDebugInfo('character', character.id, false, 'insufficient_event_evidence', items));
  const latest = latestDistilledAt(character.layeredMemories || []);
  const enoughGap = !latest || items.every((item) => item.updatedAt > latest);
  if (!enoughGap) return withName(buildDebugInfo('character', character.id, false, 'already_distilled_recently', items));
  if (!hasEnoughNewEvidence(items)) return withName(buildDebugInfo('character', character.id, false, 'insufficient_new_evidence', items));
  const candidates = distillCharacterMemoryCandidates(character, participants);
  return withName(buildDebugInfo('character', character.id, Boolean(candidates.length), candidates.length ? 'distilled' : 'no_candidates', items, candidates));
}

export function logMemoryDistillationTriggered(info: MemoryDistillationDebugInfo) {
  if (!info.triggered) return;
  if (!(globalThis as { __PNEUMATA_DEBUG_MEMORY_DISTILLATION__?: boolean }).__PNEUMATA_DEBUG_MEMORY_DISTILLATION__) return;
  logDeveloperDiagnostic('memory-distillation', {
    ...info,
    candidateTexts: sanitizeMemoryTexts(info.candidateTexts || []).map((text) => text.slice(0, 120)),
  }, 'info');
}
