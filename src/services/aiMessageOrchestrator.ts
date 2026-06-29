import type { AICharacter } from '../types/character';
import type { DriverMessageCommitResult, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import type { SessionGenerationPromptContext } from '../types/sessionEngine';
import { createStreamingLocalMessage } from './chatCommitMessage';
import { commitGeneratedMessageTurn } from './generatedMessageTurnCommit';
import { generateSpeakerMessage, type LocalInterceptionEvent } from './chatEngine';
import { attachMessageToActiveBranch } from './messageBranching';
import { GenerationCancelledError, isGenerationCancelledError } from './generationCancellation';

function ensureGenerationStillCurrent(params: { signal?: AbortSignal; shouldContinue?: () => boolean }) {
  if (params.signal?.aborted) throw new GenerationCancelledError();
  if (params.shouldContinue && !params.shouldContinue()) throw new GenerationCancelledError('生成所属分支已切换');
}

export async function generateAndCommitAiMessage(params: {
  api: APIConfig;
  aiProfiles: AIModelProfile[];
  chatId: string;
  chat: GroupChat;
  speaker: AICharacter;
  characters: AICharacter[];
  currentMessages: Message[];
  timestamp?: number;
  streamingMessage?: Message | null;
  onChunk?: (content: string) => void;
  signal?: AbortSignal;
  shouldContinue?: () => boolean;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
  generationContext?: {
    promptContext?: SessionGenerationPromptContext | null;
    buildPromptContext?: (speaker: AICharacter) => SessionGenerationPromptContext | null | undefined;
  };
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
  getCurrentChat?: (id: string) => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
}) {
  ensureGenerationStillCurrent(params);
  const placeholder = params.streamingMessage || createStreamingLocalMessage(attachMessageToActiveBranch(params.chat, params.currentMessages, {
    chatId: params.chatId,
    type: 'ai',
    senderId: params.speaker.id,
    senderName: params.speaker.name,
    content: '',
    emotion: 0,
  }), { timestamp: params.timestamp });
  let streamingMessage = { ...placeholder, isStreaming: true };
  params.upsertMessage(streamingMessage);

  try {
    const message = await generateSpeakerMessage({
      chat: params.chat,
      speaker: params.speaker,
      characters: params.characters,
      messages: params.currentMessages,
      apiConfig: params.aiProfiles.length ? params.aiProfiles : params.api,
      profiles: params.aiProfiles,
      generationContext: params.generationContext,
      onLocalInterception: params.onLocalInterception,
      signal: params.signal,
      onChunk: (content) => {
        ensureGenerationStillCurrent(params);
        streamingMessage = { ...streamingMessage, content, isStreaming: true };
        params.upsertMessage(streamingMessage);
        params.onChunk?.(content);
      },
    });

    ensureGenerationStillCurrent(params);
    return commitGeneratedMessageTurn({
      api: params.api,
      chatId: params.chatId,
      chat: params.chat,
      characters: params.characters,
      message,
      streamingMessage,
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
      aiProfiles: params.aiProfiles,
      getCurrentChat: params.getCurrentChat,
      getCurrentCharacters: params.getCurrentCharacters,
    });
  } catch (error) {
    if (isGenerationCancelledError(error)) {
      params.upsertMessage({ ...streamingMessage, content: '', isDeleted: true, isStreaming: false });
    }
    throw error;
  }
}
