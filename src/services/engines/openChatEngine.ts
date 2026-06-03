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
import { projectWorldAttentionStates, projectWorldCalendar } from '../worldRuntimeProjection';
import { isCharacterFeatureEnabled } from '../characterGenerationPolicy';
import { orchestrateWorldDecision } from '../worldDecisionOrchestrator';
import { buildMomentPostText } from '../momentTextBuilder';
import { buildCharacterCompanionshipStates, shouldBlockUserProactiveContactByCompanionshipPolicy } from '../companionshipProjection';

const MAX_OPEN_CHAT_RUNTIME_EVENTS = 120;

type AttentionStateSnapshot = ReturnType<typeof projectWorldAttentionStates>[number];

function readWorldInfluenceBias(conversation: GroupChat, actorId: string, now: number) {
  const latest = (conversation.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .find((event) => {
      if (event.kind !== 'action_resolution') return false;
      if ((event.actorIds || [])[0] !== actorId) return false;
      if (now - event.createdAt > 2 * 60 * 60_000) return false;
      const payload = event.payload as { eventType?: string };
      return payload.eventType === 'world_influence_rule_evaluated';
    });
  if (!latest) {
    return {
      comfortBoost: 0,
      scheduleBoost: 0,
      restraintPenalty: 0,
    };
  }
  const payload = latest.payload as {
    matchedRuleIds?: string[];
    unmetRuleIds?: string[];
  };
  const matched = new Set(payload.matchedRuleIds || []);
  const unmet = new Set(payload.unmetRuleIds || []);
  return {
    comfortBoost: matched.has('comfort_first') ? 0.05 : 0,
    scheduleBoost: matched.has('urgent_calendar_first') || matched.has('calendar_conflict_clarify_first') ? 0.06 : 0,
    restraintPenalty: unmet.has('low_pressure_restraint') ? 0.04 : 0,
  };
}

function attachAttentionTrace(
  payload: SocialEventCandidatePayload,
  attentionState: AttentionStateSnapshot | undefined,
) {
  if (!attentionState) return payload;
  return {
    ...payload,
    attentionTrace: {
      score: attentionState.attentionScore,
      restraint: attentionState.restraint,
      suggestedActions: attentionState.suggestedActions as NonNullable<SocialEventCandidatePayload['attentionTrace']>['suggestedActions'],
      reasons: attentionState.reasons.slice(0, 4),
      latestEvidenceAt: attentionState.latestEvidenceAt,
    },
  } satisfies SocialEventCandidatePayload;
}

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
  createdAt?: number;
}): RuntimeEventV2 {
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
    triggerReason: hint.triggerReason || hint.seedIntent || '当前群聊出现了适合转入双人私聊的未尽话题。',
    openingMessage: hint.openingMessage,
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
  const explicitPrivateIntent = Boolean(payload.triggerReason && payload.openingMessage && payload.confidence >= 0.85);
  if (targetId && explicitPrivateIntent) {
    return {
      ...hinted,
      payload: {
        ...payload,
        reasonType: payload.reasonType || 'unresolved_question',
        confidence: Math.max(payload.confidence, 0.86),
      },
    } satisfies RuntimeEventV2;
  }
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
      triggerReason: payload.triggerReason || `基于当前${reason}互动，${payload.initiatorId}需要和${targetId}私下延续刚才的话题。`,
      openingMessage: payload.openingMessage || payload.seedIntent,
    },
  } satisfies RuntimeEventV2;
}

function buildAttentionDrivenPrivateThreadCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const actorId = params.message.senderId;
  if (!actorId || actorId === 'user') return null;
  if (!params.conversation.memberIds.includes('user')) return null;
  const actor = params.characters.find((item) => item.id === actorId) || null;
  if (shouldBlockUserProactiveContactByCompanionshipPolicy({
    character: actor,
    eventKind: 'check_in',
    reasonType: 'world_attention_private_message',
  }).blocked) return null;
  const attentionState = projectWorldAttentionStates([params.conversation], params.characters)
    .find((item) => item.actorId === actorId && item.targetId === 'user');
  if (attentionState && !attentionState.suggestedActions.includes('private_message')) return null;
  const recentAttention = (params.conversation.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .find((event) => (
      event.kind === 'attention_candidate'
      && (event.actorIds || []).includes('user')
      && (event.targetIds || []).includes(actorId)
      && Date.now() - event.createdAt <= 20 * 60_000
    ));
  if (!recentAttention) return null;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'pair_private_thread',
    initiatorId: actorId,
    participantIds: [actorId, 'user'],
    targetIds: ['user'],
    reasonType: 'attention_followup',
    confidence: 0.81,
    urgency: 'soon',
    seedIntent: '用户刚刚点名了我，适合私下跟进确认。',
    triggerReason: '用户刚刚点名或触发关注状态，角色需要转入私域跟进确认。',
    openingMessage: '刚才你提到我的时候，我有点在意。方便的话，我想单独问问你真实的想法。',
    visibilityPlan: 'user_private',
    expectedArtifacts: ['private_thread_summary'],
    sourceText: params.message.content.trim().slice(0, 128),
    dedupeKey: `attention-followup-${params.conversation.id}-${actorId}`,
  };
  const tracedPayload = attachAttentionTrace(payload, attentionState);
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${actorId} 生成了一个面向用户的私聊跟进候选`,
    actorIds: [actorId],
    targetIds: ['user'],
    visibility: 'derived_public',
    payload: tracedPayload,
  });
}

function pickCompanionshipPrivateThreadState(params: {
  conversation: GroupChat;
  actor: AICharacter;
}) {
  const memberIds = new Set(params.conversation.memberIds.filter((id) => id !== 'user'));
  const now = Date.now();
  return buildCharacterCompanionshipStates(params.actor, now)
    .filter((state) => memberIds.has(state.targetId))
    .map((state) => {
      const textureScore = state.sharedSecrets.length * 9 + state.sharedRituals.length * 7 + state.unresolvedCareTopics.length * 12;
      const score = state.closeness * 0.36 + state.protectiveness * 0.34 + state.reliance * 0.28 + textureScore;
      return { state, score };
    })
    .filter(({ state, score }) => {
      if (state.unresolvedCareTopics.length) return score >= 44;
      if (state.sharedSecrets.length || state.sharedRituals.length) return score >= 52;
      return score >= 68;
    })
    .sort((left, right) => right.score - left.score)[0] || null;
}

function buildCompanionshipPrivateThreadOpening(actorName: string, targetName: string, texture: string, sourceText: string) {
  const cleanedTexture = texture.replace(/\s+/g, ' ').trim();
  const cleanedSource = sourceText.replace(/\s+/g, ' ').trim();
  if (/担心|放心不下|想帮|护着/.test(cleanedTexture)) {
    return `${targetName}，刚才在群里我没接着问，是不想让你难堪。但这件事我还是有点放心不下，想单独确认一下。`;
  }
  if (/约定|暗号|共同梗|仪式/.test(cleanedTexture)) {
    return `${targetName}，刚才那一下我突然想起我们之前说好的事。群里不太适合展开，我想单独跟你把这个接上。`;
  }
  if (/秘密|只有.*知道|保密/.test(cleanedTexture)) {
    return `${targetName}，有些话在群里说出来就不是那个味道了。刚才那点我想单独和你确认一下。`;
  }
  if (cleanedSource) {
    return `${targetName}，刚才你听到我那句了吗？我不是随口一说，想单独和你接着聊一下。`;
  }
  return `${targetName}，刚才在群里我没完全说完，想单独和你接着聊一下。`;
}

function buildCompanionshipPrivateThreadCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const actor = params.characters.find((item) => item.id === params.message.senderId);
  if (!actor || actor.id === 'user') return null;
  if (params.conversation.type !== 'group') return null;
  if (!params.conversation.memberIds.includes(actor.id)) return null;
  const picked = pickCompanionshipPrivateThreadState({ conversation: params.conversation, actor });
  if (!picked) return null;
  const target = params.characters.find((item) => item.id === picked.state.targetId);
  if (!target) return null;
  const texture = [
    picked.state.unresolvedCareTopics[0],
    picked.state.sharedRituals[0],
    picked.state.sharedSecrets[0],
  ].filter(Boolean).join('；');
  const reasonType = picked.state.unresolvedCareTopics.length
    ? 'companionship_care_followup'
    : picked.state.sharedRituals.length
      ? 'companionship_ritual_followup'
      : picked.state.sharedSecrets.length
        ? 'companionship_secret_followup'
        : 'companionship_bond_followup';
  const seedIntent = texture
    ? `${actor.name} 对 ${target.name} 的陪伴关系有未尽余波：${texture}`
    : `${actor.name} 和 ${target.name} 的关系已经足够熟悉，适合私下补一句没有在群里说完的话。`;
  const openingMessage = buildCompanionshipPrivateThreadOpening(actor.name, target.name, texture, params.message.content);
  const confidence = Math.max(0.82, Math.min(0.94, picked.score / 100));
  const payload: SocialEventCandidatePayload = {
    eventKind: 'pair_private_thread',
    initiatorId: actor.id,
    participantIds: [actor.id, target.id],
    targetIds: [target.id],
    reasonType,
    confidence,
    urgency: 'soon',
    seedIntent,
    triggerReason: texture
      ? `角色-角色陪伴关系触发：${texture}`
      : '角色-角色陪伴关系达到可私下延续的强度。',
    openingMessage,
    visibilityPlan: 'conversation_private',
    expectedArtifacts: ['private_thread_summary'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: '陪伴私聊',
    activityType: '角色陪伴跟进',
    dedupeKey: `companionship-private-thread-${params.conversation.id}-${actor.id}-${target.id}`,
  };
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${actor.name} 因陪伴关系想和 ${target.name} 私下接一句`,
    actorIds: [actor.id],
    targetIds: [target.id],
    visibility: 'derived_public',
    payload,
  });
}

function buildAttentionDrivenCheckInCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const actorId = params.message.senderId;
  if (!actorId || actorId === 'user') return null;
  if (hasPendingCandidateSuppression(params.conversation, actorId, 'check_in', Date.now())) return null;
  if (!params.conversation.memberIds.includes('user')) return null;
  const actor = params.characters.find((item) => item.id === actorId) || null;
  if (shouldBlockUserProactiveContactByCompanionshipPolicy({
    character: actor,
    eventKind: 'check_in',
    reasonType: 'attention_check_in',
  }).blocked) return null;
  const attentionState = projectWorldAttentionStates([params.conversation], params.characters)
    .find((item) => item.actorId === actorId && item.targetId === 'user');
  if (attentionState && !attentionState.suggestedActions.includes('check_in')) return null;
  const recentAttention = (params.conversation.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .find((event) => (
      event.kind === 'attention_candidate'
      && (event.actorIds || []).includes('user')
      && (event.targetIds || []).includes(actorId)
      && Date.now() - event.createdAt <= 45 * 60_000
    ));
  if (!recentAttention) return null;
  const followupBoosted = hasRecentCompletedAttentionFollowup(
    params.conversation,
    actorId,
    'user',
    Date.now(),
    90 * 60_000,
  );
  const bias = readWorldInfluenceBias(params.conversation, actorId, Date.now());
  const payload: SocialEventCandidatePayload = {
    eventKind: 'check_in',
    initiatorId: actorId,
    participantIds: [actorId, 'user'],
    targetIds: ['user'],
    reasonType: 'attention_check_in',
    confidence: Math.max(0.7, Math.min(0.95, (followupBoosted ? 0.84 : 0.78) + bias.comfortBoost - bias.restraintPenalty)),
    urgency: 'soon',
    seedIntent: followupBoosted ? '刚完成一次用户跟进，适合顺势补一句关心或确认近况。' : '用户刚刚点名后，适合补一句关心或确认近况。',
    visibilityPlan: 'user_private',
    expectedArtifacts: ['status_note'],
    sourceText: params.message.content.trim().slice(0, 128),
    dedupeKey: `attention-check-in-${params.conversation.id}-${actorId}`,
  };
  const tracedPayload = attachAttentionTrace(payload, attentionState);
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${actorId} 生成了一个对用户的 check_in 候选`,
    actorIds: [actorId],
    targetIds: ['user'],
    visibility: 'derived_public',
    payload: tracedPayload,
  });
}

function buildAttentionDrivenReactMomentCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const actorId = params.message.senderId;
  if (!actorId || actorId === 'user') return null;
  if (hasPendingCandidateSuppression(params.conversation, actorId, 'react_to_moment', Date.now())) return null;
  if (!params.conversation.memberIds.includes('user')) return null;
  const attentionState = projectWorldAttentionStates([params.conversation], params.characters)
    .find((item) => item.actorId === actorId && item.targetId === 'user');
  if (attentionState && !attentionState.suggestedActions.includes('react_to_moment')) return null;
  const recentMoment = (params.conversation.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .find((event) => (
      event.kind === 'artifact'
      && (event.visibility === 'public' || event.visibility === 'derived_public')
      && typeof event.payload === 'object'
      && event.payload !== null
      && ((event.payload as { eventKind?: string }).eventKind === 'post_moment')
      && Date.now() - event.createdAt <= 60 * 60_000
    ));
  if (!recentMoment) return null;
  const followupBoosted = hasRecentCompletedAttentionFollowup(
    params.conversation,
    actorId,
    'user',
    Date.now(),
    90 * 60_000,
  );
  const payload: SocialEventCandidatePayload = {
    eventKind: 'react_to_moment',
    initiatorId: actorId,
    participantIds: [actorId],
    targetIds: ['user'],
    reasonType: 'moment_reaction',
    confidence: followupBoosted ? 0.82 : 0.76,
    urgency: 'defer',
    seedIntent: followupBoosted ? '刚完成跟进后，适合顺势补一句动态回应。' : '刚刚有人发了动态，适合补一句回应。',
    visibilityPlan: 'public',
    expectedArtifacts: ['moment_text'],
    sourceText: params.message.content.trim().slice(0, 128),
    dedupeKey: `react-moment-${params.conversation.id}-${actorId}`,
  };
  const tracedPayload = attachAttentionTrace(payload, attentionState);
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${actorId} 生成了 react_to_moment 候选`,
    actorIds: [actorId],
    targetIds: ['user'],
    visibility: 'derived_public',
    payload: tracedPayload,
  });
}

function buildAttentionDrivenInviteActivityCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const actorId = params.message.senderId;
  if (!actorId || actorId === 'user') return null;
  if (hasPendingCandidateSuppression(params.conversation, actorId, 'social_outing', Date.now())) return null;
  if (!params.conversation.memberIds.includes('user')) return null;
  const attentionState = projectWorldAttentionStates([params.conversation], params.characters)
    .find((item) => item.actorId === actorId && item.targetId === 'user');
  if (attentionState && !attentionState.suggestedActions.includes('invite_activity')) return null;
  const recentAttention = (params.conversation.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .find((event) => (
      event.kind === 'attention_candidate'
      && (event.actorIds || []).includes('user')
      && (event.targetIds || []).includes(actorId)
      && Date.now() - event.createdAt <= 60 * 60_000
    ));
  if (!recentAttention) return null;
  const hasRecentOuting = (params.conversation.runtimeEventsV2 || []).some((event) => {
    if (Date.now() - event.createdAt > 3 * 60 * 60_000) return false;
    if (event.kind !== 'artifact') return false;
    const payload = event.payload as { artifactType?: string; eventKind?: string };
    return payload.artifactType === 'outing_summary'
      && payload.eventKind === 'social_outing'
      && (event.actorIds || [])[0] === actorId;
  });
  if (hasRecentOuting) return null;
  const bias = readWorldInfluenceBias(params.conversation, actorId, Date.now());
  const payload: SocialEventCandidatePayload = {
    eventKind: 'social_outing',
    initiatorId: actorId,
    participantIds: [actorId, 'user'],
    targetIds: ['user'],
    reasonType: 'world_attention_invite_activity',
    confidence: Math.max(0.7, Math.min(0.95, 0.82 - bias.scheduleBoost * 0.5 - bias.restraintPenalty)),
    urgency: 'soon',
    seedIntent: '最近互动升温，适合发起一次轻量活动邀约。',
    visibilityPlan: 'user_private',
    expectedArtifacts: ['outing_summary'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: '活动邀约',
    activityType: '活动邀约',
    dedupeKey: `attention-invite-${params.conversation.id}-${actorId}`,
  };
  const tracedPayload = attachAttentionTrace(payload, attentionState);
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${actorId} 生成了活动邀约候选`,
    actorIds: [actorId],
    targetIds: ['user'],
    visibility: 'derived_public',
    payload: tracedPayload,
  });
}

function buildAttentionDrivenCalendarReminderCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const actorId = params.message.senderId;
  if (!actorId || actorId === 'user') return null;
  if (hasPendingCandidateSuppression(params.conversation, actorId, 'status_update', Date.now())) return null;
  if (!params.conversation.memberIds.includes('user')) return null;
  const now = Date.now();
  const bias = readWorldInfluenceBias(params.conversation, actorId, now);
  const attentionState = projectWorldAttentionStates([params.conversation], params.characters)
    .find((item) => item.actorId === actorId && item.targetId === 'user');
  if (attentionState && !attentionState.suggestedActions.includes('calendar_reminder')) return null;
  const upcomingCalendarItem = projectWorldCalendar([params.conversation], params.characters, { now }).items
    .filter((item) => (
      item.status !== 'cancelled'
      && item.status !== 'completed'
      && typeof item.startAt === 'number'
      && item.startAt > now
      && item.startAt - now <= 6 * 60 * 60_000
      && item.participantIds.includes(actorId)
      && item.participantIds.includes('user')
    ))
    .sort((left, right) => (left.startAt || 0) - (right.startAt || 0))[0];
  const recentAttention = (params.conversation.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .find((event) => (
      event.kind === 'attention_candidate'
      && (event.actorIds || []).includes('user')
      && (event.targetIds || []).includes(actorId)
      && now - event.createdAt <= 75 * 60_000
    ));
  if (!recentAttention && !upcomingCalendarItem) return null;
  const hasRecentReminder = (params.conversation.runtimeEventsV2 || []).some((event) => {
    if (now - event.createdAt > 2 * 60 * 60_000) return false;
    if (event.kind !== 'artifact') return false;
    const payload = event.payload as { artifactType?: string; eventKind?: string };
    return payload.artifactType === 'status_note'
      && payload.eventKind === 'status_update'
      && (event.actorIds || [])[0] === actorId
      && (event.targetIds || []).includes('user');
  });
  if (hasRecentReminder) return null;
  const minutesUntil = upcomingCalendarItem?.startAt ? Math.max(0, Math.round((upcomingCalendarItem.startAt - now) / 60_000)) : null;
  const reminderTitle = upcomingCalendarItem?.title || '日程提醒';
  const reminderType = upcomingCalendarItem?.activityType || reminderTitle;
  const calendarDrivenReminder = Boolean(upcomingCalendarItem);
  const sourceText = calendarDrivenReminder
    ? `${upcomingCalendarItem?.summary || reminderTitle}${minutesUntil !== null ? `（${minutesUntil} 分钟后）` : ''}`
    : params.message.content.trim().slice(0, 128);
  const payload: SocialEventCandidatePayload = {
    eventKind: 'status_update',
    initiatorId: actorId,
    participantIds: [actorId],
    targetIds: ['user'],
    reasonType: calendarDrivenReminder ? 'world_calendar_upcoming_reminder' : 'world_attention_calendar_reminder',
    confidence: Math.max(0.72, Math.min(0.96, (calendarDrivenReminder ? 0.86 : 0.8) + bias.scheduleBoost - bias.restraintPenalty * 0.5)),
    urgency: 'soon',
    seedIntent: calendarDrivenReminder
      ? `${reminderTitle} 即将开始，适合提前提醒并确认用户安排。`
      : '最近的互动提示有待提醒事项，适合给用户补一条日程提醒。',
    visibilityPlan: 'user_private',
    expectedArtifacts: ['status_note'],
    sourceText,
    title: reminderTitle,
    activityType: reminderType,
    dedupeKey: calendarDrivenReminder
      ? `calendar-upcoming-reminder-${params.conversation.id}-${actorId}-${upcomingCalendarItem?.id || 'item'}`
      : `attention-reminder-${params.conversation.id}-${actorId}`,
  };
  const tracedPayload = attachAttentionTrace(payload, attentionState);
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: calendarDrivenReminder
      ? `${actorId} 基于临近日程生成了提醒候选`
      : `${actorId} 生成了日程提醒候选`,
    actorIds: [actorId],
    targetIds: ['user'],
    visibility: 'derived_public',
    payload: tracedPayload,
  });
}

function buildAttentionDrivenComfortCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const actorId = params.message.senderId;
  if (!actorId || actorId === 'user') return null;
  if (!params.conversation.memberIds.includes('user')) return null;
  const attentionState = projectWorldAttentionStates([params.conversation], params.characters)
    .find((item) => item.actorId === actorId && item.targetId === 'user');
  if (!attentionState || !attentionState.suggestedActions.includes('comfort')) return null;
  const now = Date.now();
  const hasRecentComfort = (params.conversation.runtimeEventsV2 || []).some((event) => {
    if (now - event.createdAt > 2 * 60 * 60_000) return false;
    if (event.kind !== 'artifact') return false;
    const payload = event.payload as { eventKind?: string; reasonType?: string };
    return payload.eventKind === 'check_in'
      && payload.reasonType === 'world_attention_comfort'
      && (event.actorIds || [])[0] === actorId
      && (event.targetIds || []).includes('user');
  });
  if (hasRecentComfort) return null;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'check_in',
    initiatorId: actorId,
    participantIds: [actorId, 'user'],
    targetIds: ['user'],
    reasonType: 'world_attention_comfort',
    confidence: 0.83,
    urgency: 'soon',
    seedIntent: '察觉到用户状态波动，想补一句更具体的关心。',
    visibilityPlan: 'user_private',
    expectedArtifacts: ['check_in_note'],
    sourceText: params.message.content.trim().slice(0, 128),
    title: '关怀跟进',
    activityType: '关怀',
    dedupeKey: `attention-comfort-${params.conversation.id}-${actorId}`,
  };
  const tracedPayload = attachAttentionTrace(payload, attentionState);
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${actorId} 生成了关怀跟进候选`,
    actorIds: [actorId],
    targetIds: ['user'],
    visibility: 'derived_public',
    payload: tracedPayload,
  });
}

function buildAttentionDrivenShareMomentCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'senderId'>;
}): RuntimeEventV2 | null {
  const now = Date.now();
  const actorId = params.message.senderId;
  if (!actorId || actorId === 'user') return null;
  if (hasPendingCandidateSuppression(params.conversation, actorId, 'post_moment', now)) return null;
  const actor = params.characters.find((item) => item.id === actorId) || null;
  if (actor && !isCharacterFeatureEnabled(actor, 'moments')) return null;
  const attentionState = projectWorldAttentionStates([params.conversation], params.characters)
    .find((item) => item.actorId === actorId && item.targetId !== 'user');
  if (!attentionState || !attentionState.suggestedActions.includes('share_moment')) return null;
  const targetId = attentionState.targetId;
  if (!targetId || targetId === 'user') return null;
  if (!params.conversation.memberIds.includes(targetId)) return null;
  const recentAttention = (params.conversation.runtimeEventsV2 || [])
    .slice()
    .reverse()
    .find((event) => (
      event.kind === 'attention_candidate'
      && (event.actorIds || []).includes(actorId)
      && (event.targetIds || []).includes(targetId)
      && now - event.createdAt <= 90 * 60_000
    ));
  if (!recentAttention) return null;
  const personaText = `${actor?.speakingStyle || ''} ${actor?.background || ''} ${(actor?.expertise || []).join(' ')}`.toLowerCase();
  const isNightOwl = /(夜猫|熬夜|夜班|主播|直播|vlog|夜生活|night|stream)/i.test(personaText);
  const hour = new Date(now).getHours();
  const isLateNight = hour >= 23 || hour < 7;
  if (isLateNight && !isNightOwl) return null;
  const hasRecentMoment = (params.conversation.runtimeEventsV2 || []).some((event) => {
    if (now - event.createdAt > 4 * 60 * 60_000) return false;
    if (event.kind !== 'artifact') return false;
    const payload = event.payload as { artifactType?: string; eventKind?: string };
    return payload.artifactType === 'moment_text'
      && payload.eventKind === 'post_moment'
      && (event.actorIds || [])[0] === actorId;
  });
  if (hasRecentMoment) return null;
  const lastSocialArtifactAt = (params.conversation.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'artifact' && ['social_outing', 'check_in', 'react_to_moment', 'status_update', 'gift_exchange'].includes((event.payload as { eventKind?: string }).eventKind || ''))
    .map((event) => event.createdAt)
    .sort((a, b) => b - a)[0];
  if (typeof lastSocialArtifactAt === 'number' && now - lastSocialArtifactAt < 18 * 60_000) return null;
  const followupBoosted = hasRecentCompletedAttentionFollowup(
    params.conversation,
    actorId,
    targetId,
    now,
    120 * 60_000,
  );
  const bias = readWorldInfluenceBias(params.conversation, actorId, now);
  const targetName = params.characters.find((item) => item.id === targetId)?.name || targetId;
  const styleSeed = Math.abs(stableEventSeed([params.conversation.id, actorId, targetId, Math.floor(now / (60 * 60_000))]).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0));
  const styleVariant = styleSeed % 3;
  const momentMode = styleVariant === 0 ? 'event_capture' : styleVariant === 1 ? 'photo_social' : 'reflective_subtext';
  const expectedArtifacts = momentMode === 'photo_social'
    ? ['moment_text', 'moment_group_photo', 'moment_selfie']
    : momentMode === 'reflective_subtext'
      ? ['moment_text']
      : ['moment_text', 'moment_group_photo'];
  const title = momentMode === 'photo_social'
    ? '随手一拍'
    : momentMode === 'reflective_subtext'
      ? '今日碎片'
      : '朋友圈动态';
  const seedIntent = momentMode === 'photo_social'
    ? `和${targetName}这波互动之后，想发一条带照片的轻量动态。`
    : momentMode === 'reflective_subtext'
      ? `不直说事件细节，想写一条更内心化的动态，留一点余味。`
      : `刚和${targetName}互动后，想发一条记录当下氛围的动态。`;
  const payload: SocialEventCandidatePayload = {
    eventKind: 'post_moment',
    initiatorId: actorId,
    participantIds: [actorId],
    targetIds: [targetId],
    reasonType: 'world_attention_share_moment',
    confidence: Math.max(0.7, Math.min(0.95, (followupBoosted ? 0.88 : 0.81) - bias.scheduleBoost * 0.45 - bias.restraintPenalty)),
    urgency: 'defer',
    seedIntent: followupBoosted
      ? `刚完成对${targetName}的跟进，${seedIntent}`
      : seedIntent,
    visibilityPlan: 'public',
    expectedArtifacts,
    sourceText: params.message.content.trim().slice(0, 128),
    title,
    activityType: momentMode === 'photo_social' ? '随拍' : momentMode === 'reflective_subtext' ? '情绪碎片' : '关系互动',
    dedupeKey: `attention-share-moment-${params.conversation.id}-${actorId}-${targetId}`,
  };
  const tracedPayload = attachAttentionTrace(payload, attentionState);
  return createRuntimeEventV2({
    conversationId: params.conversation.id,
    kind: 'event_candidate',
    summary: `${actorId} 生成了动态分享候选`,
    actorIds: [actorId],
    targetIds: [targetId],
    visibility: 'derived_public',
    payload: tracedPayload,
  });
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
          candidateId: event.id,
          title: payload.title,
          activityType: payload.activityType,
          expectedArtifacts: payload.expectedArtifacts || [],
          dedupeKey: payload.dedupeKey,
        },
      });
    });
}

function buildCheckInArtifactEvents(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}): RuntimeEventV2[] {
  return params.socialEventCandidates
    .filter((event) => (event.payload as SocialEventCandidatePayload).eventKind === 'check_in')
    .map((event) => {
      const payload = event.payload as SocialEventCandidatePayload;
      const actorName = params.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      const text = `${actorName} 给用户发了一句简短问候，确认近况。`;
      return createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'artifact',
        summary: text,
        actorIds: [payload.initiatorId],
        targetIds: payload.targetIds,
        visibility: 'derived_public',
        payload: {
          artifactType: 'check_in_note',
          eventKind: 'check_in',
          text,
          candidateId: event.id,
          title: payload.title || '问候跟进',
          activityType: payload.activityType,
          expectedArtifacts: payload.expectedArtifacts || [],
          dedupeKey: payload.dedupeKey,
        },
      });
    });
}

