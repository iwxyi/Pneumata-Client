import type { DriverMessageCommitResult, GroupChat } from '../../types/chat';
import { createDefaultConversationEngineDefinition } from '../../types/sessionEngine';
import type { SessionEngineDefinition } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import type {
  InteractionEventPayload,
  DirectorInterventionPayload,
  MemoryCandidatePayload,
  RuntimeEventV2,
  SocialEventCandidatePayload,
  SocialEventHintEnvelope,
  SocialOutingAnalysisResult,
  PostMomentAnalysisResult,
  PairPrivateThreadAnalysisResult,
} from '../../types/runtimeEvent';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../../types/chat';
import { buildChatPatch, buildNextWorldState, buildRelationshipTransition, buildWorldRuntimeEvents } from '../chatRuntimeTransitionBuilder';
import { judgeInteractionEvent } from '../interactionJudge';
import { getRelationshipLedgerEntry, inferRelationshipDelta, reduceRelationshipLedger, summarizeRelationshipDelta, getRelationshipDeltaDirection } from '../relationshipLedger';
import { calculateRoomShift } from '../roomStateSynthesizer';
import { resolveRuntimeEvolutionConfig } from '../runtimeEvolutionConfig';
import type { APIConfig } from '../../types/settings';
import { generateResponse } from '../aiClient';
import { getGuidanceTargetActorIds, parseUserGuidanceIntent } from '../userGuidanceIntent';

const MAX_OPEN_CHAT_RUNTIME_EVENTS = 120;

type OpenChatCommittedMessage = Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'> & {
  interactionHint?: InteractionEventPayload | null;
  socialEventHints?: SocialEventHintEnvelope[] | null;
  conflictFocus?: import('../../types/runtimeEvent').ConflictFocusPayload | null;
};

function areRuntimeValuesEqual(left: unknown, right: unknown) {
  if (left === right) return true;
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
}

function setChangedChatPatchField<K extends keyof GroupChat>(patch: Partial<GroupChat>, conversation: GroupChat, key: K, value: GroupChat[K]) {
  if (!areRuntimeValuesEqual(value, conversation[key])) {
    patch[key] = value;
  } else {
    delete patch[key];
  }
}

function buildRuntimeEventsDelta(conversation: GroupChat, nextEvents: RuntimeEventV2[]) {
  const previousById = new Map((conversation.runtimeEventsV2 || []).map((event) => [event.id, event] as const));
  const upserts = nextEvents.filter((event) => !areRuntimeValuesEqual(previousById.get(event.id), event));
  if (!upserts.length && nextEvents.length === (conversation.runtimeEventsV2 || []).length) return undefined;
  return {
    orderedIds: nextEvents.map((event) => event.id),
    upserts,
  };
}

function buildRelationshipLedgerDelta(conversation: GroupChat, nextLedger: NonNullable<GroupChat['relationshipLedger']>) {
  const previousByKey = new Map((conversation.relationshipLedger || []).map((entry) => [entry.pairKey, entry] as const));
  const upserts = nextLedger.filter((entry) => !areRuntimeValuesEqual(previousByKey.get(entry.pairKey), entry));
  if (!upserts.length && nextLedger.length === (conversation.relationshipLedger || []).length) return undefined;
  return {
    orderedPairKeys: nextLedger.map((entry) => entry.pairKey),
    upserts,
  };
}

function createRuntimeEventV2(params: {
  conversationId: string;
  kind: RuntimeEventV2['kind'];
  summary: string;
  payload: RuntimeEventV2['payload'];
  actorIds?: string[];
  targetIds?: string[];
  evidenceMessageIds?: string[];
  visibility?: RuntimeEventV2['visibility'];
  visibleToIds?: string[];
  visibleToRoles?: string[];
}): RuntimeEventV2 {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId: params.conversationId,
    kind: params.kind,
    createdAt: Date.now(),
    actorIds: params.actorIds,
    targetIds: params.targetIds,
    evidenceMessageIds: params.evidenceMessageIds,
    summary: params.summary,
    channelId: params.visibility === 'pair_private' ? 'pair-private' : params.visibility === 'moderator_only' ? 'moderator' : 'public',
    eventClass: params.kind === 'artifact' ? 'artifact' : params.kind === 'room_shift' ? 'phase' : params.kind === 'event_candidate' ? 'action' : 'message',
    visibility: params.visibility || 'public',
    visibleToIds: params.visibleToIds,
    visibleToRoles: params.visibleToRoles,
    payload: params.payload,
  };
}

async function resolveInteraction(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: InteractionEventPayload | null; socialEventHints?: SocialEventHintEnvelope[] | null; conflictFocus?: import('../../types/runtimeEvent').ConflictFocusPayload | null };
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}) {
  const hint = params.message.interactionHint || null;
  if (hint?.targetId && (hint.confidence || 0) >= 0.8) return hint;
  if (params.apiConfig) {
    const fallback = await judgeInteractionEvent({
      api: params.apiConfig,
      chat: params.conversation,
      message: { content: params.message.content, senderId: params.message.senderId },
      recentMessages: params.recentMessages || [],
      characters: params.characters,
    });
    if (fallback.interaction) return fallback.interaction;
  }
  return hint;
}

function buildMemoryCandidateFromStructuredEvent(event: RuntimeEventV2): RuntimeEventV2 | null {
  if (event.kind === 'interaction') {
    const payload = event.payload as InteractionEventPayload;
    if (!payload.targetId) return null;
    const memoryPayload: MemoryCandidatePayload = {
      kind: 'relationship',
      text: event.summary.slice(0, 128),
      salience: Math.min(1, 0.45 + (payload.intensity * 0.1)),
      confidence: payload.confidence,
    };
    return createRuntimeEventV2({
      conversationId: event.conversationId,
      kind: 'memory_candidate',
      summary: memoryPayload.text,
      actorIds: event.actorIds,
      targetIds: event.targetIds,
      payload: memoryPayload,
    });
  }
  if (event.kind === 'room_shift') {
    const memoryPayload: MemoryCandidatePayload = {
      kind: 'topic',
      text: event.summary.slice(0, 128),
      salience: 0.58,
      confidence: 0.78,
    };
    return createRuntimeEventV2({
      conversationId: event.conversationId,
      kind: 'memory_candidate',
      summary: memoryPayload.text,
      actorIds: event.actorIds,
      targetIds: event.targetIds,
      payload: memoryPayload,
    });
  }
  return null;
}

function buildArtifactEvent(params: { conversation: GroupChat; message: Pick<Message, 'content' | 'senderId'> }): RuntimeEventV2 | null {
  if (!/(总结|共识|方案|清单|计划|summary|plan|checklist)/i.test(params.message.content)) return null;
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'artifact',
    summary: params.message.content.trim().slice(0, 128),
    actorIds: [params.message.senderId],
    payload: { text: params.message.content.trim().slice(0, 128) },
  });
}

