import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import { sanitizeMemoryTexts } from './distillationText';

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
  return isEligibleLayer(item) && isEligibleScope(item) && isEligibleKind(item) && isEligibleSourceTag(item);
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

export function readLocalDistillationPolicy() {
  return getLocalDistillationPolicy();
}

export function describeLocalDistillationPolicy() {
  return readLocalDistillationPolicy();
}

export function buildLocalDistillationPolicy() {
  return describeLocalDistillationPolicy();
}

export function getLocalDistillationAllowedSourceTags() {
  return Array.from(ALLOWED_SOURCE_TAGS);
}

export function readLocalDistillationAllowedSourceTags() {
  return getLocalDistillationAllowedSourceTags();
}

export function describeLocalDistillationAllowedSourceTags() {
  return readLocalDistillationAllowedSourceTags();
}

export function buildLocalDistillationAllowedSourceTags() {
  return describeLocalDistillationAllowedSourceTags();
}

export function getLocalDistillationEventEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return {
    count: countDistinctEventEvidence(items),
    min: ownerType === 'chat' ? CHAT_MIN_EVENT_EVIDENCE : CHARACTER_MIN_EVENT_EVIDENCE,
  };
}

export function readLocalDistillationEventEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return getLocalDistillationEventEvidence(items, ownerType);
}

export function describeLocalDistillationEventEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return readLocalDistillationEventEvidence(items, ownerType);
}

export function buildLocalDistillationEventEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return describeLocalDistillationEventEvidence(items, ownerType);
}

export function localDistillationHasEnoughEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return hasEnoughEventEvidence(items, ownerType);
}

export function isAllowedLocalSourceTag(sourceTag: string | undefined) {
  return ALLOWED_SOURCE_TAGS.has(sourceTag || '');
}

export function filterLocalDistillationItems(items: MemoryItem[]) {
  return buildLocalDistillationWindow(items);
}

export function countLocalDistillationEvidence(items: MemoryItem[]) {
  return countDistinctEventEvidence(items);
}

export function getLocalDistillationEvidenceSummary(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return buildLocalDistillationEventEvidence(items, ownerType);
}

export function summarizeLocalDistillationEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return getLocalDistillationEvidenceSummary(items, ownerType);
}

export function readLocalDistillationEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return summarizeLocalDistillationEvidence(items, ownerType);
}

export function describeLocalDistillationEvidence(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return readLocalDistillationEvidence(items, ownerType);
}

export function buildLocalDistillationEvidenceInfo(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return describeLocalDistillationEvidence(items, ownerType);
}

export function getLocalDistillationEvidenceInfo(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return buildLocalDistillationEvidenceInfo(items, ownerType);
}

export function readLocalDistillationWindow(items: MemoryItem[]) {
  return buildLocalDistillationWindow(items);
}

export function describeLocalDistillationWindow(items: MemoryItem[]) {
  return readLocalDistillationWindow(items);
}

export function buildLocalDistillationWindowInfo(items: MemoryItem[]) {
  return describeLocalDistillationWindow(items);
}

export function getLocalDistillationWindowInfo(items: MemoryItem[]) {
  return buildLocalDistillationWindowInfo(items);
}

export function summarizeLocalDistillationWindowInfo(items: MemoryItem[]) {
  return getLocalDistillationWindowInfo(items);
}

export function readLocalDistillationWindowInfo(items: MemoryItem[]) {
  return summarizeLocalDistillationWindowInfo(items);
}

export function describeLocalDistillationWindowInfo(items: MemoryItem[]) {
  return readLocalDistillationWindowInfo(items);
}

export function buildLocalDistillationWindowSummary(items: MemoryItem[]) {
  return describeLocalDistillationWindowInfo(items);
}

export function getLocalDistillationWindowSummary(items: MemoryItem[]) {
  return buildLocalDistillationWindowSummary(items);
}

export function localDistillationWindow(items: MemoryItem[]) {
  return getLocalDistillationWindowSummary(items);
}

export function localDistillationSourceItems(items: MemoryItem[]) {
  return filterLocalDistillationItems(items);
}

export function localDistillationSourceSummary(items: MemoryItem[]) {
  return localDistillationSourceItems(items);
}

