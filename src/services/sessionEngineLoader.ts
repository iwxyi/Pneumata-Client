import type { GroupChat } from '../types/chat';
import type { SessionEngineDefinition } from '../types/sessionEngine';
import { resolveSessionEngineKey } from './sessionEngineKeys';

const engineLoaders: Record<string, () => Promise<SessionEngineDefinition>> = {
  open_chat: async () => (await import('./engines/openChatEngine')).openChatEngine,
  interview: async () => (await import('./engines/interviewEngine')).INTERVIEW_ENGINE,
  werewolf: async () => (await import('./engines/werewolfEngine')).WEREWOLF_ENGINE,
  group_discussion: async () => (await import('./engines/discussionEngine')).DISCUSSION_ENGINE,
  roundtable: async () => (await import('./engines/discussionEngine')).DISCUSSION_ENGINE,
  scripted_play: async () => (await import('./engines/storyEngine')).STORY_ENGINE,
  classroom: async () => (await import('./engines/studyEngine')).STUDY_ENGINE,
  agent_workflow: async () => (await import('./engines/agentWorkflowEngine')).AGENT_WORKFLOW_ENGINE,
  board_game: async () => (await import('./engines/boardGameEngine')).BOARD_GAME_ENGINE,
  murder_mystery: async () => (await import('./engines/mysteryEngine')).MYSTERY_ENGINE,
};

const enginePromiseCache = new Map<string, Promise<SessionEngineDefinition>>();

export function loadSessionEngineByKey(mode: GroupChat['mode']) {
  const key = engineLoaders[mode] ? mode : 'open_chat';
  let pending = enginePromiseCache.get(key);
  if (!pending) {
    pending = engineLoaders[key]();
    enginePromiseCache.set(key, pending);
  }
  return pending;
}

export function loadSessionEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return loadSessionEngineByKey(resolveSessionEngineKey(chat));
}
