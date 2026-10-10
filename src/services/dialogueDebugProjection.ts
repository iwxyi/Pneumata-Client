import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { InteractionEventPayload } from '../types/runtimeEvent';
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

export interface MessageAffectDebugProjection {
  incoming: ProjectedInteractionAffect | null;
  outgoing: ProjectedInteractionAffect[];
}

export interface ProjectedInteractionAffect {
  target: string | null;
  kind: string;
  tone: string;
  intensity: number;
  confidence: number | null;
  evidence: string | null;
  emotionDeltas: string[];
  speakerEmotionDeltas: string[];
  roomDeltas: string[];
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

export interface DeliberationDebugItem {
  key: string;
  category: 'claim' | 'evidence' | 'issue' | 'verdict' | 'summary';
  label: string;
  speakerName: string;
  text: string;
  reason: string | null;
  confidence: number | null;
}

export interface PresenceDebugItem {
  key: string;
  speakerName: string;
  status: 'online' | 'away';
  activity: string | null;
  reason: string | null;
  durationMinutes: number | null;
}

export interface ConversationMoveDebugItem {
  key: string;
  speakerName: string;
  moveType: string;
  reason: string | null;
  artifactStatus: string | null;
}

export interface DeliberationDebugProjection {
  counts: {
    claims: number;
    evidence: number;
    issues: number;
    verdicts: number;
    summaries: number;
    presenceUpdates: number;
    moveHints: number;
  };
  artifacts: DeliberationDebugItem[];
  presence: PresenceDebugItem[];
  moves: ConversationMoveDebugItem[];
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

function resolveDisplayName(value: string, members: AICharacter[] = []) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === 'user') return '我';
  const matched = members.find((member) => member.id === raw);
  if (matched?.name) return matched.name;
  return raw;
}

function visibleDebugMessages(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event');
}

