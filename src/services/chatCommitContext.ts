import type { Message } from '../types/message';

export function getPreviousAiMessage(messages: Message[]) {
  const currentAiMessages = messages.filter((item) => item.type === 'ai' && !item.isDeleted);
  return currentAiMessages.at(-1) || null;
}

export function buildChatCommitContext(messages: Message[]) {
  return {
    previousAiMessage: getPreviousAiMessage(messages),
  };
}
