import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { SessionEngineDefinition, SessionGenerationContext, SessionGenerationPromptContext, SessionTurnPlan } from '../types/sessionEngine';
import { getCurrentSessionPhase } from './sessionStateMachine';
import { resolveSessionDefinition } from '../types/sessionEngine';

export interface ScenarioRuntimeDecision {
  scenarioId: string;
  family: string;
  phaseKey: string;
  allowedActions: string[];
  canSpeak: boolean;
  preferredChannelId: string;
  turnPlan: SessionTurnPlan;
}

function latestVisibleMessage(messages: Message[]) {
  return messages.filter((message) => !message.isDeleted && message.type !== 'system' && message.type !== 'event').at(-1) || null;
}

function resolvePreferredChannelId(chat: GroupChat) {
  const publicChannel = chat.channels?.find((channel) => channel.visibility === 'public');
  return publicChannel?.channelId || 'public';
}

function deriveMoveClass(scenarioId: string, family: string, phaseKey: string): SessionTurnPlan['moveClass'] {
  if (scenarioId === 'group-discussion' || scenarioId === 'roundtable-discussion') return phaseKey === 'synthesis' ? 'resolve' : 'deepen';
  if (scenarioId === 'panel-interview' || scenarioId === 'ielts-coach') return 'respond';
  if (scenarioId === 'werewolf-classic' || family === 'deduction' || family === 'mystery') return 'perform';
  if (family === 'conversation') return 'advance';
  if (family === 'analysis') return 'deepen';
  if (family === 'study' || family === 'interview') return 'respond';
  return 'advance';
}

function deriveTargetScope(chat: GroupChat, family: string): SessionTurnPlan['targetScope'] {
  if (chat.type === 'direct' || chat.type === 'ai_direct') return 'person';
  if (family === 'analysis' || family === 'study' || family === 'interview') return 'topic';
  if (family === 'deduction' || family === 'mystery' || family === 'simulation') return 'scene';
  return 'room';
}

function deriveDepth(family: string, scenarioId: string): SessionTurnPlan['depth'] {
  if (family === 'analysis' || family === 'study' || family === 'interview') return 'deep';
  if (scenarioId === 'group-discussion' || scenarioId === 'roundtable-discussion') return 'normal';
  return 'normal';
}

export function buildScenarioRuntimeDecision(context: SessionGenerationContext & {
  speaker: AICharacter;
  promptContext?: SessionGenerationPromptContext | null;
  sessionEngine?: SessionEngineDefinition | null;
}): ScenarioRuntimeDecision {
  const phase = context.sessionEngine
    ? getCurrentSessionPhase(context.sessionEngine, context.conversation)
    : { key: 'default', label: 'Default', allowedActions: ['speak'] };
  const session = resolveSessionDefinition(context.conversation);
  const latest = latestVisibleMessage(context.messages);
  const preferredChannelId = resolvePreferredChannelId(context.conversation);
  const canSpeak = phase.allowedActions.includes('speak') || phase.allowedActions.includes('all');
  const turnPlan: SessionTurnPlan = {
    speakerId: context.speaker.id,
    obligation: latest?.type === 'user' || latest?.type === 'god' ? 'should' : 'can',
    moveClass: deriveMoveClass(session.kind.scenarioId, session.kind.family, phase.key),
    targetScope: deriveTargetScope(context.conversation, session.kind.family),
    targetIds: latest?.senderId && latest.senderId !== context.speaker.id ? [latest.senderId] : [],
    depth: deriveDepth(session.kind.family, session.kind.scenarioId),
    channelId: preferredChannelId,
    reason: `${session.kind.scenarioId}:${phase.key}`,
  };
  return {
    scenarioId: session.kind.scenarioId,
    family: session.kind.family,
    phaseKey: phase.key,
    allowedActions: phase.allowedActions,
    canSpeak,
    preferredChannelId,
    turnPlan,
  };
}
