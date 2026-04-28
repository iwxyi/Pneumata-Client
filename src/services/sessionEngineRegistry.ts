import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition } from '../types/sessionEngine';
import { openChatEngine } from './engines/openChatEngine';
import { INTERVIEW_ENGINE } from './engines/interviewEngine';
import { WEREWOLF_ENGINE } from './engines/werewolfEngine';

const sessionEngines = new Map<string, SessionEngineDefinition>([
  [openChatEngine.key, openChatEngine],
  [INTERVIEW_ENGINE.key, INTERVIEW_ENGINE],
  [WEREWOLF_ENGINE.key, WEREWOLF_ENGINE],
]);

export function registerSessionEngine(engine: SessionEngineDefinition) {
  sessionEngines.set(engine.key, engine);
}

export function getSessionEngine(mode: GroupChat['mode']) {
  return sessionEngines.get(mode) || openChatEngine;
}

export function listSessionEngines() {
  return Array.from(sessionEngines.values());
}
