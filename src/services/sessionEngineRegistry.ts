import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition } from '../types/sessionEngine';
import { OPEN_CHAT_ENGINE } from './engines/openChatEngine';
import { INTERVIEW_ENGINE } from './engines/interviewEngine';
import { WEREWOLF_ENGINE } from './engines/werewolfEngine';

const sessionEngines = new Map<string, SessionEngineDefinition>([
  [OPEN_CHAT_ENGINE.key, OPEN_CHAT_ENGINE],
  [INTERVIEW_ENGINE.key, INTERVIEW_ENGINE],
  [WEREWOLF_ENGINE.key, WEREWOLF_ENGINE],
]);

export function registerSessionEngine(engine: SessionEngineDefinition) {
  sessionEngines.set(engine.key, engine);
}

export function getSessionEngine(mode: GroupChat['mode']) {
  return sessionEngines.get(mode) || OPEN_CHAT_ENGINE;
}

export function listSessionEngines() {
  return Array.from(sessionEngines.values());
}
