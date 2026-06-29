import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition, SessionFamily } from '../types/sessionEngine';
import { openChatEngine } from './engines/openChatEngine';
import { INTERVIEW_ENGINE } from './engines/interviewEngine';
import { WEREWOLF_ENGINE } from './engines/werewolfEngine';
import { DISCUSSION_ENGINE } from './engines/discussionEngine';
import { STORY_ENGINE } from './engines/storyEngine';
import { STUDY_ENGINE } from './engines/studyEngine';
import { AGENT_WORKFLOW_ENGINE } from './engines/agentWorkflowEngine';
import { BOARD_GAME_ENGINE } from './engines/boardGameEngine';
import { MYSTERY_ENGINE } from './engines/mysteryEngine';
import {
  listRegisteredSessionScenarios,
  registerSessionFamilyEngineKey,
  registerSessionScenarioEngineKey,
  resolveSessionEngineKey,
  resolveSessionFamilyKey,
} from './sessionEngineKeys';

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

export function registerSessionFamilyEngine(family: SessionFamily, engineKey: GroupChat['mode']) {
  registerSessionFamilyEngineKey(family, engineKey);
}

export function registerSessionEngine(engine: SessionEngineDefinition) {
  sessionEngines.set(engine.key, engine);
}

export function registerSessionScenarioEngine(scenarioId: string, engineKey: GroupChat['mode']) {
  registerSessionScenarioEngineKey(scenarioId, engineKey);
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

export { listRegisteredSessionScenarios, resolveSessionEngineKey, resolveSessionFamilyKey };