function buildPairPrivateThreadCandidateFromHint(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hint = (params.message.socialEventHints || []).find((item) => item.eventKind === 'pair_private_thread');
  if (!hint || (hint.confidence || 0) < 0.8) return null;
  const participantIds = (hint.participantIds || []).filter((id) => params.conversation.memberIds.includes(id));
  if (participantIds.length !== 2) return null;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'pair_private_thread',
    initiatorId: params.message.senderId,
    participantIds,
    targetIds: hint.targetIds?.filter((id) => params.conversation.memberIds.includes(id)),
    reasonType: hint.reasonType || 'unresolved_question',
    confidence: Math.max(0.8, hint.confidence || 0),
    urgency: hint.urgency || 'soon',
    seedIntent: hint.seedIntent || '想私下继续聊刚才的话题。',
    visibilityPlan: hint.visibilityPlan || 'conversation_private',
    expectedArtifacts: hint.expectedArtifacts || ['private_thread_summary'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: hint.title,
    activityType: hint.activityType,
    timeHint: hint.timeHint ?? null,
    locationHint: hint.locationHint ?? null,
    dedupeKey: hint.dedupeKey ?? null,
  };
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${params.message.senderId} 提议与 ${participantIds.find((id) => id !== params.message.senderId) || participantIds[1]} 发起双人私聊候选`,
    actorIds: [params.message.senderId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload,
  });
}

function buildPairPrivateThreadCandidate(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  relationshipLedger: GroupChat['relationshipLedger'];
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hinted = buildPairPrivateThreadCandidateFromHint(params);
  if (!hinted) return null;
  const payload = hinted.payload as SocialEventCandidatePayload;
  const targetId = payload.targetIds?.[0] || payload.participantIds.find((id) => id !== payload.initiatorId) || null;
  if (!targetId || !params.interaction || params.interaction.targetId !== targetId) return null;
  if (params.interaction.intensity < 3 || params.interaction.confidence < 0.85) return null;
  const relation = getRelationshipLedgerEntry(params.relationshipLedger || [], payload.initiatorId, targetId);
  const hostilePressure = relation?.current.threat || 0;
  const connectivePressure = (relation?.current.warmth || 0) + (relation?.current.competence || 0) + (relation?.current.trust || 0);
  const roomFocus = params.structuredRoomState?.dominantThread?.includes(payload.initiatorId) && params.structuredRoomState?.dominantThread?.includes(targetId);
  const reason = params.interaction.kind;
  const qualifies = (
    (reason === 'probe' || reason === 'challenge') && (hostilePressure >= 8 || roomFocus)
  ) || (
    (reason === 'support' || reason === 'defend') && connectivePressure >= 12 && params.interaction.intensity >= 4
  );
  if (!qualifies) return null;
  return {
    ...hinted,
    payload: {
      ...payload,
      reasonType: payload.reasonType || (reason === 'support' || reason === 'defend' ? 'mutual_affinity' : 'unresolved_question'),
      confidence: Math.max(payload.confidence, roomFocus ? 0.88 : 0.82),
    },
  } satisfies RuntimeEventV2;
}

function buildPostMomentCandidateFromHint(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hint = (params.message.socialEventHints || []).find((item) => item.eventKind === 'post_moment');
  if (!hint || (hint.confidence || 0) < 0.8) return null;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'post_moment',
    initiatorId: params.message.senderId,
    participantIds: [params.message.senderId],
    targetIds: hint.targetIds?.filter((id) => params.conversation.memberIds.includes(id)),
    reasonType: hint.reasonType || 'emotion_release',
    confidence: Math.max(0.8, hint.confidence || 0),
    urgency: hint.urgency || 'soon',
    seedIntent: hint.seedIntent || '想发一条和刚才气氛有关的朋友圈或动态。',
    visibilityPlan: hint.visibilityPlan || 'public',
    expectedArtifacts: hint.expectedArtifacts || ['moment_text'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: hint.title,
    activityType: hint.activityType,
    timeHint: hint.timeHint ?? null,
    locationHint: hint.locationHint ?? null,
    dedupeKey: hint.dedupeKey ?? null,
  };
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${params.message.senderId} 提议发布一条 post_moment 动态`,
    actorIds: [params.message.senderId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload,
  });
}

function buildStatusUpdateCandidateFromHint(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hint = (params.message.socialEventHints || []).find((item) => item.eventKind === 'status_update');
  if (!hint || (hint.confidence || 0) < 0.8) return null;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'status_update',
    initiatorId: params.message.senderId,
    participantIds: [params.message.senderId],
    targetIds: hint.targetIds?.filter((id) => params.conversation.memberIds.includes(id)),
    reasonType: hint.reasonType || 'self_disclosure',
    confidence: Math.max(0.8, hint.confidence || 0),
    urgency: hint.urgency || 'soon',
    seedIntent: hint.seedIntent || '想同步一下自己当前的状态或近况。',
    visibilityPlan: hint.visibilityPlan || 'public',
    expectedArtifacts: hint.expectedArtifacts || ['status_note'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: hint.title || '状态更新',
    activityType: hint.activityType,
    timeHint: hint.timeHint ?? null,
    locationHint: hint.locationHint ?? null,
    dedupeKey: hint.dedupeKey ?? null,
  };
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${params.message.senderId} 提议发布一条状态更新`,
    actorIds: [params.message.senderId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload,
  });
}

function buildStatusUpdateCandidate(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hinted = buildStatusUpdateCandidateFromHint(params);
  if (!hinted) return null;
  const payload = hinted.payload as SocialEventCandidatePayload;
  const text = params.message.content.trim();
  const statusLanguage = /(最近|这两天|我现在|我这边|更新一下|汇报一下|补充一下进展|近况|状态)/i.test(text);
  const roomHeat = params.structuredRoomState?.heat || 0;
  const selfFocused = params.interaction === null || !params.interaction.targetId;
  if (!statusLanguage && !(selfFocused && roomHeat <= 28)) return null;
  return {
    ...hinted,
    payload: {
      ...payload,
      confidence: Math.max(payload.confidence, statusLanguage ? 0.9 : 0.82),
      reasonType: payload.reasonType || 'self_disclosure',
    },
  } satisfies RuntimeEventV2;
}

function buildStatusUpdateArtifactEvents(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}): RuntimeEventV2[] {
  return params.socialEventCandidates
    .filter((event) => (event.payload as SocialEventCandidatePayload).eventKind === 'status_update')
    .map((event) => {
      const payload = event.payload as SocialEventCandidatePayload;
      const actorName = params.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      const text = `${actorName} 更新了一下自己的近况：${payload.activityType || payload.title || '状态更新'}`;
      return createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'artifact',
        summary: text,
        actorIds: [payload.initiatorId],
        targetIds: payload.targetIds,
        visibility: 'derived_public',
        payload: {
          artifactType: 'status_note',
          eventKind: 'status_update',
          text,
          title: payload.title,
          activityType: payload.activityType,
          expectedArtifacts: payload.expectedArtifacts || [],
          dedupeKey: payload.dedupeKey,
        },
      });
    });
}

function buildGiftExchangeCandidateFromHint(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hint = (params.message.socialEventHints || []).find((item) => item.eventKind === 'gift_exchange');
  if (!hint || (hint.confidence || 0) < 0.8) return null;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'gift_exchange',
    initiatorId: params.message.senderId,
    participantIds: (hint.participantIds || [params.message.senderId]).filter((id) => params.conversation.memberIds.includes(id)),
    targetIds: hint.targetIds?.filter((id) => params.conversation.memberIds.includes(id)),
    reasonType: hint.reasonType || 'care_gesture',
    confidence: Math.max(0.8, hint.confidence || 0),
    urgency: hint.urgency || 'soon',
    seedIntent: hint.seedIntent || '想送出一个小礼物或心意。',
    visibilityPlan: hint.visibilityPlan || 'public',
    expectedArtifacts: hint.expectedArtifacts || ['gift_note'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: hint.title || '礼物互动',
    activityType: hint.activityType,
    timeHint: hint.timeHint ?? null,
    locationHint: hint.locationHint ?? null,
    dedupeKey: hint.dedupeKey ?? null,
  };
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${params.message.senderId} 提议触发一次礼物互动`,
    actorIds: [params.message.senderId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload,
  });
}

function buildGiftExchangeCandidate(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hinted = buildGiftExchangeCandidateFromHint(params);
  if (!hinted) return null;
  const payload = hinted.payload as SocialEventCandidatePayload;
  const text = params.message.content.trim();
  const giftLanguage = /(送你|给你带|小礼物|给你买了|请你喝|红包|纪念品|伴手礼)/i.test(text);
  const warmTargeted = Boolean(params.interaction?.targetId && ['support', 'defend'].includes(params.interaction.kind));
  const roomCohesion = params.structuredRoomState?.cohesion || 0;
  if (!giftLanguage && !(warmTargeted && roomCohesion >= 5)) return null;
  return {
    ...hinted,
    payload: {
      ...payload,
      confidence: Math.max(payload.confidence, giftLanguage ? 0.9 : 0.84),
      reasonType: payload.reasonType || 'care_gesture',
    },
  } satisfies RuntimeEventV2;
}

function buildGiftExchangeArtifactEvents(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}): RuntimeEventV2[] {
  return params.socialEventCandidates
    .filter((event) => (event.payload as SocialEventCandidatePayload).eventKind === 'gift_exchange')
    .map((event) => {
      const payload = event.payload as SocialEventCandidatePayload;
      const actorName = params.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      const text = `${actorName} 送出了一个小礼物或心意。`;
      return createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'artifact',
        summary: text,
        actorIds: [payload.initiatorId],
        targetIds: payload.targetIds,
        visibility: 'derived_public',
        payload: {
          artifactType: 'gift_note',
          eventKind: 'gift_exchange',
          text,
          title: payload.title,
          activityType: payload.activityType,
          expectedArtifacts: payload.expectedArtifacts || [],
          dedupeKey: payload.dedupeKey,
        },
      });
    });
}

function shouldAutoBackflowGiftExchange(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !(chat.runtimeEventsV2 || []).some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'gift_note' && (event.payload as { eventKind?: string }).eventKind === 'gift_exchange' && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload) && event.createdAt >= createdAt);
}