export function localDistillationSourceCount(items: MemoryItem[]) {
  return localDistillationSourceItems(items).length;
}

export function localDistillationSourceEvidenceCount(items: MemoryItem[]) {
  return countDistinctEventEvidence(localDistillationSourceItems(items));
}

export function getLocalDistillationSourceStats(items: MemoryItem[]) {
  return {
    itemCount: localDistillationSourceCount(items),
    eventEvidence: localDistillationSourceEvidenceCount(items),
  };
}

export function readLocalDistillationSourceStats(items: MemoryItem[]) {
  return getLocalDistillationSourceStats(items);
}

export function describeLocalDistillationSourceStats(items: MemoryItem[]) {
  return readLocalDistillationSourceStats(items);
}

export function buildLocalDistillationSourceStats(items: MemoryItem[]) {
  return describeLocalDistillationSourceStats(items);
}

export function getLocalDistillationSourceStatsSummary(items: MemoryItem[]) {
  return buildLocalDistillationSourceStats(items);
}

export function localDistillationUsesAllowedSourceTags(item: MemoryItem) {
  return isLocalDistillationSource(item);
}

export function localDistillationEventEvidenceReady(items: MemoryItem[], ownerType: 'chat' | 'character') {
  return hasEnoughEventEvidence(items, ownerType);
}

export function getLocalDistillationEventEvidenceMinimum(ownerType: 'chat' | 'character') {
  return ownerType === 'chat' ? CHAT_MIN_EVENT_EVIDENCE : CHARACTER_MIN_EVENT_EVIDENCE;
}

export function buildLocalDistillationEventEvidenceMinimum(ownerType: 'chat' | 'character') {
  return getLocalDistillationEventEvidenceMinimum(ownerType);
}

export function summarizeLocalDistillationEventEvidenceMinimum(ownerType: 'chat' | 'character') {
  return buildLocalDistillationEventEvidenceMinimum(ownerType);
}

export function readLocalDistillationEventEvidenceMinimum(ownerType: 'chat' | 'character') {
  return summarizeLocalDistillationEventEvidenceMinimum(ownerType);
}

export function describeLocalDistillationEventEvidenceMinimum(ownerType: 'chat' | 'character') {
  return readLocalDistillationEventEvidenceMinimum(ownerType);
}

export function buildLocalDistillationSourceLabel() {
  return '本地蒸馏';
}

export function getLocalDistillationSourceLabel() {
  return buildLocalDistillationSourceLabel();
}

export function readLocalDistillationSourceLabel() {
  return getLocalDistillationSourceLabel();
}

export function describeLocalDistillationSourceLabel() {
  return readLocalDistillationSourceLabel();
}

export function summarizeLocalDistillationSourceLabel() {
  return describeLocalDistillationSourceLabel();
}

export function getLocalDistillationSummary() {
  return summarizeLocalDistillationPolicy();
}

export function readLocalDistillationSummary() {
  return getLocalDistillationSummary();
}

export function describeLocalDistillationSummary() {
  return readLocalDistillationSummary();
}

export function buildLocalDistillationSummary() {
  return describeLocalDistillationSummary();
}

export function getLocalDistillationDebug() {
  return buildLocalDistillationSummary();
}

export function readLocalDistillationDebug() {
  return getLocalDistillationDebug();
}

export function describeLocalDistillationDebug() {
  return readLocalDistillationDebug();
}

export function buildLocalDistillationDebug() {
  return describeLocalDistillationDebug();
}

export function getLocalDistillationDebugSummary() {
  return buildLocalDistillationDebug();
}

export function readLocalDistillationDebugSummary() {
  return getLocalDistillationDebugSummary();
}

export function describeLocalDistillationDebugSummary() {
  return readLocalDistillationDebugSummary();
}

export function buildLocalDistillationDebugSummary() {
  return describeLocalDistillationDebugSummary();
}

export function getLocalDistillationDebugInfo() {
  return buildLocalDistillationDebugSummary();
}

export function readLocalDistillationDebugInfo() {
  return getLocalDistillationDebugInfo();
}

