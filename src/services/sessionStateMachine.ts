import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition, SessionPhaseDefinition } from '../types/sessionEngine';

export function getSessionPhases(engine: SessionEngineDefinition, conversation: GroupChat): SessionPhaseDefinition[] {
  return engine.getPhaseDefinitions?.(conversation) || [{ key: 'default', label: 'Default', allowedActions: ['speak'] }];
}

export function getCurrentSessionPhase(engine: SessionEngineDefinition, conversation: GroupChat): SessionPhaseDefinition {
  const phases = getSessionPhases(engine, conversation);
  const scenarioPhase = typeof conversation.scenarioState?.phase === 'string' ? conversation.scenarioState.phase : '';
  const currentKey = scenarioPhase || conversation.worldState.phase || phases[0]?.key || 'default';
  return phases.find((phase) => phase.key === currentKey) || phases[0];
}
