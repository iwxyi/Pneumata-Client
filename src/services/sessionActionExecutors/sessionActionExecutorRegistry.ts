import type { GroupChat } from '../../types/chat';
import type { SessionActionDefinition, SessionActionExecutionResult } from '../../types/sessionEngine';
import { executeNonChatActionScaffold } from './nonChatActionScaffold';

export type SessionActionExecutor = (chat: GroupChat, action: SessionActionDefinition) => SessionActionExecutionResult | null;

const executors: SessionActionExecutor[] = [executeNonChatActionScaffold];

export function registerSessionActionExecutor(executor: SessionActionExecutor) {
  executors.push(executor);
}

export function runSessionActionExecutor(chat: GroupChat, action: SessionActionDefinition) {
  for (const executor of executors) {
    const result = executor(chat, action);
    if (result) return result;
  }
  return null;
}
