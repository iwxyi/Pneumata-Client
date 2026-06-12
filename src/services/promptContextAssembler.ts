import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { interviewPromptAdapter } from './enginePromptAdapters/interviewPromptAdapter';
import { openChatPromptAdapter } from './enginePromptAdapters/openChatPromptAdapter';
import { werewolfPromptAdapter } from './enginePromptAdapters/werewolfPromptAdapter';

export interface EnginePromptAdapter {
  key: string;
  buildSystemPrompt: (args: {
    character: AICharacter;
    chat: GroupChat;
    emotion: number;
    messages: Message[];
    characters: Map<string, AICharacter>;
  }) => string;
}

const adapters = new Map<string, EnginePromptAdapter>([
  [openChatPromptAdapter.key, openChatPromptAdapter],
  ['open-chat', openChatPromptAdapter],
  ['direct-chat', openChatPromptAdapter],
  ['ai-private-thread', openChatPromptAdapter],
  [interviewPromptAdapter.key, interviewPromptAdapter],
  ['panel-interview', interviewPromptAdapter],
  ['ielts-coach', interviewPromptAdapter],
  [werewolfPromptAdapter.key, werewolfPromptAdapter],
  ['werewolf-classic', werewolfPromptAdapter],
]);

export function registerPromptAdapter(adapter: EnginePromptAdapter) {
  adapters.set(adapter.key, adapter);
}

export function getPromptAdapter(key: string) {
  return adapters.get(key);
}

export function buildEngineAwarePrompt(args: {
  engineKey: string;
  character: AICharacter;
  chat: GroupChat;
  emotion: number;
  messages: Message[];
  characters: Map<string, AICharacter>;
  fallback: EnginePromptAdapter['buildSystemPrompt'];
}) {
  const adapter = getPromptAdapter(args.engineKey);
  if (adapter) {
    return adapter.buildSystemPrompt(args);
  }
  return args.fallback(args);
}
