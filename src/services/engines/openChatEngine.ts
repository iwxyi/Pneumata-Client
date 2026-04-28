import type { DriverMessageCommitResult, GroupChat, RuntimeContext } from '../../types/chat';
import type { SessionActionSchema, SessionEngineDefinition } from '../../types/sessionEngine';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import type { InteractionEventPayload, RuntimeEventV2 } from '../../types/runtimeEvent';
import { DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../../types/chat';
import { buildChatPatch, buildNextWorldState, buildRelationshipTransition, buildWorldRuntimeEvents } from '../chatRuntimeTransitionBuilder';
import { judgeInteractionEvent } from '../interactionJudge';
import { getRelationshipLedgerEntry, inferRelationshipDelta, reduceRelationshipLedger, summarizeRelationshipDelta } from '../relationshipLedger';
import { calculateRoomShift } from '../roomStateSynthesizer';
import { resolveRuntimeEvolutionConfig } from '../runtimeEvolutionConfig';
import type { APIConfig } from '../../types/settings';

function createRuntimeEventV2(params: {
  conversationId: string;
  kind: RuntimeEventV2['kind'];
  summary: string;
  payload: RuntimeEventV2['payload'];
  actorIds?: string[];
  targetIds?: string[];
  evidenceMessageIds?: string[];
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
    payload: params.payload,
  };
}

async function resolveInteraction(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: InteractionEventPayload | null };
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

async function buildStructuredRuntime(params: {
  conversation: GroupChat;
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: InteractionEventPayload | null };
  characters: AICharacter[];
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}) {
  if (params.message.type !== 'ai') {
    return {
      interaction: null,
      runtimeEventsV2: params.conversation.runtimeEventsV2 || [],
      relationshipLedger: params.conversation.relationshipLedger || [],
      structuredRoomState: params.conversation.worldState.structuredRoomState || null,
    };
  }

  const interaction = await resolveInteraction(params);
  if (!interaction) {
    return {
      interaction: null,
      runtimeEventsV2: params.conversation.runtimeEventsV2 || [],
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
  const latestLedgerEntry = interaction.targetId
    ? getRelationshipLedgerEntry(relationshipLedger, interaction.actorId, interaction.targetId)
    : null;

  const relationshipDeltaEvent = relationshipDelta && latestLedgerEntry && targetName
    ? createRuntimeEventV2({
        conversationId: params.conversation.id,
        kind: 'relationship_delta',
        summary: `${actorName}→${targetName} ${summarizeRelationshipDelta(relationshipDelta)}`,
        actorIds: [interaction.actorId],
        targetIds: interaction.targetId ? [interaction.targetId] : undefined,
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

  return {
    interaction,
    runtimeEventsV2: [
      ...(params.conversation.runtimeEventsV2 || []),
      interactionEvent,
      ...(relationshipDeltaEvent ? [relationshipDeltaEvent] : []),
      roomShiftEvent,
    ].slice(-120),
    relationshipLedger,
    structuredRoomState,
  };
}

function toLegacyMetrics(interaction: InteractionEventPayload, relationshipLedger: GroupChat['relationshipLedger']) {
  if (!interaction.targetId) return null;
  return relationshipLedger?.find((entry) => entry.actorId === interaction.actorId && entry.targetId === interaction.targetId)?.current || null;
}

function buildStructuredLegacyEvents(interaction: InteractionEventPayload | null, relationshipLedger: GroupChat['relationshipLedger'], structuredRoomState: GroupChat['worldState']['structuredRoomState']): Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }> {
  if (!interaction) return [];
  const events: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }> = [{
    eventType: `interaction_${interaction.kind}`,
    title: `结构化互动：${interaction.kind}`,
    summary: interaction.evidenceText,
    pair: interaction.targetId ? [interaction.actorId, interaction.targetId] as [string, string] : undefined,
    metrics: toLegacyMetrics(interaction, relationshipLedger),
  }];

  if (structuredRoomState) {
    events.push({
      eventType: 'room_state_snapshot_v2',
      title: '房间态势更新',
      summary: `热度 ${structuredRoomState.heat} / 凝聚 ${structuredRoomState.cohesion} / 跑题 ${structuredRoomState.topicDrift}`,
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

function buildParticipants(conversation: GroupChat) {
  return conversation.memberIds.map((memberId, index) => ({
    participantId: `${conversation.id}:${memberId}`,
    conversationId: conversation.id,
    entityType: 'ai' as const,
    entityRefId: memberId,
    seatIndex: index,
    canSpeak: true,
    canAct: true,
    flags: {},
  }));
}

function getAvailableActions() {
  return [{ type: 'speak' }];
}

function getVisiblePanels(context: RuntimeContext) {
  const isOpenChat = context.conversation.mode === 'open_chat';
  return [
    { key: 'members', title: context.conversation.type === 'group' ? '成员' : '角色', type: 'members' as const, tabKey: 'members' as const },
    { key: 'runtime', title: isOpenChat ? '运行态' : '世界', type: 'runtime' as const, tabKey: 'world' as const },
  ];
}

function getPhaseDefinitions() {
  return [{ key: 'idle', label: 'Idle', allowedActions: ['speak', 'all'] }];
}

function getActionSchema(_context: { conversation: GroupChat }): SessionActionSchema | null {
  return null;
}

async function onMessageCommitted(params: {
  conversation: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: InteractionEventPayload | null };
  previousAiMessage?: Pick<Message, 'senderId'> | null;
  recentMessages?: Message[];
  apiConfig?: APIConfig;
}): Promise<DriverMessageCommitResult> {
  const config = resolveRuntimeEvolutionConfig(params.conversation.runtimeEvolutionIntensity);
  const nextWorldStateResult = buildNextWorldState(params.conversation, params.message, config);
  const relationshipTransition = buildRelationshipTransition({
    conversation: params.conversation,
    characters: params.characters,
    message: params.message,
    previousAiMessage: params.previousAiMessage || null,
    config,
  });
  const worldRuntimeEvents = buildWorldRuntimeEvents(params.message, nextWorldStateResult.worldState, nextWorldStateResult.nextConflictAxes, config);
  const { interaction, runtimeEventsV2, relationshipLedger, structuredRoomState } = await buildStructuredRuntime({
    conversation: params.conversation,
    message: params.message,
    characters: params.characters,
    recentMessages: params.recentMessages,
    apiConfig: params.apiConfig,
  });
  const mergedWorldState = {
    ...nextWorldStateResult.worldState,
    structuredRoomState,
    recentEvent: mergeRecentEvent(nextWorldStateResult.worldState.recentEvent, buildStructuredSummary(interaction, params.characters)),
  };
  const commitRuntimeEvents = [
    ...relationshipTransition.runtimeEvents,
    ...worldRuntimeEvents,
    ...buildStructuredLegacyEvents(interaction, relationshipLedger, structuredRoomState),
  ];

  const chatPatch = buildChatPatch(params.conversation, params.message, mergedWorldState, commitRuntimeEvents, config);
  chatPatch.runtimeEventsV2 = runtimeEventsV2;
  chatPatch.relationshipLedger = relationshipLedger;
  return {
    chatPatch,
    characterPatches: relationshipTransition.characterPatches,
    runtimeEvents: commitRuntimeEvents,
  };
}

export const openChatEngine: SessionEngineDefinition = {
  key: 'open_chat',
  createInitialConfig: () => DEFAULT_OPEN_CHAT_MODE_CONFIG,
  createInitialState: () => DEFAULT_OPEN_CHAT_MODE_STATE,
  buildParticipants,
  getPhaseDefinitions,
  getActionSchema,
  getAvailableActions,
  getVisiblePanels,
  onMessageCommitted,
};

export const OPEN_CHAT_ENGINE = openChatEngine;
