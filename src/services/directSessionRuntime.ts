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
import { projectWorldAttentionStates } from './worldRuntimeProjection';
import { resolveSessionEngine } from './sessionEngineRegistry';
import { buildThreadRef, getVisibilityChannelId } from './sessionTopology';
import { reportUnresolvedDisplayEntity } from './diagnostics';
import { isCharacterFeatureEnabled } from './characterGenerationPolicy';

function withFrameworkPatch(chat: GroupChat, patch: Partial<GroupChat>) {
  const engine = resolveSessionEngine(chat);
  return mergeSessionChatPatch(engine, chat, patch);
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

function resolveEventTimestamp(createdAt?: number) {
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? Math.round(createdAt) : Date.now();
}

function stableEventSeed(parts: Array<string | number | undefined>) {
  const joined = parts.filter((item) => item !== undefined && item !== null && String(item).length > 0).join('|');
  let hash = 0;
  for (let index = 0; index < joined.length; index += 1) {
    hash = (hash * 31 + joined.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
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
  createdAt?: number;
}) {
  const createdAt = resolveEventTimestamp(params.createdAt);
  const seed = stableEventSeed([
    params.conversationId,
    params.kind,
    createdAt,
    params.summary.slice(0, 80),
    (params.actorIds || []).join(','),
    (params.targetIds || []).join(','),
  ]);
  return {
    id: `evt_${createdAt}_${seed}`,
    conversationId: params.conversationId,
    kind: params.kind,
    createdAt,
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

function buildPostMomentExpectedArtifactsForWorldCandidate(chat: GroupChat, actorId: string, now: number, hasImageModel: boolean) {
  if (!hasImageModel) return ['moment_text'];
  const seed = stableEventSeed([chat.id, actorId, Math.floor(now / (60 * 60_000)), 'world-post-moment']);
  const score = seed.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 100;
  if (score < 35) return ['moment_text']; // 可发图，但不强制
  if (score < 60) return ['moment_text', 'moment_selfie'];
  if (score < 80) return ['moment_text', 'moment_group_photo'];
  return ['moment_text', 'moment_scene_photo'];
}

function appendStructuredRuntimeEvent(chat: GroupChat, event: RuntimeEventV2) {
  return [...(chat.runtimeEventsV2 || []), event].slice(-160);
}

function appendStructuredRuntimeEvents(chat: GroupChat, events: RuntimeEventV2[]) {
  return events.reduce((acc, event) => appendStructuredRuntimeEvent({ ...chat, runtimeEventsV2: acc }, event), chat.runtimeEventsV2 || []);
}

function hasRecentWorldSuppressionEvent(chat: GroupChat, actorId: string | null, reasonType: string, windowMs: number, now = Date.now()) {
  return (chat.runtimeEventsV2 || []).some((event) => {
    if (event.kind !== 'artifact') return false;
    if (now - event.createdAt > windowMs) return false;
    const payload = event.payload as {
      eventType?: string;
      reasonType?: string;
    };
    if (payload.eventType !== 'event_candidate_suppressed' || payload.reasonType !== reasonType) return false;
    if (!actorId) return true;
    return (event.actorIds || [])[0] === actorId;
  });
}

function buildWorldSuppressionEvent(params: {
  chat: GroupChat;
  actorId: string | null;
  actorName?: string;
  reasonType: string;
  reasonLabel: string;
  reasonDetail: string;
  candidateEventKind?: SocialEventCandidatePayload['eventKind'];
}) {
  return createRuntimeEventV2({
    conversationId: params.chat.id,
    kind: 'artifact',
    actorIds: params.actorId ? [params.actorId] : undefined,
    targetIds: params.actorId ? ['user'] : undefined,
    visibility: 'derived_public',
    summary: `${params.actorName || '世界驱动'}候选已抑制：${params.reasonLabel}`,
    payload: {
      eventType: 'event_candidate_suppressed',
      candidateEventKind: params.candidateEventKind,
      reasonType: params.reasonType,
      reasonLabel: params.reasonLabel,
      reasonDetail: params.reasonDetail,
    },
  });
}

function buildWorldDecisionEvent(params: {
  chat: GroupChat;
  actorId: string | null;
  actorName?: string;
  decisionType: 'trigger' | 'suppressed' | 'fallback';
  reasonType: string;
  reasonLabel: string;
  reasonDetail: string;
  fromEventKind?: SocialEventCandidatePayload['eventKind'];
  toEventKind?: SocialEventCandidatePayload['eventKind'];
}) {
  const fromLabel = params.fromEventKind ? `${params.fromEventKind} -> ` : '';
  return createRuntimeEventV2({
    conversationId: params.chat.id,
    kind: 'artifact',
    actorIds: params.actorId ? [params.actorId] : undefined,
    targetIds: params.actorId ? ['user'] : undefined,
    visibility: 'derived_public',
    summary: `${params.actorName || '世界驱动'}决策：${fromLabel}${params.toEventKind || 'none'} (${params.decisionType})`,
    payload: {
      eventType: 'world_attention_decision',
      decisionType: params.decisionType,
      reasonType: params.reasonType,
      reasonLabel: params.reasonLabel,
      reasonDetail: params.reasonDetail,
      fromEventKind: params.fromEventKind,
      toEventKind: params.toEventKind,
    },
  });
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

function buildPrivateThreadProjectionMetrics(params: {
  starterId: string;
  targetId: string;
  starterName: string;
  targetName: string;
  content: string;
  starterRelation?: AICharacter['relationships'][number] | null;
  targetRelation?: AICharacter['relationships'][number] | null;
}) {
  return {
    eventKind: 'pair_private_thread',
    projectionKind: 'relationship_backflow',
    participantIds: [params.starterId, params.targetId],
    participantNames: [params.starterName, params.targetName],
    topicSnippet: params.content.trim().replace(/\s+/g, ' ').slice(0, 48),
    relationDelta: {
      starterToTarget: params.starterRelation || null,
      targetToStarter: params.targetRelation || null,
    },
  };
}

function buildPrivateThreadSummaryMetrics(params: {
  starterId: string;
  targetId: string;
  starterName: string;
  targetName: string;
  content: string;
}) {
  return {
    eventKind: 'pair_private_thread',
    projectionKind: 'summary_backflow',
    participantIds: [params.starterId, params.targetId],
    participantNames: [params.starterName, params.targetName],
    topicSnippet: params.content.trim().replace(/\s+/g, ' ').slice(0, 48),
  };
}

function buildPrivateThreadSourcePatchMetrics(params: {
  starterId: string;
  targetId: string;
  starterName: string;
  targetName: string;
  summary: string;
}) {
  return {
    eventKind: 'pair_private_thread',
    projectionKind: 'source_chat_patch',
    participantIds: [params.starterId, params.targetId],
    participantNames: [params.starterName, params.targetName],
    summarySnippet: params.summary.slice(0, 80),
  };
}

function buildPrivateThreadProjectionArtifact(sourceChat: GroupChat, starterId: string, targetId: string, starterName: string, targetName: string, summary: string) {
  return createRuntimeEventV2({
    conversationId: sourceChat.id,
    kind: 'artifact',
    summary: `${starterName} 与 ${targetName} 的私聊影响已结构化投影到群聊`,
    actorIds: [starterId],
    targetIds: [targetId],
    visibility: 'derived_public',
    payload: {
      artifactType: 'private_thread_projection',
      ...buildPrivateThreadSourcePatchMetrics({ starterId, targetId, starterName, targetName, summary }),
    },
  });
}

function updateSourceChatAfterPrivateThread(sourceChat: GroupChat, starterId: string, targetId: string, starterName: string, targetName: string, summary: string) {
  const { effectEvent, summaryEvent, roomShiftEvent, nextStructuredRoomState } = buildPrivateThreadEffectEvents(sourceChat, starterId, targetId, summary);
  const projectionArtifact = buildPrivateThreadProjectionArtifact(sourceChat, starterId, targetId, starterName, targetName, summary);
  return withFrameworkPatch(sourceChat, {
    lastMessageAt: Date.now(),
    runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [effectEvent, summaryEvent, roomShiftEvent, projectionArtifact]),
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

function findLatestAutoCheckInCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => {
    if (event.kind !== 'event_candidate') return false;
    const payload = event.payload as SocialEventCandidatePayload;
    if (payload.eventKind !== 'check_in') return false;
    if (payload.confidence < 0.75) return false;
    return !(chat.runtimeEventsV2 || []).some((item) => item.kind === 'artifact'
      && (item.payload as { artifactType?: string; eventKind?: string }).artifactType === 'check_in_note'
      && (item.payload as { eventKind?: string }).eventKind === 'check_in'
      && item.actorIds?.[0] === payload.initiatorId
      && item.createdAt >= event.createdAt);
  }) || null;
}

function findLatestAutoReactToMomentCandidate(chat: GroupChat) {
  return (chat.runtimeEventsV2 || []).slice().reverse().find((event) => {
    if (event.kind !== 'event_candidate') return false;
    const payload = event.payload as SocialEventCandidatePayload;
    if (payload.eventKind !== 'react_to_moment') return false;
    if (payload.confidence < 0.75) return false;
    return !(chat.runtimeEventsV2 || []).some((item) => item.kind === 'artifact'
      && (item.payload as { artifactType?: string; eventKind?: string }).artifactType === 'moment_reaction_note'
      && (item.payload as { eventKind?: string }).eventKind === 'react_to_moment'
      && item.actorIds?.[0] === payload.initiatorId
      && item.createdAt >= event.createdAt);
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

export function updateSourceChatAfterCheckIn(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorName: string) {
  const summary = `${actorName} 主动问候了用户近况。`;
  const shiftedRoom = calculateRoomShift(sourceChat.worldState.structuredRoomState || null, {
    kind: 'support',
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
    summary: `问候回流：${summary}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      eventKind: 'check_in',
      effectType: 'artifact',
      summary: `问候回流：${summary}`,
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
      salience: 0.64,
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
      artifactType: 'check_in_note',
      eventKind: 'check_in',
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
    summary: `问候后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
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

export function updateSourceChatAfterReactToMoment(sourceChat: GroupChat, payload: SocialEventCandidatePayload, actorName: string) {
  const summary = `${actorName} 回应了用户最近的动态。`;
  const shiftedRoom = calculateRoomShift(sourceChat.worldState.structuredRoomState || null, {
    kind: 'support',
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
    summary: `动态回应回流：${summary}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds,
    visibility: 'derived_public',
    payload: {
      eventKind: 'react_to_moment',
      effectType: 'artifact',
      summary: `动态回应回流：${summary}`,
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
      salience: 0.66,
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
      artifactType: 'moment_reaction_note',
      eventKind: 'react_to_moment',
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
    summary: `动态回应后房间态势微调：热度 ${shiftedRoom.nextState.heat} / 凝聚 ${shiftedRoom.nextState.cohesion}`,
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
      sourceEventTag: 'ai_direct_starter_message',
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
      sourceEventTag: 'ai_direct_target_message',
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
    metrics: buildPrivateThreadProjectionMetrics({
      starterId,
      targetId,
      starterName: starter.name,
      targetName: target.name,
      content: params.content,
      starterRelation: starterRelation || null,
      targetRelation: targetRelation || null,
    }),
    visibilityScope: 'derived_public',
  });

  await params.appendEventMessage(params.chat.sourceChatId, {
    eventType: 'private_thread_summary',
    title: `${starter.name} 与 ${target.name} 的私聊摘要`,
    summary: publicSummary,
    pair: [starter.name, target.name],
    metrics: buildPrivateThreadSummaryMetrics({
      starterId,
      targetId,
      starterName: starter.name,
      targetName: target.name,
      content: params.content,
    }),
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
  imageModelEnabled?: boolean;
  updateChat: (chatId: string, patch: Partial<GroupChat>) => Promise<unknown>;
  addChat: (input: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) => Promise<GroupChat>;
  addMessage: (message: { chatId: string; type: 'system'; senderId: string; senderName: string; content: string; emotion: number }) => Promise<unknown>;
  appendEventMessage: (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[] }) => Promise<void>;
}

function buildHandledSocialEventMarker(eventId: string) {
  return `handled_social_event:${eventId}`;
}

function hasHandledSocialEvent(chat: GroupChat, eventId: string) {
  return (chat.runtimeEventsV2 || []).some((event) => event.kind === 'artifact' && event.summary === buildHandledSocialEventMarker(eventId));
}

function buildHandledSocialEventRuntimeEvent(chat: GroupChat, eventId: string, actorId?: string | null) {
  return createRuntimeEventV2({
    conversationId: chat.id,
    kind: 'artifact',
    summary: buildHandledSocialEventMarker(eventId),
    actorIds: actorId ? [actorId] : [],
    visibility: 'derived_public',
    payload: {
      artifactType: 'handled_social_event',
      eventId,
    },
  });
}

function appendHandledSocialEvent(chat: GroupChat, patch: Partial<GroupChat>, eventId: string, actorId?: string | null) {
  const baseEvents = patch.runtimeEventsV2 || chat.runtimeEventsV2 || [];
  return {
    ...patch,
    runtimeEventsV2: appendStructuredRuntimeEvents({ ...chat, runtimeEventsV2: baseEvents } as GroupChat, [buildHandledSocialEventRuntimeEvent(chat, eventId, actorId)]),
  };
}

function hasRecentWorldArtifact(
  chat: GroupChat,
  actorId: string,
  eventKind: 'status_update' | 'post_moment' | 'check_in' | 'react_to_moment' | 'social_outing',
  withinMs: number,
) {
  const now = Date.now();
  return (chat.runtimeEventsV2 || []).some((event) => {
    if (event.kind !== 'artifact') return false;
    const payload = event.payload as { eventKind?: string };
    return payload.eventKind === eventKind && event.actorIds?.[0] === actorId && now - event.createdAt <= withinMs;
  });
}

function hasRecentMomentSignal(chat: GroupChat, withinMs: number) {
  const now = Date.now();
  return (chat.runtimeEventsV2 || []).some((event) => {
    const payload = event.payload as { eventKind?: string; artifactType?: string };
    if (event.kind === 'artifact' && payload.eventKind === 'post_moment' && payload.artifactType === 'moment_text') {
      return now - event.createdAt <= withinMs;
    }
    if (event.kind === 'event_candidate' && payload.eventKind === 'post_moment') {
      return now - event.createdAt <= withinMs;
    }
    return false;
  });
}

function hasRecentAttentionFollowup(chat: GroupChat, actorId: string, withinMs: number) {
  const now = Date.now();
  return (chat.runtimeEventsV2 || []).some((event) => {
    if (now - event.createdAt > withinMs) return false;
    const payload = event.payload as { eventKind?: string };
    if (event.kind === 'artifact' && event.actorIds?.[0] === actorId) {
      return payload.eventKind === 'check_in' || payload.eventKind === 'react_to_moment';
    }
    if (event.kind === 'event_candidate' && event.actorIds?.[0] === actorId) {
      return payload.eventKind === 'check_in' || payload.eventKind === 'react_to_moment';
    }
    return false;
  });
}

function isQuietHours(timestamp: number) {
  const hour = new Date(timestamp).getHours();
  return hour >= 23 || hour < 7;
}

function hasRecentUserPrivateAction(chat: GroupChat, actorId: string, targetId: string, createdAt: number, cooldownMs: number) {
  return (chat.runtimeEventsV2 || []).some((event) => {
    if (event.createdAt >= createdAt || createdAt - event.createdAt > cooldownMs) return false;
    const payload = event.payload as Partial<SocialEventCandidatePayload> & { eventKind?: string; visibilityPlan?: string };
    if (event.kind !== 'event_candidate' && event.kind !== 'artifact') return false;
    if (payload.visibilityPlan !== 'user_private' && payload.eventKind !== 'check_in' && payload.eventKind !== 'pair_private_thread') return false;
    const sameActor = (event.actorIds || [])[0] === actorId;
    const sameTarget = (event.targetIds || []).includes(targetId);
    return sameActor && sameTarget;
  });
}

export function passesWorldAttentionRestraintPolicy(
  chat: GroupChat,
  actorId: string,
  targetId: string,
  createdAt: number,
  eventKind: SocialEventCandidatePayload['eventKind'],
  reasonType: SocialEventCandidatePayload['reasonType'],
) {
  if (!actorId || actorId === 'user' || targetId !== 'user') return true;
  const relation = getRelationshipLedgerEntry(chat.relationshipLedger || [], actorId, targetId);
  const warmth = relation?.current.warmth || 0;
  const trust = relation?.current.trust || 0;
  const threat = relation?.current.threat || 0;
  const relationSignal = warmth + trust;
  const worldAttentionInvite = reasonType === 'world_attention_invite_activity';
  const worldAttentionReminder = reasonType === 'world_attention_calendar_reminder';
  if (worldAttentionInvite || worldAttentionReminder) {
    if (threat >= 8) return false;
  }
  if (worldAttentionInvite) {
    if (relationSignal < 8) return false;
    if (isQuietHours(createdAt)) return false;
    if (hasRecentUserPrivateAction(chat, actorId, targetId, createdAt, 3 * 60 * 60_000)) return false;
  }
  if (worldAttentionReminder) {
    if (relationSignal < 6) return false;
    if (isQuietHours(createdAt) && relationSignal < 10) return false;
    if (hasRecentUserPrivateAction(chat, actorId, targetId, createdAt, 2 * 60 * 60_000)) return false;
  }
  if (eventKind === 'check_in') {
    if (threat >= 8) return false;
    if (relation && warmth + trust < 3) return false;
    if (isQuietHours(createdAt) && (relation ? warmth + trust < 9 : true)) return false;
    if (hasRecentUserPrivateAction(chat, actorId, targetId, createdAt, 90 * 60_000)) return false;
  }
  if (eventKind === 'react_to_moment') {
    if (isQuietHours(createdAt)) return false;
    const recentReactionCount = (chat.runtimeEventsV2 || []).filter((event) => {
      if (event.createdAt >= createdAt || createdAt - event.createdAt > 2 * 60 * 60_000) return false;
      if (event.kind !== 'artifact') return false;
      const artifactPayload = event.payload as { artifactType?: string; eventKind?: string };
      return artifactPayload.artifactType === 'moment_reaction_note'
        && artifactPayload.eventKind === 'react_to_moment'
        && (event.actorIds || [])[0] === actorId;
    }).length;
    if (recentReactionCount >= 2) return false;
  }
  return true;
}

function shouldConsumeCandidateWithRestraint(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const recentDedupeArtifactExists = (() => {
    const dedupeKey = payload.dedupeKey;
    if (!dedupeKey) return false;
    const configByEventKind: Record<SocialEventCandidatePayload['eventKind'], { artifactType: string; windowMs: number } | null> = {
      post_moment: { artifactType: 'moment_text', windowMs: 6 * 60 * 60_000 },
      status_update: { artifactType: 'status_note', windowMs: 3 * 60 * 60_000 },
      check_in: { artifactType: 'check_in_note', windowMs: 2 * 60 * 60_000 },
      react_to_moment: { artifactType: 'moment_reaction_note', windowMs: 2 * 60 * 60_000 },
      gift_exchange: { artifactType: 'gift_note', windowMs: 6 * 60 * 60_000 },
      conflict_expression: { artifactType: 'conflict_note', windowMs: 6 * 60 * 60_000 },
      social_outing: { artifactType: 'outing_summary', windowMs: 6 * 60 * 60_000 },
      pair_private_thread: { artifactType: 'private_thread_opened', windowMs: 30 * 60_000 },
      custom: null,
    };
    const config = configByEventKind[payload.eventKind];
    if (!config) return false;
    return (chat.runtimeEventsV2 || []).some((event) => {
      if (event.kind !== 'artifact') return false;
      const artifactPayload = event.payload as { artifactType?: string; dedupeKey?: string };
      if (artifactPayload.artifactType !== config.artifactType) return false;
      if (artifactPayload.dedupeKey !== dedupeKey) return false;
      const sameActor = (event.actorIds || [])[0] === payload.initiatorId;
      if (!sameActor) return false;
      return Math.abs(createdAt - event.createdAt) <= config.windowMs;
    });
  })();
  if (recentDedupeArtifactExists) return false;
  if (!['check_in', 'react_to_moment', 'social_outing', 'status_update'].includes(payload.eventKind)) return true;
  const actorId = payload.initiatorId;
  const targetId = payload.targetIds?.[0] || 'user';
  const reasonType = payload.reasonType || 'world_attention_followup';
  return passesWorldAttentionRestraintPolicy(chat, actorId, targetId, createdAt, payload.eventKind, reasonType);
}

function isValidAutoFlowCandidate(chat: GroupChat, payload: SocialEventCandidatePayload) {
  const memberIds = new Set(chat.memberIds || []);
  const userInChat = memberIds.has('user');
  const initiatorId = payload.initiatorId;
  if (!initiatorId || !memberIds.has(initiatorId)) return false;

  const participantIds = Array.isArray(payload.participantIds) ? payload.participantIds.filter(Boolean) : [];
  const targetIds = Array.isArray(payload.targetIds) ? payload.targetIds.filter(Boolean) : [];
  if (!participantIds.includes(initiatorId)) return false;
  const allIds = Array.from(new Set([...participantIds, ...targetIds]));
  const nonUserUnknown = allIds.filter((id) => id !== 'user' && !memberIds.has(id));
  if (nonUserUnknown.length) return false;
  const referencesUser = participantIds.includes('user') || targetIds.includes('user');
  if (referencesUser && !userInChat) return false;

  if (payload.eventKind === 'pair_private_thread') {
    if (participantIds.length !== 2) return false;
    if (participantIds.includes('user')) return false;
  }

  if (payload.eventKind === 'check_in' || payload.eventKind === 'react_to_moment' || payload.eventKind === 'status_update') {
    const firstTarget = targetIds[0] || 'user';
    if (firstTarget !== 'user') return false;
  }

  const visibilityPlan = payload.visibilityPlan;
  const visibilityAllowedByKind: Record<SocialEventCandidatePayload['eventKind'], ReadonlyArray<SocialEventCandidatePayload['visibilityPlan']>> = {
    pair_private_thread: ['conversation_private'],
    check_in: ['user_private'],
    react_to_moment: ['user_private'],
    status_update: ['public'],
    post_moment: ['public'],
    social_outing: ['mixed', 'public'],
    gift_exchange: ['public', 'mixed'],
    conflict_expression: ['public', 'mixed'],
    custom: ['public', 'conversation_private', 'user_private', 'mixed'],
  };
  if (!visibilityAllowedByKind[payload.eventKind].includes(visibilityPlan)) return false;

  const expectedArtifacts = Array.isArray(payload.expectedArtifacts) ? payload.expectedArtifacts.filter(Boolean) : [];
  const canonicalArtifactByKind: Record<SocialEventCandidatePayload['eventKind'], string | null> = {
    pair_private_thread: 'private_thread_summary',
    check_in: 'check_in_note',
    react_to_moment: 'moment_reaction_note',
    status_update: 'status_note',
    post_moment: 'moment_text',
    social_outing: 'outing_summary',
    gift_exchange: 'gift_note',
    conflict_expression: 'conflict_note',
    custom: null,
  };
  const canonical = canonicalArtifactByKind[payload.eventKind];
  const strictArtifactContract = (payload.reasonType || '').startsWith('world_attention_');
  if (strictArtifactContract && canonical && expectedArtifacts.length > 0 && !expectedArtifacts.includes(canonical)) return false;

  return true;
}

function buildWorldDrivenCandidate(chat: GroupChat, characters: AICharacter[], imageModelEnabled = false) {
  const attention = projectWorldAttentionStates([chat], characters).find((item) => item.targetId === 'user' && item.actorId !== 'user');
  if (!attention) return null;
  const actor = characters.find((item) => item.id === attention.actorId) || null;
  if (attention.attentionScore < 0.58 || attention.restraint > 0.72) return null;
  const now = Date.now();
  const hasRecentFollowup = hasRecentAttentionFollowup(chat, attention.actorId, 120 * 60_000);
  const inviteReasonType: SocialEventCandidatePayload['reasonType'] = 'world_attention_invite_activity';
  const reminderReasonType: SocialEventCandidatePayload['reasonType'] = 'world_attention_calendar_reminder';
  const privateMessageReasonType: SocialEventCandidatePayload['reasonType'] = 'world_attention_private_message';
  const followupQuestionReasonType: SocialEventCandidatePayload['reasonType'] = 'world_attention_followup_question';
  const followupReasonType: SocialEventCandidatePayload['reasonType'] = 'world_attention_followup';
  const canPrivateMessage = attention.suggestedActions.includes('private_message')
    && !hasRecentFollowup
    && !hasRecentWorldArtifact(chat, attention.actorId, 'check_in', 120 * 60_000)
    && passesWorldAttentionRestraintPolicy(chat, attention.actorId, 'user', now, 'check_in', privateMessageReasonType);
  const canAskFollowup = attention.suggestedActions.includes('ask_followup')
    && !hasRecentFollowup
    && !hasRecentWorldArtifact(chat, attention.actorId, 'check_in', 120 * 60_000)
    && passesWorldAttentionRestraintPolicy(chat, attention.actorId, 'user', now, 'check_in', followupQuestionReasonType);
  const canCheckIn = attention.suggestedActions.includes('check_in')
    && !hasRecentWorldArtifact(chat, attention.actorId, 'check_in', 90 * 60_000)
    && passesWorldAttentionRestraintPolicy(chat, attention.actorId, 'user', now, 'check_in', followupReasonType);
  const canReactMoment = attention.suggestedActions.includes('react_to_moment')
    && hasRecentMomentSignal(chat, 7 * 24 * 60 * 60_000)
    && !hasRecentWorldArtifact(chat, attention.actorId, 'react_to_moment', 120 * 60_000)
    && passesWorldAttentionRestraintPolicy(chat, attention.actorId, 'user', now, 'react_to_moment', followupReasonType);
  const canInviteActivity = attention.suggestedActions.includes('invite_activity')
    && !hasRecentWorldArtifact(chat, attention.actorId, 'social_outing', 6 * 60 * 60_000)
    && passesWorldAttentionRestraintPolicy(chat, attention.actorId, 'user', now, 'social_outing', inviteReasonType);
  const canCalendarReminder = attention.suggestedActions.includes('calendar_reminder')
    && !hasRecentWorldArtifact(chat, attention.actorId, 'status_update', 120 * 60_000)
    && passesWorldAttentionRestraintPolicy(chat, attention.actorId, 'user', now, 'status_update', reminderReasonType);
  const canStatus = !hasRecentWorldArtifact(chat, attention.actorId, 'status_update', 90 * 60_000);
  const canPostMoment = isCharacterFeatureEnabled(actor, 'moments')
    && !hasRecentWorldArtifact(chat, attention.actorId, 'post_moment', 180 * 60_000);
  const eventKind: SocialEventCandidatePayload['eventKind'] = canInviteActivity
    ? 'social_outing'
    : canCalendarReminder
      ? 'status_update'
      : canPrivateMessage || canAskFollowup || canCheckIn
    ? 'check_in'
    : canReactMoment
      ? 'react_to_moment'
      : canPostMoment
        ? 'post_moment'
        : canStatus
          ? 'status_update'
          : 'status_update';
  if (!canPrivateMessage && !canAskFollowup && !canCheckIn && !canReactMoment && !canPostMoment && !canStatus && !canInviteActivity && !canCalendarReminder) return null;
  const actorName = characters.find((item) => item.id === attention.actorId)?.name || attention.actorId;
  const confidence = Math.max(0.72, Math.min(0.93, attention.attentionScore * (1 - attention.restraint * 0.35)));
  const reasonType = canInviteActivity
    ? inviteReasonType
    : canCalendarReminder
      ? reminderReasonType
      : canPrivateMessage
    ? privateMessageReasonType
    : canAskFollowup
      ? followupQuestionReasonType
      : followupReasonType;
  const seedIntent = canInviteActivity
    ? (attention.reasons[0] || '关注状态触发一次线下邀约。')
    : canCalendarReminder
      ? (attention.reasons[0] || '关注状态触发一次日程提醒。')
      : canPrivateMessage
    ? (attention.reasons[0] || '关注状态触发一次私域问候。')
    : canAskFollowup
      ? (attention.reasons[0] || '关注状态触发一次追问式关心。')
      : (attention.reasons[0] || '关注状态触发一次自然近况同步。');
  const postMomentExpectedArtifacts = eventKind === 'post_moment'
    ? buildPostMomentExpectedArtifactsForWorldCandidate(chat, attention.actorId, now, imageModelEnabled)
    : null;
  const postMomentActivityType = eventKind === 'post_moment'
    ? (postMomentExpectedArtifacts?.includes('moment_selfie')
      ? '自拍动态'
      : postMomentExpectedArtifacts?.includes('moment_group_photo')
        ? '合影动态'
        : postMomentExpectedArtifacts?.includes('moment_scene_photo')
          ? '场景动态'
          : '日常动态')
    : null;
  const postMomentTitle = eventKind === 'post_moment'
    ? (postMomentExpectedArtifacts?.includes('moment_selfie')
      ? '随手自拍'
      : postMomentExpectedArtifacts?.includes('moment_group_photo')
        ? '合影记录'
        : postMomentExpectedArtifacts?.includes('moment_scene_photo')
          ? '场景碎片'
          : '朋友圈')
    : null;
  return createRuntimeEventV2({
    conversationId: chat.id,
    kind: 'event_candidate',
    actorIds: [attention.actorId],
    targetIds: ['user'],
    visibility: 'derived_public',
    summary: `${actorName} 触发世界驱动${eventKind === 'post_moment'
      ? '动态候选'
      : eventKind === 'social_outing'
        ? '活动邀约候选'
        : eventKind === 'check_in'
          ? '问候跟进候选'
          : eventKind === 'react_to_moment'
            ? '动态回应候选'
            : '状态更新候选'}`,
    payload: {
      eventKind,
      initiatorId: attention.actorId,
      participantIds: eventKind === 'social_outing' ? [attention.actorId, 'user'] : [attention.actorId],
      targetIds: ['user'],
      reasonType,
      confidence,
      urgency: 'soon',
      seedIntent,
      visibilityPlan: eventKind === 'post_moment' || eventKind === 'status_update'
        ? 'public'
        : eventKind === 'social_outing'
          ? 'mixed'
          : 'user_private',
      expectedArtifacts: eventKind === 'post_moment'
        ? (postMomentExpectedArtifacts || ['moment_text'])
        : eventKind === 'check_in'
          ? ['check_in_note']
          : eventKind === 'react_to_moment'
            ? ['moment_reaction_note']
            : eventKind === 'social_outing'
              ? ['outing_summary']
            : ['status_note'],
      title: eventKind === 'post_moment'
        ? (postMomentTitle || '朋友圈')
        : eventKind === 'social_outing'
          ? '活动邀约'
        : eventKind === 'check_in'
          ? (canPrivateMessage ? '私聊问候' : canAskFollowup ? '追问跟进' : '问候跟进')
          : eventKind === 'react_to_moment'
            ? '动态回应'
            : '状态更新',
      activityType: eventKind === 'post_moment'
        ? (postMomentActivityType || '日常动态')
        : eventKind === 'social_outing'
          ? '活动邀约'
        : eventKind === 'check_in'
          ? (canPrivateMessage ? '私聊问候' : canAskFollowup ? '追问关心' : '问候')
          : eventKind === 'react_to_moment'
            ? '动态互动'
            : canCalendarReminder
              ? '日程提醒'
            : '近况同步',
      dedupeKey: `world-attention-${eventKind}-${chat.id}-${attention.actorId}`,
    } satisfies SocialEventCandidatePayload,
  });
}

function evaluateWorldDrivenDecision(chat: GroupChat, characters: AICharacter[], imageModelEnabled = false) {
  const attention = projectWorldAttentionStates([chat], characters).find((item) => item.targetId === 'user' && item.actorId !== 'user');
  if (!attention) return { candidate: null as RuntimeEventV2 | null, suppressionEvents: [] as RuntimeEventV2[], decisionEvents: [] as RuntimeEventV2[] };
  const actor = characters.find((item) => item.id === attention.actorId) || null;
  const actorName = actor?.name || attention.actorId;
  const suppressionEvents: RuntimeEventV2[] = [];
  const decisionEvents: RuntimeEventV2[] = [];
  const now = Date.now();

  if (attention.attentionScore < 0.58 && !hasRecentWorldSuppressionEvent(chat, attention.actorId, 'world_attention_low_score', 20 * 60_000, now)) {
    suppressionEvents.push(buildWorldSuppressionEvent({
      chat,
      actorId: attention.actorId,
      actorName,
      reasonType: 'world_attention_low_score',
      reasonLabel: '关注分不足',
      reasonDetail: `关注分 ${attention.attentionScore.toFixed(2)} 低于触发阈值 0.58`,
      candidateEventKind: 'status_update',
    }));
    decisionEvents.push(buildWorldDecisionEvent({
      chat,
      actorId: attention.actorId,
      actorName,
      decisionType: 'suppressed',
      reasonType: 'world_attention_low_score',
      reasonLabel: '关注分不足',
      reasonDetail: `关注分 ${attention.attentionScore.toFixed(2)} 低于触发阈值 0.58`,
      toEventKind: 'status_update',
    }));
  }

  if (attention.restraint > 0.72 && !hasRecentWorldSuppressionEvent(chat, attention.actorId, 'world_attention_high_restraint', 20 * 60_000, now)) {
    suppressionEvents.push(buildWorldSuppressionEvent({
      chat,
      actorId: attention.actorId,
      actorName,
      reasonType: 'world_attention_high_restraint',
      reasonLabel: '关注克制过高',
      reasonDetail: `克制值 ${attention.restraint.toFixed(2)} 超过限制阈值 0.72`,
      candidateEventKind: 'check_in',
    }));
    decisionEvents.push(buildWorldDecisionEvent({
      chat,
      actorId: attention.actorId,
      actorName,
      decisionType: 'suppressed',
      reasonType: 'world_attention_high_restraint',
      reasonLabel: '关注克制过高',
      reasonDetail: `克制值 ${attention.restraint.toFixed(2)} 超过限制阈值 0.72`,
      toEventKind: 'check_in',
    }));
  }

  const shareMomentSuggested = attention.suggestedActions.includes('share_moment');
  const momentsEnabled = isCharacterFeatureEnabled(actor, 'moments');
  if (shareMomentSuggested && !momentsEnabled && !hasRecentWorldSuppressionEvent(chat, attention.actorId, 'world_attention_moment_disabled', 20 * 60_000, now)) {
    suppressionEvents.push(buildWorldSuppressionEvent({
      chat,
      actorId: attention.actorId,
      actorName,
      reasonType: 'world_attention_moment_disabled',
      reasonLabel: '朋友圈功能关闭',
      reasonDetail: '该角色当前不允许自动发朋友圈，已改走其它世界驱动动作。',
      candidateEventKind: 'post_moment',
    }));
  }

  const candidate = buildWorldDrivenCandidate(chat, characters, imageModelEnabled);
  const candidatePayload = candidate?.payload as SocialEventCandidatePayload | undefined;
  if (shareMomentSuggested && !momentsEnabled && candidatePayload?.eventKind && candidatePayload.eventKind !== 'post_moment') {
    decisionEvents.push(buildWorldDecisionEvent({
      chat,
      actorId: attention.actorId,
      actorName,
      decisionType: 'fallback',
      reasonType: 'world_attention_moment_disabled',
      reasonLabel: '朋友圈功能关闭，改走替代动作',
      reasonDetail: `share_moment 被关闭，已改为 ${candidatePayload.eventKind}`,
      fromEventKind: 'post_moment',
      toEventKind: candidatePayload.eventKind,
    }));
  } else if (candidatePayload?.eventKind) {
    decisionEvents.push(buildWorldDecisionEvent({
      chat,
      actorId: attention.actorId,
      actorName,
      decisionType: 'trigger',
      reasonType: 'world_attention_triggered',
      reasonLabel: '世界驱动触发',
      reasonDetail: `根据关注状态触发 ${candidatePayload.eventKind}`,
      toEventKind: candidatePayload.eventKind,
    }));
  }
  return { candidate, suppressionEvents, decisionEvents };
}

export async function runSocialEventAutoFlow(sourceChat: GroupChat, ops: SocialEventRuntimeOps): Promise<{ privateChatId?: string | null; handledEventId?: string | null }> {
  const pairCandidate = pickAutoPairPrivateThreadCandidate(sourceChat);
  if (pairCandidate && hasHandledSocialEvent(sourceChat, pairCandidate.id)) return { privateChatId: null, handledEventId: pairCandidate.id };
  if (pairCandidate) {
    const payload = pairCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { privateChatId: null, handledEventId: null };
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
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, withFrameworkPatch(sourceChat, {
        runtimeEventsV2: [...(sourceChat.runtimeEventsV2 || []), buildPrivateThreadOpenedEvent(sourceChat, pairCandidate)].slice(-160),
      }), pairCandidate.id, payload.initiatorId));
      return { privateChatId: privateChat.id, handledEventId: pairCandidate.id };
    }
  }

  const momentCandidate = findLatestAutoPostMomentCandidate(sourceChat);
  if (momentCandidate) {
    const payload = momentCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { handledEventId: null };
    if (hasHandledSocialEvent(sourceChat, momentCandidate.id)) return { handledEventId: momentCandidate.id };
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, updateSourceChatAfterPostMoment(sourceChat, payload, actorName), momentCandidate.id, payload.initiatorId));
    return { handledEventId: momentCandidate.id };
  }

  const outingCandidate = findLatestAutoSocialOutingCandidate(sourceChat);
  if (outingCandidate) {
    const payload = outingCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { handledEventId: null };
    if (hasHandledSocialEvent(sourceChat, outingCandidate.id)) return { handledEventId: outingCandidate.id };
    if (shouldConsumeCandidateWithRestraint(sourceChat, payload, outingCandidate.createdAt)) {
      const actorNames = payload.participantIds.map((id) => ops.characters.find((item) => item.id === id)?.name || id);
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, updateSourceChatAfterSocialOuting(sourceChat, payload, actorNames), outingCandidate.id, payload.initiatorId));
      return { handledEventId: outingCandidate.id };
    }
  }

  const statusCandidate = findLatestAutoStatusUpdateCandidate(sourceChat);
  if (statusCandidate) {
    const payload = statusCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { handledEventId: null };
    if (hasHandledSocialEvent(sourceChat, statusCandidate.id)) return { handledEventId: statusCandidate.id };
    if (shouldConsumeCandidateWithRestraint(sourceChat, payload, statusCandidate.createdAt)) {
      const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, updateSourceChatAfterStatusUpdate(sourceChat, payload, actorName), statusCandidate.id, payload.initiatorId));
      return { handledEventId: statusCandidate.id };
    }
  }

  const checkInCandidate = findLatestAutoCheckInCandidate(sourceChat);
  if (checkInCandidate) {
    const payload = checkInCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { handledEventId: null };
    if (hasHandledSocialEvent(sourceChat, checkInCandidate.id)) return { handledEventId: checkInCandidate.id };
    if (shouldConsumeCandidateWithRestraint(sourceChat, payload, checkInCandidate.createdAt)) {
      const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, updateSourceChatAfterCheckIn(sourceChat, payload, actorName), checkInCandidate.id, payload.initiatorId));
      return { handledEventId: checkInCandidate.id };
    }
  }

  const reactMomentCandidate = findLatestAutoReactToMomentCandidate(sourceChat);
  if (reactMomentCandidate) {
    const payload = reactMomentCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { handledEventId: null };
    if (hasHandledSocialEvent(sourceChat, reactMomentCandidate.id)) return { handledEventId: reactMomentCandidate.id };
    if (shouldConsumeCandidateWithRestraint(sourceChat, payload, reactMomentCandidate.createdAt)) {
      const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, updateSourceChatAfterReactToMoment(sourceChat, payload, actorName), reactMomentCandidate.id, payload.initiatorId));
      return { handledEventId: reactMomentCandidate.id };
    }
  }

  const giftCandidate = findLatestAutoGiftExchangeCandidate(sourceChat);
  if (giftCandidate) {
    const payload = giftCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { handledEventId: null };
    if (hasHandledSocialEvent(sourceChat, giftCandidate.id)) return { handledEventId: giftCandidate.id };
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, updateSourceChatAfterGiftExchange(sourceChat, payload, actorName), giftCandidate.id, payload.initiatorId));
    return { handledEventId: giftCandidate.id };
  }

  const conflictCandidate = findLatestAutoConflictExpressionCandidate(sourceChat);
  if (conflictCandidate) {
    const payload = conflictCandidate.payload as SocialEventCandidatePayload;
    if (!isValidAutoFlowCandidate(sourceChat, payload)) return { handledEventId: null };
    if (hasHandledSocialEvent(sourceChat, conflictCandidate.id)) return { handledEventId: conflictCandidate.id };
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    await ops.updateChat(sourceChat.id, appendHandledSocialEvent(sourceChat, updateSourceChatAfterConflictExpression(sourceChat, payload, actorName), conflictCandidate.id, payload.initiatorId));
    return { handledEventId: conflictCandidate.id };
  }

  const worldDrivenDecision = evaluateWorldDrivenDecision(sourceChat, ops.characters, Boolean(ops.imageModelEnabled));
  const worldDrivenCandidate = worldDrivenDecision.candidate;
  if (worldDrivenCandidate) {
    const payload = worldDrivenCandidate.payload as SocialEventCandidatePayload;
    const seededChat = {
      ...sourceChat,
      runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [...worldDrivenDecision.suppressionEvents, ...worldDrivenDecision.decisionEvents, worldDrivenCandidate]),
    } as GroupChat;
    const actorName = ops.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
    if (payload.eventKind === 'post_moment') {
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(seededChat, updateSourceChatAfterPostMoment(seededChat, payload, actorName), worldDrivenCandidate.id, payload.initiatorId));
      return { handledEventId: worldDrivenCandidate.id };
    }
    if (payload.eventKind === 'check_in') {
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(seededChat, updateSourceChatAfterCheckIn(seededChat, payload, actorName), worldDrivenCandidate.id, payload.initiatorId));
      return { handledEventId: worldDrivenCandidate.id };
    }
    if (payload.eventKind === 'social_outing') {
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(seededChat, updateSourceChatAfterSocialOuting(seededChat, payload, [actorName]), worldDrivenCandidate.id, payload.initiatorId));
      return { handledEventId: worldDrivenCandidate.id };
    }
    if (payload.eventKind === 'react_to_moment') {
      await ops.updateChat(sourceChat.id, appendHandledSocialEvent(seededChat, updateSourceChatAfterReactToMoment(seededChat, payload, actorName), worldDrivenCandidate.id, payload.initiatorId));
      return { handledEventId: worldDrivenCandidate.id };
    }
    await ops.updateChat(sourceChat.id, appendHandledSocialEvent(seededChat, updateSourceChatAfterStatusUpdate(seededChat, payload, actorName), worldDrivenCandidate.id, payload.initiatorId));
    return { handledEventId: worldDrivenCandidate.id };
  }

  if (worldDrivenDecision.suppressionEvents.length || worldDrivenDecision.decisionEvents.length) {
    await ops.updateChat(sourceChat.id, withFrameworkPatch(sourceChat, {
      runtimeEventsV2: appendStructuredRuntimeEvents(sourceChat, [...worldDrivenDecision.suppressionEvents, ...worldDrivenDecision.decisionEvents]),
    }));
  }

  return { privateChatId: null, handledEventId: null };
}

function resolvePrivateThreadParticipantName(characters: AICharacter[] | undefined, id: string, fallback: string) {
  const name = characters?.find((character) => character.id === id)?.name;
  if (!name) {
    reportUnresolvedDisplayEntity({ id, kind: 'character', location: 'directSessionRuntime.privateThreadParticipant', fallback });
  }
  return name || fallback;
}

export function buildStartPrivateThreadExecutionResult(chat: GroupChat, actorId: string, targetId: string, prompt = '', characters: AICharacter[] = []): SessionActionExecutionResult {
  const actorName = resolvePrivateThreadParticipantName(characters, actorId, '发起者');
  const targetName = resolvePrivateThreadParticipantName(characters, targetId, '对象');
  const summary = `发起AI私聊：${actorName} → ${targetName}${prompt ? ` · ${prompt.slice(0, 32)}` : ''}`;
  return {
    chatPatch: withFrameworkPatch(chat, {
      worldState: {
        ...chat.worldState,
        recentEvent: summary,
      },
    }),
    runtimeEvents: [{
      eventType: 'start_private_thread',
      title: '执行了AI私聊派生动作',
      summary,
      metrics: { actorId, targetId, actorName, targetName, prompt },
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
  const memberSet = new Set(params.sourceChat.memberIds);
  if (!memberSet.has(params.starterId) || !memberSet.has(params.targetId)) return null;
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
