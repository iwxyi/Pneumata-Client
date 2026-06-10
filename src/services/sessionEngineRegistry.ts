import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition, SessionFamily } from '../types/sessionEngine';
import { getSessionScenarioResolution } from '../types/sessionEngine';
import { openChatEngine } from './engines/openChatEngine';
import { INTERVIEW_ENGINE } from './engines/interviewEngine';
import { WEREWOLF_ENGINE } from './engines/werewolfEngine';
import { DISCUSSION_ENGINE } from './engines/discussionEngine';
import { STORY_ENGINE } from './engines/storyEngine';
import { STUDY_ENGINE } from './engines/studyEngine';
import { AGENT_WORKFLOW_ENGINE } from './engines/agentWorkflowEngine';
import { BOARD_GAME_ENGINE } from './engines/boardGameEngine';
import { MYSTERY_ENGINE } from './engines/mysteryEngine';

const sessionEngines = new Map<string, SessionEngineDefinition>([
  [openChatEngine.key, openChatEngine],
  [INTERVIEW_ENGINE.key, INTERVIEW_ENGINE],
  [WEREWOLF_ENGINE.key, WEREWOLF_ENGINE],
  [DISCUSSION_ENGINE.key, DISCUSSION_ENGINE],
  [STORY_ENGINE.key, STORY_ENGINE],
  [STUDY_ENGINE.key, STUDY_ENGINE],
  [AGENT_WORKFLOW_ENGINE.key, AGENT_WORKFLOW_ENGINE],
  [BOARD_GAME_ENGINE.key, BOARD_GAME_ENGINE],
  [MYSTERY_ENGINE.key, MYSTERY_ENGINE],
]);

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

export function registerSessionFamilyEngine(family: SessionFamily, engineKey: GroupChat['mode']) {
  sessionFamilyToEngineKey.set(family, engineKey);
}

export function registerSessionEngine(engine: SessionEngineDefinition) {
  sessionEngines.set(engine.key, engine);
}

export function registerSessionScenarioEngine(scenarioId: string, engineKey: GroupChat['mode']) {
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
    || chat.mode;
}

export function getSessionEngine(mode: GroupChat['mode']) {
  return sessionEngines.get(mode) || openChatEngine;
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
