import type { AICharacter } from '../types/character';
import type { DriverMessageCommitResult, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import type { GeneratedRoundMessage } from './chatEngine';
import { persistStreamingMessage } from './chatCommitMessage';
import { buildGeneratedTurnContent, splitGeneratedRoundMessage } from './generatedMessageSegmenter';
import { runPersistedSessionCommitRuntime, runSessionCommitPipeline, type SessionCommitPipelineResult } from './sessionCommitPipeline';

function resolveTurnBaseTimestamp(message: GeneratedRoundMessage) {
  const metadata = message.metadata as Record<string, unknown> | undefined;
  const candidate = metadata?.generatedAt;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.round(candidate);
  return Date.now();
}

export async function commitGeneratedMessageTurn(params: {
  api: APIConfig;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  message: GeneratedRoundMessage;
  streamingMessage?: Message | null;
  currentMessages: Message[];
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'>;
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
  aiProfiles?: AIModelProfile[];
  getCurrentChat?: (id: string) => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
}) {
  const segments = splitGeneratedRoundMessage(params.message);
  let workingChat = params.chat;
  let workingCharacters = params.characters;
  let workingMessages = [...params.currentMessages];
  const results: SessionCommitPipelineResult[] = [];

  if (segments.length > 1) {
    const baseTimestamp = resolveTurnBaseTimestamp(params.message);
    const persistedSegments: Message[] = [];
    for (let index = 0; index < segments.length; index += 1) {
      const persisted = await persistStreamingMessage({
        message: segments[index],
        upsertMessage: params.upsertMessage,
        existingLocalMessage: index === 0 && params.streamingMessage
          ? { ...params.streamingMessage, content: segments[index].content }
          : null,
        timestamp: index === 0 ? undefined : baseTimestamp + index,
      });
      persistedSegments.push(persisted);
    }
    const runtimeMessage: Message = {
      ...persistedSegments[0],
      content: buildGeneratedTurnContent(params.message),
      metadata: params.message.metadata,
      emotion: params.message.emotion,
      isDeleted: false,
      isStreaming: false,
    };
    const result = await runPersistedSessionCommitRuntime({
      api: params.api,
      chatId: params.chatId,
      chat: params.chat,
      characters: params.characters,
      message: runtimeMessage,
      currentMessages: params.currentMessages,
      onCommit: params.onCommit,
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
    return {
      segments,
      results: [result],
    };
  }

  for (let index = 0; index < segments.length; index += 1) {
    const result = await runSessionCommitPipeline({
      api: params.api,
      chatId: params.chatId,
      chat: workingChat,
      characters: workingCharacters,
      message: segments[index],
      streamingMessage: index === 0 ? params.streamingMessage : null,
      currentMessages: workingMessages,
      onCommit: params.onCommit,
      upsertMessage: params.upsertMessage,
      updateCharacter: params.updateCharacter,
      updateCharacters: params.updateCharacters,
      appendEventMessage: params.appendEventMessage,
      appendEventMessages: params.appendEventMessages,
      updateChat: params.updateChat,
      applyChatRuntimeDelta: params.applyChatRuntimeDelta,
      recordSpeak: params.recordSpeak,
      aiProfiles: params.aiProfiles,
      getCurrentChat: params.getCurrentChat,
      getCurrentCharacters: params.getCurrentCharacters,
    });
    results.push(result);
    workingChat = result.nextChat;
    workingCharacters = result.nextCharacters;
    workingMessages = workingMessages.concat(result.persistedMessage);
    if (result.persistedMessage.metadata?.withdrawal?.withdrawn) break;
  }

  return {
    segments,
    results,
  };
}
