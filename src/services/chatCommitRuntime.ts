import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult, DriverMessageCommitTransition } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';

export async function buildChatCommitTransition(params: {
  api: APIConfig;
  chat: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'>;
  previousAiMessage: Pick<Message, 'senderId'> | null;
  recentMessages?: Message[];
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
    recentMessages?: Message[];
    apiConfig?: APIConfig;
  }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>;
}): Promise<DriverMessageCommitTransition> {
  const result = await params.onCommit({
    conversation: params.chat,
    characters: params.characters,
    message: params.message,
    previousAiMessage: params.previousAiMessage,
    recentMessages: params.recentMessages,
    apiConfig: params.api,
  });
  return {
    chatPatch: result.chatPatch,
    chatRuntimeDelta: result.chatRuntimeDelta,
    characterPatches: result.characterPatches,
    runtimeEvents: result.runtimeEvents,
  };
}

export async function finalizeChatCommitRuntime(params: {
  api: APIConfig;
  chat: GroupChat;
  characters: AICharacter[];
  message: Pick<Message, 'chatId' | 'content' | 'type' | 'senderId' | 'senderName' | 'emotion' | 'metadata'>;
  previousAiMessage: Pick<Message, 'senderId'> | null;
  recentMessages?: Message[];
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
    recentMessages?: Message[];
    apiConfig?: APIConfig;
  }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>;
}): Promise<DriverMessageCommitTransition> {
  return buildChatCommitTransition(params);
}
