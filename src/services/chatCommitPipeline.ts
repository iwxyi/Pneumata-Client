import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { persistStreamingMessage } from './chatCommitMessage';
import { buildChatCommitContext } from './chatCommitContext';
import { finalizeChatCommitRuntime } from './chatCommitRuntime';
import { applyChatCommitRuntime } from './chatCommitApply';

export async function runChatCommitPipeline(params: {
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
  }) => DriverMessageCommitResult;
  addOptimisticMessage: (message: Message) => void;
  replaceOptimisticMessage: (temporaryId: string, message: Message) => void;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
}) {
  const nextMessages = params.currentMessages.filter((message) => !message.isDeleted);
  await persistStreamingMessage({
    message: params.message,
    addOptimisticMessage: params.addOptimisticMessage,
    replaceOptimisticMessage: params.replaceOptimisticMessage,
  });

  const commitContext = buildChatCommitContext(nextMessages);
  const transition = await finalizeChatCommitRuntime({
    api: params.api,
    chat: params.chat,
    characters: params.characters,
    message: params.message,
    previousAiMessage: commitContext.previousAiMessage,
    onCommit: params.onCommit,
  });

  await applyChatCommitRuntime({
    chatId: params.chatId,
    transition,
    updateCharacter: params.updateCharacter,
    appendEventMessage: params.appendEventMessage,
    updateChat: params.updateChat,
    recordSpeak: params.recordSpeak,
    speakerId: params.message.senderId,
  });
}