function buildConflictExpressionCandidateFromHint(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hint = (params.message.socialEventHints || []).find((item) => item.eventKind === 'conflict_expression');
  if (!hint || (hint.confidence || 0) < 0.8) return null;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'conflict_expression',
    initiatorId: params.message.senderId,
    participantIds: (hint.participantIds || [params.message.senderId]).filter((id) => params.conversation.memberIds.includes(id)),
    targetIds: hint.targetIds?.filter((id) => params.conversation.memberIds.includes(id)),
    reasonType: hint.reasonType || 'frustration',
    confidence: Math.max(0.8, hint.confidence || 0),
    urgency: hint.urgency || 'soon',
    seedIntent: hint.seedIntent || '想把刚才的不满直接表达出来。',
    visibilityPlan: hint.visibilityPlan || 'public',
    expectedArtifacts: hint.expectedArtifacts || ['conflict_note'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: hint.title || '冲突表达',
    activityType: hint.activityType,
    timeHint: hint.timeHint ?? null,
    locationHint: hint.locationHint ?? null,
    dedupeKey: hint.dedupeKey ?? null,
  };
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${params.message.senderId} 提议触发一次冲突表达`,
    actorIds: [params.message.senderId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload,
  });
}

function buildConflictExpressionCandidate(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hinted = buildConflictExpressionCandidateFromHint(params);
  if (!hinted) return null;
  const payload = hinted.payload as SocialEventCandidatePayload;
  const text = params.message.content.trim();
  const conflictLanguage = /(受不了|不爽|别这样|你这也太|真无语|我很不满|吵起来|翻脸)/i.test(text);
  const conflictTargeted = Boolean(params.interaction?.targetId && ['challenge', 'mock', 'dismiss', 'pile_on'].includes(params.interaction.kind));
  const roomHeat = params.structuredRoomState?.heat || 0;
  if (!conflictLanguage && !conflictTargeted && roomHeat < 24) return null;
  return {
    ...hinted,
    payload: {
      ...payload,
      confidence: Math.max(payload.confidence, conflictTargeted ? 0.9 : conflictLanguage ? 0.88 : 0.82),
      reasonType: payload.reasonType || 'frustration',
    },
  } satisfies RuntimeEventV2;
}

function buildConflictExpressionArtifactEvents(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}): RuntimeEventV2[] {
  return params.socialEventCandidates
    .filter((event) => (event.payload as SocialEventCandidatePayload).eventKind === 'conflict_expression')
    .map((event) => {
      const payload = event.payload as SocialEventCandidatePayload;
      const actorName = params.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      const text = `${actorName} 把刚才的矛盾直接摊开说了。`;
      return createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'artifact',
        summary: text,
        actorIds: [payload.initiatorId],
        targetIds: payload.targetIds,
        visibility: 'derived_public',
        payload: {
          artifactType: 'conflict_note',
          eventKind: 'conflict_expression',
          text,
          title: payload.title,
          activityType: payload.activityType,
          expectedArtifacts: payload.expectedArtifacts || [],
          dedupeKey: payload.dedupeKey,
        },
      });
    });
}

function shouldAutoBackflowStatusUpdate(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !(chat.runtimeEventsV2 || []).some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'status_note' && (event.payload as { eventKind?: string }).eventKind === 'status_update' && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload) && event.createdAt >= createdAt);
}

void buildGiftExchangeCandidate;
void buildGiftExchangeCandidateFromHint;
void buildGiftExchangeArtifactEvents;
void buildStatusUpdateCandidate;
void buildStatusUpdateCandidateFromHint;
void buildStatusUpdateArtifactEvents;

function buildRecentSocialEventContext(chat: GroupChat, eventKind?: SocialEventCandidatePayload['eventKind']) {
  return (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'event_candidate' || event.kind === 'artifact')
    .filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return typeof payload.eventKind === 'string' && (!eventKind || payload.eventKind === eventKind);
    })
    .slice(-8)
    .map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return {
        title: typeof payload.title === 'string' ? payload.title : undefined,
        activityType: typeof payload.activityType === 'string' ? payload.activityType : null,
        timeHint: typeof payload.timeHint === 'string' ? payload.timeHint : null,
        locationHint: typeof payload.locationHint === 'string' ? payload.locationHint : null,
        dedupeKey: typeof payload.dedupeKey === 'string' ? payload.dedupeKey : null,
        participantIds: Array.isArray(payload.participantIds) ? payload.participantIds.filter((id): id is string => typeof id === 'string') : [],
        targetIds: Array.isArray(event.targetIds) ? event.targetIds : [],
        summary: event.summary,
      };
    });
}

function buildCharacterReference(characters: AICharacter[]) {
  return characters.map((character) => `- id=${character.id}; name=${character.name}`).join('\n');
}

function cleanJson(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : raw.trim();
}

function normalizeOutingParticipantIds(ids: unknown, conversation: GroupChat, fallbackId: string) {
  if (!Array.isArray(ids)) return [fallbackId];
  const filtered = ids.filter((id): id is string => typeof id === 'string' && conversation.memberIds.includes(id));
  return filtered.length ? Array.from(new Set(filtered)) : [fallbackId];
}

function toSocialOutingHint(result: SocialOutingAnalysisResult | null, conversation: GroupChat, senderId: string): SocialEventHintEnvelope | null {
  if (!result?.shouldCreate || (result.confidence || 0) < 0.8) return null;
  return {
    eventKind: 'social_outing',
    participantIds: normalizeOutingParticipantIds(result.participantIds, conversation, senderId),
    reasonType: result.reasonType || 'celebration',
    confidence: Math.max(0.8, result.confidence || 0),
    urgency: 'soon',
    seedIntent: result.seedIntent || '想把刚才群里的热络气氛延续成一次线下活动。',
    visibilityPlan: 'public',
    expectedArtifacts: ['outing_summary', 'group_photo', 'food_photo'],
    title: result.title || '线下活动',
    activityType: result.activityType || undefined,
    timeHint: result.timeHint ?? null,
    locationHint: result.locationHint ?? null,
    dedupeKey: result.dedupeKey ?? null,
  };
}

async function analyzeSocialOuting(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'>;
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}): Promise<SocialOutingAnalysisResult | null> {
  if (!params.apiConfig) return null;
  const recentTranscript = (params.recentMessages || [])
    .filter((message) => !message.isDeleted && message.type !== 'system')
    .slice(-8)
    .map((message) => `${message.senderName}: ${message.content}`)
    .join('\n');
  const recentOutings = buildRecentSocialEventContext(params.conversation, 'social_outing')
    .map((outing) => `- ${outing.title}${outing.activityType ? ` / ${outing.activityType}` : ''}${outing.timeHint ? ` / ${outing.timeHint}` : ''}${outing.locationHint ? ` / ${outing.locationHint}` : ''}: ${outing.summary}`)
    .join('\n');
  const prompt = `你是群聊社交事件分析器。判断这条新消息是否真的在提议一次线下活动。\n\n只输出 JSON：\n{\n  "shouldCreate": boolean,\n  "title": string | null,\n  "activityType": string | null,\n  "timeHint": string | null,\n  "locationHint": string | null,\n  "participantIds": string[] | null,\n  "confidence": number,\n  "reasonType": string | null,\n  "dedupeKey": string | null,\n  "seedIntent": string | null\n}\n\n要求：\n1. 不要靠关键词机械判断，只有明确在推动“线下活动真的可能发生”时才 shouldCreate=true。\n2. 标题用泛化层级，例如“线下活动”。具体内容放 activityType。\n3. 如果这条消息和最近已有活动是同一件事，返回相同 dedupeKey。\n4. participantIds 必须来自以下成员 id。\n5. 拿不准就 shouldCreate=false 或降低 confidence。\n\n成员：\n${buildCharacterReference(params.characters.filter((character) => params.conversation.memberIds.includes(character.id)))}\n\n最近对话：\n${recentTranscript}\n\n最近线下活动：\n${recentOutings || '无'}\n\n当前消息（speakerId=${params.message.senderId}）：\n${params.message.content}`;
  try {
    const raw = await generateResponse(params.apiConfig, prompt, [{ role: 'user', content: '只输出 JSON。' }]);
    return JSON.parse(cleanJson(raw)) as SocialOutingAnalysisResult;
  } catch {
    return null;
  }
}

function toPostMomentHint(result: PostMomentAnalysisResult | null, conversation: GroupChat, senderId: string): SocialEventHintEnvelope | null {
  if (!result?.shouldCreate || (result.confidence || 0) < 0.8) return null;
  return {
    eventKind: 'post_moment',
    participantIds: [senderId],
    targetIds: result.targetIds?.filter((id) => conversation.memberIds.includes(id)),
    reasonType: result.reasonType || 'emotion_release',
    confidence: Math.max(0.8, result.confidence || 0),
    urgency: 'soon',
    seedIntent: result.seedIntent || '想发一条和刚才气氛有关的朋友圈或动态。',
    visibilityPlan: 'public',
    expectedArtifacts: ['moment_text'],
    title: result.title,
    activityType: result.activityType,
    dedupeKey: result.dedupeKey ?? null,
  };
}

async function analyzePostMoment(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'>;
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}): Promise<PostMomentAnalysisResult | null> {
  if (!params.apiConfig) return null;
  const recentTranscript = (params.recentMessages || [])
    .filter((message) => !message.isDeleted && message.type !== 'system')
    .slice(-8)
    .map((message) => `${message.senderName}: ${message.content}`)
    .join('\n');
  const recentMoments = buildRecentSocialEventContext(params.conversation, 'post_moment')
    .map((event) => `- ${event.title || '动态'}${event.activityType ? ` / ${event.activityType}` : ''}: ${event.summary}`)
    .join('\n');
  const prompt = `你是群聊社交事件分析器。判断这条新消息之后，角色是否很可能会发一条朋友圈/动态。\n\n只输出 JSON：\n{\n  "shouldCreate": boolean,\n  "title": string | null,\n  "activityType": string | null,\n  "targetIds": string[] | null,\n  "confidence": number,\n  "reasonType": string | null,\n  "dedupeKey": string | null,\n  "seedIntent": string | null\n}\n\n要求：\n1. 不要靠关键词机械判断，只有在角色真的有“分享/吐槽/记录/阴阳外显”冲动时才 shouldCreate=true。\n2. 如果只是普通聊天，不要创建动态。\n3. 如果和最近已有动态是同一条语义，返回相同 dedupeKey。\n4. targetIds 如有，必须来自成员 id。\n5. 拿不准就 shouldCreate=false 或降低 confidence。\n\n成员：\n${buildCharacterReference(params.characters.filter((character) => params.conversation.memberIds.includes(character.id)))}\n\n最近对话：\n${recentTranscript}\n\n最近动态：\n${recentMoments || '无'}\n\n当前消息（speakerId=${params.message.senderId}）：\n${params.message.content}`;
  try {
    const raw = await generateResponse(params.apiConfig, prompt, [{ role: 'user', content: '只输出 JSON。' }]);
    return JSON.parse(cleanJson(raw)) as PostMomentAnalysisResult;
  } catch {
    return null;
  }
}

function toPairPrivateThreadHint(result: PairPrivateThreadAnalysisResult | null, conversation: GroupChat, senderId: string): SocialEventHintEnvelope | null {
  if (!result?.shouldCreate || (result.confidence || 0) < 0.8) return null;
  const participantIds = Array.isArray(result.participantIds)
    ? result.participantIds.filter((id) => conversation.memberIds.includes(id))
    : [];
  if (participantIds.length !== 2) return null;
  return {
    eventKind: 'pair_private_thread',
    participantIds,
    targetIds: result.targetIds?.filter((id) => conversation.memberIds.includes(id)),
    reasonType: result.reasonType || 'unresolved_question',
    confidence: Math.max(0.8, result.confidence || 0),
    urgency: 'soon',
    seedIntent: result.seedIntent || '想私下继续聊刚才的话题。',
    visibilityPlan: 'conversation_private',
    expectedArtifacts: ['private_thread_summary'],
    dedupeKey: result.dedupeKey ?? `${senderId}::${participantIds.filter((id) => id !== senderId)[0] || participantIds[1]}`,
  };
}

async function analyzePairPrivateThread(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'>;
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}): Promise<PairPrivateThreadAnalysisResult | null> {
  if (!params.apiConfig) return null;
  const recentTranscript = (params.recentMessages || [])
    .filter((message) => !message.isDeleted && message.type !== 'system')
    .slice(-8)
    .map((message) => `${message.senderName}: ${message.content}`)
    .join('\n');
  const recentPrivateThreads = buildRecentSocialEventContext(params.conversation, 'pair_private_thread')
    .map((event) => `- ${event.summary}`)
    .join('\n');
  const prompt = `你是群聊社交事件分析器。判断这条新消息之后，角色是否很可能想和某个具体成员私下继续聊。\n\n只输出 JSON：\n{\n  "shouldCreate": boolean,\n  "participantIds": string[] | null,\n  "targetIds": string[] | null,\n  "confidence": number,\n  "reasonType": string | null,\n  "dedupeKey": string | null,\n  "seedIntent": string | null\n}\n\n要求：\n1. 不要机械镜像 interactionHint，只有在确实存在私下继续聊的强动机时才 shouldCreate=true。\n2. participantIds 必须恰好 2 人，且来自成员 id。\n3. 如果最近已经有同一对成员的私聊提议，复用相同 dedupeKey。\n4. 拿不准就 shouldCreate=false 或降低 confidence。\n\n成员：\n${buildCharacterReference(params.characters.filter((character) => params.conversation.memberIds.includes(character.id)))}\n\n最近对话：\n${recentTranscript}\n\n最近双人私聊事件：\n${recentPrivateThreads || '无'}\n\n当前消息（speakerId=${params.message.senderId}）：\n${params.message.content}`;
  try {
    const raw = await generateResponse(params.apiConfig, prompt, [{ role: 'user', content: '只输出 JSON。' }]);
    return JSON.parse(cleanJson(raw)) as PairPrivateThreadAnalysisResult;
  } catch {
    return null;
  }
}

function shouldAnalyzeSocialOuting(content: string) {
  return /(今晚|明天|周末|改天|一起去|约饭|吃火锅|聚餐|看展|唱歌|散步|庆祝|线下|见面|出去玩|喝一杯|喝奶茶|吃饭)/i.test(content);
}

function shouldAnalyzePostMoment(content: string) {
  return /(发个朋友圈|发条动态|想发|晒|记录一下|发出来|po一下|纪念一下|发成动态|发一条|朋友圈|动态)/i.test(content);
}

async function resolveSocialEventHints(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}) {
  const baseHints = [...(params.message.socialEventHints || [])];
  const hasOutingHint = baseHints.some((hint) => hint.eventKind === 'social_outing');
  const hasMomentHint = baseHints.some((hint) => hint.eventKind === 'post_moment');
  if (!hasOutingHint && shouldAnalyzeSocialOuting(params.message.content)) {
    const analyzed = await analyzeSocialOuting({
      conversation: params.conversation,
      message: params.message,
      characters: params.characters,
      recentMessages: params.recentMessages,
      apiConfig: params.apiConfig,
    });
    const mapped = toSocialOutingHint(analyzed, params.conversation, params.message.senderId);
    if (mapped) baseHints.push(mapped);
  }
  if (!hasMomentHint && shouldAnalyzePostMoment(params.message.content)) {
    const analyzed = await analyzePostMoment({
      conversation: params.conversation,
      message: params.message,
      characters: params.characters,
      recentMessages: params.recentMessages,
      apiConfig: params.apiConfig,
    });
    const mapped = toPostMomentHint(analyzed, params.conversation, params.message.senderId);
    if (mapped) baseHints.push(mapped);
  }
  return baseHints.length ? baseHints : null;
}

function buildPostMomentCandidate(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hinted = buildPostMomentCandidateFromHint(params);
  if (!hinted) return null;
  const payload = hinted.payload as SocialEventCandidatePayload;
  const text = params.message.content.trim();
  const expressive = /(发个朋友圈|发条动态|想发|晒|记录一下|发出来|po一下)/i.test(text);
  const roomHeat = params.structuredRoomState?.heat || 0;
  const roomCohesion = params.structuredRoomState?.cohesion || 0;
  const emotionalPush = params.interaction && params.interaction.confidence >= 0.85 && (params.interaction.intensity >= 3 || params.interaction.kind === 'side_comment');
  if (!expressive && !emotionalPush && !(roomHeat >= 18 && roomCohesion >= 2)) return null;
  return {
    ...hinted,
    payload: {
      ...payload,
      confidence: Math.max(payload.confidence, expressive ? 0.92 : emotionalPush ? 0.86 : 0.82),
      reasonType: payload.reasonType || (roomCohesion >= 10 ? 'celebration' : 'emotion_release'),
    },
  } satisfies RuntimeEventV2;
}

function buildSocialOutingCandidateFromHint(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hint = (params.message.socialEventHints || []).find((item) => item.eventKind === 'social_outing');
  if (!hint || (hint.confidence || 0) < 0.8) return null;
  const participantIds = (hint.participantIds || []).filter((id) => params.conversation.memberIds.includes(id));
  const payload: SocialEventCandidatePayload = {
    eventKind: 'social_outing',
    initiatorId: params.message.senderId,
    participantIds: participantIds.length ? participantIds : [params.message.senderId],
    targetIds: hint.targetIds?.filter((id) => params.conversation.memberIds.includes(id)),
    reasonType: hint.reasonType || 'celebration',
    confidence: Math.max(0.8, hint.confidence || 0),
    urgency: hint.urgency || 'soon',
    seedIntent: hint.seedIntent || '想把刚才群里的热络气氛延续成一次线下活动。',
    visibilityPlan: hint.visibilityPlan || 'public',
    expectedArtifacts: hint.expectedArtifacts || ['outing_summary', 'group_photo', 'food_photo'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: hint.title || '线下活动',
    activityType: hint.activityType || undefined,
    timeHint: hint.timeHint ?? null,
    locationHint: hint.locationHint ?? null,
    dedupeKey: hint.dedupeKey ?? null,
  };
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${params.message.senderId} 提议触发${payload.title || '线下活动'}`,
    actorIds: [params.message.senderId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload,
  });
}

