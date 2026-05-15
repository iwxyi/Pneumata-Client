import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';

const LLM_DISTILLATION_VERSION = 'llm-v2';
const LLM_CHAT_MIN_ITEMS = 12;
const LLM_CHARACTER_MIN_ITEMS = 8;
const LLM_CHAT_MIN_EVENT_EVIDENCE = 18;
const LLM_CHARACTER_MIN_EVENT_EVIDENCE = 10;
const LLM_CHAT_MIN_NEW_ITEMS = 12;
const LLM_CHARACTER_MIN_NEW_ITEMS = 8;
const LLM_CHAT_MIN_NEW_SUBJECTS = 4;
const LLM_CHARACTER_MIN_NEW_SUBJECTS = 2;
const LLM_CHAT_MIN_NEW_EVENT_EVIDENCE = 10;
const LLM_CHARACTER_MIN_NEW_EVENT_EVIDENCE = 6;
const LLM_TRACKED_SOURCE_EVENT_LIMIT = 32;
const LLM_ALLOWED_SOURCE_TAGS = new Set(['interaction', 'relationship_delta', 'private_thread_effect', 'private_thread_summary']);
const LLM_ALLOWED_LAYERS = new Set<MemoryItem['layer']>(['working', 'episodic']);
const LLM_ALLOWED_SCOPES = new Set<MemoryItem['scope']>(['relationship', 'thread']);
const LLM_ALLOWED_KINDS = new Set<MemoryItem['kind']>(['bond', 'resentment', 'thread_effect']);
const LLM_MAX_SOURCE_ITEMS = 18;

interface LlmDistilledItem {
  scope: MemoryCandidate['scope'];
  kind: MemoryCandidate['kind'];
  subjectIds?: string[];
  text: string;
  confidence?: number;
}

interface LlmDistillationResult {
  items: LlmDistilledItem[];
}

function isEligibleItem(item: MemoryItem) {
  return !item.archivedAt
    && LLM_ALLOWED_LAYERS.has(item.layer)
    && LLM_ALLOWED_SCOPES.has(item.scope)
    && LLM_ALLOWED_KINDS.has(item.kind)
    && LLM_ALLOWED_SOURCE_TAGS.has(item.sourceTag || '');
}

function eligibleItems(items: MemoryItem[]) {
  return items.filter(isEligibleItem);
}

function latestLlmDistilledItem(items: MemoryItem[]) {
  return items
    .filter((item) => item.origin === 'distilled' && item.distillationVersion === LLM_DISTILLATION_VERSION)
    .sort((left, right) => (right.distilledAt || 0) - (left.distilledAt || 0))[0] || null;
}

function latestLlmDistilledAt(items: MemoryItem[]) {
  return latestLlmDistilledItem(items)?.distilledAt || 0;
}

function latestLlmDistilledEventIds(items: MemoryItem[]) {
  return new Set(latestLlmDistilledItem(items)?.sourceEventIds || []);
}

function buildSubjectKey(item: MemoryItem) {
  return (item.subjectIds || []).filter(Boolean).sort().join('::');
}

function countDistinctSubjects(items: MemoryItem[]) {
  return new Set(items.map(buildSubjectKey).filter(Boolean)).size;
}

function countDistinctEventEvidence(items: MemoryItem[]) {
  return new Set(items.flatMap((item) => item.sourceEventIds || []).filter(Boolean)).size;
}

function countNewItemsSince(items: MemoryItem[], latest: number) {
  if (!latest) return items.length;
  return items.filter((item) => item.updatedAt > latest).length;
}

function newItemsSince(items: MemoryItem[], latest: number) {
  if (!latest) return items;
  return items.filter((item) => item.updatedAt > latest);
}

function hasNovelEventEvidence(item: MemoryItem, seenEventIds: Set<string>) {
  return (item.sourceEventIds || []).some((id) => id && !seenEventIds.has(id));
}

function countNewEventEvidenceSince(items: MemoryItem[], seenEventIds: Set<string>) {
  return new Set(
    items
      .flatMap((item) => item.sourceEventIds || [])
      .filter((id): id is string => Boolean(id) && !seenEventIds.has(id))
  ).size;
}

function collectTrackedSourceEventIds(source: MemoryItem[]) {
  return Array.from(
    new Set(source.flatMap((entry) => entry.sourceEventIds || []).filter(Boolean))
  ).slice(-LLM_TRACKED_SOURCE_EVENT_LIMIT);
}

