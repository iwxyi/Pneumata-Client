import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { RelationshipLedgerEntry, RuntimeEventV2 } from '../types/runtimeEvent';
import type {
  SessionExpressionPlan,
  SessionGenerationRuntimeBundle,
  SessionHumanAppraisalMoveBias,
  SessionHumanAppraisalPatch,
  SessionMoveClass,
  SessionRealizationPlan,
  SessionRuntimeContextBundle,
  SessionTurnPlan,
} from '../types/sessionEngine';
import { getHumanAppraisalRuntimeConfig } from './humanAppraisalRuntimeConfig';

const NO_APPRAISAL: SessionHumanAppraisalPatch = {
  moveBias: 'none',
  strength: 'none',
  publicSafe: true,
  reasonTags: [],
  sourceEventIds: [],
};

const CLOSED_PROMISE_ACTIONS = new Set(['fulfilled', 'revoked', 'blocked', 'stale', 'suppressed', 'skipped']);
const VAGUE_FUTURE_RE = /(下次|改天|以后|回头|有空|晚点|过几天|以后再说|再说|一定|会的|再约|later|next time|someday)/i;
const REMEMBERED_RE = /(还记得|记得|没忘|你居然记得|你还记着|想起|remembered|you remember)/i;
const REPAIR_RE = /(你|刚才|刚刚|那句|前面).{0,20}(说重|说过|过分|敷衍|冷淡|太凶|伤人|难受|不舒服|生气|失望|别这样)/;
const EXPLICIT_TASK_RE = /(写|生成|总结|分析|解释|翻译|代码|实现|修复|测试|构建|搜索|查一下|计算|方案|步骤|报告|文章|作文|发图|画图|图片|表格|清单|how to|explain|summari[sz]e|write|generate|implement|fix|test|build|search|calculate)/i;