function normalizeSemanticText(value: string | null | undefined) {
  return (value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?:;：；“”"'‘’（）()【】\[\]-]/g, '');
}

function normalizeSemanticParticipantSet(ids: string[] | undefined) {
  return [...new Set((ids || []).filter(Boolean))].sort().join(',');
}

function buildCandidateClusterKey(payload: SocialEventCandidatePayload) {
  return payload.dedupeKey || `${payload.eventKind}::${payload.title || ''}::${payload.activityType || ''}::${payload.timeHint || ''}::${payload.locationHint || ''}::${[...(payload.participantIds || [])].sort().join(',')}::${[...(payload.targetIds || [])].sort().join(',')}`;
}

function buildSemanticCandidateKey(payload: SocialEventCandidatePayload) {
  return [
    payload.eventKind,
    normalizeSemanticText(payload.title),
    normalizeSemanticText(payload.activityType),
    normalizeSemanticText(payload.timeHint),
    normalizeSemanticText(payload.locationHint),
    normalizeSemanticParticipantSet(payload.participantIds),
    normalizeSemanticParticipantSet(payload.targetIds),
  ].join('::');
}

function areCandidatesSemanticallySimilar(left: SocialEventCandidatePayload, right: SocialEventCandidatePayload) {
  if (left.eventKind !== right.eventKind) return false;
  if (buildSemanticCandidateKey(left) === buildSemanticCandidateKey(right)) return true;
  if (left.eventKind === 'social_outing') {
    const sameParticipants = normalizeSemanticParticipantSet(left.participantIds) === normalizeSemanticParticipantSet(right.participantIds);
    const sameActivity = normalizeSemanticText(left.activityType || left.title) === normalizeSemanticText(right.activityType || right.title);
    const sameTime = normalizeSemanticText(left.timeHint) === normalizeSemanticText(right.timeHint);
    return sameParticipants && sameActivity && Boolean(sameActivity) && sameTime;
  }
  if (left.eventKind === 'post_moment') {
    const sameInitiator = left.initiatorId === right.initiatorId;
    const sameTopic = normalizeSemanticText(left.activityType || left.title || left.seedIntent) === normalizeSemanticText(right.activityType || right.title || right.seedIntent);
    return sameInitiator && sameTopic && Boolean(sameTopic);
  }
  if (left.eventKind === 'pair_private_thread') {
    return normalizeSemanticParticipantSet(left.participantIds) === normalizeSemanticParticipantSet(right.participantIds);
  }
  return false;
}

function choosePreferredText(current: string | undefined | null, incoming: string | undefined | null) {
  return (incoming && incoming.trim().length > (current || '').trim().length ? incoming : current) || current || incoming || undefined;
}

function choosePreferredConfidence(current: number | undefined, incoming: number | undefined) {
  return Math.max(current || 0, incoming || 0);
}

function mergeCandidatePayloads(existing: SocialEventCandidatePayload, incoming: SocialEventCandidatePayload, fallbackKey: string): SocialEventCandidatePayload {
  return {
    ...existing,
    ...incoming,
    dedupeKey: existing.dedupeKey || incoming.dedupeKey || fallbackKey,
    title: choosePreferredText(existing.title, incoming.title),
    activityType: choosePreferredText(existing.activityType, incoming.activityType),
    timeHint: choosePreferredText(existing.timeHint || undefined, incoming.timeHint || undefined) ?? null,
    locationHint: choosePreferredText(existing.locationHint || undefined, incoming.locationHint || undefined) ?? null,
    seedIntent: choosePreferredText(existing.seedIntent, incoming.seedIntent) || incoming.seedIntent,
    sourceText: choosePreferredText(existing.sourceText, incoming.sourceText),
    confidence: choosePreferredConfidence(existing.confidence, incoming.confidence),
    participantIds: Array.from(new Set([...(existing.participantIds || []), ...(incoming.participantIds || [])])),
    targetIds: Array.from(new Set([...(existing.targetIds || []), ...(incoming.targetIds || [])])),
    expectedArtifacts: Array.from(new Set([...(existing.expectedArtifacts || []), ...(incoming.expectedArtifacts || [])])),
  };
}

function mergeCandidateEvents(existing: RuntimeEventV2, incoming: RuntimeEventV2) {
  const existingPayload = existing.payload as SocialEventCandidatePayload;
  const incomingPayload = incoming.payload as SocialEventCandidatePayload;
  const fallbackKey = existingPayload.dedupeKey || incomingPayload.dedupeKey || buildSemanticCandidateKey(existingPayload);
  const mergedPayload = mergeCandidatePayloads(existingPayload, incomingPayload, fallbackKey);
  return {
    ...incoming,
    summary: existing.summary.length >= incoming.summary.length ? existing.summary : incoming.summary,
    targetIds: Array.from(new Set([...(existing.targetIds || []), ...(incoming.targetIds || [])])),
    payload: mergedPayload,
  } satisfies RuntimeEventV2;
}

function findSemanticallySimilarExisting(chat: GroupChat, payload: SocialEventCandidatePayload) {
  return (chat.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'event_candidate')
    .find((event) => areCandidatesSemanticallySimilar(event.payload as SocialEventCandidatePayload, payload)) || null;
}

function mergeCandidatesWithinBatch(events: RuntimeEventV2[]) {
  const merged: RuntimeEventV2[] = [];
  for (const event of events) {
    const payload = event.payload as SocialEventCandidatePayload;
    const index = merged.findIndex((item) => areCandidatesSemanticallySimilar(item.payload as SocialEventCandidatePayload, payload));
    if (index === -1) {
      merged.push(event);
      continue;
    }
    merged[index] = mergeCandidateEvents(merged[index], event);
  }
  return merged;
}

function dedupeSemanticCandidates(chat: GroupChat, candidates: RuntimeEventV2[]) {
  return mergeCandidatesWithinBatch(candidates).flatMap((event) => {
    const payload = event.payload as SocialEventCandidatePayload;
    const existing = findSemanticallySimilarExisting(chat, payload);
    if (!existing) return [event];
    if (existing.createdAt >= event.createdAt) return [];
    return [{
      ...mergeCandidateEvents(existing, event),
      id: existing.id,
      createdAt: existing.createdAt,
    } satisfies RuntimeEventV2];
  });
}

function buildCandidateDedupeKey(payload: SocialEventCandidatePayload) {
  return payload.dedupeKey || buildCandidateClusterKey(payload) || buildSemanticCandidateKey(payload);
}

function dedupeByKey(candidates: RuntimeEventV2[]) {
  const seen = new Set<string>();
  return candidates.flatMap((event) => {
    const payload = event.payload as SocialEventCandidatePayload;
    const dedupeKey = buildCandidateDedupeKey(payload);
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);
    return [event];
  });
}

