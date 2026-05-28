import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { persistStreamingMessage } from './chatCommitMessage';
import { buildChatCommitContext } from './chatCommitContext';
import { finalizeChatCommitRuntime } from './chatCommitRuntime';
import { applyChatCommitRuntime } from './chatCommitApply';
import { createRuntimeMemoryTimer } from './runtimeMemoryMonitor';
import { isLocalOnlyMediaMode, processRichMessageMedia } from './richMessageMedia';
import { parseRuntimeEvent } from './runtimeEventFactory';

export interface ChatCommitPipelineResult {
  persistedMessage: Message;
  transition: DriverMessageCommitResult;
}

function isLocalInterceptionMessage(message: Message) {
  return message.type === 'event' && parseRuntimeEvent(message.content)?.eventType === 'local_interception';
}

export async function runChatCommitPipeline(params: {
  api: APIConfig;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  streamingMessage?: Message | null;
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
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number], sourceMessageId?: string) => Promise<void>;
  appendEventMessages?: (chatId: string, payloads: DriverMessageCommitResult['runtimeEvents'], sourceMessageId?: string) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  applyChatRuntimeDelta?: (id: string, delta: NonNullable<DriverMessageCommitResult['chatRuntimeDelta']>, patch?: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
  aiProfiles?: import('../types/settings').AIModelProfile[];
}): Promise<ChatCommitPipelineResult> {
  const timer = createRuntimeMemoryTimer('chat-commit', {
    chatId: params.chatId,
    speakerId: params.message.senderId,
    chat: params.chat,
    characters: params.characters,
    messages: params.currentMessages,
  });

  try {
    const nextMessages = params.currentMessages.filter((message) => !message.isDeleted && message.id !== params.streamingMessage?.id && !isLocalInterceptionMessage(message));
    let mediaProcessingStarted = false;
    const startMediaProcessing = (message: Message) => {
      if (!params.aiProfiles?.length) return;
      if (mediaProcessingStarted) return;
      if (!message.metadata?.attachments?.some((item) => item.status === 'queued')) return;
      mediaProcessingStarted = true;
      const speaker = params.characters.find((character) => character.id === message.senderId);
      void processRichMessageMedia({
        message,
        character: speaker,
        characters: params.characters,
        aiProfiles: params.aiProfiles || [],
        upsertMessage: params.upsertMessage,
      });
    };
    const persistedMessage = await persistStreamingMessage({
      message: params.message,
      upsertMessage: params.upsertMessage,
      existingLocalMessage: params.streamingMessage,
      deferLocalUpsert: false,
      onPersisted: (message) => {
        if (!isLocalOnlyMediaMode()) startMediaProcessing(message);
      },
    });
    if (params.aiProfiles?.length && persistedMessage.metadata?.attachments?.some((item) => item.status === 'queued')) {
      if (isLocalOnlyMediaMode() || persistedMessage.serverId) {
        startMediaProcessing(persistedMessage);
      } else {
        params.upsertMessage({
          ...persistedMessage,
          metadata: {
            ...(persistedMessage.metadata || {}),
            generation: {
              ...(persistedMessage.metadata?.generation || {}),
              status: 'queued',
              updatedAt: Date.now(),
            },
          },
        });
      }
    }
    timer.mark('after-persist-message', {
      messages: nextMessages.concat(persistedMessage),
      extra: {
        persistedMessageId: persistedMessage.id,
        reusedStreamingMessage: Boolean(params.streamingMessage?.id && params.streamingMessage.id === persistedMessage.id),
      },
    });

    const commitContext = buildChatCommitContext(nextMessages);
    const transition = await finalizeChatCommitRuntime({
      api: params.api,
      chat: params.chat,
      characters: params.characters,
      message: persistedMessage,
      previousAiMessage: commitContext.previousAiMessage,
      recentMessages: nextMessages,
      onCommit: params.onCommit,
    });
    timer.mark('after-finalize-runtime', { transition });

    await applyChatCommitRuntime({
      chatId: params.chatId,
      transition,
      updateCharacter: params.updateCharacter,
      updateCharacters: params.updateCharacters,
      appendEventMessage: params.appendEventMessage,
      appendEventMessages: params.appendEventMessages,
      updateChat: params.updateChat,
      applyChatRuntimeDelta: params.applyChatRuntimeDelta,
      recordSpeak: params.recordSpeak,
      speakerId: params.message.senderId,
      sourceMessageId: persistedMessage.id,
    });
    timer.mark('after-apply-runtime', { transition });

    timer.finish({ transition });
    return {
      persistedMessage,
      transition,
    };
  } catch (error) {
    timer.mark('error', {
      extra: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
