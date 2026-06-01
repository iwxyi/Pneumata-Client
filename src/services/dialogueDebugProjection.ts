import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { sanitizeUserFacingText } from './displayTextSanitizer';
import { formatConflictHookLabels, formatConflictPressureLabel, formatConflictStageLabel, formatConflictTypeLabel } from './runtimeEventFactory';
import type { ProjectedRuntimeTimelineItem } from './sessionProjection';
import { readGuidanceInfoMeta, readProjectionInfoMeta } from './sessionProjection';
import { formatRuntimeEventKindLabel } from './runtimeEventPresentation';
import { buildCalendarPatchDebugChips, buildCalendarPatchSummary, buildCalendarPatchTimelineTitle } from './worldCalendarPatchPresentation';
import { formatAttentionDebugLine } from './runtimeTimelinePresentation';

export interface DialogueRecentSignal {
  recentEvent: string;
  focus: string;
  mood: string;
}

export interface ConflictDebugState {
  type: string;
  stage: string;
  severity: string;
  pressure: string;
  hooks: string[];
  summary: string;
}

export interface DialogueStructuredEventCard {
  title: string;
  timestampLabel: string;
  bodyText: string;
  summaryText: string | null;
  chips: string[];
  guidanceMetaLine: string | null;
  attentionMetaLine: string | null;
  projectionMetaLine: string | null;
}

function formatEventKind(kind: string, isZh: boolean) {
  return formatRuntimeEventKindLabel(kind, isZh ? 'zh' : 'en');
}

export function projectEventKindLabel(kind: string, isZh: boolean) {
  return formatEventKind(kind, isZh);
}

function formatProjectionKind(projectionKind: string | null | undefined, isZh = true) {
  const map: Record<string, string> = {
    relationship_backflow: isZh ? '关系回流' : 'Relationship backflow',
    summary_backflow: isZh ? '摘要回流' : 'Summary backflow',
    source_chat_patch: isZh ? '群聊投影' : 'Source chat projection',
  };
  return projectionKind ? map[projectionKind] || projectionKind : '';
}

export function projectDialogueRecentSignal(chat: GroupChat, members: AICharacter[] = []): DialogueRecentSignal {
  const recentEvent = sanitizeUserFacingText(chat.worldState.recentEvent || '暂无', members);
  const focus = sanitizeUserFacingText(chat.worldState.focus || '', members) || '未设置';
  const mood = sanitizeUserFacingText(chat.worldState.mood || '', members) || '未设置';
  return { recentEvent, focus, mood };
}

export function projectConflictDebugState(chat: GroupChat, members: AICharacter[] = []): ConflictDebugState | null {
  const primary = chat.worldState.conflictState?.primaryConflict;
  if (!primary) return null;
  return {
    type: formatConflictTypeLabel(primary.type),
    stage: formatConflictStageLabel(primary.stage),
    severity: primary.severity.toFixed(2),
    pressure: formatConflictPressureLabel(primary.nextPressure),
    hooks: formatConflictHookLabels(primary.developmentHooks),
    summary: sanitizeUserFacingText(primary.summary, members),
  };
}

export function projectProjectionMetaLine(item: ProjectedRuntimeTimelineItem, isZh: boolean) {
  const projection = readProjectionInfoMeta(item);
  const projectionKind = projection?.projectionKind || null;
  const topicSnippet = projection?.topicSnippet || null;
  const participantNames = projection?.participantNames || [];
  if (!projectionKind && !topicSnippet && !participantNames.length) return null;
  return [formatProjectionKind(projectionKind, isZh), participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · ');
}

export function projectTimelineGuidanceMetaLine(item: ProjectedRuntimeTimelineItem, isZh: boolean) {
  const guidance = readGuidanceInfoMeta(item);
  if (!guidance) return null;
  const kindLabel = guidance.kind === 'media_request'
    ? (isZh ? '媒体请求' : 'Media request')
    : guidance.kind === 'direct_reply'
      ? (isZh ? '点名回应' : 'Direct reply')
      : (isZh ? '话题引导' : 'Topic guidance');
  const actorNames = (guidance.actorNames || []).join('、');
  const subjectNames = (guidance.subjectNames || []).join('、');
  return [
    kindLabel,
    actorNames ? `${isZh ? '执行' : 'Actors'} ${actorNames}` : '',
    subjectNames ? `${isZh ? '图片对象' : 'Image subject'} ${subjectNames}` : '',
    !subjectNames && guidance.subjectText ? `${isZh ? '图片对象' : 'Image subject'} ${guidance.subjectText}` : '',
  ].filter(Boolean).join(' · ');
}

export function projectTimelineAttentionMetaLine(item: ProjectedRuntimeTimelineItem, isZh: boolean) {
  return formatAttentionDebugLine({
    candidate: item.meta?.socialEventCandidate,
    language: isZh ? 'zh' : 'en',
    reasonMax: 120,
  });
}

export function projectCalendarPatchMeta(item: ProjectedRuntimeTimelineItem, isZh: boolean) {
  if (item.event?.kind !== 'calendar_item_patch') return null;
  return {
    title: buildCalendarPatchTimelineTitle(item.event, isZh),
    summary: buildCalendarPatchSummary(item.event, isZh),
    chips: buildCalendarPatchDebugChips(item.event, isZh),
  };
}

export function projectProjectionTitle(item: ProjectedRuntimeTimelineItem, isZh: boolean) {
  const projectionKind = readProjectionInfoMeta(item)?.projectionKind || '';
  return formatProjectionKind(projectionKind, isZh) || formatEventKind(item.event?.kind || 'artifact', isZh);
}

export function projectProjectionDescription(item: ProjectedRuntimeTimelineItem, members: AICharacter[] = []) {
  const projection = readProjectionInfoMeta(item);
  const participantNames = projection?.participantNames || [];
  const topicSnippet = projection?.topicSnippet || null;
  return sanitizeUserFacingText([participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · '), members);
}

export function projectDialogueStructuredEventCard(item: ProjectedRuntimeTimelineItem, isZh: boolean, members: AICharacter[] = []): DialogueStructuredEventCard {
  const calendarPatchMeta = projectCalendarPatchMeta(item, isZh);
  return {
    title: calendarPatchMeta?.title || projectEventKindLabel(item.event?.kind || 'artifact', isZh),
    timestampLabel: new Date(item.createdAt).toLocaleString(),
    bodyText: sanitizeUserFacingText(item.text, members),
    summaryText: calendarPatchMeta?.summary ? sanitizeUserFacingText(calendarPatchMeta.summary, members) : null,
    chips: calendarPatchMeta?.chips || [],
    guidanceMetaLine: projectTimelineGuidanceMetaLine(item, isZh),
    attentionMetaLine: projectTimelineAttentionMetaLine(item, isZh),
    projectionMetaLine: projectProjectionMetaLine(item, isZh),
  };
}