function dedupeSocialEventCandidates(chat: GroupChat, candidates: RuntimeEventV2[]) {
  return dedupeByKey(dedupeSemanticCandidates(chat, candidates));
}

function legacyBuildExistingCandidateClusterMap(chat: GroupChat) {
  return new Map<string, RuntimeEventV2>();
}

void legacyBuildExistingCandidateClusterMap;


function shouldAutoBackflowMoment(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !(chat.runtimeEventsV2 || []).some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'moment_text' && (event.payload as { eventKind?: string }).eventKind === 'post_moment' && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload) && event.createdAt >= createdAt);
}

function shouldAutoBackflowOuting(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !(chat.runtimeEventsV2 || []).some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'outing_summary' && (event.payload as { eventKind?: string }).eventKind === 'social_outing' && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload) && event.createdAt >= createdAt);
}

function dedupeAgainstRecentRuntime(chat: GroupChat, candidates: RuntimeEventV2[]) {
  return dedupeSocialEventCandidates(chat, candidates).filter((event) => {
    const payload = event.payload as SocialEventCandidatePayload;
    if (payload.eventKind === 'post_moment') return shouldAutoBackflowMoment(chat, payload, event.createdAt);
    if (payload.eventKind === 'social_outing') return shouldAutoBackflowOuting(chat, payload, event.createdAt);
    if (payload.eventKind === 'status_update') return shouldAutoBackflowStatusUpdate(chat, payload, event.createdAt);
    if (payload.eventKind === 'gift_exchange') return shouldAutoBackflowGiftExchange(chat, payload, event.createdAt);
    return true;
  });
}

