import type { RuntimeAction } from '../types/chat';
import type { SessionEngineDefinition, SessionProjectionContext } from '../types/sessionEngine';
import { getCurrentSessionPhase } from './sessionStateMachine';

export function getAllowedSessionActions(engine: SessionEngineDefinition, context: SessionProjectionContext): RuntimeAction[] {
  const currentPhase = getCurrentSessionPhase(engine, context.conversation);
  return engine.getAvailableActions(context).filter((action) => currentPhase.allowedActions.includes(action.type) || currentPhase.allowedActions.includes('all'));
}
