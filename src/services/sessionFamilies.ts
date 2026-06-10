import type { GroupChat } from '../types/chat';
import type { SessionFamily, SessionRuntimeLoopDecision, SessionTurnPolicy } from '../types/sessionEngine';
import { createSessionRuntimeContext } from './sessionEngineKernel';
import { resolveSessionEngine, resolveSessionFamilyKey } from './sessionEngineRegistry';
import { getAllowedSessionActions } from './sessionActionBus';
import { getCurrentSessionPhase } from './sessionStateMachine';

export function getSessionFamily(chat: Pick<GroupChat, 'sessionKind' | 'type' | 'mode'>): SessionFamily {
  return resolveSessionFamilyKey(chat);
}

export function isSpeakAllowed(chat: GroupChat) {
  const engine = resolveSessionEngine(chat);
  const context = createSessionRuntimeContext(engine, chat);
  const phase = getCurrentSessionPhase(engine, chat);
  const actions = getAllowedSessionActions(engine, context);
  return phase.allowedActions.includes('send_message')
    || phase.allowedActions.includes('speak')
    || phase.allowedActions.includes('all')
    || actions.some((action) => action.type === 'send_message' || action.type === 'speak');
}

export function canAttemptNonChatAction(chat: GroupChat) {
  const engine = resolveSessionEngine(chat);
  const context = createSessionRuntimeContext(engine, chat);
  return getAllowedSessionActions(engine, context).some((action) => action.type !== 'send_message' && action.type !== 'speak');
}

export function createFamilyTurnPolicy(chat: GroupChat): SessionTurnPolicy {
  const canSpeak = isSpeakAllowed(chat);
  const canAct = canAttemptNonChatAction(chat);
  const family = getSessionFamily(chat);
  if (family === 'interview') return { runChat: canSpeak, runAction: canAct, interleaveAction: canAct };
  if (family === 'deduction' || family === 'mystery') return { runChat: canSpeak, runAction: canAct, interleaveAction: true };
  if (family === 'board_game') return { runChat: canSpeak, runAction: true, interleaveAction: true };
  if (family === 'study' || family === 'analysis' || family === 'agent' || family === 'simulation') {
    return { runChat: canSpeak, runAction: canAct, interleaveAction: canAct };
  }
  return { runChat: canSpeak, runAction: canAct, interleaveAction: canSpeak && canAct };
}

export function deriveFamilyLoopDecision(policy: SessionTurnPolicy): SessionRuntimeLoopDecision {
  return {
    canRun: Boolean(policy.runChat || policy.runAction),
    runAction: Boolean(policy.runAction),
    runChat: Boolean(policy.runChat),
    actionFirst: Boolean(policy.interleaveAction && policy.runAction),
  };
}

export function getFamilyActionChance(chat: Pick<GroupChat, 'sessionKind' | 'type' | 'mode'>) {
  const family = getSessionFamily(chat);
  if (family === 'board_game') return 0.22;
  if (family === 'interview') return 1;
  if (family === 'deduction' || family === 'mystery') return 0.16;
  if (family === 'study') return 0.12;
  if (family === 'analysis' || family === 'simulation') return 0.1;
  if (family === 'agent') return 0.2;
  return 0.08;
}