function replaceCompactedExistingCandidates(existingEvents: RuntimeEventV2[], compactedCandidates: RuntimeEventV2[]) {
  const replacements = new Map(compactedCandidates.map((event) => [event.id, event]));
  const replacedIds = new Set(replacements.keys());
  return existingEvents.map((event) => replacements.get(event.id) || event).filter((event) => !(event.kind === 'event_candidate' && replacedIds.has(event.id) && !replacements.has(event.id)));
}

function mergeRuntimeEventsWithCompaction(existingEvents: RuntimeEventV2[], compactedCandidates: RuntimeEventV2[], additions: RuntimeEventV2[]) {
  const base = replaceCompactedExistingCandidates(existingEvents, compactedCandidates);
  const existingIds = new Set(base.map((event) => event.id));
  const newCandidates = compactedCandidates.filter((event) => !existingIds.has(event.id));
  return [...base, ...newCandidates, ...additions].slice(-MAX_OPEN_CHAT_RUNTIME_EVENTS);
}

function buildNonCandidateAdditions(params: { messageGeneratedEvent: RuntimeEventV2; interactionEvent?: RuntimeEventV2 | null; relationshipDeltaEvent?: RuntimeEventV2 | null; roomShiftEvent?: RuntimeEventV2 | null; memoryCandidateEvents?: RuntimeEventV2[]; momentArtifactEvents?: RuntimeEventV2[]; artifactEvent?: RuntimeEventV2 | null }) {
  return [
    params.messageGeneratedEvent,
    ...(params.interactionEvent ? [params.interactionEvent] : []),
    ...(params.relationshipDeltaEvent ? [params.relationshipDeltaEvent] : []),
    ...(params.roomShiftEvent ? [params.roomShiftEvent] : []),
    ...(params.memoryCandidateEvents || []),
    ...(params.momentArtifactEvents || []),
    ...(params.artifactEvent ? [params.artifactEvent] : []),
  ];
}

function compactEventCandidateHistory(existingEvents: RuntimeEventV2[], compactedCandidates: RuntimeEventV2[]) {
  const compactedIds = new Set(compactedCandidates.map((event) => event.id));
  const compactedPayloads = compactedCandidates.map((event) => event.payload as SocialEventCandidatePayload);
  return existingEvents.filter((event) => {
    if (event.kind !== 'event_candidate') return true;
    if (compactedIds.has(event.id)) return false;
    const payload = event.payload as SocialEventCandidatePayload;
    return !compactedPayloads.some((compacted) => areCandidatesSemanticallySimilar(compacted, payload));
  });
}

function mergeCompactedRuntimeEvents(existingEvents: RuntimeEventV2[], compactedCandidates: RuntimeEventV2[], additions: RuntimeEventV2[]) {
  const compactedBase = compactEventCandidateHistory(existingEvents, compactedCandidates);
  return [...compactedBase, ...compactedCandidates, ...additions].slice(-MAX_OPEN_CHAT_RUNTIME_EVENTS);
}

void replaceCompactedExistingCandidates;
void mergeRuntimeEventsWithCompaction;
void buildNonCandidateAdditions;
void mergeCompactedRuntimeEvents;

function buildSocialOutingCandidate(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hinted = buildSocialOutingCandidateFromHint(params);
  if (!hinted) return null;
  const payload = hinted.payload as SocialEventCandidatePayload;
  const text = params.message.content.trim();
  const outingLanguage = /(今晚|周末|一起去|约饭|吃火锅|聚餐|看展|唱歌|散步|庆祝|线下)/i.test(text);
  const roomHeat = params.structuredRoomState?.heat || 0;
  const roomCohesion = params.structuredRoomState?.cohesion || 0;
  const relationshipBoost = payload.participantIds.some((participantId) => participantId !== payload.initiatorId && (() => {
    const relation = getRelationshipLedgerEntry(params.conversation.relationshipLedger || [], payload.initiatorId, participantId);
    return Boolean(relation && (relation.current.warmth + relation.current.competence + relation.current.trust) >= 12);
  })());
  const positiveInteraction = params.interaction && params.interaction.confidence >= 0.85 && getRelationshipDeltaDirection(inferRelationshipDelta(params.interaction)?.delta || {}) === 'up';
  if (!outingLanguage && !relationshipBoost && !(positiveInteraction && roomHeat >= 12 && roomCohesion >= 5)) return null;
  return {
    ...hinted,
    payload: {
      ...payload,
      confidence: Math.max(payload.confidence, outingLanguage ? 0.92 : relationshipBoost ? 0.87 : 0.82),
      reasonType: payload.reasonType || (roomCohesion >= 10 ? 'celebration' : 'follow_up_hangout'),
    },
  } satisfies RuntimeEventV2;
}

function buildOutingArtifactEvents(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}): RuntimeEventV2[] {
  return params.socialEventCandidates
    .filter((event) => (event.payload as SocialEventCandidatePayload).eventKind === 'social_outing')
    .map((event) => {
      const payload = event.payload as SocialEventCandidatePayload;
      const participantNames = payload.participantIds.map((id) => params.characters.find((item) => item.id === id)?.name || id);
      const label = payload.activityType || payload.title || '线下活动';
      const text = `${participantNames.join('、')} 一起去参加了刚才聊到的${label}。`;
      return createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'artifact',
        summary: text,
        actorIds: [payload.initiatorId],
        targetIds: payload.participantIds,
        visibility: 'derived_public',
        payload: {
          artifactType: 'outing_summary',
          eventKind: 'social_outing',
          text,
          title: payload.title,
          activityType: payload.activityType,
          timeHint: payload.timeHint,
          locationHint: payload.locationHint,
          dedupeKey: payload.dedupeKey,
          participantIds: payload.participantIds,
          expectedArtifacts: payload.expectedArtifacts || [],
        },
      });
    });
}

function buildSocialEventCandidates(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  relationshipLedger: GroupChat['relationshipLedger'];
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}) {
  return dedupeAgainstRecentRuntime(params.conversation, [
    buildPairPrivateThreadCandidate({
      conversation: params.conversation,
      interaction: params.interaction,
      relationshipLedger: params.relationshipLedger,
      structuredRoomState: params.structuredRoomState,
      message: params.message,
    }),
    buildPostMomentCandidate(params),
    buildSocialOutingCandidate(params),
    buildStatusUpdateCandidate(params),
    buildGiftExchangeCandidate(params),
    buildConflictExpressionCandidate(params),
  ].filter(Boolean) as RuntimeEventV2[]);
}

function buildSocialEventCandidateEvents(params: {
  conversation: GroupChat;
  interaction: InteractionEventPayload | null;
  relationshipLedger: GroupChat['relationshipLedger'];
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}) {
  return buildSocialEventCandidates(params);
}

function buildMomentArtifactEvents(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}): RuntimeEventV2[] {
  return params.socialEventCandidates
    .filter((event) => (event.payload as SocialEventCandidatePayload).eventKind === 'post_moment')
    .map((event) => {
      const payload = event.payload as SocialEventCandidatePayload;
      const actorName = params.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      const celebratory = payload.reasonType === 'celebration';
      const text = celebratory
        ? `${actorName} 发了一条动态：${payload.expectedArtifacts?.includes('moment_food_photo') ? '晒了吃饭/活动照片' : '记录了刚才的开心时刻'}`
        : `${actorName} 发了一条动态：带着点情绪地记录了刚才的事`;
      return createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'artifact',
        summary: text,
        actorIds: [payload.initiatorId],
        targetIds: payload.targetIds,
        visibility: 'derived_public',
        payload: {
          artifactType: 'moment_text',
          eventKind: 'post_moment',
          text,
          expectedArtifacts: payload.expectedArtifacts || [],
        },
      });
    });
}