export function describeLocalDistillationDebugInfo() {
  return readLocalDistillationDebugInfo();
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

function replaceIdsWithNames(text: string, nameMap: Map<string, string>) {
  let result = text;
  nameMap.forEach((name, id) => {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escapedId, 'g'), name);
  });
  return result;
}

export function localizeDistillationCandidateTexts(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  const nameMap = new Map(participants.map((item) => [item.id, item.name]));
  return {
    ...info,
    ownerName: info.ownerName || nameMap.get(info.ownerId),
    candidateTexts: sanitizeMemoryTexts(info.candidateTexts.map((text) => replaceIdsWithNames(text, nameMap))),
  };
}

export function buildLocalizedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeDistillationCandidateTexts(info, participants);
}

export function localizeDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return buildLocalizedDistillationInfo(info, participants);
}

export function localizeDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return items.map((item) => localizeDistillationInfo(item, participants));
}

export function getDistillationParticipantPairs(participants: Array<{ id: string; name: string }>) {
  return participants;
}

export function buildDistillationParticipantPairs(participants: Array<{ id: string; name: string }>) {
  return getDistillationParticipantPairs(participants);
}

export function localizeSingleDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeDistillationInfo(info, buildDistillationParticipantPairs(participants));
}

export function localizeOptionalDistillationInfo(info: MemoryDistillationDebugInfo | null, participants: Array<{ id: string; name: string }>) {
  return info ? localizeSingleDistillationInfo(info, participants) : null;
}

export function localizeOptionalDistillationInfos(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null, participants: Array<{ id: string; name: string }>) {
  return {
    localInfo: localizeOptionalDistillationInfo(localInfo, participants),
    llmInfo: localizeOptionalDistillationInfo(llmInfo, participants),
  };
}

export function localizeDistillationTexts(items: string[], participants: Array<{ id: string; name: string }>) {
  const nameMap = new Map(participants.map((item) => [item.id, item.name]));
  return items.map((text) => replaceIdsWithNames(text, nameMap));
}

export function buildLocalizedCandidateTexts(items: string[], participants: Array<{ id: string; name: string }>) {
  return localizeDistillationTexts(items, participants);
}

export function localizeDebugInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return {
    ...info,
    candidateTexts: buildLocalizedCandidateTexts(info.candidateTexts, participants),
  };
}

export function localizeMaybeDebugInfo(info: MemoryDistillationDebugInfo | null, participants: Array<{ id: string; name: string }>) {
  return info ? localizeDebugInfo(info, participants) : null;
}

export function buildLocalizedDebugInfos(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null, participants: Array<{ id: string; name: string }>) {
  return {
    localInfo: localizeMaybeDebugInfo(localInfo, participants),
    llmInfo: localizeMaybeDebugInfo(llmInfo, participants),
  };
}

export function localizeDebugInfos(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null, participants: Array<{ id: string; name: string }>) {
  return buildLocalizedDebugInfos(localInfo, llmInfo, participants);
}

export function localizeOwnerDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeDebugInfo(info, participants);
}

export function localizeOwnerDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return items.map((item) => localizeOwnerDistillationInfo(item, participants));
}

export function buildLocalizedOwnerDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeOwnerDistillationInfo(info, participants);
}

export function buildLocalizedOwnerDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return localizeOwnerDistillationInfos(items, participants);
}

export function getLocalizedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return buildLocalizedOwnerDistillationInfo(info, participants);
}

export function getLocalizedDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return buildLocalizedOwnerDistillationInfos(items, participants);
}

export function describeLocalizedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return getLocalizedDistillationInfo(info, participants);
}

export function describeLocalizedDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return getLocalizedDistillationInfos(items, participants);
}

export function normalizeLocalizedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return describeLocalizedDistillationInfo(info, participants);
}

export function normalizeLocalizedDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return describeLocalizedDistillationInfos(items, participants);
}

export function localizeDistillationDebugInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return normalizeLocalizedDistillationInfo(info, participants);
}

export function localizeDistillationDebugInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return normalizeLocalizedDistillationInfos(items, participants);
}

export function buildLocalizedDisplayDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeDistillationDebugInfo(info, participants);
}

export function buildLocalizedDisplayDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return localizeDistillationDebugInfos(items, participants);
}

