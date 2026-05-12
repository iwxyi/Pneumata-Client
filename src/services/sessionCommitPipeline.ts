import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { mergeSessionChatPatch } from '../types/sessionEngine';
import { runChatCommitPipeline } from './chatCommitPipeline';
import { resolveSessionEngine } from './sessionEngineRegistry';
import { consolidateMemoryCandidates } from './memoryConsolidation';
import { createMemoryDistillationRuntimeEvent, debugCharacterMemoryDistillation, debugChatMemoryDistillation, logMemoryDistillationTriggered, shouldEmitMemoryDistillationEvent } from './memoryDistillation';
import { distillChatMemoriesWithLlm, distillCharacterMemoriesWithLlm, shouldRunLlmCharacterDistillation, shouldRunLlmChatDistillation } from './llmMemoryDistillation';

const LLM_CHAT_TURN_COUNT = 20;
const LLM_CHARACTER_TURN_COUNT = 16;

async function applyLlmDistillation(params: {
  api: APIConfig;
  transition: DriverMessageCommitResult;
  chat: GroupChat;
  characters: AICharacter[];
}) {
  const nextChat = { ...params.chat, ...params.transition.chatPatch } as GroupChat;
  const nextCharacterPatches = [...params.transition.characterPatches];
  const nextRuntimeEvents = [...params.transition.runtimeEvents];

  const chatDebug = debugChatMemoryDistillation(nextChat, LLM_CHAT_TURN_COUNT);
  if (shouldRunLlmChatDistillation(nextChat, LLM_CHAT_TURN_COUNT)) {
    const distilled = await distillChatMemoriesWithLlm(params.api, nextChat);
    if (distilled.length) {
      nextChat.layeredMemories = consolidateMemoryCandidates(nextChat.layeredMemories || [], distilled);
      const info = { ...chatDebug, triggered: true, reason: 'llm_distilled', candidateTexts: distilled.map((item) => item.text) };
      logMemoryDistillationTriggered(info);
      if (shouldEmitMemoryDistillationEvent(info)) nextRuntimeEvents.push(createMemoryDistillationRuntimeEvent(info));
    }
  }

  for (const patchEntry of nextCharacterPatches) {
    const baseCharacter = params.characters.find((item) => item.id === patchEntry.characterId);
    if (!baseCharacter) continue;
    const nextCharacter = { ...baseCharacter, ...patchEntry.patch } as AICharacter;
    const charDebug = debugCharacterMemoryDistillation(nextCharacter, LLM_CHARACTER_TURN_COUNT);
    if (!shouldRunLlmCharacterDistillation(nextCharacter, LLM_CHARACTER_TURN_COUNT)) continue;
    const distilled = await distillCharacterMemoriesWithLlm(params.api, nextCharacter);
    if (!distilled.length) continue;
    patchEntry.patch = {
      ...patchEntry.patch,
      layeredMemories: consolidateMemoryCandidates(nextCharacter.layeredMemories || [], distilled),
    };
    const info = { ...charDebug, triggered: true, reason: 'llm_distilled', candidateTexts: distilled.map((item) => item.text) };
    logMemoryDistillationTriggered(info);
    if (shouldEmitMemoryDistillationEvent(info)) nextRuntimeEvents.push(createMemoryDistillationRuntimeEvent(info));
  }

  return {
    ...params.transition,
    chatPatch: nextChat,
    characterPatches: nextCharacterPatches,
    runtimeEvents: nextRuntimeEvents,
  };
}

function wrapCommitWithFrameworkPatch(params: Parameters<typeof runChatCommitPipeline>[0]): Parameters<typeof runChatCommitPipeline>[0]['onCommit'] {
  return async (args) => {
    const transition = await params.onCommit(args);
    const distilled = await applyLlmDistillation({
      api: params.api,
      transition,
      chat: args.conversation,
      characters: args.characters,
    });
    const engine = resolveSessionEngine(args.conversation);
    return {
      ...distilled,
      chatPatch: mergeSessionChatPatch(engine, args.conversation, distilled.chatPatch),
    };
  };
}

export async function runSessionCommitPipeline(params: {
  api: APIConfig;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  currentMessages: Message[];
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
    recentMessages?: Message[];
    apiConfig?: APIConfig;
  }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>;
  upsertMessage: (message: Message) => void;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
}) {
  await runChatCommitPipeline({
    ...params,
    onCommit: wrapCommitWithFrameworkPatch(params),
  });
}