function buildMomentArtifactEventsAndOuting(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}) {
  return [
    ...buildMomentArtifactEvents(params),
    ...buildOutingArtifactEvents(params),
    ...buildStatusUpdateArtifactEvents(params),
    ...buildGiftExchangeArtifactEvents(params),
    ...buildConflictExpressionArtifactEvents(params),
  ];
}

async function buildStructuredRuntime(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: InteractionEventPayload | null; socialEventHints?: SocialEventHintEnvelope[] | null; conflictFocus?: import('../../types/runtimeEvent').ConflictFocusPayload | null };
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}) {
  const existingEvents = params.conversation.runtimeEventsV2 || [];
  const speaker = params.characters.find((character) => character.id === params.message.senderId);
  const isCharacterAuthoredMessage = params.message.type === 'ai' || Boolean(speaker);
  if (params.message.type === 'user' && !speaker) {
    const summary = params.message.content.trim().slice(0, 128);
    const guidance = parseUserGuidanceIntent(params.message.content, params.characters);
    const targetActorIds = getGuidanceTargetActorIds(guidance);
    const cueEvent = summary ? createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'memory_candidate',
      summary: `用户引导：${summary}`,
      actorIds: [params.message.senderId],
      payload: {
        kind: 'topic',
        text: `用户引导：${summary}`,
        salience: 0.62,
        confidence: 0.74,
      } satisfies MemoryCandidatePayload,
    }) : null;
    const directorEvent = summary && guidance ? createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'director_intervention',
      summary: guidance.reason,
      actorIds: [params.message.senderId],
      targetIds: targetActorIds,
      visibility: 'moderator_only',
      payload: {
        intent: guidance.beatType === 'summarize'
          ? 'summarize'
          : guidance.beatType === 'cool_down'
            ? 'cool_down'
          : guidance.beatType === 'reveal'
            ? 'reveal'
          : guidance.beatType === 'deflect'
            ? 'redirect'
          : guidance.beatType === 'escalate' || guidance.beatType === 'challenge'
            ? 'escalate'
          : guidance.beatType === 'invite'
            ? 'inject_event'
          : 'force_reply',
        targetActorIds,
        pressure: guidance.pressure,
        text: guidance.rawText,
        maxTurns: guidance.maxTurns,
        expiresAt: Date.now() + 10 * 60_000,
        userGuidance: guidance as unknown as Record<string, unknown>,
      } satisfies DirectorInterventionPayload,
    }) : null;
    const additions = [cueEvent, directorEvent].filter(Boolean) as RuntimeEventV2[];
    return {
      interaction: null,
      runtimeEventsV2: additions.length ? mergeCompactedRuntimeEvents(existingEvents, [], additions) : existingEvents,
      relationshipLedger: params.conversation.relationshipLedger || [],
      structuredRoomState: params.conversation.worldState.structuredRoomState || null,
    };
  }

  if (!isCharacterAuthoredMessage) {
    return {
      interaction: null,
      runtimeEventsV2: existingEvents,
      relationshipLedger: params.conversation.relationshipLedger || [],
      structuredRoomState: params.conversation.worldState.structuredRoomState || null,
    };
  }

  const resolvedSocialEventHints = await resolveSocialEventHints({
    conversation: params.conversation,
    message: params.message,
    characters: params.characters,
    recentMessages: params.recentMessages,
    apiConfig: params.apiConfig,
  });
  const enrichedMessage = {
    ...params.message,
    socialEventHints: resolvedSocialEventHints,
    conflictFocus: params.message.conflictFocus || null,
  };

  const messageGeneratedEvent = createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'message_generated',
    summary: params.message.content.trim().slice(0, 128),
    actorIds: [params.message.senderId],
    payload: { text: params.message.content.trim().slice(0, 128), messageType: params.message.type },
  });

  const interaction = await resolveInteraction({
    ...params,
    message: enrichedMessage,
  });
  if (!interaction) {
    const artifactEvent = buildArtifactEvent(params);
    const socialEventCandidateEvents = buildSocialEventCandidateEvents({
      conversation: params.conversation,
      interaction: null,
      relationshipLedger: params.conversation.relationshipLedger || [],
      structuredRoomState: params.conversation.worldState.structuredRoomState || null,
      message: enrichedMessage,
    });
    const socialArtifacts = buildMomentArtifactEventsAndOuting({
      conversation: params.conversation,
      socialEventCandidates: socialEventCandidateEvents,
      characters: params.characters,
    });
    return {
      interaction: null,
      runtimeEventsV2: mergeCompactedRuntimeEvents(existingEvents, socialEventCandidateEvents, buildNonCandidateAdditions({ messageGeneratedEvent, momentArtifactEvents: socialArtifacts, artifactEvent })),
      relationshipLedger: params.conversation.relationshipLedger || [],
      structuredRoomState: params.conversation.worldState.structuredRoomState || null,
    };
  }

  const actorName = params.characters.find((item) => item.id === interaction.actorId)?.name || interaction.actorId;
  const targetName = interaction.targetId ? (params.characters.find((item) => item.id === interaction.targetId)?.name || interaction.targetId) : null;

  const interactionEvent = createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'interaction',
    summary: targetName ? `${actorName} → ${targetName} · ${interaction.evidenceText}` : `${actorName} · ${interaction.evidenceText}`,
    actorIds: [interaction.actorId],
    targetIds: interaction.targetId ? [interaction.targetId] : undefined,
    payload: interaction,
  });

  const relationshipLedger = reduceRelationshipLedger(
    params.conversation.relationshipLedger || [],
    interaction,
    interactionEvent,
  );

  const { nextState: structuredRoomState, shift: roomShift } = calculateRoomShift(
    params.conversation.worldState.structuredRoomState || null,
    interaction,
  );

  const relationshipDelta = inferRelationshipDelta(interaction);
  const relationshipTargetId = relationshipDelta?.targetId || null;
  const relationshipTargetName = relationshipTargetId
    ? (params.characters.find((character) => character.id === relationshipTargetId)?.name || relationshipTargetId)
    : null;
  const latestLedgerEntry = relationshipTargetId
    ? getRelationshipLedgerEntry(relationshipLedger, interaction.actorId, relationshipTargetId)
    : null;

  const relationshipDeltaEvent = relationshipDelta && latestLedgerEntry && relationshipTargetName
    ? createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'relationship_delta',
        summary: `${actorName}→${relationshipTargetName} ${summarizeRelationshipDelta(relationshipDelta)}`,
        actorIds: [interaction.actorId],
        targetIds: relationshipTargetId ? [relationshipTargetId] : undefined,
        payload: relationshipDelta,
      })
    : null;

  const roomShiftEvent = createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'room_shift',
    summary: `房间态势更新：热度 ${structuredRoomState.heat} (${roomShift.delta?.heat && roomShift.delta.heat > 0 ? '+' : ''}${roomShift.delta?.heat || 0}) / 凝聚 ${structuredRoomState.cohesion} (${roomShift.delta?.cohesion && roomShift.delta.cohesion > 0 ? '+' : ''}${roomShift.delta?.cohesion || 0})`,
    actorIds: [interaction.actorId],
    targetIds: interaction.targetId ? [interaction.targetId] : undefined,
    payload: roomShift,
  });

  const artifactEvent = buildArtifactEvent(params);
  const socialEventCandidateEvents = buildSocialEventCandidateEvents({
    conversation: params.conversation,
    interaction,
    relationshipLedger,
    structuredRoomState,
    message: enrichedMessage,
  });
  const momentArtifactEvents = buildMomentArtifactEventsAndOuting({
    conversation: params.conversation,
    socialEventCandidates: socialEventCandidateEvents,
    characters: params.characters,
  });
  const memoryCandidateEvents = [interactionEvent, roomShiftEvent]
    .map(buildMemoryCandidateFromStructuredEvent)
    .filter(Boolean) as RuntimeEventV2[];

  return {
    interaction,
    runtimeEventsV2: mergeCompactedRuntimeEvents(existingEvents, socialEventCandidateEvents, buildNonCandidateAdditions({ messageGeneratedEvent, interactionEvent, relationshipDeltaEvent, roomShiftEvent, memoryCandidateEvents, momentArtifactEvents, artifactEvent })),
    relationshipLedger,
    structuredRoomState,
  };
}

function toLegacyMetrics(interaction: InteractionEventPayload, relationshipLedger: GroupChat['relationshipLedger']) {
  if (!interaction.targetId) return null;
  return relationshipLedger?.find((entry) => entry.actorId === interaction.actorId && entry.targetId === interaction.targetId)?.current || null;
}

