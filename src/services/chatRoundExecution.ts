import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { commitGeneratedMessageTurn } from './generatedMessageTurnCommit';

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
  updateCharacters?: (patches: Array<{ id: string; patch: Partial<AICharacter> }>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>;
  appendEventMessages?: (chatId: string, payloads: DriverMessageCommitResult['runtimeEvents'], sourceMessageId?: string) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  applyChatRuntimeDelta?: (id: string, delta: NonNullable<DriverMessageCommitResult['chatRuntimeDelta']>, patch?: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
  clearStreamingState: () => void;
  getCurrentChat?: (id: string) => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
}) {
  params.clearStreamingState();
  await commitGeneratedMessageTurn({
    api: params.api,
    chatId: params.chatId,
    chat: params.chat,
    characters: params.characters,
    message: params.message,
    currentMessages: params.currentMessages,
    onCommit: params.onCommit,
    upsertMessage: params.upsertMessage,
    updateCharacter: params.updateCharacter,
    updateCharacters: params.updateCharacters,
    appendEventMessage: params.appendEventMessage,
    appendEventMessages: params.appendEventMessages,
    updateChat: params.updateChat,
    applyChatRuntimeDelta: params.applyChatRuntimeDelta,
    recordSpeak: params.recordSpeak,
    getCurrentChat: params.getCurrentChat,
    getCurrentCharacters: params.getCurrentCharacters,
  });
}
