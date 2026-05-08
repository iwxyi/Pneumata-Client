import type { AICharacter } from '../types/character';
import type { ConversationPhase, GroupChat } from '../types/chat';
import type { RuntimeEventV2, SocialEventCandidatePayload } from '../types/runtimeEvent';
import type { SessionActionExecutionResult } from '../types/sessionEngine';
import { createDefaultConversationFrameworkPatch, mergeSessionChatPatch } from '../types/sessionEngine';
import { DEFAULT_CONVERSATION_WORLD_STATE } from '../types/chat';
import { resolveRuntimeEvolutionConfig } from './runtimeEvolutionConfig';
import { updateCharacterRelationship } from './relationshipEngine';
import { deriveEmotionalState, derivePersonalityDrift } from './personalityDrift';
import { updateCharacterLayeredMemories } from './characterLayeredMemory';
import { accumulateCharacterRuntime } from './characterRuntime';
import { accumulateChatRuntime } from './chatRuntime';
import { createProjectionContext, projectRuntimeState } from './sessionProjection';
import { openChatEngine } from './engines/openChatEngine';
import { getRelationshipLedgerEntry } from './relationshipLedger';
import { calculateRoomShift } from './roomStateSynthesizer';
import { resolveSessionEngine } from './sessionEngineRegistry';
import { buildThreadRef, getVisibilityChannelId } from './sessionTopology';

function withFrameworkPatch(chat: GroupChat, patch: Partial<GroupChat>) {
  const engine = resolveSessionEngine(chat);
  return mergeSessionChatPatch(engine, chat, {
    ...createDefaultConversationFrameworkPatch(chat),
    ...patch,
  });
}

function createConversationThreadFrameworkPatch(sourceChat: GroupChat, memberIds: string[]) {
  const conversation = {
    ...sourceChat,
    type: 'ai_direct' as const,
    memberIds,
    sessionKind: { topology: 'thread' as const, family: 'conversation' as const, scenarioId: 'ai-private-thread', surfaceProfile: 'text' as const },
    channels: [{ channelId: 'public', visibility: 'pair_private' as const, label: 'Private Thread', actorIds: memberIds }],
  } as GroupChat;
  return createDefaultConversationFrameworkPatch(conversation);
}

function createRuntimeEventV2(params: {
  conversationId: string;
  kind: RuntimeEventV2['kind'];
  summary: string;
  payload: RuntimeEventV2['payload'];
  actorIds?: string[];
  targetIds?: string[];
  visibility?: RuntimeEventV2['visibility'];
  channelId?: string;
  causedByIntentId?: string;
  threadRef?: string;
  eventClass?: RuntimeEventV2['eventClass'];
}) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    conversationId: params.conversationId,
    kind: params.kind,
    createdAt: Date.now(),
    actorIds: params.actorIds,
    targetIds: params.targetIds,
    summary: params.summary,
    channelId: params.channelId || getVisibilityChannelId(params.visibility),
    causedByIntentId: params.causedByIntentId,
    threadRef: params.threadRef || buildThreadRef(undefined, params.conversationId),
    eventClass: params.eventClass || (params.kind === 'artifact' ? 'artifact' : params.kind === 'room_shift' ? 'phase' : 'message'),
    visibility: params.visibility || 'public',
    payload: params.payload,
  } satisfies RuntimeEventV2;
}

function appendStructuredRuntimeEvent(chat: GroupChat, event: RuntimeEventV2) {
  return [...(chat.runtimeEventsV2 || []), event].slice(-160);
}

function appendStructuredRuntimeEvents(chat: GroupChat, events: RuntimeEventV2[]) {
  return events.reduce((acc, event) => appendStructuredRuntimeEvent({ ...chat, runtimeEventsV2: acc }, event), chat.runtimeEventsV2 || []);
}

function mergeRuntimeSeedWithSummary(chat: GroupChat, summary: string) {
  return {
    notes: [...(chat.runtimeSeed?.notes || []), summary].slice(-24),
    artifacts: chat.runtimeSeed?.artifacts || [],
  };
}

function buildPrivateThreadRecentEvent(starterName: string, targetName: string, summary: string) {
  return `${starterName} 与 ${targetName} 的私聊回流：${summary}`.slice(0, 120);
}

function buildPrivateThreadPublicSummary(starterName: string, targetName: string, content: string) {
  return `${starterName} 私下和 ${targetName} 继续聊了刚才的话题：${content.slice(0, 48)}${content.length > 48 ? '…' : ''}`;
}