function buildStructuredLegacyEvents(runtimeEventsV2: RuntimeEventV2[], relationshipLedger: GroupChat['relationshipLedger'], structuredRoomState: GroupChat['worldState']['structuredRoomState']): Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }> {
  const events: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }> = [];
  const latestInteraction = runtimeEventsV2.slice().reverse().find((event) => event.kind === 'interaction');
  if (latestInteraction) {
    const payload = latestInteraction.payload as InteractionEventPayload;
    events.push({
      eventType: `interaction_${payload.kind}`,
      title: `结构化互动：${payload.kind}`,
      summary: payload.evidenceText,
      pair: payload.targetId ? [payload.actorId, payload.targetId] as [string, string] : undefined,
      metrics: toLegacyMetrics(payload, relationshipLedger),
    });
  }
  if (runtimeEventsV2.some((event) => event.kind === 'artifact')) {
    const artifact = runtimeEventsV2.slice().reverse().find((event) => event.kind === 'artifact');
    if (artifact) {
      events.push({
        eventType: 'structured_artifact',
        title: '结构化产物',
        summary: artifact.summary,
      });
    }
  }
  if (structuredRoomState) {
    events.push({
      eventType: 'room_state_snapshot_v2',
      title: '房间态势更新',
      summary: `热度 ${structuredRoomState.heat} / 凝聚 ${structuredRoomState.cohesion} / 话题漂移 ${structuredRoomState.topicDrift}`,
      metrics: structuredRoomState,
    });
  }
  return events;
}

function buildStructuredSummary(interaction: InteractionEventPayload | null, characters: AICharacter[]) {
  if (!interaction) return null;
  const actor = characters.find((item) => item.id === interaction.actorId)?.name || interaction.actorId;
  const target = interaction.targetId
    ? (characters.find((item) => item.id === interaction.targetId)?.name || interaction.targetId)
    : null;
  const kindLabelMap: Record<InteractionEventPayload['kind'], string> = {
    support: '表达支持',
    challenge: '发起挑战',
    mock: '进行了嘲讽',
    dismiss: '表示不屑',
    defend: '出面维护',
    evade: '回避问题',
    probe: '进行了追问',
    pile_on: '加入围攻',
    redirect: '试图转移话题',
    side_comment: '插入侧面评论',
  };
  return target ? `${actor}${kindLabelMap[interaction.kind]}，对象是 ${target}` : `${actor}${kindLabelMap[interaction.kind]}`;
}

function mergeRecentEvent(baseRecentEvent: string, structuredSummary: string | null) {
  if (!structuredSummary) return baseRecentEvent;
  return baseRecentEvent ? `${baseRecentEvent} / ${structuredSummary}`.slice(0, 120) : structuredSummary;
}


async function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: OpenChatCommittedMessage;
  previousAiMessage?: Pick<Message, 'senderId'> | null;
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}): Promise<DriverMessageCommitResult> {
  const config = resolveRuntimeEvolutionConfig(params.conversation.runtimeEvolutionIntensity);
  const publicMessage = params.message.metadata?.withdrawal?.withdrawn
    ? {
        ...params.message,
        interactionHint: null,
        socialEventHints: null,
        conflictFocus: null,
      }
    : params.message;
  const nextWorldStateResult = buildNextWorldState(params.conversation, publicMessage, config);
  const isPlainUserGuidance = publicMessage.type === 'user' && !params.characters.some((character) => character.id === publicMessage.senderId);
  const userGuidanceSummary = isPlainUserGuidance ? publicMessage.content.trim().slice(0, 96) : '';
  const nextWorldState = isPlainUserGuidance && userGuidanceSummary
    ? {
        ...nextWorldStateResult.worldState,
        focus: userGuidanceSummary,
        recentEvent: `用户引导：${userGuidanceSummary}`,
      }
    : nextWorldStateResult.worldState;
  const relationshipTransition = buildRelationshipTransition({
    conversation: params.conversation,
    characters: params.characters,
    message: publicMessage,
    previousAiMessage: params.previousAiMessage || null,
    recentMessages: params.recentMessages,
    config,
  });
  const worldRuntimeEvents = buildWorldRuntimeEvents(
    publicMessage,
    params.conversation.worldState,
    nextWorldState,
    nextWorldStateResult.nextConflictAxes,
    config,
  );
  const { interaction, runtimeEventsV2, relationshipLedger, structuredRoomState } = await buildStructuredRuntime({
    conversation: params.conversation,
    message: publicMessage,
    characters: params.characters,
    recentMessages: params.recentMessages,
    apiConfig: params.apiConfig,
  });
  const mergedWorldState = {
    ...nextWorldState,
    structuredRoomState,
    recentEvent: mergeRecentEvent(nextWorldState.recentEvent, buildStructuredSummary(interaction, params.characters)),
  };
  const nextStructuredEvents = runtimeEventsV2.slice((params.conversation.runtimeEventsV2 || []).length);
  const fallbackRelationshipLedger = relationshipTransition.relationshipLedger;
  const effectiveRelationshipLedger = relationshipLedger.length ? relationshipLedger : fallbackRelationshipLedger;
  const commitRuntimeEvents = [
    ...relationshipTransition.runtimeEvents,
    ...(params.message.metadata?.withdrawal?.withdrawn ? [{
      eventType: 'message_withdrawn',
      title: `${params.characters.find((item) => item.id === params.message.senderId)?.name || '成员'} 撤回了一条消息`,
      summary: '这次撤回留下了一点迟疑、尴尬或关系余波，但原文不进入公开运行态。',
      metrics: {
        actorId: params.message.senderId,
        reason: params.message.metadata.withdrawal.reason,
      },
      timelineType: 'note',
      eventClass: 'message' as const,
      visibilityScope: 'public' as const,
      createdAt: Date.now(),
    }] : []),
    ...worldRuntimeEvents,
    ...buildStructuredLegacyEvents(nextStructuredEvents, effectiveRelationshipLedger, structuredRoomState),
  ];
  const withdrawalRuntimeEventsV2: RuntimeEventV2[] = publicMessage.metadata?.withdrawal?.withdrawn ? [
    createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'memory_candidate',
      summary: `${params.characters.find((item) => item.id === publicMessage.senderId)?.name || '成员'} 撤回了一条消息：撤回本身成为公开可见的余波，原文不进入公开记忆。`,
      actorIds: [publicMessage.senderId],
      payload: {
        kind: 'topic',
        text: `${params.characters.find((item) => item.id === publicMessage.senderId)?.name || '成员'} 撤回了一条消息：撤回本身成为公开可见的余波，原文不进入公开记忆。`,
        salience: 0.59,
        confidence: 0.7,
      },
      visibility: 'public',
    }),
  ] : [];

  const chatPatch = buildChatPatch(
    params.conversation,
    publicMessage,
    mergedWorldState,
    commitRuntimeEvents,
    config,
    params.characters.map((item) => ({ id: item.id, name: item.name })),
  ) as Partial<GroupChat> & { localDistillationEvent?: DriverMessageCommitResult['runtimeEvents'][number] | null };
  const localDistillationEvent = chatPatch.localDistillationEvent || null;
  delete chatPatch.localDistillationEvent;
  const nextRuntimeEventsV2 = [...runtimeEventsV2, ...withdrawalRuntimeEventsV2].slice(-MAX_OPEN_CHAT_RUNTIME_EVENTS);
  setChangedChatPatchField(chatPatch, params.conversation, 'runtimeEventsV2', nextRuntimeEventsV2);
  setChangedChatPatchField(chatPatch, params.conversation, 'relationshipLedger', effectiveRelationshipLedger);
  const chatRuntimeDelta = {
    runtimeEventsV2: buildRuntimeEventsDelta(params.conversation, nextRuntimeEventsV2),
    relationshipLedger: buildRelationshipLedgerDelta(params.conversation, effectiveRelationshipLedger),
  };
  delete chatPatch.runtimeEventsV2;
  delete chatPatch.relationshipLedger;
  return {
    chatPatch,
    chatRuntimeDelta: Object.values(chatRuntimeDelta).some(Boolean) ? chatRuntimeDelta : undefined,
    characterPatches: relationshipTransition.characterPatches,
    runtimeEvents: localDistillationEvent ? [...commitRuntimeEvents, localDistillationEvent] : commitRuntimeEvents,
  };
}

export const openChatEngine: SessionEngineDefinition = createDefaultConversationEngineDefinition({
  key: 'open_chat',
  createInitialConfig: () => ({ ...DEFAULT_OPEN_CHAT_MODE_CONFIG, sessionFamily: 'conversation', scenarioId: 'open-chat' }),
  createInitialState: () => DEFAULT_OPEN_CHAT_MODE_STATE,
  onMessageCommitted,
});

export const OPEN_CHAT_ENGINE = openChatEngine;