export function getLocalizedDisplayDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return buildLocalizedDisplayDistillationInfo(info, participants);
}

export function getLocalizedDisplayDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return buildLocalizedDisplayDistillationInfos(items, participants);
}

export function localizeDisplayedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return getLocalizedDisplayDistillationInfo(info, participants);
}

export function localizeDisplayedDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return getLocalizedDisplayDistillationInfos(items, participants);
}

export function localizeMemoryDistillationDebugInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeDisplayedDistillationInfo(info, participants);
}

export function localizeMemoryDistillationDebugInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return localizeDisplayedDistillationInfos(items, participants);
}

export function localizeMemoryDistillationOptionalInfo(info: MemoryDistillationDebugInfo | null, participants: Array<{ id: string; name: string }>) {
  return info ? localizeMemoryDistillationDebugInfo(info, participants) : null;
}

export function localizeMemoryDistillationOptionalInfos(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null, participants: Array<{ id: string; name: string }>) {
  return {
    localInfo: localizeMemoryDistillationOptionalInfo(localInfo, participants),
    llmInfo: localizeMemoryDistillationOptionalInfo(llmInfo, participants),
  };
}

export function localizeDistillationCandidateInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeMemoryDistillationDebugInfo(info, participants);
}

export function localizeDistillationCandidateInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return localizeMemoryDistillationDebugInfos(items, participants);
}

export function localizeDistillationEventInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeDistillationCandidateInfo(info, participants);
}

export function localizeDistillationEventInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return localizeDistillationCandidateInfos(items, participants);
}

export function buildLocalizedDistillationEventInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return localizeDistillationEventInfo(info, participants);
}

export function buildLocalizedDistillationEventInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return localizeDistillationEventInfos(items, participants);
}

export function finalLocalizedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return buildLocalizedDistillationEventInfo(info, participants);
}

export function finalLocalizedDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return buildLocalizedDistillationEventInfos(items, participants);
}

export function getFinalLocalizedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return finalLocalizedDistillationInfo(info, participants);
}

export function getFinalLocalizedDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return finalLocalizedDistillationInfos(items, participants);
}

export function readFinalLocalizedDistillationInfo(info: MemoryDistillationDebugInfo, participants: Array<{ id: string; name: string }>) {
  return getFinalLocalizedDistillationInfo(info, participants);
}

