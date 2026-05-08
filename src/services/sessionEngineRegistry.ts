import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition, SessionFamily } from '../types/sessionEngine';
import { getSessionScenarioResolution } from '../types/sessionEngine';
import { openChatEngine } from './engines/openChatEngine';
import { INTERVIEW_ENGINE } from './engines/interviewEngine';
import { WEREWOLF_ENGINE } from './engines/werewolfEngine';

const sessionEngines = new Map<string, SessionEngineDefinition>([
  [openChatEngine.key, openChatEngine],
  [INTERVIEW_ENGINE.key, INTERVIEW_ENGINE],
  [WEREWOLF_ENGINE.key, WEREWOLF_ENGINE],
]);

const sessionFamilyToEngineKey = new Map<SessionFamily, GroupChat['mode']>([
  ['conversation', 'open_chat'],
  ['interview', 'interview'],
  ['deduction', 'werewolf'],
  ['mystery', 'werewolf'],
  ['study', 'interview'],
  ['analysis', 'open_chat'],
  ['board_game', 'open_chat'],
]);

const sessionScenarioToEngineKey = new Map<string, GroupChat['mode']>([
  ['open-chat', 'open_chat'],
  ['direct-chat', 'open_chat'],
  ['ai-private-thread', 'open_chat'],
  ['panel-interview', 'interview'],
  ['werewolf-classic', 'werewolf'],
  ['murder-mystery', 'werewolf'],
  ['board-game', 'open_chat'],
]);

function resolveEngineKeyFromFamily(family: SessionFamily | undefined) {
  return family ? sessionFamilyToEngineKey.get(family) : undefined;
}

function resolveEngineKeyFromScenario(scenarioId: string | undefined) {
  if (!scenarioId) return undefined;
  return sessionScenarioToEngineKey.get(scenarioId) || resolveEngineKeyFromFamily(getSessionScenarioResolution(scenarioId).family);
}

export function registerSessionFamilyEngine(family: SessionFamily, engineKey: GroupChat['mode']) {
  sessionFamilyToEngineKey.set(family, engineKey);
}

export function resolveSessionFamilyKey(chat: Pick<GroupChat, 'mode' | 'sessionKind'>): SessionFamily {
  return chat.sessionKind?.family
    || getSessionScenarioResolution(chat.sessionKind?.scenarioId || '').family
    || (chat.mode === 'interview' ? 'interview'
      : chat.mode === 'werewolf' ? 'deduction'
      : chat.mode === 'murder_mystery' ? 'mystery'
      : chat.mode === 'board_game' ? 'board_game'
      : 'conversation');
}

export function resolveSessionScenarioKey(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return chat.sessionKind?.scenarioId;
}

export function resolveSessionFrameworkEngineKey(chat: Pick<GroupChat, 'mode' | 'sessionKind'>): GroupChat['mode'] {
  return resolveEngineKeyFromScenario(resolveSessionScenarioKey(chat))
    || resolveEngineKeyFromFamily(resolveSessionFamilyKey(chat))
    || chat.mode;
}

export function getSessionFamilyEngineMap() {
  return new Map(sessionFamilyToEngineKey);
}

export function getSessionScenarioEngineMap() {
  return new Map(sessionScenarioToEngineKey);
}

export function resolveSessionFrameworkEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionEngine(resolveSessionFrameworkEngineKey(chat));
}

export function listSessionFrameworkResolvers() {
  return {
    families: Array.from(sessionFamilyToEngineKey.entries()).map(([family, engineKey]) => ({ family, engineKey })),
    scenarios: Array.from(sessionScenarioToEngineKey.entries()).map(([scenarioId, engineKey]) => ({ scenarioId, engineKey })),
  };
}

export function resolveSessionFramework(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return {
    family: resolveSessionFamilyKey(chat),
    scenarioId: resolveSessionScenarioKey(chat),
    engine: resolveSessionFrameworkEngine(chat),
  };
}

export function resolveSessionFrameworkDefinition(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  const scenarioId = resolveSessionScenarioKey(chat) || '';
  const scenario = getSessionScenarioResolution(scenarioId);
  return {
    family: resolveSessionFamilyKey(chat),
    scenario,
    engine: resolveSessionFrameworkEngine(chat),
  };
}

export function resolveSessionEngineResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkEngine(chat);
}

export function getSessionTopologyResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return chat.sessionKind?.topology;
}

export function getSessionSurfaceResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return chat.sessionKind?.surfaceProfile || getSessionScenarioResolution(chat.sessionKind?.scenarioId || '').surfaceProfile;
}

export function getSessionScenarioResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionScenarioResolution(chat.sessionKind?.scenarioId || '');
}

export function getSessionFamilyResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFamilyKey(chat);
}

export function getSessionFrameworkResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFramework(chat);
}

export function getSessionFrameworkDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkDefinition(chat);
}

export function getSessionEngineResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionEngineResolver(chat);
}

export function getSessionProjectionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return {
    family: getSessionFamilyResolver(chat),
    scenario: getSessionScenarioResolver(chat),
    topology: getSessionTopologyResolver(chat),
    surfaceProfile: getSessionSurfaceResolver(chat),
  };
}

export function getSessionIntentResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionChannelResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionThreadResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionScenarioPackageResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionScenarioResolver(chat);
}

export function getSessionFamilyDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkDefinition(chat);
}

export function getSessionComposerResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionProjectionDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionRuntimeResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkDefinition(chat);
}

export function getSessionTopologyDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionSurfaceDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionChannelDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionThreadDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionScenarioDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkDefinition(chat);
}

export function getSessionIntentDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionComposerDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionRuntimeDefinitionResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkDefinition(chat);
}

export function getSessionProjectionStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionChannelStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionThreadStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionSurfaceStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionTopologyStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionIntentStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionComposerStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionProjectionResolver(chat);
}

export function getSessionScenarioStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkDefinition(chat);
}

export function getSessionFamilyStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkDefinition(chat);
}

export function getSessionEngineStateResolver(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionFrameworkEngine(chat);
}

export function registerSessionEngine(engine: SessionEngineDefinition) {
  sessionEngines.set(engine.key, engine);
}

export function registerSessionScenarioEngine(scenarioId: string, engineKey: GroupChat['mode']) {
  sessionScenarioToEngineKey.set(scenarioId, engineKey);
}

export function getSessionEngine(mode: GroupChat['mode']) {
  return sessionEngines.get(mode) || openChatEngine;
}

export function resolveSessionEngineKey(chat: Pick<GroupChat, 'mode' | 'sessionKind'>): GroupChat['mode'] {
  const scenarioId = chat.sessionKind?.scenarioId;
  if (scenarioId) {
    return sessionScenarioToEngineKey.get(scenarioId) || chat.mode;
  }
  return chat.mode;
}

export function resolveSessionEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return getSessionEngine(resolveSessionEngineKey(chat));
}

export function listSessionEngines() {
  return Array.from(sessionEngines.values());
}

export function listRegisteredSessionScenarios() {
  return Array.from(sessionScenarioToEngineKey.entries()).map(([scenarioId, engineKey]) => ({ scenarioId, engineKey }));
}
