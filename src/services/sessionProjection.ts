import type { GroupChat } from '../types/chat';
import type { MemoryCandidatePayload, RuntimeEventKind, RuntimeEventV2 } from '../types/runtimeEvent';
import type { SessionActionDefinition, SessionEngineDefinition, SessionProjectionContext, SessionViewProjection } from '../types/sessionEngine';
import { canProjectScope } from '../types/sessionVisibility';
import { projectSessionRecentEvent } from './directSessionHelpers';
import { buildRolePrivateParticipantStates, buildRolePrivatePayloads, projectPrivateParticipantPayloads } from './privateRuntimePayloads';

export interface ProjectedRuntimeTimelineItem {
  type: 'note' | 'artifact' | 'relationship';
  text: string;
  createdAt: number;
  label: string;
  event?: RuntimeEventV2 | null;
  meta?: {
    memoryCandidate?: MemoryCandidatePayload;
    relationshipDelta?: {
      reason: string;
      delta: { affinity?: number; respect?: number; hostility?: number; contempt?: number };
    };
    roomShift?: {
      heat?: number;
      cohesion?: number;
      topicDrift?: number;
      delta?: { heat?: number; cohesion?: number; topicDrift?: number };
    };
  };
}

function isMemoryCandidatePayload(payload: RuntimeEventV2['payload']): payload is MemoryCandidatePayload {
  return typeof payload === 'object' && payload !== null && 'kind' in payload && 'text' in payload && 'salience' in payload && 'confidence' in payload;
}

function isRelationshipDeltaPayload(payload: RuntimeEventV2['payload']): payload is { reason: string; delta: { affinity?: number; respect?: number; hostility?: number; contempt?: number } } {
  return typeof payload === 'object' && payload !== null && 'reason' in payload && 'delta' in payload;
}

function isRoomShiftPayload(payload: RuntimeEventV2['payload']): payload is { heat?: number; cohesion?: number; topicDrift?: number; delta?: { heat?: number; cohesion?: number; topicDrift?: number } } {
  return typeof payload === 'object' && payload !== null && ('heat' in payload || 'cohesion' in payload || 'topicDrift' in payload || 'delta' in payload);
}

function buildEventMeta(event: RuntimeEventV2) {
  return {
    memoryCandidate: event.kind === 'memory_candidate' && isMemoryCandidatePayload(event.payload) ? event.payload : undefined,
    relationshipDelta: event.kind === 'relationship_delta' && isRelationshipDeltaPayload(event.payload) ? event.payload : undefined,
    roomShift: event.kind === 'room_shift' && isRoomShiftPayload(event.payload) ? event.payload : undefined,
  };
}

void buildEventMeta;
void isRoomShiftPayload;
void isRelationshipDeltaPayload;
void isMemoryCandidatePayload;

export interface ProjectedRuntimeState {
  worldState: GroupChat['worldState'];
  runtimeTimeline: ProjectedRuntimeTimelineItem[];
  runtimeSeed: { notes: string[]; artifacts: string[] };
  runtimeEventsV2: RuntimeEventV2[];
  relationshipLedger: NonNullable<GroupChat['relationshipLedger']>;
  primaryRecentEvent: string;
  latestEvent: RuntimeEventV2 | null;
  timelineCount: number;
}

function mapRuntimeEventKindToTimelineType(kind: RuntimeEventKind): 'note' | 'artifact' | 'relationship' {
  if (kind === 'interaction' || kind === 'relationship_delta') return 'relationship';
  if (kind === 'artifact') return 'artifact';
  return 'note';
}

function formatRuntimeEventLabel(kind: RuntimeEventKind) {
  const labels: Record<RuntimeEventKind, string> = {
    message_generated: '消息生成',
    interaction: '互动',
    relationship_delta: '关系变化',
    room_shift: '房间态势',
    memory_candidate: '记忆候选',
    artifact: '产物',
  };
  return labels[kind] || kind;
}

function formatMemoryCandidateKind(kind: MemoryCandidatePayload['kind']) {
  const labels: Record<MemoryCandidatePayload['kind'], string> = {
    fact: '事实',
    topic: '话题',
    preference: '偏好',
    secret: '秘密',
    relationship: '关系',
  };
  return labels[kind] || kind;
}