function buildRecentSource(items: MemoryItem[], latest: number, seenEventIds: Set<string>) {
  const source = newItemsSince(eligibleItems(items), latest)
    .filter((item) => !seenEventIds.size || hasNovelEventEvidence(item, seenEventIds));
  return source.slice(-LLM_MAX_SOURCE_ITEMS);
}

function hasEnoughSourceDiversity(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return countDistinctSubjects(items) >= (ownerType === 'chat' ? LLM_CHAT_MIN_NEW_SUBJECTS : LLM_CHARACTER_MIN_NEW_SUBJECTS);
}

function hasEnoughSourceEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return countDistinctEventEvidence(items) >= (ownerType === 'chat' ? LLM_CHAT_MIN_EVENT_EVIDENCE : LLM_CHARACTER_MIN_EVENT_EVIDENCE);
}

function hasEnoughSourceItems(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return items.length >= (ownerType === 'chat' ? LLM_CHAT_MIN_ITEMS : LLM_CHARACTER_MIN_ITEMS);
}

function hasEnoughNewItems(items: MemoryItem[], latest: number, ownerType: 'chat' | 'character') {
  return countNewItemsSince(items, latest) >= (ownerType === 'chat' ? LLM_CHAT_MIN_NEW_ITEMS : LLM_CHARACTER_MIN_NEW_ITEMS);
}

function hasEnoughNewEventEvidence(items: MemoryItem[], seenEventIds: Set<string>, ownerType: 'chat' | 'character') {
  return countNewEventEvidenceSince(items, seenEventIds) >= (ownerType === 'chat' ? LLM_CHAT_MIN_NEW_EVENT_EVIDENCE : LLM_CHARACTER_MIN_NEW_EVENT_EVIDENCE);
}

function buildDistillationSource(owner: { layeredMemories?: MemoryItem[] }, ownerType: 'chat' | 'character') {
  const items = owner.layeredMemories || [];
  const latest = latestLlmDistilledAt(items);
  const seenEventIds = latestLlmDistilledEventIds(items);
  const source = buildRecentSource(items, latest, seenEventIds);
  if (!hasEnoughSourceItems(source, ownerType)) return [];
  if (!hasEnoughSourceEvidence(source, ownerType)) return [];
  if (!hasEnoughSourceDiversity(source, ownerType)) return [];
  if (!hasEnoughNewItems(eligibleItems(items), latest, ownerType)) return [];
  if (!hasEnoughNewEventEvidence(source, seenEventIds, ownerType)) return [];
  return source;
}

function buildEvidenceBlock(items: MemoryItem[]) {
  return items.map((item, index) => `${index + 1}. [${item.scope}/${item.layer}/${item.kind}] ${item.text}`).join('\n');
}

function normalizeScope(value: unknown): MemoryCandidate['scope'] {
  const allowed: MemoryCandidate['scope'][] = ['conversation', 'character_self', 'relationship', 'thread', 'system_runtime'];
  return allowed.includes(value as MemoryCandidate['scope']) ? value as MemoryCandidate['scope'] : 'relationship';
}

function normalizeKind(value: unknown): MemoryCandidate['kind'] {
  const allowed: MemoryCandidate['kind'][] = ['decision', 'conflict', 'bond', 'resentment', 'status_shift', 'trait_evidence', 'bias', 'taboo', 'obsession', 'artifact', 'thread_effect'];
  return allowed.includes(value as MemoryCandidate['kind']) ? value as MemoryCandidate['kind'] : 'bias';
}

function parseResult(raw: string): LlmDistillationResult {
  const parsed = JSON.parse(raw) as { items?: Array<Record<string, unknown>> };
  return {
    items: (parsed.items || []).map((item) => ({
      scope: normalizeScope(item.scope),
      kind: normalizeKind(item.kind),
      subjectIds: Array.isArray(item.subjectIds) ? item.subjectIds.filter((id): id is string => typeof id === 'string') : undefined,
      text: typeof item.text === 'string' ? item.text.trim() : '',
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.78,
    })).filter((item) => item.text),
  };
}

