import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { runSessionCommitPipeline } from './sessionCommitPipeline';

export async function commitGeneratedMessage(params: {
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
  clearStreamingState: () => void;
}) {
  params.clearStreamingState();
  await runSessionCommitPipeline({
    api: params.api,
    chatId: params.chatId,
    chat: params.chat,
    characters: params.characters,
    message: params.message,
    currentMessages: params.currentMessages,
    onCommit: params.onCommit,
    upsertMessage: params.upsertMessage,
    updateCharacter: params.updateCharacter,
    appendEventMessage: params.appendEventMessage,
    updateChat: params.updateChat,
    recordSpeak: params.recordSpeak,
  });
}
