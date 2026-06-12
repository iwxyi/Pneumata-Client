import type { GroupChat } from '../types/chat';
import type { SessionGenerationPromptContext, SessionMoveClass, SessionTargetScope } from '../types/sessionEngine';
import { getChannelSemantics } from './channelSemanticsRegistry';
import { resolveSessionDefinition } from '../types/sessionEngine';
import { resolveDefaultStyleProfile } from './styleProfileRegistry';
import { getGenerationSettingsRuntimeConfig } from './generationSettingsRuntime';

export interface EffectiveCapabilities {
  scenarioId: string;
  family: string;
  channelType: GroupChat['type'];
  styleProfile: string;
  replyToAddressedTarget: boolean;
  targetPriority: 'latest_human' | 'counterpart' | 'room_thread';
  memoryMode: 'user_private' | 'pair_private' | 'public_room';
  duplicateTolerance: 'relaxed' | 'balanced' | 'strict';
  roomActivity: 'focused' | 'balanced' | 'lively';
  allowMarkdown: boolean;
  preferredMoveClass: SessionMoveClass;
  preferredTargetScope: SessionTargetScope;
}

function derivePreferredMoveClass(styleProfile: string, family: string): SessionMoveClass {
  if (styleProfile === 'analytical_room') return 'deepen';
  if (styleProfile === 'discovery_room') return 'expand';
  if (styleProfile === 'companion_room') return 'stabilize';
  if (styleProfile === 'dramatic_room') return family === 'deduction' || family === 'mystery' ? 'perform' : 'advance';
  if (styleProfile === 'task_room') return 'respond';
  return family === 'conversation' ? 'advance' : 'respond';
}

function derivePreferredTargetScope(chat: GroupChat, family: string, targetPriority: EffectiveCapabilities['targetPriority']): SessionTargetScope {
  if (chat.type === 'direct' || chat.type === 'ai_direct') return 'person';
  if (targetPriority === 'room_thread') return family === 'analysis' ? 'topic' : 'room';
  return 'person';
}

export function resolveEffectiveCapabilities(chat: GroupChat, promptContext?: SessionGenerationPromptContext | null): EffectiveCapabilities {
  const session = resolveSessionDefinition(chat);
  const channel = getChannelSemantics(chat);
  const generationSettings = getGenerationSettingsRuntimeConfig();
  const styleProfile = promptContext?.styleProfile || resolveDefaultStyleProfile({
    scenarioId: chat.sessionKind?.scenarioId || session.kind.scenarioId,
    family: chat.sessionKind?.family || session.kind.family,
  });
  const duplicateTolerance = generationSettings.duplicateGuardLevel === 'strict'
    ? 'strict'
    : generationSettings.duplicateGuardLevel === 'relaxed'
      ? 'relaxed'
      : channel.duplicateTolerance;
  const roomActivity = generationSettings.groupReplyActivity;
  const allowMarkdown = promptContext?.allowMarkdown ?? generationSettings.allowMarkdownInChat;
  const preferredMoveClass = derivePreferredMoveClass(styleProfile, session.kind.family);
  const preferredTargetScope = derivePreferredTargetScope(chat, session.kind.family, channel.targetPriority);
  return {
    scenarioId: chat.sessionKind?.scenarioId || session.kind.scenarioId,
    family: chat.sessionKind?.family || session.kind.family,
    channelType: chat.type,
    styleProfile,
    replyToAddressedTarget: true,
    targetPriority: channel.targetPriority,
    memoryMode: channel.memoryMode,
    duplicateTolerance,
    roomActivity,
    allowMarkdown,
    preferredMoveClass,
    preferredTargetScope,
  };
}