function toCandidate(ownerId: string, source: MemoryItem[], item: LlmDistilledItem): MemoryCandidate {
  return {
    scope: item.scope,
    layerHint: 'long_term',
    kind: item.kind,
    ownerId,
    subjectIds: item.subjectIds,
    text: item.text,
    sourceEventIds: collectTrackedSourceEventIds(source),
    sourceTag: 'llm_memory_distillation',
    origin: 'distilled',
    distilledFromIds: source.map((entry) => entry.id),
    distilledAt: Date.now(),
    distillationVersion: LLM_DISTILLATION_VERSION,
    scoreBreakdown: {
      stability: 0.9,
      recurrence: 0.78,
      impact: 0.82,
      specificity: 0.84,
      durability: 0.94,
    },
  };
}

export function buildLlmDistillationSource(owner: { layeredMemories?: MemoryItem[] }) {
  return eligibleItems(owner.layeredMemories || []).slice(-LLM_MAX_SOURCE_ITEMS);
}

export function debugLlmChatDistillation(chat: GroupChat) {
  const source = buildDistillationSource(chat, 'chat');
  return source.length
    ? { triggered: true, reason: 'ready', eligibleCount: source.length, evidenceCount: countDistinctEventEvidence(source) }
    : { triggered: false, reason: 'below_threshold', eligibleCount: 0, evidenceCount: 0 };
}

export function debugLlmCharacterDistillation(character: AICharacter) {
  const source = buildDistillationSource(character, 'character');
  return source.length
    ? { triggered: true, reason: 'ready', eligibleCount: source.length, evidenceCount: countDistinctEventEvidence(source) }
    : { triggered: false, reason: 'below_threshold', eligibleCount: 0, evidenceCount: 0 };
}

export function formatLlmDistillationReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    llm_distilled: '已完成 LLM 蒸馏',
    below_threshold: 'LLM 蒸馏证据不足',
  };
  return labels[reason] || reason;
}

export function shouldRunLlmChatDistillation(chat: GroupChat, _turnCount: number) {
  return buildDistillationSource(chat, 'chat').length > 0;
}

export function shouldRunLlmCharacterDistillation(character: AICharacter, _turnCount: number) {
  return buildDistillationSource(character, 'character').length > 0;
}

export async function distillChatMemoriesWithLlm(api: APIConfig, chat: GroupChat): Promise<MemoryCandidate[]> {
  const source = buildDistillationSource(chat, 'chat');
  if (!source.length) return [];
  const systemPrompt = `你是一个群体长期记忆蒸馏器。\n只在最近证据已经跨越多个互动对象、多个事件、并形成稳定群体结构时，才提炼 1 条长期记忆。\n不要复述最近几轮争吵，不要输出阶段性总结，不要把同一主线换个说法再写一遍。\n如果证据仍然只是同一段争执的局部延续，返回空数组。\n只输出 JSON：{"items":[{"scope":"conversation|relationship","kind":"conflict|bond|resentment|status_shift|decision","subjectIds":["..."],"text":"...","confidence":0.0}]}。`;
  const raw = await generateJsonResponse(api, systemPrompt, [
    { role: 'user', content: `群聊：${chat.name}\n主题：${chat.topic || '未设置'}\n最近高门槛证据：\n${buildEvidenceBlock(source)}` },
  ]);
  const result = parseResult(raw);
  return result.items.slice(0, 1).map((item) => toCandidate(chat.id, source, item));
}

export async function distillCharacterMemoriesWithLlm(api: APIConfig, character: AICharacter): Promise<MemoryCandidate[]> {
  const source = buildDistillationSource(character, 'character');
  if (!source.length) return [];
  const systemPrompt = `你是一个角色长期记忆蒸馏器。\n只在最近证据已经显示出稳定的人际判断或长期偏向时，才提炼 1 条长期记忆。\n不要把最近几句互呛或单轮情绪波动写成长期记忆。\n如果证据只是同一轮互动的余波，返回空数组。\n只输出 JSON：{"items":[{"scope":"character_self|relationship","kind":"bias|bond|resentment|taboo|obsession|trait_evidence","subjectIds":["..."],"text":"...","confidence":0.0}]}。`;
  const raw = await generateJsonResponse(api, systemPrompt, [
    { role: 'user', content: `角色：${character.name}\n最近高门槛证据：\n${buildEvidenceBlock(source)}` },
  ]);
  const result = parseResult(raw);
  return result.items.slice(0, 1).map((item) => toCandidate(character.id, source, item));
}
