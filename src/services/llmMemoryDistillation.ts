import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { APIConfig } from '../types/settings';
import { generateJsonResponse } from './aiClient';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import {
  buildCharacterMemoryAnalysisPrompt,
  buildChatMemoryAnalysisPrompt,
  buildMemoryAnalysisEvidenceBlock,
  collectMemoryAnalysisEvidenceText,
  collectTrackedMemoryAnalysisSourceEventIds,
  LLM_MEMORY_ANALYSIS_ALLOWED_KINDS,
  LLM_MEMORY_ANALYSIS_ALLOWED_LAYERS,
  LLM_MEMORY_ANALYSIS_ALLOWED_SCOPES,
  LLM_MEMORY_ANALYSIS_ALLOWED_SOURCE_TAGS,
  LLM_MEMORY_ANALYSIS_LIMITS,
  LLM_MEMORY_ANALYSIS_MAX_SOURCE_ITEMS,
  LLM_MEMORY_ANALYSIS_VERSION,
  parseLlmMemoryAnalysisResult,
  type LlmAnalyzedMemoryItem,
} from './memoryAnalysisStrategy';

function isEligibleItem(item: MemoryItem) {
  return !item.archivedAt
    && LLM_MEMORY_ANALYSIS_ALLOWED_LAYERS.has(item.layer)
    && LLM_MEMORY_ANALYSIS_ALLOWED_SCOPES.has(item.scope)
    && LLM_MEMORY_ANALYSIS_ALLOWED_KINDS.has(item.kind)
    && LLM_MEMORY_ANALYSIS_ALLOWED_SOURCE_TAGS.has(item.sourceTag || '');
}

function eligibleItems(items: MemoryItem[]) {
  return items.filter(isEligibleItem);
}

function latestLlmDistilledItem(items: MemoryItem[]) {
  return items
    .filter((item) => item.origin === 'distilled' && item.distillationVersion === LLM_MEMORY_ANALYSIS_VERSION)
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

function buildRecentSource(items: MemoryItem[], latest: number, seenEventIds: Set<string>) {
  const source = newItemsSince(eligibleItems(items), latest)
    .filter((item) => !seenEventIds.size || hasNovelEventEvidence(item, seenEventIds));
  return source.slice(-LLM_MEMORY_ANALYSIS_MAX_SOURCE_ITEMS);
}

function hasEnoughSourceDiversity(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return countDistinctSubjects(items) >= LLM_MEMORY_ANALYSIS_LIMITS[ownerType].minNewSubjects;
}

function hasEnoughSourceEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return countDistinctEventEvidence(items) >= LLM_MEMORY_ANALYSIS_LIMITS[ownerType].minEventEvidence;
}

function hasEnoughSourceItems(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return items.length >= LLM_MEMORY_ANALYSIS_LIMITS[ownerType].minItems;
}

function hasEnoughNewItems(items: MemoryItem[], latest: number, ownerType: 'chat' | 'character') {
  return countNewItemsSince(items, latest) >= LLM_MEMORY_ANALYSIS_LIMITS[ownerType].minNewItems;
}

function hasEnoughNewEventEvidence(items: MemoryItem[], seenEventIds: Set<string>, ownerType: 'chat' | 'character') {
  return countNewEventEvidenceSince(items, seenEventIds) >= LLM_MEMORY_ANALYSIS_LIMITS[ownerType].minNewEventEvidence;
}

function buildSourceTag(item: LlmAnalyzedMemoryItem) {
  return item.lens ? `llm_memory_${item.lens}` : 'llm_memory_distillation';
}

function buildCharacterAnalysisContext(character: AICharacter) {
  const personality = character.personality
    ? Object.entries(character.personality).map(([key, value]) => `${key}:${value}`).join(', ')
    : '未设置';
  const emotion = character.emotionalState
    ? Object.entries(character.emotionalState).map(([key, value]) => `${key}:${value}`).join(', ')
    : '未设置';
  const core = character.coreProfile
    ? [
        character.coreProfile.coreDesire ? `核心欲望：${character.coreProfile.coreDesire}` : '',
        character.coreProfile.coreFear ? `核心恐惧：${character.coreProfile.coreFear}` : '',
        character.coreProfile.valuePriority?.length ? `价值优先：${character.coreProfile.valuePriority.join('、')}` : '',
        character.coreProfile.socialMask ? `社交面具：${character.coreProfile.socialMask}` : '',
        character.coreProfile.biases?.length ? `偏见：${character.coreProfile.biases.join('、')}` : '',
        character.coreProfile.interactionHabits?.length ? `互动习惯：${character.coreProfile.interactionHabits.join('、')}` : '',
      ].filter(Boolean).join('\n')
    : '';
  const relationships = (character.relationships || [])
    .slice(0, 8)
    .map((item) => `${item.characterId}: 亲和${item.warmth} 能力${item.competence} 信任${item.trust} 威胁${item.threat}${item.note ? `；备注：${item.note}` : ''}`)
    .join('\n');
  return [
    `角色：${character.name}`,
    character.group ? `身份/分组：${character.group}` : '',
    character.background ? `背景：${character.background}` : '',
    character.speakingStyle ? `说话风格：${character.speakingStyle}` : '',
    character.expertise?.length ? `专长/兴趣：${character.expertise.join('、')}` : '',
    `人格参数：${personality}`,
    `当前情绪：${emotion}`,
    core,
    relationships ? `既有关系：\n${relationships}` : '',
  ].filter(Boolean).join('\n');
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

function toCandidate(ownerId: string, source: MemoryItem[], item: LlmAnalyzedMemoryItem): MemoryCandidate {
  return {
    scope: item.scope,
    layerHint: 'long_term',
    kind: item.kind,
    ownerId,
    subjectIds: item.subjectIds,
    text: item.text,
    evidenceText: collectMemoryAnalysisEvidenceText(source),
    sourceEventIds: collectTrackedMemoryAnalysisSourceEventIds(source),
    sourceTag: buildSourceTag(item),
    origin: 'distilled',
    decision: item.decision,
    distilledFromIds: source.map((entry) => entry.id),
    distilledAt: Date.now(),
    distillationVersion: LLM_MEMORY_ANALYSIS_VERSION,
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
  return eligibleItems(owner.layeredMemories || []).slice(-LLM_MEMORY_ANALYSIS_MAX_SOURCE_ITEMS);
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
  const systemPrompt = buildChatMemoryAnalysisPrompt();
  const raw = await generateJsonResponse(api, systemPrompt, [
    { role: 'user', content: `群聊：${chat.name}\n主题：${chat.topic || '未设置'}\n最近高门槛证据：\n${buildMemoryAnalysisEvidenceBlock(source)}` },
  ]);
  const result = parseLlmMemoryAnalysisResult(raw);
  return result.items.slice(0, 4).map((item) => toCandidate(chat.id, source, item));
}

export async function distillCharacterMemoriesWithLlm(api: APIConfig, character: AICharacter): Promise<MemoryCandidate[]> {
  const source = buildDistillationSource(character, 'character');
  if (!source.length) return [];
  const systemPrompt = buildCharacterMemoryAnalysisPrompt();
  const raw = await generateJsonResponse(api, systemPrompt, [
    { role: 'user', content: `${buildCharacterAnalysisContext(character)}\n\n最近高门槛证据：\n${buildMemoryAnalysisEvidenceBlock(source)}` },
  ]);
  const result = parseLlmMemoryAnalysisResult(raw);
  return result.items.slice(0, 4).map((item) => toCandidate(character.id, source, item));
}