function compactDebugText(value: string | null | undefined, members: AICharacter[] = [], max = 120) {
  const cleaned = sanitizeUserFacingText(String(value || '').replace(/\s+/g, ' ').trim(), members);
  if (!cleaned) return '';
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function safeConfidence(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

const interactionLabels: Record<string, string> = {
  support: '支持', challenge: '质疑', mock: '嘲讽', dismiss: '冷落', defend: '维护',
  evade: '回避', probe: '追问', pile_on: '围攻', redirect: '转移', apologize: '道歉',
  concede: '让步', take_responsibility: '承担责任', include: '纳入', exclude: '排斥',
  boundary: '设限', side_comment: '旁评',
};

const toneLabels: Record<string, string> = {
  warm: '温和', annoyed: '不耐', defensive: '防御', excited: '兴奋', sarcastic: '讽刺', cold: '冷淡',
};

const emotionAxisLabels: Record<string, string> = {
  irritation: '恼火', affection: '亲近', insecurity: '不安', excitement: '兴奋', embarrassment: '难堪',
};

const roomAxisLabels: Record<string, string> = { heat: '紧张度', cohesion: '凝聚度', topicDrift: '话题偏移' };

function projectDeltas(deltas: Record<string, number> | undefined, labels: Record<string, string>) {
  return Object.entries(deltas || {}).flatMap(([axis, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return [];
    return [`${labels[axis] || axis} ${value > 0 ? '+' : ''}${value}`];
  });
}

function projectInteractionAffect(hint: InteractionEventPayload | null | undefined, members: AICharacter[]): ProjectedInteractionAffect | null {
  if (!hint) return null;
  const target = hint.targetId === 'user'
    ? '我'
    : members.find((member) => member.id === hint.targetId)?.name || null;
  const impact = hint.immediateImpact;
  return {
    target,
    kind: interactionLabels[hint.kind] || hint.kind,
    tone: toneLabels[hint.tone] || hint.tone,
    intensity: Number.isFinite(hint.intensity) ? hint.intensity : 0,
    confidence: safeConfidence(hint.confidence),
    evidence: hint.evidenceText ? compactDebugText(hint.evidenceText, members, 180) || null : null,
    emotionDeltas: projectDeltas(impact?.targetEmotionDelta, emotionAxisLabels),
    speakerEmotionDeltas: projectDeltas(impact?.speakerEmotionDelta, emotionAxisLabels),
    roomDeltas: projectDeltas(impact?.roomDelta, roomAxisLabels),
  };
}

export function projectMessageAffectDebug(message: Message, members: AICharacter[] = []): MessageAffectDebugProjection {
  return {
    incoming: projectInteractionAffect(message.incomingInteractionHint, members),
    outgoing: (message.interactionHints || (message.interactionHint ? [message.interactionHint] : []))
      .map((hint) => projectInteractionAffect(hint, members))
      .filter((hint): hint is ProjectedInteractionAffect => Boolean(hint)),
  };
}

function categoryLabel(category: DeliberationDebugItem['category'], isZh: boolean) {
  const zh: Record<DeliberationDebugItem['category'], string> = {
    claim: '主张',
    evidence: '证据',
    issue: '质询',
    verdict: '裁决',
    summary: '总结',
  };
  const en: Record<DeliberationDebugItem['category'], string> = {
    claim: 'Claim',
    evidence: 'Evidence',
    issue: 'Issue',
    verdict: 'Verdict',
    summary: 'Summary',
  };
  return isZh ? zh[category] : en[category];
}

function extractMoveHints(message: Message, members: AICharacter[] = []): ConversationMoveDebugItem[] {
  const trace = message.metadata?.runtimeDecision?.generationRuntime?.trace;
  const policyHits = Array.isArray((trace as { policyHits?: unknown[] } | null | undefined)?.policyHits)
    ? ((trace as { policyHits?: unknown[] }).policyHits || [])
    : [];
  const move = policyHits.find((item): item is string => typeof item === 'string' && item.startsWith('conversation_move:'))?.replace('conversation_move:', '') || '';
  if (!move) return [];
  const reason = policyHits.find((item): item is string => typeof item === 'string' && item.startsWith('conversation_move_reason:'))?.replace('conversation_move_reason:', '') || null;
  const artifactStatus = policyHits
    .filter((item): item is string => typeof item === 'string' && item.startsWith('deliberation_artifacts:'))
    .map((item) => {
      const value = item.replace('deliberation_artifacts:', '');
      if (value === 'present') return '已返回';
      if (value === 'absent') return '缺失';
      if (value === 'json_envelope_parsed') return 'JSON已解析';
      if (value === 'no_json_envelope') return '未解析到JSON';
      if (value.startsWith('expected_by_move:')) return `当前动作要求:${value.replace('expected_by_move:', '')}`;
      if (value.startsWith('not_expected_by_move:')) return `当前动作不要求:${value.replace('not_expected_by_move:', '')}`;
      return value;
    })
    .join(' / ') || null;
  return [{
    key: `${message.id}-move`,
    speakerName: resolveDisplayName(message.senderId, members) || message.senderName,
    moveType: move,
    reason,
    artifactStatus,
  }];
}

export function projectDeliberationDebugProjection(params: {
  messages: Message[];
  members?: AICharacter[];
  language?: string;
  limit?: number;
}): DeliberationDebugProjection {
  const members = params.members || [];
  const isZh = (params.language || 'zh').startsWith('zh');
  const recent = visibleDebugMessages(params.messages).slice(-(params.limit || 12));
  const artifacts: DeliberationDebugItem[] = [];
  const presence: PresenceDebugItem[] = [];
  const moves: ConversationMoveDebugItem[] = [];

  recent.forEach((message) => {
    const speakerName = resolveDisplayName(message.senderId, members) || message.senderName;
    const source = message.metadata?.deliberationArtifacts;
    source?.claims?.forEach((item, index) => {
      artifacts.push({
        key: `${message.id}-claim-${index}`,
        category: 'claim',
        label: categoryLabel('claim', isZh),
        speakerName,
        text: compactDebugText(item.text, members),
        reason: compactDebugText(item.reason, members, 90) || null,
        confidence: safeConfidence(item.confidence),
      });
    });
    source?.evidence?.forEach((item, index) => {
      artifacts.push({
        key: `${message.id}-evidence-${index}`,
        category: 'evidence',
        label: categoryLabel('evidence', isZh),
        speakerName,
        text: compactDebugText(item.text, members),
        reason: compactDebugText(item.reason, members, 90) || null,
        confidence: safeConfidence(item.confidence),
      });
    });
    source?.issues?.forEach((item, index) => {
      artifacts.push({
        key: `${message.id}-issue-${index}`,
        category: 'issue',
        label: categoryLabel('issue', isZh),
        speakerName,
        text: compactDebugText(item.text, members),
        reason: compactDebugText(item.reason, members, 90) || null,
        confidence: safeConfidence(item.confidence),
      });
    });
    source?.verdicts?.forEach((item, index) => {
      artifacts.push({
        key: `${message.id}-verdict-${index}`,
        category: 'verdict',
        label: categoryLabel('verdict', isZh),
        speakerName,
        text: compactDebugText(item.text, members),
        reason: compactDebugText(item.reason, members, 90) || null,
        confidence: safeConfidence(item.confidence),
      });
    });
    if (source?.summary?.text) {
      artifacts.push({
        key: `${message.id}-summary`,
        category: 'summary',
        label: categoryLabel('summary', isZh),
        speakerName,
        text: compactDebugText(source.summary.text, members),
        reason: compactDebugText(source.summary.reason, members, 90) || null,
        confidence: safeConfidence(source.summary.confidence),
      });
    }

    const update = message.metadata?.presenceUpdate;
    if (update) {
      presence.push({
        key: `${message.id}-presence`,
        speakerName,
        status: update.status,
        activity: compactDebugText(update.activity, members, 60) || null,
        reason: compactDebugText(update.reason, members, 90) || null,
        durationMinutes: typeof update.durationMinutes === 'number' && Number.isFinite(update.durationMinutes) ? Math.round(update.durationMinutes) : null,
      });
    }

    moves.push(...extractMoveHints(message, members));
  });

  return {
    counts: {
      claims: artifacts.filter((item) => item.category === 'claim').length,
      evidence: artifacts.filter((item) => item.category === 'evidence').length,
      issues: artifacts.filter((item) => item.category === 'issue').length,
      verdicts: artifacts.filter((item) => item.category === 'verdict').length,
      summaries: artifacts.filter((item) => item.category === 'summary').length,
      presenceUpdates: presence.length,
      moveHints: moves.length,
    },
    artifacts: artifacts.filter((item) => item.text).slice(-10).reverse(),
    presence: presence.slice(-8).reverse(),
    moves: moves.slice(-8).reverse(),
  };
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

export function projectProjectionMetaLine(item: ProjectedRuntimeTimelineItem, isZh: boolean, members: AICharacter[] = []) {
  const projection = readProjectionInfoMeta(item);
  const projectionKind = projection?.projectionKind || null;
  const topicSnippet = projection?.topicSnippet || null;
  const participantNames = (projection?.participantNames || []).map((name) => resolveDisplayName(name, members));
  if (!projectionKind && !topicSnippet && !participantNames.length) return null;
  return sanitizeUserFacingText(
    [formatProjectionKind(projectionKind, isZh), participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · '),
    members,
  );
}

export function projectTimelineGuidanceMetaLine(item: ProjectedRuntimeTimelineItem, isZh: boolean, members: AICharacter[] = []) {
  const guidance = readGuidanceInfoMeta(item);
  if (!guidance) return null;
  const kindLabel = guidance.kind === 'media_request'
    ? (isZh ? '媒体请求' : 'Media request')
    : guidance.kind === 'direct_reply'
      ? (isZh ? '点名回应' : 'Direct reply')
      : (isZh ? '话题引导' : 'Topic guidance');
  const actorNames = (guidance.actorNames || []).map((name) => resolveDisplayName(name, members)).join('、');
  const subjectNames = (guidance.subjectNames || []).map((name) => resolveDisplayName(name, members)).join('、');
  const subjectText = resolveDisplayName(guidance.subjectText || '', members);
  return sanitizeUserFacingText([
    kindLabel,
    actorNames ? `${isZh ? '执行' : 'Actors'} ${actorNames}` : '',
    subjectNames ? `${isZh ? '图片对象' : 'Image subject'} ${subjectNames}` : '',
    !subjectNames && subjectText ? `${isZh ? '图片对象' : 'Image subject'} ${subjectText}` : '',
  ].filter(Boolean).join(' · '), members);
}

export function projectTimelineAttentionMetaLine(item: ProjectedRuntimeTimelineItem, isZh: boolean, members: AICharacter[] = []) {
  return formatAttentionDebugLine({
    candidate: item.meta?.socialEventCandidate,
    language: isZh ? 'zh' : 'en',
    reasonMax: 120,
    members: members.map((member) => ({ id: member.id, name: member.name })),
  });
}

export function projectCalendarPatchMeta(item: ProjectedRuntimeTimelineItem, isZh: boolean, members: AICharacter[] = []) {
  if (item.event?.kind !== 'calendar_item_patch') return null;
  const displayMembers = [
    { id: 'user', name: '我' },
    ...members.map((member) => ({ id: member.id, name: member.name })),
  ];
  return {
    title: buildCalendarPatchTimelineTitle(item.event, isZh),
    summary: buildCalendarPatchSummary(item.event, isZh, displayMembers),
    chips: buildCalendarPatchDebugChips(item.event, isZh),
  };
}

export function projectProjectionTitle(item: ProjectedRuntimeTimelineItem, isZh: boolean) {
  const projectionKind = readProjectionInfoMeta(item)?.projectionKind || '';
  return formatProjectionKind(projectionKind, isZh) || formatEventKind(item.event?.kind || 'artifact', isZh);
}

export function projectProjectionDescription(item: ProjectedRuntimeTimelineItem, members: AICharacter[] = []) {
  const projection = readProjectionInfoMeta(item);
  const participantNames = (projection?.participantNames || []).map((name) => resolveDisplayName(name, members));
  const topicSnippet = projection?.topicSnippet || null;
  return sanitizeUserFacingText([participantNames.length ? participantNames.join(' ↔ ') : null, topicSnippet].filter(Boolean).join(' · '), members);
}

export function projectDialogueStructuredEventCard(item: ProjectedRuntimeTimelineItem, isZh: boolean, members: AICharacter[] = []): DialogueStructuredEventCard {
  const calendarPatchMeta = projectCalendarPatchMeta(item, isZh, members);
  return {
    title: calendarPatchMeta?.title || projectEventKindLabel(item.event?.kind || 'artifact', isZh),
    timestampLabel: new Date(item.createdAt).toLocaleString(),
    bodyText: sanitizeUserFacingText(item.text, members),
    summaryText: calendarPatchMeta?.summary ? sanitizeUserFacingText(calendarPatchMeta.summary, members) : null,
    chips: calendarPatchMeta?.chips || [],
    guidanceMetaLine: projectTimelineGuidanceMetaLine(item, isZh, members),
    attentionMetaLine: projectTimelineAttentionMetaLine(item, isZh, members),
    projectionMetaLine: projectProjectionMetaLine(item, isZh, members),
  };
}
