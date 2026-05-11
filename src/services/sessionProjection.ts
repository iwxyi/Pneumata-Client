import type { AICharacter } from '../types/character';
import type { GroupChat, ParticipantInstance, RuntimePanelDefinition, SessionSurfaceProjection } from '../types/chat';
import type { MemoryCandidatePayload, RuntimeEventKind, RuntimeEventV2, SocialEventCandidatePayload, SocialEventEffectPayload, RelationshipAxisReason } from '../types/runtimeEvent';
import type { SessionActionDefinition, SessionActionSchema, SessionEngineDefinition, SessionProjectionContext, SessionViewProjection } from '../types/sessionEngine';
import { buildDefaultSessionSurfaceProjection, resolveSessionDefinitionForConversation } from '../types/chat';
import { buildSessionSurfaceProjectionFromSchema } from '../types/sessionEngine';
import { canProjectScope } from '../types/sessionVisibility';
import { projectSessionRecentEvent } from './directSessionHelpers';
import { buildRolePrivateParticipantStates, buildRolePrivatePayloads, projectPrivateParticipantPayloads } from './privateRuntimePayloads';

export interface ProjectedRuntimeTimelineItem {
  type: 'note' | 'artifact' | 'relationship';
  text: string;
  createdAt: number;
  label: string;
  event?: RuntimeEventV2 | null;
  actorNames?: string[];
  targetNames?: string[];
  meta?: {
    memoryCandidate?: MemoryCandidatePayload;
    socialEventCandidate?: SocialEventCandidatePayload;
    socialEventArtifact?: {
      eventKind?: string;
      artifactType?: string;
      title?: string;
      activityType?: string;
      dedupeKey?: string | null;
      participantIds?: string[];
      targetIds?: string[];
      expectedArtifacts?: string[];
      timeHint?: string | null;
      locationHint?: string | null;
      candidateId?: string;
      reasonType?: string;
    };
    socialEventEffect?: SocialEventEffectPayload;
    socialEventCluster?: {
      eventKind?: string;
      dedupeKey?: string | null;
      candidateId?: string | null;
      stage: 'candidate' | 'artifact' | 'effect' | 'opened';
    };
    relationshipDelta?: {
      reason: string;
      delta: { warmth?: number; competence?: number; trust?: number; threat?: number };
      axisReasons?: Partial<Record<'warmth' | 'competence' | 'trust' | 'threat', RelationshipAxisReason[]>>;
      spikeType?: 'normal' | 'turning_point' | 'rupture' | 'bonding';
    };
    roomShift?: {
      heat?: number;
      cohesion?: number;
      topicDrift?: number;
      delta?: { heat?: number; cohesion?: number; topicDrift?: number };
    };
  };
}

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

export interface ProjectedSessionFrameworkState {
  definition: ReturnType<typeof resolveSessionDefinitionForConversation>;
  surfaces: SessionSurfaceProjection;
  familyLabel: string;
  scenarioLabel: string;
  topologyLabel: string;
}

export interface ProjectedSidebarChat {
  chat: GroupChat & { primaryRecentEvent?: string };
  privatePayloads: Array<{ key: string; title: string; text: string }>;
}

export interface ProjectedChatDetailState {
  memberPanel?: RuntimePanelDefinition;
  runtimePanel?: RuntimePanelDefinition;
  showMemberTab: boolean;
  showRuntimeTab: boolean;
  showActionTab: boolean;
  activeSidebarTab: string;
  sidebarTitle: string;
  memberTabTitle: string;
  runtimeTabTitle: string;
  sidebarChat: ProjectedSidebarChat;
  actionPanel: { title: string; actions: SessionActionDefinition[] };
  composerSurfaces: SessionSurfaceProjection['surfaces'];
  compactCharacterMemorySummary?: string;
  speakAsSummary?: string | null;
}

function isSocialEventArtifactPayload(payload: RuntimeEventV2['payload']): payload is { eventKind?: string; artifactType?: string; title?: string; activityType?: string; dedupeKey?: string | null; participantIds?: string[]; targetIds?: string[]; expectedArtifacts?: string[]; timeHint?: string | null; locationHint?: string | null; candidateId?: string; reasonType?: string } {
  return typeof payload === 'object' && payload !== null && ('eventKind' in payload || 'artifactType' in payload);
}