function formatRelationshipReason(reason: string) {
  const labels: Record<string, string> = {
    support: '支持',
    defend: '维护',
    challenge: '挑战',
    mock: '嘲讽',
    dismiss: '轻视',
    pile_on: '围攻',
  };
  return labels[reason] || reason;
}

void formatRelationshipReason;
void formatMemoryCandidateKind;

function projectRuntimeTimelineItems(events: RuntimeEventV2[], legacyTimeline: NonNullable<GroupChat['runtimeTimeline']>) {
  if (events.length) {
    return events.map<ProjectedRuntimeTimelineItem>((event) => ({
      type: mapRuntimeEventKindToTimelineType(event.kind),
      text: event.summary,
      createdAt: event.createdAt,
      label: formatRuntimeEventLabel(event.kind),
      event,
      meta: (() => {
        const baseMeta = buildEventMeta(event);
        return {
          memoryCandidate: baseMeta.memoryCandidate
            ? {
                ...baseMeta.memoryCandidate,
                kind: formatMemoryCandidateKind(baseMeta.memoryCandidate.kind) as MemoryCandidatePayload['kind'],
              }
            : undefined,
          relationshipDelta: baseMeta.relationshipDelta
            ? {
                reason: formatRelationshipReason(baseMeta.relationshipDelta.reason),
                delta: baseMeta.relationshipDelta.delta || {},
              }
            : undefined,
          roomShift: baseMeta.roomShift,
        };
      })(),
    }));
  }

  return legacyTimeline.map<ProjectedRuntimeTimelineItem>((item) => ({
    type: item.type,
    text: item.text,
    createdAt: item.createdAt,
    label: item.type,
    event: null,
  }));
}

function latestStructuredEvent(events: RuntimeEventV2[]) {
  return events.length ? events[events.length - 1] : null;
}

function summarizePrimaryRecentEvent(chat: GroupChat) {
  const room = chat.worldState.structuredRoomState;
  return room ? `热度 ${room.heat} / 凝聚 ${room.cohesion}` : chat.worldState.recentEvent;
}

function countProjectedTimeline(chat: GroupChat) {
  return chat.runtimeEventsV2?.length || chat.runtimeTimeline?.length || 0;
}

export function projectRuntimeTimeline(chat: GroupChat) {
  return projectRuntimeTimelineItems(chat.runtimeEventsV2 || [], chat.runtimeTimeline || []);
}

export function projectPrimaryRecentEvent(chat: GroupChat) {
  return summarizePrimaryRecentEvent(chat);
}

export function projectLatestRuntimeEvent(chat: GroupChat) {
  return latestStructuredEvent(chat.runtimeEventsV2 || []);
}

export function projectTimelineCount(chat: GroupChat) {
  return countProjectedTimeline(chat);
}

function buildProjectedParticipants(chat: GroupChat, context: SessionProjectionContext) {
  return buildRolePrivateParticipantStates(chat, context.participants);
}

function buildPrivatePanelPayloads(chat: GroupChat, context: SessionProjectionContext) {
  const scopedPayloads = buildRolePrivatePayloads(chat)
    .filter((payload) => canProjectScope({
      scope: payload.visibilityScope,
      visibleToIds: payload.visibleToIds,
      visibleToRoles: payload.visibleToRoles,
    }, { viewerId: context.viewerId, viewerRole: context.viewerRole }))
    .map((payload) => ({ key: payload.key, title: payload.title, text: payload.text }));
  const participantPayloads = projectPrivateParticipantPayloads(buildProjectedParticipants(chat, context), context.viewerRole);
  return [...scopedPayloads, ...participantPayloads];
}

export function projectPrivatePayloads(chat: GroupChat, context: SessionProjectionContext) {
  return buildPrivatePanelPayloads(chat, context);
}

function buildVisiblePanels(engine: SessionEngineDefinition, context: SessionProjectionContext) {
  const privatePayloads = buildPrivatePanelPayloads(context.conversation, context);
  const visiblePanels = engine.getVisiblePanels(context).filter((panel) => panel.type !== 'custom' || context.viewerRole !== 'viewer');
  return privatePayloads.length ? [...visiblePanels, { key: 'private_payloads', title: '私有信息', type: 'custom' as const }] : visiblePanels;
}