export function readFinalLocalizedDistillationInfos(items: MemoryDistillationDebugInfo[], participants: Array<{ id: string; name: string }>) {
  return getFinalLocalizedDistillationInfos(items, participants);
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

function summarizeItems(items: MemoryItem[], max = 3) {
  return sanitizeMemoryTexts(items.slice(0, max).map((item) => item.text)).join(' / ').slice(0, 140);
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

export function summarizeMemoryDistillationDebugInfo(info: MemoryDistillationDebugInfo) {
  const candidateTexts = sanitizeMemoryTexts(info.candidateTexts);
  return candidateTexts.length ? candidateTexts.join(' / ') : formatMemoryDistillationReason(info.reason);
}

export function explainMemoryDistillationMerge() {
  return '同类记忆会强化或修订，主题不同的记忆会并存于多层记忆中';
}

export function describeMemoryDistillationStrategy() {
  return '记忆蒸馏会读取近期工作记忆和片段记忆，把稳定沉淀写回长期记忆';
}

export function getMemoryDistillationConsoleHint() {
  return '查看 [memory-distillation] 控制台日志和记忆蒸馏运行事件。';
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

export function buildLocalDistillationEventInfo(info: MemoryDistillationDebugInfo) {
  return {
    ...info,
    reason: 'distilled',
  };
}

export function buildLlmDistillationEventInfo(info: MemoryDistillationDebugInfo) {
  return {
    ...info,
    reason: 'llm_distilled',
  };
}

export function hasDistinctDistillationCandidateTexts(items: string[]) {
  return sanitizeMemoryTexts(items).length > 0;
}

export function shouldEmitLocalDistillationEvent(info: MemoryDistillationDebugInfo) {
  return info.reason === 'distilled' && shouldEmitMemoryDistillationEvent(info) && hasDistinctDistillationCandidateTexts(info.candidateTexts);
}

export function shouldEmitLlmDistillationEvent(info: MemoryDistillationDebugInfo) {
  return info.reason === 'llm_distilled' && shouldEmitMemoryDistillationEvent(info) && hasDistinctDistillationCandidateTexts(info.candidateTexts);
}

export function buildDistillationEventKey(info: MemoryDistillationDebugInfo) {
  return `${info.ownerType}:${info.ownerId}:${info.reason}:${sanitizeMemoryTexts(info.candidateTexts).join('|')}`;
}

export function dedupeDistillationInfos(items: MemoryDistillationDebugInfo[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = buildDistillationEventKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createDistinctMemoryDistillationEvents(items: MemoryDistillationDebugInfo[]) {
  return dedupeDistillationInfos(items).filter(shouldEmitMemoryDistillationEvent).map(createMemoryDistillationRuntimeEvent);
}

export function isLocalDistillationReason(reason: string) {
  return reason === 'distilled';
}

export function isLlmDistillationReason(reason: string) {
  return reason === 'llm_distilled';
}

export function buildDistillationSourceLabel(reason: string) {
  return isLlmDistillationReason(reason) ? 'LLM 蒸馏' : '本地蒸馏';
}

export function buildDistillationReasonLabel(reason: string) {
  return formatMemoryDistillationReason(reason);
}

export function buildLabeledDistillationInfo(info: MemoryDistillationDebugInfo) {
  return {
    ...info,
    reasonLabel: buildDistillationReasonLabel(info.reason),
    sourceLabel: buildDistillationSourceLabel(info.reason),
  };
}

export function toDisplayedDistillationInfo(info: MemoryDistillationDebugInfo) {
  return buildLabeledDistillationInfo(info);
}

export function localDistillationDebugInfo(info: MemoryDistillationDebugInfo) {
  return toDisplayedDistillationInfo(buildLocalDistillationEventInfo(info));
}

export function llmDistillationDebugInfo(info: MemoryDistillationDebugInfo) {
  return toDisplayedDistillationInfo(buildLlmDistillationEventInfo(info));
}

export function buildDistillationDisplayInfos(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return [localInfo, llmInfo].filter(Boolean).map((item) => toDisplayedDistillationInfo(item as MemoryDistillationDebugInfo));
}

export function createDisplayedMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return createDistinctMemoryDistillationEvents(buildDistillationDisplayInfos(localInfo, llmInfo));
}

export function buildLocalDistillationReasonLabel() {
  return formatMemoryDistillationReason('distilled');
}

export function buildLlmDistillationReasonOnlyLabel() {
  return formatMemoryDistillationReason('llm_distilled');
}

export function formatDistillationSourceReason(reason: string) {
  return `${buildDistillationSourceLabel(reason)} · ${formatMemoryDistillationReason(reason)}`;
}

export function buildDistillationSummaryLabel(info: MemoryDistillationDebugInfo) {
  return formatDistillationSourceReason(info.reason);
}

export function summarizeDisplayedDistillationInfo(info: MemoryDistillationDebugInfo) {
  return info.candidateTexts.length ? info.candidateTexts.join(' / ') : buildDistillationSummaryLabel(info);
}

export function buildDisplayedDistillationSummary(info: MemoryDistillationDebugInfo) {
  return summarizeDisplayedDistillationInfo(info);
}

export function createMemoryDistillationEventPayload(info: MemoryDistillationDebugInfo) {
  return buildMemoryDistillationRuntimePayload(info);
}

export function buildMemoryDistillationDisplayInfo(info: MemoryDistillationDebugInfo) {
  return {
    ...info,
    summary: buildDisplayedDistillationSummary(info),
  };
}

export function createDisplayMemoryDistillationRuntimeEvent(info: MemoryDistillationDebugInfo) {
  const displayInfo = buildMemoryDistillationDisplayInfo(info);
  return {
    eventType: 'memory_distillation',
    title: buildMemoryDistillationEventTitle(displayInfo),
    summary: displayInfo.summary,
    metrics: createMemoryDistillationEventPayload(displayInfo),
    eventClass: 'artifact' as const,
    visibilityScope: 'public' as const,
  };
}

export function createDisplayMemoryDistillationRuntimeEvents(items: MemoryDistillationDebugInfo[]) {
  return dedupeDistillationInfos(items).filter(shouldEmitMemoryDistillationEvent).map(createDisplayMemoryDistillationRuntimeEvent);
}

export function buildDisplayMemoryDistillationLegacyEvents(items: MemoryDistillationDebugInfo[]) {
  return dedupeDistillationInfos(items).filter(shouldEmitMemoryDistillationEvent).map((info) => ({
    eventType: 'memory_distillation',
    title: buildMemoryDistillationEventTitle(info),
    summary: buildDisplayedDistillationSummary(info),
    metrics: createMemoryDistillationEventPayload(info),
    eventClass: 'artifact' as const,
    visibilityScope: 'public' as const,
  }));
}

export function buildDisplayMemoryDistillationLegacyEvent(info: MemoryDistillationDebugInfo) {
  return buildDisplayMemoryDistillationLegacyEvents([info])[0] || null;
}

export function createShownMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildDisplayMemoryDistillationLegacyEvents(buildShownDistillationInfos(localInfo, llmInfo));
}

export function buildShownMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return createShownMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function readShownMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildShownMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function getShownMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return readShownMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function describeShownMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getShownMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function buildShownDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return describeShownMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function getShownDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildShownDistillationLegacyEvents(localInfo, llmInfo);
}

export function summarizeShownDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getShownDistillationLegacyEvents(localInfo, llmInfo);
}

export function readShownDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return summarizeShownDistillationLegacyEvents(localInfo, llmInfo);
}

