import type { GroupChat } from '../types/chat';
import type { SessionFamily } from '../types/sessionEngine';
import { getSessionScenarioResolution } from '../types/sessionEngine';

const sessionFamilyToEngineKey = new Map<SessionFamily, GroupChat['mode']>([
  ['conversation', 'open_chat'],
  ['interview', 'interview'],
  ['deduction', 'werewolf'],
  ['mystery', 'werewolf'],
  ['study', 'classroom'],
  ['analysis', 'group_discussion'],
  ['board_game', 'board_game'],
  ['agent', 'agent_workflow'],
  ['simulation', 'open_chat'],
]);

const sessionScenarioToEngineKey = new Map<string, GroupChat['mode']>([
  ['open-chat', 'open_chat'],
  ['direct-chat', 'open_chat'],
  ['ai-private-thread', 'open_chat'],
  ['group-discussion', 'group_discussion'],
  ['roundtable-discussion', 'group_discussion'],
  ['story-reader', 'scripted_play'],
  ['ielts-coach', 'classroom'],
  ['single-agent-workflow', 'agent_workflow'],
  ['multi-agent-workflow', 'agent_workflow'],
  ['panel-interview', 'interview'],
  ['werewolf-classic', 'werewolf'],
  ['murder-mystery', 'murder_mystery'],
  ['board-game', 'board_game'],
]);

function resolveEngineKeyFromFamily(family: SessionFamily | undefined) {
  return family ? sessionFamilyToEngineKey.get(family) : undefined;
}

function resolveEngineKeyFromScenario(scenarioId: string | undefined) {
  if (!scenarioId) return undefined;
  return sessionScenarioToEngineKey.get(scenarioId) || resolveEngineKeyFromFamily(getSessionScenarioResolution(scenarioId).family);
}

export function registerSessionFamilyEngineKey(family: SessionFamily, engineKey: GroupChat['mode']) {
  sessionFamilyToEngineKey.set(family, engineKey);
}

export function registerSessionScenarioEngineKey(scenarioId: string, engineKey: GroupChat['mode']) {
  sessionScenarioToEngineKey.set(scenarioId, engineKey);
}

export function resolveSessionFamilyKey(chat: Pick<GroupChat, 'mode' | 'sessionKind'>): SessionFamily {
  const scenarioFamily = chat.sessionKind?.scenarioId
    ? getSessionScenarioResolution(chat.sessionKind.scenarioId).family
    : undefined;
  return scenarioFamily
    || chat.sessionKind?.family
    || (chat.mode === 'interview' ? 'interview'
      : chat.mode === 'werewolf' ? 'deduction'
      : chat.mode === 'murder_mystery' ? 'mystery'
      : chat.mode === 'board_game' ? 'board_game'
      : 'conversation');
}

function resolveSessionScenarioKey(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return chat.sessionKind?.scenarioId;
}

export function resolveSessionEngineKey(chat: Pick<GroupChat, 'mode' | 'sessionKind'>): GroupChat['mode'] {
  return resolveEngineKeyFromScenario(resolveSessionScenarioKey(chat))
    || resolveEngineKeyFromFamily(resolveSessionFamilyKey(chat))
    || 'open_chat';
}

export function listRegisteredSessionScenarios() {
  return Array.from(sessionScenarioToEngineKey.entries()).map(([scenarioId, engineKey]) => ({ scenarioId, engineKey }));
}