function buildProjectedRuntimeState(chat: GroupChat, context: SessionProjectionContext): ProjectedRuntimeState {
  const canSeePrivate = chat.type === 'group' || context.viewerRole === 'pair_private' || context.viewerRole === 'user_private' || !context.viewerRole;
  const runtimeEventsV2 = canSeePrivate ? (chat.runtimeEventsV2 || []) : [];
  return {
    worldState: {
      ...chat.worldState,
      recentEvent: projectSessionRecentEvent(chat, context.viewerRole),
    },
    runtimeTimeline: canSeePrivate ? projectRuntimeTimeline(chat) : [],
    runtimeSeed: {
      notes: canSeePrivate ? (chat.runtimeSeed?.notes || []) : [],
      artifacts: canSeePrivate ? (chat.runtimeSeed?.artifacts || []) : [],
    },
    runtimeEventsV2,
    relationshipLedger: canSeePrivate ? (chat.relationshipLedger || []) : [],
    primaryRecentEvent: projectPrimaryRecentEvent(chat),
    latestEvent: canSeePrivate ? projectLatestRuntimeEvent(chat) : null,
    timelineCount: canSeePrivate ? projectTimelineCount(chat) : 0,
  };
}

export function projectRuntimeState(chat: GroupChat, context: SessionProjectionContext) {
  return buildProjectedRuntimeState(chat, context);
}

export function projectSessionView(engine: SessionEngineDefinition, context: SessionProjectionContext): SessionViewProjection {
  const visiblePanels = buildVisiblePanels(engine, context);
  const actionSchema = projectActionSchema(engine, context);
  const availableActions = actionSchema ? actionSchema.actions.map((action) => ({ type: action.type })) : engine.getAvailableActions(context);
  return {
    visiblePanels,
    availableActions,
  };
}

function filterActionsByVisibility(actions: SessionActionDefinition[], context: SessionProjectionContext) {
  return actions.filter((action) => {
    const visibility = action.visibility || (context.conversationType === 'ai_direct' ? 'pair_private' : context.conversationType === 'direct' ? 'pair_private' : 'public');
    return canProjectScope({
      scope: visibility,
      visibleToIds: action.targetIds,
      visibleToRoles: visibility === 'moderator_only' ? ['moderator', 'interviewer'] : visibility === 'pair_private' ? ['pair_private', 'user_private', 'participant'] : undefined,
    }, { viewerId: context.viewerId, viewerRole: context.viewerRole });
  });
}

export function projectActionSchema(engine: SessionEngineDefinition, context: SessionProjectionContext) {
  const schema = engine.getActionSchema?.({ conversation: context.conversation, participants: context.participants }) || null;
  if (!schema) return null;
  return {
    ...schema,
    actions: filterActionsByVisibility(schema.actions, context),
  };
}

export function createViewerRoleForConversation(conversation: GroupChat, viewerId?: string | null) {
  if (!viewerId) return null;
  if (conversation.mode === 'interview' && conversation.memberIds[0] === viewerId) return 'interviewer';
  if (conversation.mode === 'werewolf') {
    const seatIndex = conversation.memberIds.indexOf(viewerId);
    if (seatIndex === 0 && conversation.memberIds.length >= 4) return 'seer';
    if (seatIndex >= 0 && seatIndex >= conversation.memberIds.length - Math.max(1, Math.floor(conversation.memberIds.length / 4))) return 'werewolf';
    if (seatIndex >= 0) return 'villager';
  }
  if (conversation.type === 'direct') return 'user_private';
  if (conversation.type === 'ai_direct') return 'pair_private';
  if (conversation.memberIds.includes(viewerId)) return 'participant';
  return 'viewer';
}

export function createProjectionContext(conversation: GroupChat, participants: SessionProjectionContext['participants'], viewerId?: string | null, viewerRole?: string | null): SessionProjectionContext {
  return {
    conversation,
    participants,
    viewerId,
    viewerRole: viewerRole || createViewerRoleForConversation(conversation, viewerId),
    conversationType: conversation.type,
  };
}