function buildPrivateThreadEffectEvents(sourceChat: GroupChat, starterId: string, targetId: string, summary: string) {
  const context = createProjectionContext(sourceChat, openChatEngine.buildParticipants(sourceChat));
  const projected = projectRuntimeState(sourceChat, context);
  const currentLedger = getRelationshipLedgerEntry(projected.relationshipLedger || [], starterId, targetId);
  const shiftedRoom = calculateRoomShift(projected.worldState.structuredRoomState || null, {
    kind: 'probe',
    actorId: starterId,
    targetId,
    intensity: 2,
    tone: 'defensive',
    evidenceText: summary.slice(0, 120),
    confidence: 0.82,
  });
  return {
    effectEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'relationship_delta',
      summary: `私聊回流：${summary}`,
      actorIds: [starterId],
      targetIds: [targetId],
      visibility: 'derived_public',
      payload: {
        eventKind: 'pair_private_thread',
        effectType: 'relationship',
        summary: `私聊回流：${summary}`,
        confidence: 0.82,
      },
    }),
    summaryEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'artifact',
      summary: `私聊摘要：${summary}`,
      actorIds: [starterId],
      targetIds: [targetId],
      visibility: 'derived_public',
      payload: {
        artifactType: 'private_thread_summary',
        eventKind: 'pair_private_thread',
        text: summary,
        participantIds: [starterId, targetId],
      },
    }),
    roomShiftEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'room_shift',
      summary: `私聊回流后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
      actorIds: [starterId],
      targetIds: [targetId],
      visibility: 'derived_public',
      payload: shiftedRoom.shift,
    }),
    nextStructuredRoomState: shiftedRoom.nextState,
    currentLedger,
  };
}

function updateSourceChatAfterPrivateThread(sourceChat: GroupChat, starterId: string, targetId: string, starterName: string, targetName: string, summary: string) {
  const { effectEvent, summaryEvent, roomShiftEvent, nextStructuredRoomState } = buildPrivateThreadEffectEvents(sourceChat, starterId, targetId, summary);
  return withFrameworkPatch(sourceChat, {
    lastMessageAt: Date.now(),
    runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [effectEvent, summaryEvent, roomShiftEvent]),
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      ...(sourceChat.worldState || {}),
      structuredRoomState: nextStructuredRoomState,
      recentEvent: buildPrivateThreadRecentEvent(starterName, targetName, summary),
    },
    ...accumulateChatRuntime(sourceChat, { type: 'event', content: buildPrivateThreadRecentEvent(starterName, targetName, summary) }),
    runtimeSeed: mergeRuntimeSeedWithSummary(sourceChat, buildPrivateThreadPublicSummary(starterName, targetName, summary)),
  });
}

function buildPostMomentSummary(actorName: string, payload: SocialEventCandidatePayload) {
  return payload.reasonType === 'celebration'
    ? `${actorName} 发了一条动态，记录了刚才的开心时刻。`
    : `${actorName} 发了一条动态，表达了刚才的情绪。`;
}

function buildPostMomentEffectEvents(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorName: string) {
  const summary = buildPostMomentSummary(actorName, payload);
  const shiftedRoom = calculateRoomShift(sourceChat.worldState.structuredRoomState || null, {
    kind: payload.reasonType === 'celebration' ? 'support' : 'side_comment',
    actorId: payload.initiatorId,
    targetId: payload.targetIds?.[0] || null,
    intensity: payload.reasonType === 'celebration' ? 2 : 1,
    tone: payload.reasonType === 'celebration' ? 'warm' : 'cold',
    evidenceText: (payload.sourceText || summary).slice(0, 120),
    confidence: payload.confidence,
  });
  return {
    effectEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'relationship_delta',
      summary: `动态回流：${summary}`,
      actorIds: [payload.initiatorId],
      targetIds: payload.targetIds,
      visibility: 'derived_public',
      payload: {
        eventKind: 'post_moment',
        effectType: 'artifact',
        summary: `动态回流：${summary}`,
        confidence: payload.confidence,
      },
    }),
    memoryEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'memory_candidate',
      summary,
      actorIds: [payload.initiatorId],
      targetIds: payload.targetIds,
      visibility: 'derived_public',
      payload: {
        kind: payload.reasonType === 'celebration' ? 'topic' : 'preference',
        text: summary,
        salience: payload.reasonType === 'celebration' ? 0.72 : 0.64,
        confidence: payload.confidence,
      },
    }),
    artifactEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'artifact',
      summary,
      actorIds: [payload.initiatorId],
      targetIds: payload.targetIds,
      visibility: 'derived_public',
      payload: {
        artifactType: 'moment_text',
        eventKind: 'post_moment',
        text: summary,
        expectedArtifacts: payload.expectedArtifacts || [],
        dedupeKey: payload.dedupeKey,
        title: payload.title,
        activityType: payload.activityType,
        targetIds: payload.targetIds,
      },
    }),
    roomShiftEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'room_shift',
      summary: `动态回流后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
      actorIds: [payload.initiatorId],
      targetIds: payload.targetIds,
      visibility: 'derived_public',
      payload: shiftedRoom.shift,
    }),
    nextStructuredRoomState: shiftedRoom.nextState,
    publicSummary: summary,
  };
}