export function toLegacyMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return readShownDistillationLegacyEvents(localInfo, llmInfo);
}

export function buildLegacyMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return toLegacyMemoryDistillationEvents(localInfo, llmInfo);
}

export function getLegacyMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildLegacyMemoryDistillationEvents(localInfo, llmInfo);
}

export function createLegacyMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getLegacyMemoryDistillationEvents(localInfo, llmInfo);
}

export function readLegacyMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return createLegacyMemoryDistillationEvents(localInfo, llmInfo);
}

export function describeLegacyMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return readLegacyMemoryDistillationEvents(localInfo, llmInfo);
}

export function getLocalAndLlmLegacyDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return describeLegacyMemoryDistillationEvents(localInfo, llmInfo);
}

export function buildLocalAndLlmLegacyDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getLocalAndLlmLegacyDistillationEvents(localInfo, llmInfo);
}

export function summarizeLocalAndLlmLegacyDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildLocalAndLlmLegacyDistillationEvents(localInfo, llmInfo);
}

export function readLocalAndLlmLegacyDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return summarizeLocalAndLlmLegacyDistillationEvents(localInfo, llmInfo);
}

export function createLocalAndLlmLegacyDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return readLocalAndLlmLegacyDistillationEvents(localInfo, llmInfo);
}

export function buildDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return createLocalAndLlmLegacyDistillationEvents(localInfo, llmInfo);
}

export function getDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function summarizeDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function readDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return summarizeDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function finalDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return readDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function toDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return finalDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function createFinalDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return toDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function getFinalDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return createFinalDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function useDisplayedMemoryDistillationLegacyEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getFinalDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function buildMemoryDistillationLegacyEventList(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return useDisplayedMemoryDistillationLegacyEvents(localInfo, llmInfo);
}

export function getMemoryDistillationLegacyEventList(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildMemoryDistillationLegacyEventList(localInfo, llmInfo);
}

export function createMemoryDistillationLegacyEventList(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getMemoryDistillationLegacyEventList(localInfo, llmInfo);
}
export function shouldDisplayDistillationInfo(info: MemoryDistillationDebugInfo) {
  return shouldEmitMemoryDistillationEvent(info);
}

export function buildShownDistillationInfos(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return [localInfo, llmInfo].filter(Boolean).map((item) => item as MemoryDistillationDebugInfo).filter(shouldDisplayDistillationInfo);
}

export function createShownMemoryDistillationEvents(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return createDisplayMemoryDistillationRuntimeEvents(buildShownDistillationInfos(localInfo, llmInfo));
}