function visibleLatest(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1) || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textOf(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function payloadOf(event: RuntimeEventV2) {
  return isRecord(event.payload) ? event.payload : {};
}

function eventTypeOf(event: RuntimeEventV2) {
  const payload = payloadOf(event);
  return textOf(payload.eventType) || String(event.kind || '');
}

function eventActionOf(event: RuntimeEventV2) {
  return textOf(payloadOf(event).action).toLowerCase();
}

function eventParticipantIds(event: RuntimeEventV2) {
  const payload = payloadOf(event);
  return Array.from(new Set([
    ...stringArray(payload.participantIds),
    ...stringArray(payload.visibleToIds),
    ...stringArray(event.actorIds),
    ...stringArray(event.targetIds),
    textOf(payload.characterId),
    textOf(payload.actorId),
    textOf(payload.targetId),
  ].filter(Boolean)));
}

function eventIsPublicSafeForChat(chat: GroupChat, event: RuntimeEventV2) {
  if (chat.type !== 'group') return true;
  const visibility = event.visibility || 'public';
  return visibility === 'public' || visibility === 'derived_public';
}

function eventMentions(event: RuntimeEventV2, actorId: string, targetId?: string | null) {
  const participantIds = eventParticipantIds(event);
  if (!participantIds.includes(actorId)) return false;
  if (!targetId) return true;
  return participantIds.includes(targetId) || participantIds.includes('user');
}

function isExplicitTask(text: string) {
  return EXPLICIT_TASK_RE.test(text);
}

function relationshipForTarget(entries: RelationshipLedgerEntry[] | undefined, actorId: string, targetId: string | null | undefined) {
  if (!targetId) return null;
  return (entries || []).find((entry) => entry.actorId === actorId && entry.targetId === targetId) || null;
}

function relationshipIsGuarded(entry: RelationshipLedgerEntry | null) {
  if (!entry) return false;
  const semantic = entry.derived?.semantic;
  const labels = semantic?.labels || [];
  return entry.current.threat >= 42
    || entry.current.trust <= -26
    || labels.some((label) => /戒备|失望|裂痕|破裂|厌烦|憎恶/.test(label))
    || semantic?.stage === '紧张对峙'
    || semantic?.stage === '破裂边缘';
}

function relationshipSourceIds(entry: RelationshipLedgerEntry | null) {
  return (entry?.recentEvents || []).slice(-3).map((event) => event.id).filter(Boolean);
}

function findOpenPromiseEvent(params: {
  chat: GroupChat;
  events: RuntimeEventV2[];
  speakerId: string;
  targetId?: string | null;
}) {
  return [...params.events].reverse().find((event) => {
    if (eventTypeOf(event) !== 'companionship_promise') return false;
    if (CLOSED_PROMISE_ACTIONS.has(eventActionOf(event))) return false;
    if (!eventMentions(event, params.speakerId, params.targetId)) return false;
    return eventIsPublicSafeForChat(params.chat, event);
  }) || null;
}

function compactPatch(input: SessionHumanAppraisalPatch): SessionHumanAppraisalPatch {
  return {
    ...input,
    reasonTags: Array.from(new Set(input.reasonTags)).slice(0, 6),
    sourceEventIds: Array.from(new Set(input.sourceEventIds)).slice(0, 6),
  };
}

function patch(params: {
  moveBias: SessionHumanAppraisalMoveBias;
  strength?: 'low' | 'medium';
  expressionBias?: SessionHumanAppraisalPatch['expressionBias'];
  publicSafe?: boolean;
  reasonTags: string[];
  sourceEventIds?: string[];
  hiddenHint?: string | null;
}): SessionHumanAppraisalPatch {
  return compactPatch({
    moveBias: params.moveBias,
    strength: params.strength || 'low',
    expressionBias: params.expressionBias,
    publicSafe: params.publicSafe ?? true,
    reasonTags: params.reasonTags,
    sourceEventIds: params.sourceEventIds || [],
    hiddenHint: params.hiddenHint || null,
  });
}

function storyChoiceConsequencePatch(chat: GroupChat, speaker: AICharacter) {
  const selectedChoice = chat.scenarioState?.selectedChoice;
  if (chat.sessionKind?.scenarioId !== 'story-reader' || speaker.id !== 'narrator' || !selectedChoice) return null;
  return patch({
    moveBias: 'insist',
    strength: 'low',
    reasonTags: ['story_choice_consequence', 'irreversible_choice'],
    sourceEventIds: [],
    hiddenHint: null,
  });
}

export function buildHumanAppraisalPatch(params: {
  chat: GroupChat;
  speaker: AICharacter;
  messages: Message[];
}): SessionHumanAppraisalPatch {
  if (!getHumanAppraisalRuntimeConfig().enabled) return NO_APPRAISAL;

  const storyPatch = storyChoiceConsequencePatch(params.chat, params.speaker);
  if (storyPatch) return storyPatch;

  const latest = visibleLatest(params.messages);
  if (!latest || latest.senderId === params.speaker.id || latest.type !== 'user') return NO_APPRAISAL;
  const latestText = latest.content.trim();
  if (!latestText) return NO_APPRAISAL;

  const targetId = latest.senderId || 'user';
  const relationship = relationshipForTarget(params.chat.relationshipLedger, params.speaker.id, targetId);

  if (REPAIR_RE.test(latestText)) {
    return patch({
      moveBias: 'repair',
      expressionBias: { warmth: 'up', directness: 'down', restraint: 'up', length: 'shorter' },
      reasonTags: ['possible_recent_hurt', 'repairable_relation'],
      sourceEventIds: relationshipSourceIds(relationship),
      hiddenHint: '隐性行为偏置：先补救可能造成的误伤，少解释原因，不要煽情。',
    });
  }

  if (isExplicitTask(latestText)) return NO_APPRAISAL;

  const openPromise = VAGUE_FUTURE_RE.test(latestText)
    ? findOpenPromiseEvent({
      chat: params.chat,
      events: params.chat.runtimeEventsV2 || [],
      speakerId: params.speaker.id,
      targetId,
    })
    : null;

  if (openPromise) {
    return patch({
      moveBias: 'ask_followup',
      expressionBias: { directness: 'up', restraint: 'up' },
      reasonTags: ['unfinished_promise', 'vague_future_commitment'],
      sourceEventIds: [openPromise.id],
      hiddenHint: '隐性行为偏置：更在意对方这次是否认真；只轻追问，不翻旧账。',
    });
  }

  if (REMEMBERED_RE.test(latestText)) {
    return patch({
      moveBias: 'soften',
      expressionBias: { warmth: 'up', directness: 'down' },
      reasonTags: ['joy_residue', 'remembered_by_target'],
      sourceEventIds: relationshipSourceIds(relationship),
      hiddenHint: '隐性行为偏置：被认真记住后语气可以稍软；不要表白或解释机制。',
    });
  }

  if (relationshipIsGuarded(relationship)) {
    return patch({
      moveBias: 'withdraw',
      expressionBias: { warmth: 'down', restraint: 'up', length: 'shorter' },
      reasonTags: ['guarded_after_hurt', 'relationship_threat'],
      sourceEventIds: relationshipSourceIds(relationship),
      hiddenHint: '隐性行为偏置：本轮更克制、更短；不要解释旧事或扩大冲突。',
    });
  }

  return NO_APPRAISAL;
}

export function isHumanAppraisalActive(
  patchValue: Pick<Partial<SessionHumanAppraisalPatch>, 'moveBias' | 'strength'> | null | undefined,
) {
  return Boolean(patchValue && patchValue.moveBias !== 'none' && patchValue.strength !== 'none');
}

type PublicHumanAppraisalTraceInput = Partial<SessionHumanAppraisalPatch> & {
  sourceEventCount?: number;
};

export function buildPublicHumanAppraisalTrace(patchValue: PublicHumanAppraisalTraceInput | null | undefined) {
  if (!patchValue || patchValue.moveBias === 'none' || patchValue.strength === 'none') return null;
  const reasonTags = Array.isArray(patchValue.reasonTags) ? patchValue.reasonTags : [];
  const sourceEventIds = Array.isArray(patchValue.sourceEventIds) ? patchValue.sourceEventIds : [];
  const sourceEventCount = typeof patchValue.sourceEventCount === 'number'
    ? patchValue.sourceEventCount
    : sourceEventIds.length || undefined;
  return {
    moveBias: patchValue.moveBias,
    strength: patchValue.strength,
    publicSafe: patchValue.publicSafe,
    reasonTags: reasonTags.slice(0, 6),
    sourceEventCount,
  };
}

function moveBiasToMoveClass(moveBias: SessionHumanAppraisalMoveBias, current: SessionMoveClass): SessionMoveClass {
  if (moveBias === 'repair') return 'repair';
  if (moveBias === 'soften') return 'stabilize';
  if (moveBias === 'insist' || moveBias === 'challenge') return 'challenge';
  if (moveBias === 'ask_followup') return current === 'respond' ? 'respond' : 'deepen';
  return current;
}

function shortenDepth(depth: SessionTurnPlan['depth']) {
  return depth === 'deep' ? 'normal' : depth === 'normal' ? 'brief' : depth;
}

export function applyHumanAppraisalToTurnPlan(turnPlan: SessionTurnPlan, appraisal: SessionHumanAppraisalPatch): SessionTurnPlan {
  if (!isHumanAppraisalActive(appraisal)) return turnPlan;
  return {
    ...turnPlan,
    moveClass: moveBiasToMoveClass(appraisal.moveBias, turnPlan.moveClass),
    depth: appraisal.expressionBias?.length === 'shorter' ? shortenDepth(turnPlan.depth) : turnPlan.depth,
    reason: `${turnPlan.reason}:human_appraisal:${appraisal.moveBias}`,
  };
}

export function applyHumanAppraisalToExpressionPlan(expressionPlan: SessionExpressionPlan, appraisal: SessionHumanAppraisalPatch): SessionExpressionPlan {
  if (!isHumanAppraisalActive(appraisal)) return expressionPlan;
  return {
    ...expressionPlan,
    ...(appraisal.expressionBias?.length === 'shorter' ? { texture: 'terse' as const } : {}),
    ...(appraisal.expressionBias?.warmth === 'up' ? { emotionalPosture: 'warm' as const } : {}),
    ...(appraisal.expressionBias?.warmth === 'down' ? { emotionalPosture: 'defensive' as const } : {}),
  };
}

function applyHumanAppraisalToRealizationPlan(realizationPlan: SessionRealizationPlan | undefined, appraisal: SessionHumanAppraisalPatch) {
  if (!realizationPlan || !isHumanAppraisalActive(appraisal)) return realizationPlan;
  const moveClass = moveBiasToMoveClass(appraisal.moveBias, realizationPlan.moveClass);
  return {
    ...realizationPlan,
    moveClass,
    ...(appraisal.expressionBias?.length === 'shorter' ? { surfaceDepth: shortenDepth(realizationPlan.surfaceDepth || 'normal') } : {}),
    ...(appraisal.moveBias === 'repair' || appraisal.moveBias === 'soften' ? { functionTag: 'comfort' as const } : {}),
    ...(appraisal.moveBias === 'insist' || appraisal.moveBias === 'challenge' ? { functionTag: 'challenge' as const } : {}),
  };
}

export function applyHumanAppraisalToRuntimeBundle<T extends SessionRuntimeContextBundle | SessionGenerationRuntimeBundle>(
  bundle: T,
  appraisal: SessionHumanAppraisalPatch,
): T {
  if (!isHumanAppraisalActive(appraisal)) return bundle;
  if (bundle.trace?.humanAppraisal) return bundle;
  return {
    ...bundle,
    turnPlan: bundle.turnPlan ? applyHumanAppraisalToTurnPlan(bundle.turnPlan, appraisal) : bundle.turnPlan,
    expressionPlan: bundle.expressionPlan ? applyHumanAppraisalToExpressionPlan(bundle.expressionPlan, appraisal) : bundle.expressionPlan,
    realizationPlan: applyHumanAppraisalToRealizationPlan(bundle.realizationPlan, appraisal),
    trace: {
      ...(bundle.trace || {}),
      humanAppraisal: appraisal,
      policyHits: [...(bundle.trace?.policyHits || []), `human_appraisal:${appraisal.moveBias}`, ...appraisal.reasonTags],
    },
  };
}

export function enrichRuntimeBundleWithHumanAppraisal<T extends SessionRuntimeContextBundle | SessionGenerationRuntimeBundle>(params: {
  bundle: T;
  chat: GroupChat;
  speaker: AICharacter;
  messages: Message[];
}): T {
  if (params.bundle.trace?.humanAppraisal) return params.bundle;
  const appraisal = buildHumanAppraisalPatch(params);
  return applyHumanAppraisalToRuntimeBundle(params.bundle, appraisal);
}