export function updateSourceChatAfterPostMoment(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorName: string) {
  const { effectEvent, memoryEvent, artifactEvent, roomShiftEvent, nextStructuredRoomState, publicSummary } = buildPostMomentEffectEvents(sourceChat, payload, actorName);
  return withFrameworkPatch(sourceChat, {
    lastMessageAt: Date.now(),
    runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [effectEvent, memoryEvent, artifactEvent, roomShiftEvent]),
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      ...(sourceChat.worldState || {}),
      structuredRoomState: nextStructuredRoomState,
      recentEvent: publicSummary.slice(0, 120),
    },
    ...accumulateChatRuntime(sourceChat, { type: 'event', content: publicSummary }),
    runtimeSeed: mergeRuntimeSeedWithSummary(sourceChat, publicSummary),
  });
}

export function buildSocialOutingEffectEvents(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorNames: string[]) {
  const activityLabel = payload.sourceText?.match(/(吃火锅|聚餐|约饭|看展|唱歌|出去玩|散步|庆祝|打卡|线下活动|活动)/i)?.[0] || '线下活动';
  const summary = `${actorNames.join('、')} 参与了刚才提到的${activityLabel}。`;
  const shiftedRoom = calculateRoomShift(sourceChat.worldState.structuredRoomState || null, {
    kind: 'support',
    actorId: payload.initiatorId,
    targetId: payload.targetIds?.[0] || null,
    intensity: 2,
    tone: 'warm',
    evidenceText: (payload.sourceText || summary).slice(0, 120),
    confidence: payload.confidence,
  });
  return {
    effectEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'relationship_delta',
      summary: `活动回流：${summary}`,
      actorIds: [payload.initiatorId],
      targetIds: payload.participantIds,
      visibility: 'derived_public',
      payload: {
        eventKind: 'social_outing',
        effectType: 'artifact',
        summary: `活动回流：${summary}`,
        confidence: payload.confidence,
      },
    }),
    memoryEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'memory_candidate',
      summary,
      actorIds: [payload.initiatorId],
      targetIds: payload.participantIds,
      visibility: 'derived_public',
      payload: {
        kind: 'topic',
        text: summary,
        salience: 0.76,
        confidence: payload.confidence,
      },
    }),
    artifactEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'artifact',
      summary,
      actorIds: [payload.initiatorId],
      targetIds: payload.participantIds,
      visibility: 'derived_public',
      payload: {
        artifactType: 'outing_summary',
        eventKind: 'social_outing',
        text: summary,
        expectedArtifacts: payload.expectedArtifacts || [],
        dedupeKey: payload.dedupeKey,
        title: payload.title,
        activityType: payload.activityType,
        participantIds: payload.participantIds,
        targetIds: payload.targetIds,
        timeHint: payload.timeHint,
        locationHint: payload.locationHint,
      },
    }),
    roomShiftEvent: createRuntimeEventV2({
      conversationId: sourceChat.id,
      kind: 'room_shift',
      summary: `线下活动回流后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
      actorIds: [payload.initiatorId],
      targetIds: payload.participantIds,
      visibility: 'derived_public',
      payload: shiftedRoom.shift,
    }),
    nextStructuredRoomState: shiftedRoom.nextState,
    publicSummary: summary,
  };
}

export function updateSourceChatAfterSocialOuting(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorNames: string[]) {
  const { effectEvent, memoryEvent, artifactEvent, roomShiftEvent, nextStructuredRoomState, publicSummary } = buildSocialOutingEffectEvents(sourceChat, payload, actorNames);
  return withFrameworkPatch(sourceChat, {
    lastMessageAt: Date.now(),
    runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [effectEvent, memoryEvent, artifactEvent, roomShiftEvent]),
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      ...(sourceChat.worldState || {}),
      structuredRoomState: nextStructuredRoomState,
      recentEvent: publicSummary.slice(0, 120),
    },
    ...accumulateChatRuntime(sourceChat, { type: 'event', content: publicSummary }),
    runtimeSeed: mergeRuntimeSeedWithSummary(sourceChat, publicSummary),
  });
}

function isPrivateThreadOpenedArtifact(event: RuntimeEventV2) {
  return event.kind === 'artifact' && typeof (event.payload as { artifactType?: string }).artifactType === 'string' && (event.payload as { artifactType?: string }).artifactType === 'private_thread_opened';
}

function extractOpenedPairKey(event: RuntimeEventV2) {
  return [...(event.targetIds || [])].sort().join('::');
}

function extractCandidatePairKey(payload: SocialEventCandidatePayload) {
  return [...payload.participantIds].sort().join('::');
}

function extractCandidatePair(payload: SocialEventCandidatePayload) {
  return payload.participantIds.length === 2 ? payload.participantIds as [string, string] : null;
}

function hasOpenedThreadForCandidate(chat: GroupChat, payload: SocialEventCandidatePayload) {
  const pairKey = extractCandidatePairKey(payload);
  return (chat.runtimeEventsV2 || []).some((event) => isPrivateThreadOpenedArtifact(event) && extractOpenedPairKey(event) === pairKey);
}

function getLatestPrivateThreadOpenedAt(chat: GroupChat, payload: SocialEventCandidatePayload) {
  const pairKey = extractCandidatePairKey(payload);
  return (chat.runtimeEventsV2 || [])
    .filter((event) => isPrivateThreadOpenedArtifact(event) && extractOpenedPairKey(event) === pairKey)
    .map((event) => event.createdAt)
    .sort((a, b) => b - a)[0] || null;
}

function withinPrivateThreadCooldown(createdAt: number, latestOpenedAt: number | null) {
  return typeof latestOpenedAt === 'number' && createdAt - latestOpenedAt < 1000 * 60 * 30;
}

function shouldCandidateAutoOpen(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  if (payload.eventKind !== 'pair_private_thread') return false;
  if (payload.participantIds.length !== 2) return false;
  if (payload.confidence < 0.8) return false;
  if (hasOpenedThreadForCandidate(chat, payload) && withinPrivateThreadCooldown(createdAt, getLatestPrivateThreadOpenedAt(chat, payload))) return false;
  return true;
}

function getAutoOpenPairFromCandidate(chat: GroupChat, event: RuntimeEventV2) {
  if (event.kind !== 'event_candidate') return null;
  const payload = event.payload as SocialEventCandidatePayload;
  if (!shouldCandidateAutoOpen(chat, payload, event.createdAt)) return null;
  return extractCandidatePair(payload);
}

function isAutoOpenEligible(chat: GroupChat, event: RuntimeEventV2) {
  return Boolean(getAutoOpenPairFromCandidate(chat, event));
}

function findLatestAutoOpenCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => isAutoOpenEligible(chat, event)) || null;
}

export function findLatestAutoPostMomentCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => {
    if (event.kind !== 'event_candidate') return false;
    const payload = event.payload as SocialEventCandidatePayload;
    if (payload.eventKind !== 'post_moment') return false;
    if (payload.confidence < 0.8) return false;
    return !(chat.runtimeEventsV2 || []).some((item) => item.kind === 'artifact' && (item.payload as { artifactType?: string; eventKind?: string }).artifactType === 'moment_text' && (item.payload as { eventKind?: string }).eventKind === 'post_moment' && item.actorIds?.[0] === payload.initiatorId && item.createdAt >= event.createdAt);
  }) || null;
}

export function findLatestAutoStatusUpdateCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => {
    if (event.kind !== 'event_candidate') return false;
    const payload = event.payload as SocialEventCandidatePayload;
    if (payload.eventKind !== 'status_update') return false;
    if (payload.confidence < 0.8) return false;
    return !(chat.runtimeEventsV2 || []).some((item) => item.kind === 'artifact' && (item.payload as { artifactType?: string; eventKind?: string }).artifactType === 'status_note' && (item.payload as { eventKind?: string }).eventKind === 'status_update' && item.actorIds?.[0] === payload.initiatorId && item.createdAt >= event.createdAt);
  }) || null;
}

export function updateSourceChatAfterStatusUpdate(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorName: string) {
  const summary = `${actorName} 在群里同步了自己的近况。`;
  const shiftedRoom = calculateRoomShift(sourceChat.worldState.structuredRoomState || null, {
    kind: 'side_comment',
    actorId: payload.initiatorId,
    targetId: payload.targetIds?.[0] || null,
    intensity: 1,
    tone: 'warm',
    evidenceText: (payload.sourceText || summary).slice(0, 120),
    confidence: payload.confidence,
  });
  const effectEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'relationship_delta',
    summary: `状态回流：${summary}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      eventKind: 'status_update',
      effectType: 'artifact',
      summary: `状态回流：${summary}`,
      confidence: payload.confidence,
    },
  });
  const memoryEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'memory_candidate',
    summary,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      kind: 'fact',
      text: summary,
      salience: 0.62,
      confidence: payload.confidence,
    },
  });
  const artifactEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'artifact',
    summary,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      artifactType: 'status_note',
      eventKind: 'status_update',
      text: summary,
      title: payload.title,
      activityType: payload.activityType,
      expectedArtifacts: payload.expectedArtifacts || [],
      dedupeKey: payload.dedupeKey,
    },
  });
  const roomShiftEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'room_shift',
    summary: `状态更新后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: shiftedRoom.shift,
  });
  return withFrameworkPatch(sourceChat, {
    lastMessageAt: Date.now(),
    runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [effectEvent, memoryEvent, artifactEvent, roomShiftEvent]),
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      ...(sourceChat.worldState || {}),
      structuredRoomState: shiftedRoom.nextState,
      recentEvent: summary.slice(0, 120),
    },
    ...accumulateChatRuntime(sourceChat, { type: 'event', content: summary }),
    runtimeSeed: mergeRuntimeSeedWithSummary(sourceChat, summary),
  });
}

function findLatestAutoSocialOutingCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => {
    if (event.kind !== 'event_candidate') return false;
    const payload = event.payload as SocialEventCandidatePayload;
    return payload.eventKind === 'social_outing' && payload.confidence >= 0.8 && !(chat.runtimeEventsV2 || []).some((item) => item.kind === 'artifact' && (item.payload as { artifactType?: string }).artifactType === 'outing_summary' && item.createdAt >= event.createdAt);
  }) || null;
}

function findLatestAutoGiftExchangeCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => {
    if (event.kind !== 'event_candidate') return false;
    const payload = event.payload as SocialEventCandidatePayload;
    return payload.eventKind === 'gift_exchange' && payload.confidence >= 0.8 && !(chat.runtimeEventsV2 || []).some((item) => item.kind === 'artifact' && (item.payload as { artifactType?: string }).artifactType === 'gift_note' && item.createdAt >= event.createdAt);
  }) || null;
}

function findLatestAutoConflictExpressionCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => {
    if (event.kind !== 'event_candidate') return false;
    const payload = event.payload as SocialEventCandidatePayload;
    return payload.eventKind === 'conflict_expression' && payload.confidence >= 0.8 && !(chat.runtimeEventsV2 || []).some((item) => item.kind === 'artifact' && (item.payload as { artifactType?: string }).artifactType === 'conflict_note' && item.createdAt >= event.createdAt);
  }) || null;
}

export function updateSourceChatAfterGiftExchange(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorName: string) {
  const summary = `${actorName} 刚刚送出了一个小礼物或心意。`;
  const shiftedRoom = calculateRoomShift(sourceChat.worldState.structuredRoomState || null, {
    kind: 'support',
    actorId: payload.initiatorId,
    targetId: payload.targetIds?.[0] || null,
    intensity: 2,
    tone: 'warm',
    evidenceText: (payload.sourceText || summary).slice(0, 120),
    confidence: payload.confidence,
  });
  const effectEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'relationship_delta',
    summary: `礼物回流：${summary}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      eventKind: 'gift_exchange',
      effectType: 'artifact',
      summary: `礼物回流：${summary}`,
      confidence: payload.confidence,
    },
  });
  const memoryEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'memory_candidate',
    summary,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      kind: 'preference',
      text: summary,
      salience: 0.7,
      confidence: payload.confidence,
    },
  });
  const artifactEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'artifact',
    summary,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      artifactType: 'gift_note',
      eventKind: 'gift_exchange',
      text: summary,
      title: payload.title,
      activityType: payload.activityType,
      expectedArtifacts: payload.expectedArtifacts || [],
      dedupeKey: payload.dedupeKey,
    },
  });
  const roomShiftEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'room_shift',
    summary: `礼物互动后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: shiftedRoom.shift,
  });
  return withFrameworkPatch(sourceChat, {
    lastMessageAt: Date.now(),
    runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [effectEvent, memoryEvent, artifactEvent, roomShiftEvent]),
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      ...(sourceChat.worldState || {}),
      structuredRoomState: shiftedRoom.nextState,
      recentEvent: summary.slice(0, 120),
    },
    ...accumulateChatRuntime(sourceChat, { type: 'event', content: summary }),
    runtimeSeed: mergeRuntimeSeedWithSummary(sourceChat, summary),
  });
}

export function updateSourceChatAfterConflictExpression(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorName: string) {
  const summary = `${actorName} 把刚才的不满直接摊开说了。`;
  const shiftedRoom = calculateRoomShift(sourceChat.worldState.structuredRoomState || null, {
    kind: 'challenge',
    actorId: payload.initiatorId,
    targetId: payload.targetIds?.[0] || null,
    intensity: 2,
    tone: 'annoyed',
    evidenceText: (payload.sourceText || summary).slice(0, 120),
    confidence: payload.confidence,
  });
  const effectEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'relationship_delta',
    summary: `冲突回流：${summary}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      eventKind: 'conflict_expression',
      effectType: 'artifact',
      summary: `冲突回流：${summary}`,
      confidence: payload.confidence,
    },
  });
  const memoryEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'memory_candidate',
    summary,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      kind: 'relationship',
      text: summary,
      salience: 0.74,
      confidence: payload.confidence,
    },
  });
  const artifactEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'artifact',
    summary,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      artifactType: 'conflict_note',
      eventKind: 'conflict_expression',
      text: summary,
      title: payload.title,
      activityType: payload.activityType,
      expectedArtifacts: payload.expectedArtifacts || [],
      dedupeKey: payload.dedupeKey,
    },
  });
  const roomShiftEvent = createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'room_shift',
    summary: `冲突表达后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: shiftedRoom.shift,
  });
  return withFrameworkPatch(sourceChat, {
    lastMessageAt: Date.now(),
    runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [effectEvent, memoryEvent, artifactEvent, roomShiftEvent]),
    worldState: {
      ...DEFAULT_CONVERSATION_WORLD_STATE,
      ...(sourceChat.worldState || {}),
      structuredRoomState: shiftedRoom.nextState,
      recentEvent: summary.slice(0, 120),
    },
    ...accumulateChatRuntime(sourceChat, { type: 'event', content: summary }),
    runtimeSeed: mergeRuntimeSeedWithSummary(sourceChat, summary),
  });
}

export async function applyAiDirectFeedback(params: {
  chat: GroupChat;
  chats: GroupChat[];
  characters: AICharacter[];
  content: string;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[] }) => Promise<void>;
}) {
  if (params.chat.type !== 'ai_direct' || !params.chat.sourceChatId || params.chat.sourceMemberIds?.length !== 2) return;

  const [starterId, targetId] = params.chat.sourceMemberIds;
  const starter = params.characters.find((item) => item.id === starterId);
  const target = params.characters.find((item) => item.id === targetId);
  if (!starter || !target) return;

  const evolution = resolveRuntimeEvolutionConfig(params.chat.runtimeEvolutionIntensity);
  const updatedStarter = updateCharacterRelationship(starter, targetId, params.content, evolution.relationshipMultiplier);
  const updatedTarget = updateCharacterRelationship(target, starterId, params.content, evolution.reciprocalRelationshipMultiplier);
  const starterDrift = derivePersonalityDrift(starter, params.content, evolution.driftMultiplier);
  const targetDrift = derivePersonalityDrift(target, params.content, evolution.driftMultiplier * 0.85);
  const starterEmotion = deriveEmotionalState(starter, params.content, evolution.emotionMultiplier, evolution.emotionDecayBias);
  const targetEmotion = deriveEmotionalState(target, params.content, evolution.emotionMultiplier * 0.85, evolution.emotionDecayBias);

  await params.updateCharacter(starterId, {
    relationships: updatedStarter.relationships,
    personalityDrift: starterDrift,
    emotionalState: starterEmotion,
    layeredMemories: updateCharacterLayeredMemories({
      character: { ...starter, relationships: updatedStarter.relationships, emotionalState: starterEmotion },
      targetId,
      targetName: target.name,
      content: params.content,
      personalityDrift: starterDrift,
    }),
    runtimeTimeline: accumulateCharacterRuntime(starter, { type: 'relationship', text: `与 ${target.name} 的AI私聊带来了关系变化（${evolution.label}）` }).concat(
      Object.keys(starterDrift).length ? [{ type: 'drift', text: `与 ${target.name} 互动后产生性格漂移`, createdAt: Date.now() }] : []
    ).slice(-Math.max(20, evolution.maxTimeline)),
  });

  await params.updateCharacter(targetId, {
    relationships: updatedTarget.relationships,
    personalityDrift: targetDrift,
    emotionalState: targetEmotion,
    layeredMemories: updateCharacterLayeredMemories({
      character: { ...target, relationships: updatedTarget.relationships, emotionalState: targetEmotion },
      targetId: starterId,
      targetName: starter.name,
      content: params.content,
      personalityDrift: targetDrift,
    }),
    runtimeTimeline: accumulateCharacterRuntime(target, { type: 'relationship', text: `与 ${starter.name} 的AI私聊带来了关系变化（${evolution.label}）` }).concat(
      Object.keys(targetDrift).length ? [{ type: 'drift', text: `与 ${starter.name} 互动后产生性格漂移`, createdAt: Date.now() }] : []
    ).slice(-Math.max(20, evolution.maxTimeline)),
  });

  const starterRelation = updatedStarter.relationships.find((item) => item.characterId === targetId);
  const targetRelation = updatedTarget.relationships.find((item) => item.characterId === starterId);
  const publicSummary = buildPrivateThreadPublicSummary(starter.name, target.name, params.content);
  const sourceChat = params.chats.find((item) => item.id === params.chat.sourceChatId);
  if (!sourceChat) return;

  await params.updateChat(params.chat.sourceChatId, updateSourceChatAfterPrivateThread(sourceChat, starterId, targetId, starter.name, target.name, publicSummary));

  await params.appendEventMessage(params.chat.sourceChatId, {
    eventType: 'private_thread_effect',
    title: `${starter.name} 与 ${target.name} 的AI私聊回流了影响`,
    summary: publicSummary,
    pair: [starter.name, target.name],
    metrics: {
      starterToTarget: starterRelation || null,
      targetToStarter: targetRelation || null,
    },
    visibilityScope: 'derived_public',
  });

  await params.appendEventMessage(params.chat.sourceChatId, {
    eventType: 'private_thread_summary',
    title: `${starter.name} 与 ${target.name} 的私聊摘要`,
    summary: publicSummary,
    pair: [starter.name, target.name],
    visibilityScope: 'derived_public',
  });
}

export function pickAutoPairPrivateThreadCandidate(chat: GroupChat) {
  return findLatestAutoOpenCandidate(chat);
}

export function buildPrivateThreadOpenedEvent(chat: GroupChat, candidateEvent: RuntimeEventV2): RuntimeEventV2 {
  const payload = candidateEvent.payload as SocialEventCandidatePayload;
  return createRuntimeEventV2({
    conversationId: chat.id,
    kind: 'artifact',
    summary: '已自动派生双人私聊',
    actorIds: [payload.initiatorId],
    targetIds: payload.participantIds,
    visibility: 'derived_public',
    payload: {
      artifactType: 'private_thread_opened',
      candidateId: candidateEvent.id,
      eventKind: payload.eventKind,
      participantIds: payload.participantIds,
      reasonType: payload.reasonType,
    },
  });
}

export interface SocialEventRuntimeOps {
  chats: GroupChat[];
  characters: AICharacter[];
  updateChat: (chatId: string, patch: Partial<GroupChat>) => Promise<unknown>;
  addChat: (input: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) => Promise<GroupChat>;
  addMessage: (message: { chatId: string; type: 'system'; senderId: string; senderName: string; content: string; emotion: number }) => Promise<unknown>;
  appendEventMessage: (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[] }) => Promise<void>;
}

export async function runSocialEventAutoFlow(sourceChat: GroupChat, ops: SocialEventRuntimeOps): Promise<{ privateChatId?: string | null; handledEventId?: string | null }> {
  const pairCandidate = pickAutoPairPrivateThreadCandidate(sourceChat);
  if (pairCandidate) {
    const payload = pairCandidate.payload as SocialEventCandidatePayload;
    const [actorId, targetId] = payload.participantIds;
    const privateChat = await createAiPrivateThread({
      sourceChat,
      chats: ops.chats,
      characters: ops.characters,
      starterId: actorId,
      targetId,
      addChat: ops.addChat,
      addMessage: ops.addMessage,
      appendEventMessage: ops.appendEventMessage,
    });
    if (privateChat) {
      await ops.updateChat(sourceChat.id, withFrameworkPatch(sourceChat, {
        runtimeEventsV2: [...(sourceChat.runtimeEventsV2 || []), buildPrivateThreadOpenedEvent(sourceChat, pairCandidate)].slice(-160),
      }));
      return { privateChatId: privateChat.id, handledEventId: pairCandidate.id };
    }
  }

  const momentCandidate = findLatestAutoPostMomentCandidate(sourceChat);
  if (momentCandidate) {
    const payload = momentCandidate.payload as SocialEventCandidatePayload;
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    await ops.updateChat(sourceChat.id, updateSourceChatAfterPostMoment(sourceChat, payload, actorName));
    return { handledEventId: momentCandidate.id };
  }

  const outingCandidate = findLatestAutoSocialOutingCandidate(sourceChat);
  if (outingCandidate) {
    const payload = outingCandidate.payload as SocialEventCandidatePayload;
    const actorNames = payload.participantIds.map((id) => ops.characters.find((item) => item.id === id)?.name || id);
    await ops.updateChat(sourceChat.id, updateSourceChatAfterSocialOuting(sourceChat, payload, actorNames));
    return { handledEventId: outingCandidate.id };
  }

  const statusCandidate = findLatestAutoStatusUpdateCandidate(sourceChat);
  if (statusCandidate) {
    const payload = statusCandidate.payload as SocialEventCandidatePayload;
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    await ops.updateChat(sourceChat.id, updateSourceChatAfterStatusUpdate(sourceChat, payload, actorName));
    return { handledEventId: statusCandidate.id };
  }

  const giftCandidate = findLatestAutoGiftExchangeCandidate(sourceChat);
  if (giftCandidate) {
    const payload = giftCandidate.payload as SocialEventCandidatePayload;
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    await ops.updateChat(sourceChat.id, updateSourceChatAfterGiftExchange(sourceChat, payload, actorName));
    return { handledEventId: giftCandidate.id };
  }

  const conflictCandidate = findLatestAutoConflictExpressionCandidate(sourceChat);
  if (conflictCandidate) {
    const payload = conflictCandidate.payload as SocialEventCandidatePayload;
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    await ops.updateChat(sourceChat.id, updateSourceChatAfterConflictExpression(sourceChat, payload, actorName));
    return { handledEventId: conflictCandidate.id };
  }

  return { privateChatId: null, handledEventId: null };
}

export function buildStartPrivateThreadExecutionResult(chat: GroupChat, actorId: string, targetId: string, prompt = ''): SessionActionExecutionResult {
  const summary = `发起私聊：${actorId} → ${targetId}${prompt ? ` · ${prompt.slice(0, 32)}` : ''}`;
  return {
    chatPatch: withFrameworkPatch(chat, {
      worldState: {
        ...chat.worldState,
        recentEvent: summary,
      },
    }),
    runtimeEvents: [{
      eventType: 'start_private_thread',
      title: '执行了私聊派生动作',
      summary,
      metrics: { actorId, targetId, prompt },
    }],
  };
}

export async function createAiPrivateThread(params: {
  sourceChat: GroupChat;
  chats: GroupChat[];
  characters: AICharacter[];
  starterId: string;
  targetId: string;
  addChat: (input: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) => Promise<GroupChat>;
  addMessage: (message: { chatId: string; type: 'system'; senderId: string; senderName: string; content: string; emotion: number }) => Promise<unknown>;
  appendEventMessage: (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[] }) => Promise<void>;
}) {
  const initiator = params.characters.find((item) => item.id === params.starterId);
  const target = params.characters.find((item) => item.id === params.targetId);
  if (!initiator || !target || params.starterId === params.targetId) return null;

  const existing = params.chats.find((item) => item.type === 'ai_direct' && item.sourceChatId === params.sourceChat.id && item.memberIds.includes(params.starterId) && item.memberIds.includes(params.targetId));
  if (existing) return existing;

  const privateChat = await params.addChat(buildAiPrivateChatDraft(params.sourceChat, initiator, target));

  await params.addMessage({
    chatId: privateChat.id,
    type: 'system',
    senderId: 'system',
    senderName: 'System',
    content: `${initiator.name} 和 ${target.name} 从群聊 ${params.sourceChat.name} 派生出一个AI私聊。`,
    emotion: 0,
  });

  await params.appendEventMessage(params.sourceChat.id, {
    eventType: 'private_chat_started',
    title: `${initiator.name} 与 ${target.name} 开启了AI私聊`,
    summary: '群聊将跟踪这段私下互动带来的关系变化。',
    pair: [initiator.name, target.name],
    visibilityScope: 'derived_public',
  });

  return privateChat;
}

export function buildAiPrivateChatDraft(sourceChat: GroupChat, starter: AICharacter, target: AICharacter): Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'> {
  const phase: ConversationPhase = 'warming';
  const frameworkPatch = createConversationThreadFrameworkPatch(sourceChat, [starter.id, target.id]);
  return {
    type: 'ai_direct' as const,
    mode: 'open_chat' as const,
    sessionKind: frameworkPatch.sessionKind,
    modeConfig: sourceChat.modeConfig,
    modeState: sourceChat.modeState,
    scenarioPackage: frameworkPatch.scenarioPackage,
    scenarioState: frameworkPatch.scenarioState,
    channels: frameworkPatch.channels,
    layoutState: frameworkPatch.layoutState,
    judgeAgent: frameworkPatch.judgeAgent,
    modeStateSummary: frameworkPatch.modeStateSummary,
    memoryLayerSummary: frameworkPatch.memoryLayerSummary,
    growthSnapshots: frameworkPatch.growthSnapshots,
    roleMemorySummaries: frameworkPatch.roleMemorySummaries,
    scenarioMemorySummary: frameworkPatch.scenarioMemorySummary,
    topologySummary: frameworkPatch.topologySummary,
    name: `${starter.name} × ${target.name}`,
    topic: `${starter.name} 和 ${target.name} 的AI私聊`,
    style: 'free' as const,
    runtimeEvolutionIntensity: sourceChat.runtimeEvolutionIntensity,
    memberIds: [starter.id, target.id],
    speed: 1,
    isActive: false,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    sourceChatId: sourceChat.id,
    sourceMemberIds: [starter.id, target.id],
    governance: { ownerCharacterId: starter.id, adminCharacterIds: [], autoModeration: false, allowMute: false, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase, mood: 'private', focus: sourceChat.topic || '', recentEvent: `派生自 ${sourceChat.name}` },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: false, allowForcedReply: true },
  };
}
