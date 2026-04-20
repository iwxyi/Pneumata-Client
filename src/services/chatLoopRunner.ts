import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { runOneRound } from './chatEngine';
import { commitGeneratedMessage } from './chatRoundExecution';

export async function runChatLoop(params: {
  loopId: string;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  api: APIConfig;
  getCurrentMessages: () => Message[];
  isRunning: () => boolean;
  isPaused: () => boolean;
  isActiveLoop: (loopId: string) => boolean;
  onSpeakerSelected: (characterId: string) => void;
  onMessageChunk: (content: string) => void;
  onClearStreamingState: () => void;
  onEngineError: (error: Error) => void;
  onLoopError: (error: unknown) => void;
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
  while (params.isRunning() && !params.isPaused()) {
    if (!params.isActiveLoop(params.loopId)) return;

    try {
      const currentMessages = params.getCurrentMessages();

      await runOneRound(
        params.chat,
        params.characters,
        currentMessages,
        params.api,
        {
          onSpeakerSelected: (charId) => {
            if (!params.isActiveLoop(params.loopId)) return;
            params.onSpeakerSelected(charId);
          },
          onMessageChunk: (content) => {
            if (!params.isActiveLoop(params.loopId)) return;
            params.onMessageChunk(content);
          },
          onMessageComplete: async (message) => {
            if (!params.isActiveLoop(params.loopId)) return;
            await commitGeneratedMessage({
              api: params.api,
              chatId: params.chatId,
              chat: params.chat,
              characters: params.characters,
              message,
              currentMessages: params.getCurrentMessages(),
              onCommit: params.onCommit,
              addOptimisticMessage: params.addOptimisticMessage,
              replaceOptimisticMessage: params.replaceOptimisticMessage,
              updateCharacter: params.updateCharacter,
              appendEventMessage: params.appendEventMessage,
              updateChat: params.updateChat,
              recordSpeak: params.recordSpeak,
              clearStreamingState: params.onClearStreamingState,
            });
          },
          onError: (error) => {
            if (!params.isActiveLoop(params.loopId)) return;
            params.onEngineError(error);
          },
        }
      );

      if (!params.isActiveLoop(params.loopId)) return;

      if (params.isRunning() && !params.isPaused()) {
        const waitTime = (3000 / (params.chat.speed || 1)) + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    } catch (error) {
      if (!params.isActiveLoop(params.loopId)) return;
      params.onLoopError(error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