function isMemoryCandidatePayload(payload: RuntimeEventV2['payload']): payload is MemoryCandidatePayload {
  return typeof payload === 'object' && payload !== null && 'kind' in payload && 'text' in payload && 'salience' in payload && 'confidence' in payload;
}

function isRelationshipDeltaPayload(payload: RuntimeEventV2['payload']): payload is { reason: string; delta: { warmth?: number; competence?: number; trust?: number; threat?: number }; axisReasons?: Partial<Record<'warmth' | 'competence' | 'trust' | 'threat', RelationshipAxisReason[]>>; spikeType?: 'normal' | 'turning_point' | 'rupture' | 'bonding' } {
  return typeof payload === 'object' && payload !== null && 'reason' in payload && 'delta' in payload;
}

function isSocialEventCandidatePayload(payload: RuntimeEventV2['payload']): payload is SocialEventCandidatePayload {
  return typeof payload === 'object' && payload !== null && 'eventKind' in payload && 'initiatorId' in payload && 'participantIds' in payload && 'seedIntent' in payload;
}

function isRoomShiftPayload(payload: RuntimeEventV2['payload']): payload is { heat?: number; cohesion?: number; topicDrift?: number; delta?: { heat?: number; cohesion?: number; topicDrift?: number } } {
  return typeof payload === 'object' && payload !== null && ('heat' in payload || 'cohesion' in payload || 'topicDrift' in payload || 'delta' in payload);
}

function isSocialEventEffectPayload(payload: RuntimeEventV2['payload']): payload is SocialEventEffectPayload {
  return typeof payload === 'object' && payload !== null && 'eventKind' in payload && 'effectType' in payload && 'summary' in payload && 'confidence' in payload;
}

function buildSocialEventCluster(event: RuntimeEventV2) {
  if (event.kind === 'event_candidate' && isSocialEventCandidatePayload(event.payload)) return { eventKind: event.payload.eventKind, dedupeKey: event.payload.dedupeKey ?? null, stage: 'candidate' as const };
  if (event.kind === 'artifact' && isSocialEventArtifactPayload(event.payload)) return { eventKind: event.payload.eventKind, dedupeKey: event.payload.dedupeKey ?? null, candidateId: event.payload.candidateId ?? null, stage: event.payload.artifactType === 'private_thread_opened' ? 'opened' as const : 'artifact' as const };
  if (isSocialEventEffectPayload(event.payload)) return { eventKind: event.payload.eventKind, dedupeKey: null, stage: 'effect' as const };
  return undefined;
}

function buildEventMeta(event: RuntimeEventV2) {
  return {
    memoryCandidate: event.kind === 'memory_candidate' && isMemoryCandidatePayload(event.payload) ? event.payload : undefined,
    socialEventCandidate: event.kind === 'event_candidate' && isSocialEventCandidatePayload(event.payload) ? event.payload : undefined,
    socialEventArtifact: event.kind === 'artifact' && isSocialEventArtifactPayload(event.payload) ? event.payload : undefined,
    socialEventEffect: isSocialEventEffectPayload(event.payload) ? event.payload : undefined,
    socialEventCluster: buildSocialEventCluster(event),
    relationshipDelta: event.kind === 'relationship_delta' && isRelationshipDeltaPayload(event.payload) ? event.payload : undefined,
    roomShift: event.kind === 'room_shift' && isRoomShiftPayload(event.payload) ? event.payload : undefined,
  };
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
    event_candidate: '事件候选',
    phase_transition: '阶段切换',
    action_resolution: '动作结算',
    board_state: '棋盘状态',
    score_update: '分数更新',
  };
  return labels[kind] || kind;
}

function formatMemoryCandidateKind(kind: MemoryCandidatePayload['kind']) {
  const labels: Record<MemoryCandidatePayload['kind'], string> = { fact: '事实', topic: '话题', preference: '偏好', secret: '秘密', relationship: '关系' };
  return labels[kind] || kind;
}

function formatRelationshipReason(reason: string) {
  const labels: Record<string, string> = { support: '支持', defend: '维护', challenge: '挑战', mock: '嘲讽', dismiss: '轻视', pile_on: '围攻', probe: '追问' };
  return labels[reason] || reason;
}