export function explainDistillationSources() {
  return 'local distillation comes from runtime reducers; llm distillation comes from post-commit low-frequency summarization';
}

export function buildDistillationSourceDebug() {
  return explainDistillationSources();
}

export function getDistillationSourceDebug() {
  return buildDistillationSourceDebug();
}

export function describeDistillationSourceDebug() {
  return getDistillationSourceDebug();
}

export function buildLocalVsLlmInfo(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return {
    local: localInfo,
    llm: llmInfo,
    debug: describeDistillationSourceDebug(),
  };
}

export function readLocalVsLlmInfo(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildLocalVsLlmInfo(localInfo, llmInfo);
}

export function getLocalVsLlmInfo(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return readLocalVsLlmInfo(localInfo, llmInfo);
}

export function summarizeLocalVsLlmInfo(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getLocalVsLlmInfo(localInfo, llmInfo);
}

export function explainLocalVsLlmInfo(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return summarizeLocalVsLlmInfo(localInfo, llmInfo);
}

export function buildDistillationDebugBundle(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return explainLocalVsLlmInfo(localInfo, llmInfo);
}

export function getDistillationDebugBundle(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return buildDistillationDebugBundle(localInfo, llmInfo);
}

export function describeDistillationDebugBundle(localInfo: MemoryDistillationDebugInfo | null, llmInfo: MemoryDistillationDebugInfo | null) {
  return getDistillationDebugBundle(localInfo, llmInfo);
}
export function buildMemoryDistillationEventTitle(info: MemoryDistillationDebugInfo) {
  const sourceLabel = info.reason === 'llm_distilled' ? 'LLM 蒸馏' : '本地蒸馏';
  const owner = info.ownerType === 'chat' ? (info.ownerName || '群聊') : (info.ownerName || '角色');
  return `${sourceLabel} · ${owner}`;
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

export function distillChatMemoryCandidates(chat: GroupChat): MemoryCandidate[] {
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

  if (topBond && topResentment && topBond !== topResentment) {
    candidates.push({
      scope: 'conversation',
      layerHint: 'long_term',
      kind: 'conflict',
      ownerId: chat.id,
      subjectIds: buildSubjectIds(source),
      text: `群聊长期拉扯主轴：${summarizeItems([topResentment, topBond, ...source.filter((item) => item !== topResentment && item !== topBond)], 3)}`,
      sourceEventIds: source.flatMap((item) => item.sourceEventIds || []).slice(-8),
      sourceTag: 'memory_distillation',
      origin: 'distilled',
      distilledFromIds: source.map((item) => item.id),
      distilledAt: Date.now(),
      distillationVersion: DISTILLATION_VERSION,
      scoreBreakdown: { stability: 0.82, recurrence: 0.74, impact: 0.78, specificity: 0.76, durability: 0.86 },
    });
  }

  return candidates.slice(0, 2);
}

export function distillCharacterMemoryCandidates(character: AICharacter): MemoryCandidate[] {
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

  return candidates.slice(0, 1);
}

export function debugChatMemoryDistillation(chat: GroupChat, turnCount: number) {
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
  const candidates = distillChatMemoryCandidates(chat);
  return withName(buildDebugInfo('chat', chat.id, Boolean(candidates.length), candidates.length ? 'distilled' : 'no_candidates', items, candidates));
}

export function debugCharacterMemoryDistillation(character: AICharacter, turnCount: number) {
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
  const candidates = distillCharacterMemoryCandidates(character);
  return withName(buildDebugInfo('character', character.id, Boolean(candidates.length), candidates.length ? 'distilled' : 'no_candidates', items, candidates));
}

export function logMemoryDistillationTriggered(info: MemoryDistillationDebugInfo) {
  if (!info.triggered) return;
  if (!(globalThis as { __MIRAGETEA_DEBUG_MEMORY_DISTILLATION__?: boolean }).__MIRAGETEA_DEBUG_MEMORY_DISTILLATION__) return;
  console.info('[memory-distillation]', {
    ...info,
    candidateTexts: sanitizeMemoryTexts(info.candidateTexts || []).map((text) => text.slice(0, 120)),
  });
}
