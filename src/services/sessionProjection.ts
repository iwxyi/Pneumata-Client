import type { GroupChat } from '../types/chat';
import type { SessionActionDefinition, SessionEngineDefinition, SessionProjectionContext, SessionViewProjection } from '../types/sessionEngine';
import { canProjectScope } from '../types/sessionVisibility';
import { projectSessionRecentEvent } from './directSessionHelpers';
import { buildRolePrivateParticipantStates, buildRolePrivatePayloads, projectPrivateParticipantPayloads } from './privateRuntimePayloads';

function buildProjectedParticipants(chat: GroupChat, context: SessionProjectionContext) {
  return buildRolePrivateParticipantStates(chat, context.participants);
}

function buildPrivatePanelPayloads(chat: GroupChat, context: SessionProjectionContext) {
  const scopedPayloads = buildRolePrivatePayloads(chat).filter((payload) => canProjectScope({
    scope: payload.visibilityScope,
    visibleToIds: payload.visibleToIds,
    visibleToRoles: payload.visibleToRoles,
  }, { viewerId: context.viewerId, viewerRole: context.viewerRole })).map((payload) => ({ key: payload.key, title: payload.title, text: payload.text }));
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

function buildProjectedRuntimeState(chat: GroupChat, context: SessionProjectionContext) {
  const canSeePrivate = chat.type === 'group' || context.viewerRole === 'pair_private' || context.viewerRole === 'user_private' || !context.viewerRole;
  return {
    worldState: {
      ...chat.worldState,
      recentEvent: projectSessionRecentEvent(chat, context.viewerRole),
    },
    runtimeTimeline: canSeePrivate ? (chat.runtimeTimeline || []) : [],
    runtimeNotes: canSeePrivate ? (chat.runtimeNotes || []) : [],
    runtimeArtifacts: canSeePrivate ? (chat.runtimeArtifacts || []) : [],
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
