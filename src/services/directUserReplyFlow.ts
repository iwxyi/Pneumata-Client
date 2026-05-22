import type { APIConfig, AIModelProfile } from '../types/settings';
import type { AICharacter } from '../types/character';
import type { DriverMessageCommitResult, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import { deriveEmotionalState, derivePersonalityDrift } from './personalityDrift';
import { resolveRuntimeEvolutionConfig } from './runtimeEvolutionConfig';
import { updateCharacterLayeredMemories } from './characterLayeredMemory';
import { accumulateCharacterRuntime } from './characterRuntime';
import { getCharacterGroupLabel } from '../types/character';
import { projectCurrentChatMessages } from './currentChatMessages';
import { useMessageStore } from '../stores/useMessageStore';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';

export async function runDirectUserReplyFlow(params: {
  api: APIConfig | APIConfig[];
  aiProfiles: AIModelProfile[];
  chatId: string;
  chat: GroupChat;
  userMessage: Message;
  content: string;
  characters: AICharacter[];
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  updateCharacters: (patches: Array<{ id: string; updates: Partial<AICharacter> }>) => Promise<void>;
  upsertMessage: (message: Message) => void;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>;
  appendEventMessages?: (chatId: string, payloads: DriverMessageCommitResult['runtimeEvents'], sourceMessageId?: string) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  applyChatRuntimeDelta?: (id: string, delta: NonNullable<DriverMessageCommitResult['chatRuntimeDelta']>, patch?: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
}) {
  const directCharacter = params.characters.find((item) => item.id === params.chat.memberIds[0]);
  if (!directCharacter) return;

  const evolution = resolveRuntimeEvolutionConfig(params.chat.runtimeEvolutionIntensity);
  const drift = derivePersonalityDrift(directCharacter, params.content, evolution.driftMultiplier * 0.5);
  const emotion = deriveEmotionalState(directCharacter, params.content, evolution.emotionMultiplier * 0.85, evolution.emotionDecayBias);
  await params.updateCharacter(directCharacter.id, {
    personalityDrift: drift,
    emotionalState: emotion,
    layeredMemories: updateCharacterLayeredMemories({
      character: { ...directCharacter, emotionalState: emotion },
      content: params.content,
      personalityDrift: drift,
      sourceEventTag: 'direct_user_message',
    }),
    runtimeTimeline: accumulateCharacterRuntime(directCharacter, {
      type: 'memory',
      text: `${getCharacterGroupLabel(directCharacter.group) || '单聊'}中与用户互动：${params.content.slice(0, 48)}`,
    }).concat(
      Object.keys(drift).length ? [{ type: 'drift' as const, text: '与用户互动后产生性格漂移', createdAt: Date.now() }] : []
    ).slice(-24),
  });

  const [{ generateAndCommitAiMessage }, { getSessionEngine }] = await Promise.all([
    import('./aiMessageOrchestrator'),
    import('./sessionEngineRegistry'),
  ]);
  const sessionEngine = getSessionEngine(params.chat.mode);
  const getProjectedMessages = () => projectCurrentChatMessages({
    chatId: params.chatId,
    activeMessages: useMessageStore.getState().messages,
    cachedWindow: useMessageStore.getState().messageWindowsByChatId[params.chatId],
  });

  await generateAndCommitAiMessage({
    api: Array.isArray(params.api) ? params.api[0] : params.api,
    aiProfiles: params.aiProfiles,
    chatId: params.chatId,
    chat: params.chat,
    speaker: directCharacter,
    characters: params.characters,
    timestamp: params.userMessage.timestamp + 1,
    currentMessages: getProjectedMessages(),
    generationContext: {
      buildPromptContext: (speaker) => sessionEngine.buildGenerationPromptContext?.({
        conversation: params.chat,
        characters: params.characters,
        messages: getProjectedMessages(),
        speaker,
      }) || null,
    },
    onCommit: async (args) => await (sessionEngine.onMessageCommitted as (commitArgs: {
      conversation: GroupChat;
      characters: AICharacter[];
      message: Pick<Message, 'content' | 'type' | 'senderId'>;
      previousAiMessage: Pick<Message, 'senderId'> | null;
      recentMessages?: Message[];
      apiConfig?: APIConfig;
    }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>)(args),
    upsertMessage: params.upsertMessage,
    updateCharacter: params.updateCharacter,
    updateCharacters: async (patches) => params.updateCharacters(patches.map((patch) => ({ id: patch.id, updates: patch.patch }))),
    appendEventMessage: params.appendEventMessage,
    appendEventMessages: params.appendEventMessages,
    updateChat: params.updateChat,
    applyChatRuntimeDelta: params.applyChatRuntimeDelta,
    recordSpeak: params.recordSpeak,
    getCurrentChat: (chatId) => useChatStore.getState().chats.find((item) => item.id === chatId),
    getCurrentCharacters: () => useCharacterStore.getState().characters,
  });
}