function buildParticipantNameMap(participants: Array<AICharacter | ParticipantInstance>) {
  return new Map(participants.map((participant) => ('participantId' in participant ? [participant.participantId, participant.displayName || participant.entityRefId] : [participant.id, participant.name])));
}

function resolveActorTargetNames(ids: string[] | undefined, participantNameMap: Map<string, string>) {
  return (ids || []).map((id) => participantNameMap.get(id) || id);
}

function replaceIdsWithNames(text: string, participantNameMap: Map<string, string>) {
  let result = text;
  participantNameMap.forEach((name, id) => {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escapedId, 'g'), name);
  });
  return result;
}

function projectRuntimeTimelineItems(events: RuntimeEventV2[], legacyTimeline: NonNullable<GroupChat['runtimeTimeline']>, participants: Array<AICharacter | ParticipantInstance> = []) {
  const participantNameMap = buildParticipantNameMap(participants);
  if (events.length) {
    return events.map<ProjectedRuntimeTimelineItem>((event) => ({
      type: mapRuntimeEventKindToTimelineType(event.kind),
      text: replaceIdsWithNames(event.summary, participantNameMap),
      createdAt: event.createdAt,
      label: formatRuntimeEventLabel(event.kind),
      event,
      actorNames: resolveActorTargetNames(event.actorIds, participantNameMap),
      targetNames: resolveActorTargetNames(event.targetIds, participantNameMap),
      meta: (() => {
        const baseMeta = buildEventMeta(event);
        return {
          memoryCandidate: baseMeta.memoryCandidate ? { ...baseMeta.memoryCandidate, kind: formatMemoryCandidateKind(baseMeta.memoryCandidate.kind) as MemoryCandidatePayload['kind'], text: replaceIdsWithNames(baseMeta.memoryCandidate.text, participantNameMap) } : undefined,
          socialEventCandidate: baseMeta.socialEventCandidate,
          socialEventArtifact: baseMeta.socialEventArtifact,
          socialEventEffect: baseMeta.socialEventEffect ? { ...baseMeta.socialEventEffect, summary: replaceIdsWithNames(baseMeta.socialEventEffect.summary, participantNameMap) } : undefined,
          socialEventCluster: baseMeta.socialEventCluster,
          relationshipDelta: baseMeta.relationshipDelta ? { reason: formatRelationshipReason(baseMeta.relationshipDelta.reason), delta: baseMeta.relationshipDelta.delta || {}, axisReasons: baseMeta.relationshipDelta.axisReasons || {}, spikeType: baseMeta.relationshipDelta.spikeType } : undefined,
          roomShift: baseMeta.roomShift,
        };
      })(),
    }));
  }

  return legacyTimeline.map<ProjectedRuntimeTimelineItem>((item) => ({ type: item.type, text: replaceIdsWithNames(item.text, participantNameMap), createdAt: item.createdAt, label: item.type, event: null, actorNames: [], targetNames: [] }));
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

export function projectRuntimeTimeline(chat: GroupChat, participants: Array<AICharacter | ParticipantInstance> = []) {
  return projectRuntimeTimelineItems(chat.runtimeEventsV2 || [], chat.runtimeTimeline || [], participants);
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

export function projectSessionFrameworkState(chat: GroupChat, actionSchema: SessionActionSchema | null = null): ProjectedSessionFrameworkState {
  const definition = resolveSessionDefinitionForConversation(chat);
  return {
    definition,
    surfaces: actionSchema ? buildSessionSurfaceProjectionFromSchema(chat, actionSchema) : buildDefaultSessionSurfaceProjection(chat),
    familyLabel: definition.kind.family,
    scenarioLabel: definition.scenario.label,
    topologyLabel: definition.kind.topology,
  };
}

function buildProjectedParticipants(chat: GroupChat, context: SessionProjectionContext) {
  return buildRolePrivateParticipantStates(chat, context.participants);
}

function buildPrivatePanelPayloads(chat: GroupChat, context: SessionProjectionContext) {
  const scopedPayloads = buildRolePrivatePayloads(chat)
    .filter((payload) => canProjectScope({ scope: payload.visibilityScope, visibleToIds: payload.visibleToIds, visibleToRoles: payload.visibleToRoles }, { viewerId: context.viewerId, viewerRole: context.viewerRole }))
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

function filterVisibleRuntimeEvents(events: RuntimeEventV2[], context: SessionProjectionContext) {
  return events.filter((event) => canProjectScope({ scope: event.visibility || 'public', visibleToIds: event.visibleToIds, visibleToRoles: event.visibleToRoles }, { viewerId: context.viewerId, viewerRole: context.viewerRole }));
}

function buildProjectedRuntimeState(chat: GroupChat, context: SessionProjectionContext): ProjectedRuntimeState {
  const canSeePrivate = chat.type === 'group' || context.viewerRole === 'pair_private' || context.viewerRole === 'user_private' || !context.viewerRole;
  const runtimeEventsV2 = filterVisibleRuntimeEvents(chat.runtimeEventsV2 || [], context);
  const runtimeTimeline = projectRuntimeTimelineItems(runtimeEventsV2, chat.runtimeTimeline || [], context.participants);
  return {
    worldState: { ...chat.worldState, recentEvent: projectSessionRecentEvent(chat, context.viewerRole) },
    runtimeTimeline,
    runtimeSeed: { notes: canSeePrivate ? (chat.runtimeSeed?.notes || []) : [], artifacts: canSeePrivate ? (chat.runtimeSeed?.artifacts || []) : [] },
    runtimeEventsV2,
    relationshipLedger: canSeePrivate ? [...(chat.relationshipLedger || [])] : [],
    primaryRecentEvent: projectPrimaryRecentEvent(chat),
    latestEvent: runtimeEventsV2.length ? runtimeEventsV2[runtimeEventsV2.length - 1] : null,
    timelineCount: runtimeTimeline.length,
  };
}

export function projectRuntimeState(chat: GroupChat, context: SessionProjectionContext) {
  return buildProjectedRuntimeState(chat, context);
}

export function projectSessionView(engine: SessionEngineDefinition, context: SessionProjectionContext): SessionViewProjection {
  const visiblePanels = buildVisiblePanels(engine, context);
  const actionSchema = projectActionSchema(engine, context);
  const availableActions = actionSchema ? actionSchema.actions.map((action) => ({ type: action.type })) : engine.getAvailableActions(context);
  return { visiblePanels, availableActions };
}

function filterActionsByVisibility(actions: SessionActionDefinition[], context: SessionProjectionContext) {
  return actions.filter((action) => {
    const visibility = action.visibility || (context.conversationType === 'ai_direct' ? 'pair_private' : context.conversationType === 'direct' ? 'pair_private' : 'public');
    return canProjectScope({ scope: visibility, visibleToIds: action.targetIds, visibleToRoles: visibility === 'moderator_only' ? ['moderator', 'interviewer'] : visibility === 'pair_private' ? ['pair_private', 'user_private', 'participant'] : undefined }, { viewerId: context.viewerId, viewerRole: context.viewerRole });
  });
}

export function projectActionSchema(engine: SessionEngineDefinition, context: SessionProjectionContext) {
  const schema = engine.getActionSchema?.({ conversation: context.conversation, participants: context.participants }) || null;
  if (!schema) return null;
  return { ...schema, actions: filterActionsByVisibility(schema.actions, context) };
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
  return { conversation, participants, viewerId, viewerRole: viewerRole || createViewerRoleForConversation(conversation, viewerId), conversationType: conversation.type };
}

export function buildProjectedSidebarChat(chat: GroupChat, runtimeState: ProjectedRuntimeState | null, privatePayloads: Array<{ key: string; title: string; text: string }>): ProjectedSidebarChat {
  return {
    chat: {
      ...chat,
      worldState: runtimeState?.worldState || chat.worldState,
      runtimeTimeline: runtimeState?.runtimeTimeline || chat.runtimeTimeline,
      runtimeSeed: runtimeState?.runtimeSeed || chat.runtimeSeed,
      runtimeEventsV2: runtimeState?.runtimeEventsV2 || chat.runtimeEventsV2,
      relationshipLedger: runtimeState?.relationshipLedger?.length ? runtimeState.relationshipLedger : (chat.relationshipLedger || []),
      primaryRecentEvent: runtimeState?.primaryRecentEvent,
    },
    privatePayloads,
  };
}

export function buildProjectedActionPanel(actions: SessionActionDefinition[], title: string) {
  return { title, actions };
}

export function buildProjectedSessionActions(chat: GroupChat, actions: SessionActionDefinition[], members: AICharacter[] = []) {
  const injected = actions.find((action) => action.type === 'start_private_thread');
  if (chat.type !== 'group') return actions;
  if (injected?.fields?.length) {
    return [injected, ...actions.filter((action) => action !== injected && action.type !== 'start_private_thread')];
  }
  return [{
    type: 'start_private_thread',
    label: '发起 AI 私聊',
    description: '从群聊中手动选择两名成员，派生一条独立 AI 私聊。',
    fields: [
      { key: 'actorId', label: '发起者', type: 'single_select', required: true, options: members.map((member) => ({ value: member.id, label: member.name })) },
      { key: 'targetId', label: '对象', type: 'single_select', required: true, options: members.map((member) => ({ value: member.id, label: member.name })) },
    ],
    visibility: 'public' as const,
  }, ...actions.filter((action) => action.type !== 'start_private_thread')];
}

export function buildProjectedActionPanelTitle(chat: GroupChat, schemaTitle?: string) {
  return chat.type === 'group' ? '动作与派生' : schemaTitle;
}

export function buildProjectedComposerSurfaces(chat: GroupChat, frameworkState: ProjectedSessionFrameworkState) {
  return frameworkState.surfaces.surfaces.length ? frameworkState.surfaces.surfaces : buildDefaultSessionSurfaceProjection(chat).surfaces;
}

export function buildProjectedCompactMemorySummary(speakAsChar?: { layeredMemories?: Array<{ text: string }> } | null) {
  return speakAsChar?.layeredMemories?.slice(-2).map((item) => item.text).join(' / ');
}

export function buildProjectedSpeakAsSummary(speakAsChar?: { name?: string; layeredMemories?: Array<{ text: string }> } | null) {
  if (!speakAsChar) return null;
  const summary = buildProjectedCompactMemorySummary(speakAsChar);
  return summary ? `${speakAsChar.name}：${summary}` : null;
}

export function buildProjectedChatDetailState(params: {
  chat: GroupChat;
  runtimeState: ProjectedRuntimeState | null;
  privatePayloads: Array<{ key: string; title: string; text: string }>;
  visiblePanels: RuntimePanelDefinition[];
  schemaActions: SessionActionDefinition[] | undefined;
  schemaTitle?: string;
  rightPanelTab: string;
  frameworkState: ProjectedSessionFrameworkState;
  speakAsChar?: { name?: string; layeredMemories?: Array<{ text: string }> } | null;
}): ProjectedChatDetailState {
  const memberPanel = params.visiblePanels.find((panel) => panel.tabKey === 'members');
  const runtimePanel = params.visiblePanels.find((panel) => panel.tabKey === 'world');
  const showMemberTab = Boolean(memberPanel);
  const showRuntimeTab = Boolean(runtimePanel);
  const actionList = params.schemaActions || [];
  const showActionTab = params.chat.type === 'group' || Boolean(actionList.length);
  const activeSidebarTab = (showMemberTab && params.rightPanelTab === 'members') ? 'members' : (showRuntimeTab && params.rightPanelTab === 'world') ? 'world' : showActionTab ? 'actions' : 'world';
  return {
    memberPanel,
    runtimePanel,
    showMemberTab,
    showRuntimeTab,
    showActionTab,
    activeSidebarTab,
    sidebarTitle: activeSidebarTab === 'members' ? (memberPanel?.title || (params.chat.type === 'group' ? '成员' : params.chat.type === 'ai_direct' ? 'AI私聊信息' : '单聊信息')) : activeSidebarTab === 'actions' ? '动作' : (runtimePanel?.title || '状态'),
    memberTabTitle: memberPanel?.title || (params.chat.type === 'group' ? '成员' : '角色'),
    runtimeTabTitle: runtimePanel?.title || '状态',
    sidebarChat: buildProjectedSidebarChat(params.chat, params.runtimeState, params.privatePayloads),
    actionPanel: buildProjectedActionPanel(buildProjectedSessionActions(params.chat, actionList, params.chat.members || []), buildProjectedActionPanelTitle(params.chat, params.schemaTitle) || '动作'),
    composerSurfaces: buildProjectedComposerSurfaces(params.chat, params.frameworkState),
    compactCharacterMemorySummary: buildProjectedCompactMemorySummary(params.speakAsChar),
    speakAsSummary: buildProjectedSpeakAsSummary(params.speakAsChar),
  };
}