function buildReactToMomentArtifactEvents(params: {
  conversation: GroupChat;
  socialEventCandidates: RuntimeEventV2[];
  characters: AICharacter[];
}): RuntimeEventV2[] {
  return params.socialEventCandidates
    .filter((event) => (event.payload as SocialEventCandidatePayload).eventKind === 'react_to_moment')
    .map((event) => {
      const payload = event.payload as SocialEventCandidatePayload;
      const actorName = params.characters.find((item) => item.id === payload.initiatorId)?.name || payload.initiatorId;
      const text = `${actorName} 对刚刚的动态补了一句回应。`;
      return createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'artifact',
        summary: text,
        actorIds: [payload.initiatorId],
        targetIds: payload.targetIds,
        visibility: 'derived_public',
        payload: {
          artifactType: 'moment_reaction_note',
          eventKind: 'react_to_moment',
          text,
          candidateId: event.id,
          title: payload.title || '动态回应',
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
          candidateId: event.id,
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

function findRecentGiftExchangeBackflowEventId(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const matched = (chat.runtimeEventsV2 || []).find((event) => event.kind === 'artifact'
    && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'gift_note'
    && (event.payload as { eventKind?: string }).eventKind === 'gift_exchange'
    && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload)
    && event.createdAt >= createdAt);
  return matched?.id || null;
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
          candidateId: event.id,
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

function findRecentStatusUpdateBackflowEventId(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const matched = (chat.runtimeEventsV2 || []).find((event) => {
    if (event.kind !== 'artifact') return false;
    const artifactPayload = event.payload as { artifactType?: string; eventKind?: string };
    return artifactPayload.artifactType === 'status_note'
      && artifactPayload.eventKind === 'status_update'
      && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload)
      && event.createdAt >= createdAt;
  });
  return matched?.id || null;
}

function shouldAutoBackflowCheckIn(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const targetId = payload.targetIds?.[0] || 'user';
  return !(chat.runtimeEventsV2 || []).some((event) => {
    if (event.kind !== 'artifact') return false;
    const artifactPayload = event.payload as { artifactType?: string; eventKind?: string };
    if (artifactPayload.artifactType !== 'check_in_note' || artifactPayload.eventKind !== 'check_in') return false;
    const sameTarget = (event.targetIds || []).includes(targetId);
    const withinCooldown = createdAt - event.createdAt < 30 * 60_000;
    return sameTarget && withinCooldown;
  });
}

function findRecentCheckInBackflowEventId(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const targetId = payload.targetIds?.[0] || 'user';
  const matched = (chat.runtimeEventsV2 || []).find((event) => {
    if (event.kind !== 'artifact') return false;
    const artifactPayload = event.payload as { artifactType?: string; eventKind?: string };
    if (artifactPayload.artifactType !== 'check_in_note' || artifactPayload.eventKind !== 'check_in') return false;
    const sameTarget = (event.targetIds || []).includes(targetId);
    const withinCooldown = createdAt - event.createdAt < 30 * 60_000;
    return sameTarget && withinCooldown;
  });
  return matched?.id || null;
}

function shouldAutoBackflowReactToMoment(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !(chat.runtimeEventsV2 || []).some((event) => {
    if (event.kind !== 'artifact') return false;
    const artifactPayload = event.payload as { artifactType?: string; eventKind?: string };
    if (artifactPayload.artifactType !== 'moment_reaction_note' || artifactPayload.eventKind !== 'react_to_moment') return false;
    const sameActor = (event.actorIds || [])[0] === payload.initiatorId;
    const withinCooldown = createdAt - event.createdAt < 45 * 60_000;
    return sameActor && withinCooldown;
  });
}

function findRecentReactToMomentBackflowEventId(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const matched = (chat.runtimeEventsV2 || []).find((event) => {
    if (event.kind !== 'artifact') return false;
    const artifactPayload = event.payload as { artifactType?: string; eventKind?: string };
    if (artifactPayload.artifactType !== 'moment_reaction_note' || artifactPayload.eventKind !== 'react_to_moment') return false;
    const sameActor = (event.actorIds || [])[0] === payload.initiatorId;
    const withinCooldown = createdAt - event.createdAt < 45 * 60_000;
    return sameActor && withinCooldown;
  });
  return matched?.id || null;
}

function isQuietHours(timestamp: number) {
  const hour = new Date(timestamp).getHours();
  return hour >= 23 || hour < 7;
}

function findRecentUserPrivateActionEventId(chat: GroupChat, actorId: string, targetId: string, createdAt: number, cooldownMs: number) {
  const matched = (chat.runtimeEventsV2 || []).find((event) => {
    if (event.createdAt >= createdAt || createdAt - event.createdAt > cooldownMs) return false;
    const payload = event.payload as Partial<SocialEventCandidatePayload> & { eventKind?: string; visibilityPlan?: string };
    if (event.kind !== 'event_candidate' && event.kind !== 'artifact') return false;
    if (payload.visibilityPlan !== 'user_private' && payload.eventKind !== 'check_in' && payload.eventKind !== 'pair_private_thread') return false;
    const sameActor = (event.actorIds || [])[0] === actorId;
    const sameTarget = (event.targetIds || []).includes(targetId);
    return sameActor && sameTarget;
  });
  return matched?.id || null;
}

function findRecentReactMomentArtifacts(chat: GroupChat, actorId: string, createdAt: number, cooldownMs: number) {
  return (chat.runtimeEventsV2 || []).filter((event) => {
    if (event.createdAt >= createdAt || createdAt - event.createdAt > cooldownMs) return false;
    if (event.kind !== 'artifact') return false;
    const artifactPayload = event.payload as { artifactType?: string; eventKind?: string };
    return artifactPayload.artifactType === 'moment_reaction_note'
      && artifactPayload.eventKind === 'react_to_moment'
      && (event.actorIds || [])[0] === actorId;
  });
}

function findLatestActorSocialArtifact(chat: GroupChat, actorId: string, createdAt: number) {
  return (chat.runtimeEventsV2 || [])
    .filter((event) => {
      if (event.kind !== 'artifact') return false;
      if (event.createdAt >= createdAt) return false;
      if ((event.actorIds || [])[0] !== actorId) return false;
      const eventKind = (event.payload as { eventKind?: string }).eventKind || '';
      return ['social_outing', 'status_update', 'check_in', 'react_to_moment', 'gift_exchange', 'conflict_expression'].includes(eventKind);
    })
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

function normalizeLooseText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?:;：；“”"'‘’（）()【】[\]-]/g, '');
}

function matchesFollowupFocus(focus: string | null | undefined, text: string) {
  const normalizedFocus = normalizeLooseText(focus || '');
  if (!normalizedFocus) return true;
  const normalizedText = normalizeLooseText(text || '');
  if (!normalizedText) return false;
  if (normalizedText.includes(normalizedFocus.slice(0, Math.min(6, normalizedFocus.length)))) return true;
  const chunks = normalizedFocus.split(/(?:和|并|再|先|后|然后|并且)/).filter((item) => item.length >= 2);
  return chunks.some((chunk) => normalizedText.includes(chunk.slice(0, Math.min(4, chunk.length))));
}

function hasRecentCompletedAttentionFollowup(
  chat: GroupChat,
  actorId: string,
  targetId: string | undefined,
  createdAt: number,
  windowMs: number,
) {
  const events = chat.runtimeEventsV2 || [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.createdAt >= createdAt || createdAt - event.createdAt > windowMs) continue;
    if (event.kind !== 'director_intervention') continue;
    const payload = typeof event.payload === 'object' && event.payload !== null ? event.payload as Record<string, unknown> : null;
    if (!payload) continue;
    const eventType = typeof payload.eventType === 'string' ? payload.eventType : '';
    if (eventType !== 'attention_followup_user' && eventType !== 'attention_followup_member') continue;
    const followupActorId = typeof payload.actorId === 'string' ? payload.actorId : '';
    if (followupActorId !== actorId) continue;
    if (eventType === 'attention_followup_member') {
      const followupTargetId = typeof payload.targetId === 'string' ? payload.targetId : '';
      if (!targetId || followupTargetId !== targetId) continue;
    }
    const focus = typeof payload.focus === 'string' ? payload.focus : '';
    const completion = events.find((candidate) => {
      if (candidate.createdAt <= event.createdAt || candidate.createdAt >= createdAt) return false;
      if (candidate.kind !== 'message_generated') return false;
      if ((candidate.actorIds || [])[0] !== actorId) return false;
      const candidatePayload = typeof candidate.payload === 'object' && candidate.payload !== null ? candidate.payload as Record<string, unknown> : null;
      const text = typeof candidatePayload?.text === 'string' ? candidatePayload.text : candidate.summary;
      return matchesFollowupFocus(focus, text || '');
    });
    if (completion) return true;
  }
  return false;
}

function resolveAttentionRestraintFailureDetail(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number): {
  detail: string;
  hitEventId?: string;
  hitWindow?: string;
} | undefined {
  const actorId = payload.initiatorId;
  if (!actorId || actorId === 'user') return undefined;
  if (payload.reasonType === 'world_attention_share_moment') {
    const latestSocialArtifact = findLatestActorSocialArtifact(chat, actorId, createdAt);
    if (!latestSocialArtifact) return { detail: '缺少近期可投射为动态的事件触发，不生成发圈候选' };
    const ageMs = createdAt - latestSocialArtifact.createdAt;
    if (ageMs < 15 * 60_000) {
      return {
        detail: `事件结束后间隔过短（${Math.round(ageMs / 60_000)}min < 15min），避免立刻发圈`,
        hitEventId: latestSocialArtifact.id,
        hitWindow: '15min',
      };
    }
    if (ageMs > 6 * 60 * 60_000) {
      return {
        detail: `事件已过久（${Math.round(ageMs / 60_000)}min > 360min），避免机械补发`,
        hitEventId: latestSocialArtifact.id,
        hitWindow: '6h',
      };
    }
  }
  const targetId = payload.targetIds?.[0] || 'user';
  if (targetId !== 'user') return undefined;
  const relation = getRelationshipLedgerEntry(chat.relationshipLedger || [], actorId, targetId);
  const warmth = relation?.current.warmth || 0;
  const trust = relation?.current.trust || 0;
  const threat = relation?.current.threat || 0;
  const relationSignal = warmth + trust;
  const worldAttentionInvite = payload.reasonType === 'world_attention_invite_activity';
  const worldAttentionReminder = payload.reasonType === 'world_attention_calendar_reminder';
  if (worldAttentionInvite || worldAttentionReminder) {
    if (threat >= 8) return { detail: `威胁值过高（threat=${threat}），不适合世界关注动作` };
  }
  if (worldAttentionInvite) {
    if (relationSignal < 8) return { detail: `关系信号不足（warmth+trust=${relationSignal} < 8），不触发邀约` };
    if (isQuietHours(createdAt)) return { detail: '夜间时段不触发世界关注邀约' };
    const recentPrivateActionId = findRecentUserPrivateActionEventId(chat, actorId, targetId, createdAt, 3 * 60 * 60_000);
    if (recentPrivateActionId) {
      return {
        detail: `近期已存在用户私域动作（3h），不重复邀约（hit=${recentPrivateActionId}）`,
        hitEventId: recentPrivateActionId,
        hitWindow: '3h',
      };
    }
  }
  if (worldAttentionReminder) {
    if (relationSignal < 6) return { detail: `关系信号不足（warmth+trust=${relationSignal} < 6），不触发提醒` };
    if (isQuietHours(createdAt) && relationSignal < 10) return { detail: `夜间且关系信号不足（${relationSignal} < 10），不触发提醒` };
    const recentPrivateActionId = findRecentUserPrivateActionEventId(chat, actorId, targetId, createdAt, 2 * 60 * 60_000);
    if (recentPrivateActionId) {
      return {
        detail: `近期已存在用户私域动作（2h），不重复提醒（hit=${recentPrivateActionId}）`,
        hitEventId: recentPrivateActionId,
        hitWindow: '2h',
      };
    }
  }
  if (payload.eventKind === 'check_in') {
    if (threat >= 8) return { detail: `威胁值过高（threat=${threat}），不触发问候` };
    if (relation && warmth + trust < 3) return { detail: `关系信号过弱（warmth+trust=${warmth + trust} < 3），不触发问候` };
    if (isQuietHours(createdAt) && (relation ? warmth + trust < 9 : true)) return { detail: `夜间且关系信号不足（${relation ? warmth + trust : 0} < 9），不触发问候` };
    const recentPrivateActionId = findRecentUserPrivateActionEventId(chat, actorId, targetId, createdAt, 90 * 60_000);
    if (recentPrivateActionId) {
      return {
        detail: `近期已存在用户私域动作（90min），不重复问候（hit=${recentPrivateActionId}）`,
        hitEventId: recentPrivateActionId,
        hitWindow: '90min',
      };
    }
  }
  if (payload.eventKind === 'react_to_moment') {
    if (isQuietHours(createdAt)) return { detail: '夜间时段不触发动态回应' };
    const recentReactions = findRecentReactMomentArtifacts(chat, actorId, createdAt, 2 * 60 * 60_000);
    const recentReactionCount = recentReactions.length;
    if (recentReactionCount >= 2) {
      return {
        detail: `近期动态回应过多（${recentReactionCount} 次/2h），不重复回应`,
        hitEventId: recentReactions[0]?.id,
        hitWindow: '2h',
      };
    }
  }
  return undefined;
}

function passesAttentionRestraintPolicy(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !resolveAttentionRestraintFailureDetail(chat, payload, createdAt)?.detail;
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
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
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
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
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
    ? result.participantIds.filter((id) => id !== 'user' && conversation.memberIds.includes(id))
    : [];
  if (participantIds.length !== 2 || !participantIds.includes(senderId)) return null;
  return {
    eventKind: 'pair_private_thread',
    participantIds,
    targetIds: result.targetIds?.filter((id) => id !== 'user' && conversation.memberIds.includes(id)),
    reasonType: result.reasonType || 'unresolved_question',
    confidence: Math.max(0.8, result.confidence || 0),
    urgency: 'soon',
    seedIntent: result.seedIntent || '想私下继续聊刚才的话题。',
    triggerReason: result.triggerReason || result.seedIntent || '当前群聊出现了适合双人延续的未尽话题。',
    openingMessage: result.openingMessage || result.seedIntent || '刚才那个点我还是想和你单独接着聊一下。',
    visibilityPlan: 'conversation_private',
    expectedArtifacts: ['private_thread_summary'],
    dedupeKey: result.dedupeKey ?? `${senderId}::${participantIds.find((id) => id !== senderId) || participantIds[1]}`,
  };
}

async function analyzePairPrivateThread(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'senderId'>;
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}): Promise<PairPrivateThreadAnalysisResult | null> {
  if (!params.apiConfig || params.message.senderId === 'user') return null;
  const memberCharacters = params.characters.filter((character) => params.conversation.memberIds.includes(character.id));
  const recentTranscript = (params.recentMessages || [])
    .filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event')
    .slice(-10)
    .map((message) => `${message.senderName}: ${message.content}`)
    .join('\n');
  const recentPrivateThreads = buildRecentSocialEventContext(params.conversation, 'pair_private_thread')
    .map((event) => `- ${event.summary}`)
    .join('\n');
  const prompt = `你是群聊社交事件分析器。判断这条新消息之后，发言角色是否真的需要和某个AI角色派生一个双人私聊，并写出私聊第一句。\n\n只输出 JSON：\n{\n  "shouldCreate": boolean,\n  "participantIds": string[] | null,\n  "targetIds": string[] | null,\n  "confidence": number,\n  "reasonType": string | null,\n  "dedupeKey": string | null,\n  "seedIntent": string | null,\n  "triggerReason": string | null,\n  "openingMessage": string | null\n}\n\n要求：\n1. participantIds 必须恰好 2 个AI角色 id，且必须包含 speakerId=${params.message.senderId}；不要包含 user。\n2. openingMessage 是 speakerId 角色发给另一个角色的第一句私聊消息，要契合当前群聊上下文和角色人设；可以短招呼、追问、解释、安抚，也可以较长，但不能像系统说明。\n3. triggerReason 用一句话说明为什么当前场景会触发这段私聊，必须基于最近对话，不要泛泛而谈。\n4. 只有确实存在“公开群聊不适合继续讲、两人关系需要转入私下、某个问题需要避开他人追问、或者关系余波需要双人处理”时才 shouldCreate=true。\n5. 如果只是普通回复、玩笑、寒暄、或可以继续在群里聊，返回 shouldCreate=false。\n6. 如果和最近已有私聊是同一对同一语义，返回相同 dedupeKey。\n\n成员：\n${buildCharacterReference(memberCharacters)}\n\n最近对话：\n${recentTranscript}\n\n最近双人私聊事件：\n${recentPrivateThreads || '无'}\n\n当前消息（speakerId=${params.message.senderId}）：\n${params.message.content}`;
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

function shouldAnalyzePairPrivateThread(content: string) {
  return /(私下|单独|悄悄|别在群里|回头聊|另聊|私聊|只跟你|避开|别让|继续聊|我想问你|你刚才说的|刚才那个问题)/i.test(content);
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
  const hasPairPrivateThreadHint = baseHints.some((hint) => hint.eventKind === 'pair_private_thread');
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
  if (!hasPairPrivateThreadHint && shouldAnalyzePairPrivateThread(params.message.content)) {
    const analyzed = await analyzePairPrivateThread({
      conversation: params.conversation,
      message: params.message,
      characters: params.characters,
      recentMessages: params.recentMessages,
      apiConfig: params.apiConfig,
    });
    const mapped = toPairPrivateThreadHint(analyzed, params.conversation, params.message.senderId);
    if (mapped) baseHints.push(mapped);
  }
  return baseHints.length ? baseHints : null;
}

function buildPostMomentCandidate(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  interaction: InteractionEventPayload | null;
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}): RuntimeEventV2 | null {
  const hinted = buildPostMomentCandidateFromHint(params);
  if (!hinted) return null;
  const actor = params.characters.find((item) => item.id === params.message.senderId) || null;
  if (actor && !isCharacterFeatureEnabled(actor, 'moments')) return null;
  const payload = hinted.payload as SocialEventCandidatePayload;
  const now = Date.now();
  const text = params.message.content.trim();
  const expressive = /(发个朋友圈|发条动态|想发|晒|记录一下|发出来|po一下)/i.test(text);
  const roomHeat = params.structuredRoomState?.heat || 0;
  const roomCohesion = params.structuredRoomState?.cohesion || 0;
  const emotionalPush = params.interaction && params.interaction.confidence >= 0.85 && (params.interaction.intensity >= 3 || params.interaction.kind === 'side_comment');
  if (!expressive && !emotionalPush && !(roomHeat >= 18 && roomCohesion >= 2)) return null;
  const personaText = `${actor?.speakingStyle || ''} ${actor?.background || ''} ${(actor?.expertise || []).join(' ')}`.toLowerCase();
  const isNightOwl = /(夜猫|熬夜|夜班|主播|直播|vlog|夜生活|night|stream)/i.test(personaText);
  const hour = new Date(now).getHours();
  const isLateNight = hour >= 23 || hour < 7;
  if (isLateNight && !isNightOwl) return null;
  const lastSocialArtifactAt = (params.conversation.runtimeEventsV2 || [])
    .filter((event) => event.kind === 'artifact' && ['social_outing', 'check_in', 'react_to_moment', 'status_update', 'gift_exchange'].includes((event.payload as { eventKind?: string }).eventKind || ''))
    .map((event) => event.createdAt)
    .sort((a, b) => b - a)[0];
  if (typeof lastSocialArtifactAt === 'number' && now - lastSocialArtifactAt < 18 * 60 * 60_000) return null;
  const modeSeed = Math.abs(stableEventSeed([params.conversation.id, params.message.senderId, Math.floor(now / (60 * 60_000))]).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0));
  const modeVariant = modeSeed % 3;
  const expectedArtifacts = payload.expectedArtifacts?.length
    ? payload.expectedArtifacts
    : (modeVariant === 0 ? ['moment_text', 'moment_group_photo'] : modeVariant === 1 ? ['moment_text', 'moment_selfie'] : ['moment_text']);
  const activityType = payload.activityType
    || (modeVariant === 0 ? '关系互动' : modeVariant === 1 ? '随拍' : '情绪碎片');
  const title = payload.title
    || (modeVariant === 0 ? '朋友圈动态' : modeVariant === 1 ? '随手一拍' : '今日碎片');
  return {
    ...hinted,
    payload: {
      ...payload,
      title,
      activityType,
      expectedArtifacts,
      confidence: Math.max(payload.confidence, expressive ? 0.92 : emotionalPush ? 0.86 : 0.82),
      reasonType: payload.reasonType || (roomCohesion >= 10 ? 'celebration' : 'emotion_release'),
      urgency: payload.urgency === 'immediate' ? 'soon' : payload.urgency,
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
    .replace(/[，。！？、,.!?:;：；“”"'‘’（）()【】[\]-]/g, '');
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
    triggerReason: choosePreferredText(existing.triggerReason, incoming.triggerReason),
    openingMessage: choosePreferredText(existing.openingMessage, incoming.openingMessage),
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

type CandidateSuppressionReason =
  | 'restraint_policy'
  | 'dedupe_backflow_post_moment'
  | 'dedupe_backflow_social_outing'
  | 'dedupe_backflow_status_update'
  | 'dedupe_backflow_check_in'
  | 'dedupe_backflow_react_to_moment'
  | 'dedupe_backflow_gift_exchange'
  | 'dedupe_semantic_existing_newer'
  | 'dedupe_key_duplicate';

type CandidateSuppressionRecord = {
  event: RuntimeEventV2;
  reason: CandidateSuppressionReason;
  detail?: string;
  suppressedConfidence?: number;
  preferredConfidence?: number;
  preferredCandidateId?: string;
  suppressedCandidateId?: string;
};

function dedupeSemanticCandidates(chat: GroupChat, candidates: RuntimeEventV2[]) {
  const merged = mergeCandidatesWithinBatch(candidates);
  const kept: RuntimeEventV2[] = [];
  const suppressed: CandidateSuppressionRecord[] = [];
  merged.forEach((event) => {
    const payload = event.payload as SocialEventCandidatePayload;
    const existing = findSemanticallySimilarExisting(chat, payload);
    if (!existing) {
      kept.push(event);
      return;
    }
    if (existing.createdAt >= event.createdAt) {
      const incomingConfidence = (payload.confidence || 0);
      const existingPayload = existing.payload as SocialEventCandidatePayload;
      const existingConfidence = (existingPayload.confidence || 0);
      suppressed.push({
        event,
        reason: 'dedupe_semantic_existing_newer',
        detail: `语义重复且已有候选更新（existing=${existing.createdAt}, incoming=${event.createdAt}）`,
        suppressedConfidence: incomingConfidence,
        preferredConfidence: existingConfidence,
        preferredCandidateId: existing.id,
        suppressedCandidateId: event.id,
      });
      return;
    }
    kept.push({
      ...mergeCandidateEvents(existing, event),
      id: existing.id,
      createdAt: existing.createdAt,
    } satisfies RuntimeEventV2);
  });
  return { candidates: kept, suppressed };
}

function buildCandidateDedupeKey(payload: SocialEventCandidatePayload) {
  return payload.dedupeKey || buildCandidateClusterKey(payload) || buildSemanticCandidateKey(payload);
}

function dedupeByKey(candidates: RuntimeEventV2[]) {
  const seen = new Map<string, { index: number; event: RuntimeEventV2 }>();
  const kept: RuntimeEventV2[] = [];
  const suppressed: CandidateSuppressionRecord[] = [];
  candidates.forEach((event) => {
    const payload = event.payload as SocialEventCandidatePayload;
    const dedupeKey = buildCandidateDedupeKey(payload);
    const previous = seen.get(dedupeKey);
    if (previous) {
      const merged = mergeCandidateEvents(previous.event, event);
      const preferIncoming = (payload.confidence || 0) > (((previous.event.payload as SocialEventCandidatePayload).confidence) || 0);
      const winner = preferIncoming ? merged : { ...merged, id: previous.event.id, createdAt: previous.event.createdAt } as RuntimeEventV2;
      kept[previous.index] = winner;
      seen.set(dedupeKey, { index: previous.index, event: winner });
      const suppressedEvent = preferIncoming ? previous.event : event;
      const suppressedConfidence = ((suppressedEvent.payload as SocialEventCandidatePayload).confidence) || 0;
      const preferredConfidence = (((winner.payload as SocialEventCandidatePayload).confidence) || 0);
      const detail = preferIncoming
        ? `同 key 候选中保留更高置信度候选（${preferredConfidence.toFixed(2)} > ${suppressedConfidence.toFixed(2)}）`
        : `同 key 候选中保留先前更高置信度候选（${preferredConfidence.toFixed(2)} >= ${suppressedConfidence.toFixed(2)}）`;
      suppressed.push({
        event: suppressedEvent,
        reason: 'dedupe_key_duplicate',
        detail,
        suppressedConfidence,
        preferredConfidence,
        preferredCandidateId: winner.id,
        suppressedCandidateId: suppressedEvent.id,
      });
      return;
    }
    seen.set(dedupeKey, { index: kept.length, event });
    kept.push(event);
  });
  return { candidates: kept, suppressed };
}

function dedupeSocialEventCandidates(chat: GroupChat, candidates: RuntimeEventV2[]) {
  const semantic = dedupeSemanticCandidates(chat, candidates);
  const keyed = dedupeByKey(semantic.candidates);
  return {
    candidates: keyed.candidates,
    suppressed: [...semantic.suppressed, ...keyed.suppressed],
  };
}

function legacyBuildExistingCandidateClusterMap() {
  return new Map<string, RuntimeEventV2>();
}

void legacyBuildExistingCandidateClusterMap;


function shouldAutoBackflowMoment(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !(chat.runtimeEventsV2 || []).some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'moment_text' && (event.payload as { eventKind?: string }).eventKind === 'post_moment' && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload) && event.createdAt >= createdAt);
}

function findRecentMomentBackflowEventId(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const matched = (chat.runtimeEventsV2 || []).find((event) => event.kind === 'artifact'
    && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'moment_text'
    && (event.payload as { eventKind?: string }).eventKind === 'post_moment'
    && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload)
    && event.createdAt >= createdAt);
  return matched?.id || null;
}

function shouldAutoBackflowOuting(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  return !(chat.runtimeEventsV2 || []).some((event) => event.kind === 'artifact' && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'outing_summary' && (event.payload as { eventKind?: string }).eventKind === 'social_outing' && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload) && event.createdAt >= createdAt);
}

function findRecentOutingBackflowEventId(chat: GroupChat, payload: SocialEventCandidatePayload, createdAt: number) {
  const matched = (chat.runtimeEventsV2 || []).find((event) => event.kind === 'artifact'
    && (event.payload as { artifactType?: string; eventKind?: string }).artifactType === 'outing_summary'
    && (event.payload as { eventKind?: string }).eventKind === 'social_outing'
    && buildCandidateClusterKey(event.payload as SocialEventCandidatePayload) === buildCandidateClusterKey(payload)
    && event.createdAt >= createdAt);
  return matched?.id || null;
}

function candidateSuppressionReasonLabel(reason: CandidateSuppressionReason) {
  if (reason === 'restraint_policy') return '触发关注克制策略（冷却/夜间/关系边界）';
  if (reason === 'dedupe_backflow_post_moment') return '动态候选已被近期同簇产物覆盖';
  if (reason === 'dedupe_backflow_social_outing') return '活动候选已被近期同簇产物覆盖';
  if (reason === 'dedupe_backflow_status_update') return '状态候选已被近期同簇产物覆盖';
  if (reason === 'dedupe_backflow_check_in') return '问候候选已被近期同簇产物覆盖';
  if (reason === 'dedupe_backflow_react_to_moment') return '动态回应候选已被近期同簇产物覆盖';
  if (reason === 'dedupe_semantic_existing_newer') return '候选与已有候选语义重复且时间更旧';
  if (reason === 'dedupe_key_duplicate') return '候选去重键重复，已被同批候选覆盖';
  return '礼物候选已被近期同簇产物覆盖';
}

function parseSuppressionWindowMs(hitWindow: string | undefined) {
  if (!hitWindow) return null;
  if (/^\d+min$/i.test(hitWindow)) return Number(hitWindow.replace(/min/i, '')) * 60_000;
  if (/^\d+h$/i.test(hitWindow)) return Number(hitWindow.replace(/h/i, '')) * 60 * 60_000;
  return null;
}

function inferNextSuggestedAtFromSuppression(
  chat: GroupChat,
  event: RuntimeEventV2,
  hitEventId: string | undefined,
  hitWindow: string | undefined,
) {
  const windowMs = parseSuppressionWindowMs(hitWindow);
  if (!windowMs) return undefined;
  const hitEvent = hitEventId
    ? (chat.runtimeEventsV2 || []).find((item) => item.id === hitEventId)
    : null;
  const baseAt = hitEvent?.createdAt || event.createdAt;
  const nextAt = baseAt + windowMs;
  return nextAt > event.createdAt ? nextAt : undefined;
}

function hasPendingCandidateSuppression(
  chat: GroupChat,
  actorId: string,
  eventKind: SocialEventCandidatePayload['eventKind'],
  now: number,
) {
  return (chat.runtimeEventsV2 || []).some((event) => {
    if (event.kind !== 'action_resolution') return false;
    if ((event.actorIds || [])[0] !== actorId) return false;
    const payload = event.payload as {
      eventType?: string;
      candidateEventKind?: string;
      nextSuggestedAt?: number;
    };
    return payload.eventType === 'event_candidate_suppressed'
      && payload.candidateEventKind === eventKind
      && typeof payload.nextSuggestedAt === 'number'
      && payload.nextSuggestedAt > now;
  });
}

function resolveCandidateSuppressionReason(chat: GroupChat, event: RuntimeEventV2): CandidateSuppressionReason | null {
  const payload = event.payload as SocialEventCandidatePayload;
  if (!passesAttentionRestraintPolicy(chat, payload, event.createdAt)) return 'restraint_policy';
  if (payload.eventKind === 'post_moment' && !shouldAutoBackflowMoment(chat, payload, event.createdAt)) return 'dedupe_backflow_post_moment';
  if (payload.eventKind === 'social_outing' && !shouldAutoBackflowOuting(chat, payload, event.createdAt)) return 'dedupe_backflow_social_outing';
  if (payload.eventKind === 'status_update' && !shouldAutoBackflowStatusUpdate(chat, payload, event.createdAt)) return 'dedupe_backflow_status_update';
  if (payload.eventKind === 'check_in' && !shouldAutoBackflowCheckIn(chat, payload, event.createdAt)) return 'dedupe_backflow_check_in';
  if (payload.eventKind === 'react_to_moment' && !shouldAutoBackflowReactToMoment(chat, payload, event.createdAt)) return 'dedupe_backflow_react_to_moment';
  if (payload.eventKind === 'gift_exchange' && !shouldAutoBackflowGiftExchange(chat, payload, event.createdAt)) return 'dedupe_backflow_gift_exchange';
  return null;
}

function buildCandidateSuppressionEvent(chat: GroupChat, event: RuntimeEventV2, reason: CandidateSuppressionReason, metadata?: {
  detail?: string;
  suppressedConfidence?: number;
  preferredConfidence?: number;
  preferredCandidateId?: string;
  suppressedCandidateId?: string;
  hitEventId?: string;
  hitWindow?: string;
  nextSuggestedAt?: number;
}) {
  const payload = event.payload as SocialEventCandidatePayload;
  const traceReasons = payload.attentionTrace?.reasons || [];
  return createRuntimeEventV2({
    conversationId: chat.id,
    kind: 'action_resolution',
    summary: `候选已抑制：${payload.eventKind} · ${candidateSuppressionReasonLabel(reason)}`,
    actorIds: [payload.initiatorId],
    targetIds: payload.targetIds || payload.participantIds,
    visibility: 'moderator_only',
    createdAt: event.createdAt,
    payload: {
      eventType: 'event_candidate_suppressed',
      candidateEventKind: payload.eventKind,
      reasonType: reason,
      reasonLabel: candidateSuppressionReasonLabel(reason),
      dedupeKey: payload.dedupeKey || null,
      participantIds: payload.participantIds,
      targetIds: payload.targetIds || [],
      confidence: payload.confidence,
      reasonDetail: metadata?.detail,
      suppressedConfidence: metadata?.suppressedConfidence,
      preferredConfidence: metadata?.preferredConfidence,
      preferredCandidateId: metadata?.preferredCandidateId,
      suppressedCandidateId: metadata?.suppressedCandidateId,
      hitEventId: metadata?.hitEventId,
      hitWindow: metadata?.hitWindow,
      nextSuggestedAt: metadata?.nextSuggestedAt,
      attentionReasons: traceReasons.slice(0, 4),
    },
  });
}

function dedupeAgainstRecentRuntime(chat: GroupChat, candidates: RuntimeEventV2[]) {
  const deduped = dedupeSocialEventCandidates(chat, candidates);
  const kept: RuntimeEventV2[] = [];
  const suppressed: RuntimeEventV2[] = [];
  deduped.suppressed.forEach((item) => {
    suppressed.push(buildCandidateSuppressionEvent(chat, item.event, item.reason, {
      detail: item.detail,
      suppressedConfidence: item.suppressedConfidence,
      preferredConfidence: item.preferredConfidence,
      preferredCandidateId: item.preferredCandidateId,
      suppressedCandidateId: item.suppressedCandidateId,
    }));
  });
  deduped.candidates.forEach((event) => {
    const reason = resolveCandidateSuppressionReason(chat, event);
    if (!reason) {
      kept.push(event);
      return;
    }
    const payload = event.payload as SocialEventCandidatePayload;
    const restraintFailure = reason === 'restraint_policy'
      ? resolveAttentionRestraintFailureDetail(chat, payload, event.createdAt)
      : undefined;
    const reactBackflowHitEventId = reason === 'dedupe_backflow_react_to_moment'
      ? findRecentReactToMomentBackflowEventId(chat, payload, event.createdAt)
      : null;
    const checkInBackflowHitEventId = reason === 'dedupe_backflow_check_in'
      ? findRecentCheckInBackflowEventId(chat, payload, event.createdAt)
      : null;
    const statusBackflowHitEventId = reason === 'dedupe_backflow_status_update'
      ? findRecentStatusUpdateBackflowEventId(chat, payload, event.createdAt)
      : null;
    const momentBackflowHitEventId = reason === 'dedupe_backflow_post_moment'
      ? findRecentMomentBackflowEventId(chat, payload, event.createdAt)
      : null;
    const outingBackflowHitEventId = reason === 'dedupe_backflow_social_outing'
      ? findRecentOutingBackflowEventId(chat, payload, event.createdAt)
      : null;
    const giftBackflowHitEventId = reason === 'dedupe_backflow_gift_exchange'
      ? findRecentGiftExchangeBackflowEventId(chat, payload, event.createdAt)
      : null;
    suppressed.push(buildCandidateSuppressionEvent(chat, event, reason, {
      detail: restraintFailure?.detail,
      hitEventId: restraintFailure?.hitEventId,
      hitWindow: restraintFailure?.hitWindow,
      nextSuggestedAt: inferNextSuggestedAtFromSuppression(chat, event, restraintFailure?.hitEventId, restraintFailure?.hitWindow),
      ...(reactBackflowHitEventId ? {
        detail: `动态回应候选已被近期产物覆盖（hit=${reactBackflowHitEventId})`,
        hitEventId: reactBackflowHitEventId,
        hitWindow: '45min',
      } : {}),
      ...(checkInBackflowHitEventId ? {
        detail: `问候候选已被近期产物覆盖（hit=${checkInBackflowHitEventId})`,
        hitEventId: checkInBackflowHitEventId,
        hitWindow: '30min',
      } : {}),
      ...(statusBackflowHitEventId ? {
        detail: `状态候选已被近期产物覆盖（hit=${statusBackflowHitEventId})`,
        hitEventId: statusBackflowHitEventId,
        hitWindow: 'cluster',
      } : {}),
      ...(momentBackflowHitEventId ? {
        detail: `动态候选已被近期产物覆盖（hit=${momentBackflowHitEventId})`,
        hitEventId: momentBackflowHitEventId,
        hitWindow: 'cluster',
      } : {}),
      ...(outingBackflowHitEventId ? {
        detail: `活动候选已被近期产物覆盖（hit=${outingBackflowHitEventId})`,
        hitEventId: outingBackflowHitEventId,
        hitWindow: 'cluster',
      } : {}),
      ...(giftBackflowHitEventId ? {
        detail: `礼物候选已被近期产物覆盖（hit=${giftBackflowHitEventId})`,
        hitEventId: giftBackflowHitEventId,
        hitWindow: 'cluster',
      } : {}),
    }));
  });
  return { candidates: kept, suppressedEvents: suppressed };
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

function buildNonCandidateAdditions(params: { messageGeneratedEvent: RuntimeEventV2; interactionEvent?: RuntimeEventV2 | null; relationshipDeltaEvent?: RuntimeEventV2 | null; roomShiftEvent?: RuntimeEventV2 | null; attentionEvent?: RuntimeEventV2 | null; memoryCandidateEvents?: RuntimeEventV2[]; momentArtifactEvents?: RuntimeEventV2[]; artifactEvent?: RuntimeEventV2 | null }) {
  return [
    params.messageGeneratedEvent,
    ...(params.interactionEvent ? [params.interactionEvent] : []),
    ...(params.relationshipDeltaEvent ? [params.relationshipDeltaEvent] : []),
    ...(params.roomShiftEvent ? [params.roomShiftEvent] : []),
    ...(params.attentionEvent ? [params.attentionEvent] : []),
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
          candidateId: event.id,
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
  characters: AICharacter[];
  interaction: InteractionEventPayload | null;
  relationshipLedger: GroupChat['relationshipLedger'];
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
}) {
  return dedupeAgainstRecentRuntime(params.conversation, [
    buildAttentionDrivenCheckInCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildAttentionDrivenPrivateThreadCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildAttentionDrivenReactMomentCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildAttentionDrivenInviteActivityCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildAttentionDrivenCalendarReminderCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildAttentionDrivenComfortCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildAttentionDrivenShareMomentCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildPairPrivateThreadCandidate({
      conversation: params.conversation,
      interaction: params.interaction,
      relationshipLedger: params.relationshipLedger,
      structuredRoomState: params.structuredRoomState,
      message: params.message,
    }),
    buildCompanionshipPrivateThreadCandidate({
      conversation: params.conversation,
      characters: params.characters,
      message: params.message,
    }),
    buildPostMomentCandidate(params),
    buildSocialOutingCandidate(params),
    buildStatusUpdateCandidate(params),
    buildGiftExchangeCandidate(params),
    buildConflictExpressionCandidate(params),
  ].filter(Boolean) as RuntimeEventV2[]);
}

function inferUserInteractionFromMessage(params: {
  message: Pick<Message, 'content' | 'senderId'>;
  characters: AICharacter[];
  recentMessages?: Message[];
}): InteractionEventPayload | null {
  const content = params.message.content.trim();
  if (!content) return null;
  const targetFromMention = params.characters.find((character) => character.name && content.includes(character.name));
  const recent = (params.recentMessages || [])
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-4);
  const latestAiSpeakerId = recent
    .slice()
    .reverse()
    .find((item) => item.type === 'ai' && item.senderId !== 'user')?.senderId || null;
  const target = targetFromMention
    || (latestAiSpeakerId ? params.characters.find((character) => character.id === latestAiSpeakerId) : undefined);
  if (!target) return null;
  const supportive = /(谢谢|辛苦|支持|赞同|说得对|太好了|thanks|great|nice|good point)/i.test(content);
  const challenging = /(不对|不同意|凭什么|为什么|离谱|急什么|别|wrong|disagree|ridiculous)/i.test(content);
  const probing = /(吗|么|呢|\?|？|how|what|why|can you)/i.test(content);
  const kind: InteractionEventPayload['kind'] = supportive
    ? 'support'
    : challenging
      ? 'challenge'
      : probing
        ? 'probe'
        : 'side_comment';
  if (kind === 'side_comment') return null;
  const tone: InteractionEventPayload['tone'] = supportive ? 'warm' : challenging ? 'annoyed' : 'cold';
  return {
    kind,
    actorId: params.message.senderId,
    targetId: target.id,
    intensity: supportive ? 3 : challenging ? 3 : 3,
    tone,
    evidenceText: content.slice(0, 120),
    confidence: 0.86,
  };
}

function inferAiInteractionTowardUserFromRecentTurn(params: {
  message: Pick<Message, 'content' | 'type' | 'senderId'>;
  recentMessages?: Message[];
}): InteractionEventPayload | null {
  if (params.message.type !== 'ai' || params.message.senderId === 'user') return null;
  const recent = (params.recentMessages || [])
    .filter((item) => !item.isDeleted && item.type !== 'system' && item.type !== 'event')
    .slice(-4);
  const latestUserMessage = recent.slice().reverse().find((item) => item.senderId === 'user' && item.type === 'user');
  if (!latestUserMessage) return null;
  const content = params.message.content.trim();
  if (!content) return null;
  const supportive = /(谢谢|辛苦|支持|赞同|说得对|太好了|thanks|great|nice|good point)/i.test(content);
  const challenging = /(不对|不同意|凭什么|为什么|离谱|急什么|别|wrong|disagree|ridiculous)/i.test(content);
  const probing = /(吗|么|呢|\?|？|how|what|why|can you|would you)/i.test(content);
  const addressesUser = /(你|你们|你的|您)/.test(content);
  const kind: InteractionEventPayload['kind'] = supportive
    ? 'support'
    : challenging
      ? 'challenge'
      : (probing || addressesUser)
        ? 'probe'
        : 'side_comment';
  if (kind === 'side_comment') return null;
  const tone: InteractionEventPayload['tone'] = supportive ? 'warm' : challenging ? 'annoyed' : 'cold';
  return {
    kind,
    actorId: params.message.senderId,
    targetId: 'user',
    intensity: supportive || challenging ? 3 : 2,
    tone,
    evidenceText: content.slice(0, 120),
    confidence: supportive || challenging ? 0.82 : 0.76,
  };
}

async function buildSocialEventCandidateEvents(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  interaction: InteractionEventPayload | null;
  relationshipLedger: GroupChat['relationshipLedger'];
  structuredRoomState: GroupChat['worldState']['structuredRoomState'];
  message: Pick<Message, 'content' | 'senderId'> & { socialEventHints?: SocialEventHintEnvelope[] | null };
  apiConfig?: APIConfig;
}) {
  const selection = buildSocialEventCandidates(params);
  if (!selection.candidates.length) return selection;
  const decision = await orchestrateWorldDecision({
    domain: 'open_chat',
    textApiConfig: params.apiConfig || null,
    candidates: selection.candidates.map((event, index) => {
      const payload = event.payload as SocialEventCandidatePayload;
      return {
        id: event.id,
        kind: payload.eventKind,
        reasonType: payload.reasonType,
        localScore: (payload.confidence || 0.7) - index * 0.001,
        summary: `${payload.title || ''}/${payload.activityType || ''}/${payload.seedIntent || ''}`,
      };
    }),
  });
  if (!decision) return selection;
  const picked = selection.candidates.find((event) => event.id === decision.selected.id);
  if (!picked) return selection;
  return {
    candidates: [picked, ...selection.candidates.filter((event) => event.id !== picked.id)],
    suppressedEvents: selection.suppressedEvents,
  };
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
      const text = buildMomentPostText(actorName, payload);
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
          candidateId: event.id,
          expectedArtifacts: payload.expectedArtifacts || [],
          dedupeKey: payload.dedupeKey,
          title: payload.title,
          activityType: payload.activityType,
          targetIds: payload.targetIds,
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
    ...buildCheckInArtifactEvents(params),
    ...buildReactToMomentArtifactEvents(params),
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
  if ((params.message.type === 'user' || params.message.type === 'god') && !speaker) {
    const senderIsMember = params.conversation.memberIds.includes(params.message.senderId);
    const isUserPersonaMessage = params.message.type === 'user' && params.message.senderId === 'user';
    const treatAsGuidance = params.message.type === 'god' || !senderIsMember;
    const summary = params.message.content.trim().slice(0, 128);
    const guidance = params.message.type === 'god' ? parseUserGuidanceIntent(params.message.content, params.characters) : null;
    const targetActorIds = getGuidanceTargetActorIds(guidance);
    const mentionedActorIds = params.characters.filter((character) => character.name && params.message.content.includes(character.name)).map((character) => character.id);
    const cueEvent = summary && isUserPersonaMessage ? createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'memory_candidate',
      summary: `${treatAsGuidance ? '用户引导' : '用户发言'}：${summary}`,
      actorIds: [params.message.senderId],
      payload: {
        kind: 'topic',
        text: `${treatAsGuidance ? '用户引导' : '用户发言'}：${summary}`,
        salience: 0.62,
        confidence: 0.74,
      } satisfies MemoryCandidatePayload,
    }) : null;
    const inferredUserInteraction = isUserPersonaMessage
      ? inferUserInteractionFromMessage({ message: params.message, characters: params.characters, recentMessages: params.recentMessages })
      : null;
    const userInteractionEvent = inferredUserInteraction ? createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'interaction',
      summary: `${params.message.senderId} → ${inferredUserInteraction.targetId} · ${inferredUserInteraction.evidenceText}`,
      actorIds: [params.message.senderId],
      targetIds: inferredUserInteraction.targetId ? [inferredUserInteraction.targetId] : undefined,
      payload: inferredUserInteraction,
    }) : null;
    const userRelationshipLedger = userInteractionEvent && inferredUserInteraction
      ? reduceRelationshipLedger(
        params.conversation.relationshipLedger || [],
        inferredUserInteraction,
        userInteractionEvent,
      )
      : (params.conversation.relationshipLedger || []);
    const { nextState: userStructuredRoomState, shift: userRoomShift } = inferredUserInteraction
      ? calculateRoomShift(
        params.conversation.worldState.structuredRoomState || null,
        inferredUserInteraction,
      )
      : { nextState: params.conversation.worldState.structuredRoomState || null, shift: null };
    const userRoomShiftEvent = inferredUserInteraction && userRoomShift ? createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'room_shift',
      summary: `房间态势更新：热度 ${userStructuredRoomState?.heat ?? 0} / 凝聚 ${userStructuredRoomState?.cohesion ?? 0}`,
      actorIds: [params.message.senderId],
      targetIds: inferredUserInteraction.targetId ? [inferredUserInteraction.targetId] : undefined,
      payload: userRoomShift,
    }) : null;
    const userRelationshipDelta = inferredUserInteraction ? inferRelationshipDelta(inferredUserInteraction) : null;
    const userRelationshipDeltaEvent = userRelationshipDelta ? createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'relationship_delta',
      summary: `${params.message.senderId}→${userRelationshipDelta.targetId} ${summarizeRelationshipDelta(userRelationshipDelta)}`,
      actorIds: [params.message.senderId],
      targetIds: userRelationshipDelta.targetId ? [userRelationshipDelta.targetId] : undefined,
      payload: userRelationshipDelta,
    }) : null;
    const userMemoryFromInteraction = userInteractionEvent ? buildMemoryCandidateFromStructuredEvent(userInteractionEvent) : null;
    const userMemoryFromRoomShift = userRoomShiftEvent ? buildMemoryCandidateFromStructuredEvent(userRoomShiftEvent) : null;
    const directorEvent = summary && guidance && params.message.type === 'god' ? createRuntimeEventV2({
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
    const attentionTargetIds = Array.from(new Set([
      ...mentionedActorIds,
      ...(inferredUserInteraction?.targetId && inferredUserInteraction.targetId !== 'user' ? [inferredUserInteraction.targetId] : []),
    ]));
    const attentionEvent = isUserPersonaMessage && attentionTargetIds.length ? createRuntimeEventV2({
      conversationId: params.conversation.id,
      kind: 'attention_candidate',
      summary: `${treatAsGuidance ? '用户点名' : '用户发言提及'} ${attentionTargetIds.join('、')}，等待回应`,
      actorIds: ['user'],
      targetIds: attentionTargetIds,
      visibility: 'derived_public',
      payload: {
        source: mentionedActorIds.length ? 'user_group_message' : 'user_followup_message',
        reason: mentionedActorIds.length
          ? '用户在群聊中点名，形成关注候选。'
          : '用户继续接住最近角色发言，形成关注候选。',
        confidence: mentionedActorIds.length ? 0.8 : 0.74,
        targetIds: attentionTargetIds,
      },
    }) : null;
    const additions = [
      cueEvent,
      userInteractionEvent,
      userRelationshipDeltaEvent,
      userRoomShiftEvent,
      userMemoryFromInteraction,
      userMemoryFromRoomShift,
      attentionEvent,
      directorEvent,
    ].filter(Boolean) as RuntimeEventV2[];
    return {
      interaction: null,
      runtimeEventsV2: additions.length ? mergeCompactedRuntimeEvents(existingEvents, [], additions) : existingEvents,
      relationshipLedger: userRelationshipLedger,
      structuredRoomState: userStructuredRoomState,
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

  const resolvedInteraction = await resolveInteraction({
    ...params,
    message: enrichedMessage,
  });
  const interaction = resolvedInteraction || inferAiInteractionTowardUserFromRecentTurn({
    message: params.message,
    recentMessages: params.recentMessages,
  });
  if (!interaction) {
    const artifactEvent = buildArtifactEvent(params);
    const socialEventCandidateSelection = await buildSocialEventCandidateEvents({
      conversation: params.conversation,
      characters: params.characters,
      interaction: null,
      relationshipLedger: params.conversation.relationshipLedger || [],
      structuredRoomState: params.conversation.worldState.structuredRoomState || null,
      message: enrichedMessage,
      apiConfig: params.apiConfig,
    });
    const socialEventCandidateEvents = socialEventCandidateSelection.candidates;
    const socialArtifacts = buildMomentArtifactEventsAndOuting({
      conversation: params.conversation,
      socialEventCandidates: socialEventCandidateEvents,
      characters: params.characters,
    });
    return {
      interaction: null,
      runtimeEventsV2: mergeCompactedRuntimeEvents(
        existingEvents,
        socialEventCandidateEvents,
        buildNonCandidateAdditions({
          messageGeneratedEvent,
          momentArtifactEvents: socialArtifacts,
          artifactEvent,
        }).concat(socialEventCandidateSelection.suppressedEvents),
      ),
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
  const socialEventCandidateSelection = await buildSocialEventCandidateEvents({
    conversation: params.conversation,
    characters: params.characters,
    interaction,
    relationshipLedger,
    structuredRoomState,
    message: enrichedMessage,
    apiConfig: params.apiConfig,
  });
  const socialEventCandidateEvents = socialEventCandidateSelection.candidates;
  const momentArtifactEvents = buildMomentArtifactEventsAndOuting({
    conversation: params.conversation,
    socialEventCandidates: socialEventCandidateEvents,
    characters: params.characters,
  });
  const memoryCandidateEvents = [interactionEvent, roomShiftEvent]
    .map(buildMemoryCandidateFromStructuredEvent)
    .filter(Boolean) as RuntimeEventV2[];
  const actorIsChatMember = params.conversation.memberIds.includes(interaction.actorId);
  const targetIsChatMember = Boolean(interaction.targetId && params.conversation.memberIds.includes(interaction.targetId));
  const attentionTargetId = interaction.targetId || null;
  const shouldCreateAttentionEvent = Boolean(
    attentionTargetId
    && interaction.actorId !== attentionTargetId
    && actorIsChatMember
    && targetIsChatMember
    && interaction.confidence >= 0.72,
  );
  const attentionEvent = shouldCreateAttentionEvent
    ? createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'attention_candidate',
        summary: `${interaction.actorId} 对 ${attentionTargetId} 形成关注候选`,
        actorIds: [interaction.actorId],
        targetIds: [attentionTargetId as string],
        visibility: 'derived_public',
        payload: {
          source: attentionTargetId === 'user' ? 'ai_response_to_user' : 'ai_response_to_member',
          reason: interaction.evidenceText,
          confidence: Math.max(0.72, interaction.confidence),
          targetIds: [attentionTargetId as string],
        },
      })
    : null;

  return {
    interaction,
    runtimeEventsV2: mergeCompactedRuntimeEvents(
      existingEvents,
      socialEventCandidateEvents,
      buildNonCandidateAdditions({
        messageGeneratedEvent,
        interactionEvent,
        relationshipDeltaEvent,
        roomShiftEvent,
        attentionEvent,
        memoryCandidateEvents,
        momentArtifactEvents,
        artifactEvent,
      }).concat(socialEventCandidateSelection.suppressedEvents),
    ),
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

function normalizeRuleEvalText(content: string) {
  return content
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?:;：；“”"'‘’（）()【】[\]-]/g, '');
}

function evaluateWorldInfluenceRulesFromMessage(input: {
  content: string;
  activeRuleIds: string[];
}) {
  const normalized = normalizeRuleEvalText(input.content || '');
  const caringSignal = /(还好吗|没事吧|别急|辛苦了|注意休息|先缓缓|慢慢说|我在这|抱抱|areyouok|takeyourtime|norush|imhere|i'mhere)/.test(normalized);
  const scheduleSignal = /(提醒|别忘|时间|几点|改期|冲突|确认时间|行程|schedule|remind|time|conflict|reschedule|confirm)/.test(normalized);
  const forcefulSignal = /(必须|马上|立刻|赶紧|闭嘴|stoparguing|justdoit|must|immediately|shutup)/.test(normalized);
  const lowPressureSignal = /(可以|要不|如果方便|不着急|慢慢来|先看看|先别急|别急|或许|也许|建议|maybe|perhaps|ifyouwant|whenever|takeitasyoucan)/.test(normalized);
  const matchedRuleIds = input.activeRuleIds.filter((ruleId) => {
    if (ruleId === 'comfort_first') return caringSignal;
    if (ruleId === 'urgent_calendar_first' || ruleId === 'calendar_conflict_clarify_first') return scheduleSignal;
    if (ruleId === 'low_pressure_restraint') return lowPressureSignal && !forcefulSignal;
    return false;
  });
  const unmetRuleIds = input.activeRuleIds.filter((ruleId) => !matchedRuleIds.includes(ruleId));
  return { matchedRuleIds, unmetRuleIds };
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
  const senderIsCharacter = params.characters.some((character) => character.id === publicMessage.senderId);
  const senderIsMember = params.conversation.memberIds.includes(publicMessage.senderId);
  const isPlainUserGuidance = publicMessage.type === 'god'
    || ((publicMessage.type === 'user') && !senderIsCharacter && !senderIsMember);
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
  const worldInfluence = publicMessage.metadata?.runtimeDecision?.worldInfluence;
  const worldInfluenceRuleEvalEvent = worldInfluence?.activeRuleIds?.length
    ? (() => {
        const { matchedRuleIds, unmetRuleIds } = evaluateWorldInfluenceRulesFromMessage({
          content: publicMessage.content,
          activeRuleIds: worldInfluence.activeRuleIds,
        });
        return createRuntimeEventV2({
          conversationId: params.conversation.id,
          kind: 'action_resolution',
          summary: `世界影响规则执行：命中 ${matchedRuleIds.length}/${worldInfluence.activeRuleIds.length}`,
          actorIds: [publicMessage.senderId],
          visibility: 'derived_public',
          payload: {
            eventType: 'world_influence_rule_evaluated',
            activeRuleIds: worldInfluence.activeRuleIds,
            matchedRuleIds,
            unmetRuleIds,
            attentionScore: worldInfluence.attentionScore,
            attentionRestraint: worldInfluence.attentionRestraint,
          },
        });
      })()
    : null;
  const nextRuntimeEventsV2 = [...runtimeEventsV2, ...withdrawalRuntimeEventsV2].slice(-MAX_OPEN_CHAT_RUNTIME_EVENTS);
  const runtimeEventsWithRuleEval = worldInfluenceRuleEvalEvent
    ? mergeCompactedRuntimeEvents(nextRuntimeEventsV2, [], [worldInfluenceRuleEvalEvent]).slice(-MAX_OPEN_CHAT_RUNTIME_EVENTS)
    : nextRuntimeEventsV2;
  setChangedChatPatchField(chatPatch, params.conversation, 'runtimeEventsV2', runtimeEventsWithRuleEval);
  setChangedChatPatchField(chatPatch, params.conversation, 'relationshipLedger', effectiveRelationshipLedger);
  const chatRuntimeDelta = {
    runtimeEventsV2: buildRuntimeEventsDelta(params.conversation, runtimeEventsWithRuleEval),
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
