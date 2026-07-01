import type { GroupChat } from '../types/chat';
import type { SessionActionDefinition } from '../types/sessionEngine';
import type { RoomTemplateDefinition } from './roomTemplates';

export interface ConversationCapabilityProfile {
  muteMembers: boolean;
  privateThreads: boolean;
  directorIntervention: boolean;
  speakAs: boolean;
  eventInjection: boolean;
  forcedReply: boolean;
  roleActions: boolean;
  turnOrder: boolean;
  synthesis: boolean;
}

export interface ConversationCapabilityDefaults {
  showRoleActions: boolean;
  allowMute: boolean;
  allowPrivateThreads: boolean;
  allowCliques: boolean;
  allowMockery: boolean;
  allowSpeakAs: boolean;
  allowDirectorMode: boolean;
  allowEventInjection: boolean;
  allowForcedReply: boolean;
}

type CapabilityChat = Partial<Pick<GroupChat, 'type' | 'modeConfig' | 'governance' | 'directorControls' | 'showRoleActions' | 'scenarioState' | 'sessionKind'>>;

export function resolveConversationCapabilities(chat: CapabilityChat): ConversationCapabilityProfile {
  const isGroup = chat.type === undefined || chat.type === 'group';
  const family = chat.sessionKind?.family;
  const scenarioId = chat.sessionKind?.scenarioId || '';
  const hasTurnOrder = Boolean(chat.scenarioState?.turnOrder?.length);
  const allowDirectorInterventions = chat.modeConfig?.allowDirectorInterventions !== false;
  const showRoleActions = typeof chat.showRoleActions === 'boolean'
    ? chat.showRoleActions
    : chat.modeConfig?.showRoleActions !== false;

  return {
    muteMembers: isGroup && chat.governance?.allowMute === true,
    privateThreads: isGroup && chat.governance?.allowPrivateThreads === true,
    directorIntervention: isGroup
      && allowDirectorInterventions
      && chat.directorControls?.allowDirectorMode === true,
    speakAs: chat.directorControls?.allowSpeakAs === true,
    eventInjection: allowDirectorInterventions && chat.directorControls?.allowEventInjection === true,
    forcedReply: allowDirectorInterventions && chat.directorControls?.allowForcedReply === true,
    roleActions: showRoleActions,
    turnOrder: hasTurnOrder || family === 'board_game',
    synthesis: family === 'analysis' || family === 'study' || scenarioId === 'task-retrospective',
  };
}

export function canUseMute(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).muteMembers;
}

export function canUsePrivateThreads(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).privateThreads;
}

export function canUseDirectorIntervention(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).directorIntervention;
}

export function canUseSpeakAs(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).speakAs;
}

export function canUseEventInjection(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).eventInjection;
}

export function canUseForcedReply(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).forcedReply;
}

export function canUseTurnOrder(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).turnOrder;
}

export function canUseSynthesis(chat: CapabilityChat) {
  return resolveConversationCapabilities(chat).synthesis;
}

export function resolveRoomTemplateCapabilityDefaults(
  template: Pick<RoomTemplateDefinition, 'sessionKind' | 'defaults'>,
  fallback: Pick<ConversationCapabilityDefaults, 'showRoleActions'>,
): ConversationCapabilityDefaults {
  const defaults = template.defaults || {};
  const family = template.sessionKind.family;
  const scenarioId = template.sessionKind.scenarioId;
  const isStoryReader = scenarioId === 'story-reader';
  const isConversationLike = family === 'conversation' || family === 'analysis';

  return {
    showRoleActions: isStoryReader ? false : fallback.showRoleActions,
    allowMute: true,
    allowPrivateThreads: defaults.allowPrivateThreads ?? isConversationLike,
    allowCliques: defaults.allowCliques ?? isConversationLike,
    allowMockery: defaults.allowMockery ?? family === 'conversation',
    allowSpeakAs: true,
    allowDirectorMode: true,
    allowEventInjection: true,
    allowForcedReply: true,
  };
}

const MANUAL_SESSION_ACTION_TYPES = new Set([
  'director_intervention',
  'start_private_thread',
  'mute_member',
  'unmute_member',
  'choose_story_branch',
]);

function hasPayloadValue(action: SessionActionDefinition, key: string) {
  if (key === 'actorId' && action.actorId) return true;
  if (key === 'targetId' && action.targetIds?.length) return true;
  const value = action.payload?.[key];
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

function hasUnsatisfiedRequiredFields(action: SessionActionDefinition) {
  const requiredFields = (action.fields || []).filter((field) => field.required);
  if (!requiredFields.length) return false;
  return requiredFields.some((field) => !hasPayloadValue(action, field.key));
}

export function isAutoRunnableSessionAction(action: SessionActionDefinition) {
  if (action.autoRun === true) return true;
  if (action.autoRun === false) return false;
  if (hasUnsatisfiedRequiredFields(action)) return false;
  return !MANUAL_SESSION_ACTION_TYPES.has(action.type) && action.visibility !== 'moderator_only';
}
