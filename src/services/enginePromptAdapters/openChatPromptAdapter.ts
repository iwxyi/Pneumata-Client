import type { EnginePromptAdapter } from '../promptContextAssembler';
import { buildSystemPromptWithContext } from '../promptBuilder';

export const openChatPromptAdapter: EnginePromptAdapter = {
  key: 'open_chat',
  buildSystemPrompt: ({ character, chat, emotion, messages, characters }) => buildSystemPromptWithContext(character, chat, emotion, messages, characters),
};
