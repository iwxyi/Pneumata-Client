import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult, DriverMessageCommitTransition } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import { mergeSessionChatPatch } from '../types/sessionEngine';
import { runChatCommitPipeline } from './chatCommitPipeline';
import { resolveSessionEngine } from './sessionEngineRegistry';
import { __flushDeferredMemoryAnalysisForTests, __resetDeferredMemoryAnalysisStateForTests, getDeferredMemoryAnalysisDebugState, scheduleAsyncMemoryAnalysis } from './asyncMemoryAnalysis';
import { applyRecalledMemoryActivation } from './memoryRecallActivation';

export const __resetDeferredLlmDistillationStateForTests = __resetDeferredMemoryAnalysisStateForTests;
export const __flushDeferredLlmDistillationForTests = __flushDeferredMemoryAnalysisForTests;
export const getDeferredLlmDistillationDebugState = getDeferredMemoryAnalysisDebugState;

export interface SessionCommitPipelineResult {
  persistedMessage: Message;
  transition: DriverMessageCommitResult;
  nextChat: GroupChat;
  nextCharacters: AICharacter[];
}

function wrapCommitWithFrameworkPatch(params: Parameters<typeof runChatCommitPipeline>[0]): Parameters<typeof runChatCommitPipeline>[0]['onCommit'] {
  return async (args) => {
    const transition = await params.onCommit(args);
    const engine = resolveSessionEngine(args.conversation);
    return {
      ...transition,
      chatPatch: mergeSessionChatPatch(engine, args.conversation, transition.chatPatch),
    };
  };
}

function applyTransitionToChat(chat: GroupChat, transition: DriverMessageCommitTransition) {
  return {
    ...chat,
    ...transition.chatPatch,
    ...(transition.chatRuntimeDelta?.runtimeEventsV2 ? {
      runtimeEventsV2: applyRuntimeEventsDelta(chat.runtimeEventsV2 || [], transition.chatRuntimeDelta.runtimeEventsV2),
    } : {}),
    ...(transition.chatRuntimeDelta?.relationshipLedger ? {
      relationshipLedger: applyRelationshipLedgerDelta(chat.relationshipLedger || [], transition.chatRuntimeDelta.relationshipLedger),
    } : {}),
  } as GroupChat;
}

function applyRuntimeEventsDelta(
  current: NonNullable<GroupChat['runtimeEventsV2']>,
  delta: NonNullable<DriverMessageCommitTransition['chatRuntimeDelta']>['runtimeEventsV2'],
) {
  if (!delta) return current;
  const byId = new Map(current.map((item) => [item.id, item] as const));
  delta.upserts.forEach((item) => byId.set(item.id, item));
  return delta.orderedIds.map((id) => byId.get(id)).filter(Boolean) as NonNullable<GroupChat['runtimeEventsV2']>;
}

function applyRelationshipLedgerDelta(
  current: NonNullable<GroupChat['relationshipLedger']>,
  delta: NonNullable<DriverMessageCommitTransition['chatRuntimeDelta']>['relationshipLedger'],
) {
  if (!delta) return current;
  const byKey = new Map(current.map((item) => [item.pairKey, item] as const));
  delta.upserts.forEach((item) => byKey.set(item.pairKey, item));
  return delta.orderedPairKeys.map((key) => byKey.get(key)).filter(Boolean) as NonNullable<GroupChat['relationshipLedger']>;
}

function applyTransitionToCharacters(characters: AICharacter[], transition: DriverMessageCommitTransition) {
  const patchMap = new Map(transition.characterPatches.map((item) => [item.characterId, item.patch] as const));
  return characters.map((character) => {
    const patch = patchMap.get(character.id);
    return patch ? { ...character, ...patch } : character;
  });
}

export async function runSessionCommitPipeline(params: {
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
  aiProfiles?: AIModelProfile[];
  getCurrentChat?: (id: string) => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
}): Promise<SessionCommitPipelineResult> {
  const { persistedMessage, transition } = await runChatCommitPipeline({
    ...params,
    onCommit: wrapCommitWithFrameworkPatch(params),
  });
  const transitionWithRecall = applyRecalledMemoryActivation({
    chat: params.chat,
    characters: params.characters,
    message: persistedMessage,
    recentMessages: params.currentMessages,
    transition,
  });
  if (transitionWithRecall !== transition) {
    const recallPatch = transitionWithRecall.characterPatches.find((item) => item.characterId === persistedMessage.senderId)?.patch;
    if (recallPatch) {
      await params.updateCharacter(persistedMessage.senderId, recallPatch);
    }
    const recallEvents = transitionWithRecall.runtimeEvents.slice(transition.runtimeEvents.length);
    if (recallEvents.length) {
      if (params.appendEventMessages) {
        await params.appendEventMessages(params.chatId, recallEvents, persistedMessage.id);
      } else {
        for (const event of recallEvents) {
          await params.appendEventMessage(params.chatId, event, persistedMessage.id);
        }
      }
    }
  }
  const nextCharacters = applyTransitionToCharacters(params.characters, transitionWithRecall);
  const nextChat = applyTransitionToChat(params.chat, transitionWithRecall);
  const characterIdsToCheck = transitionWithRecall.characterPatches
    .filter((item) => Array.isArray(item.patch.layeredMemories))
    .map((item) => item.characterId);
  void scheduleAsyncMemoryAnalysis({
    api: params.api,
    chat: nextChat,
    characters: nextCharacters,
    characterIdsToCheck,
    updateChat: params.updateChat,
    updateCharacter: params.updateCharacter,
    appendEventMessage: params.appendEventMessage,
    sourceMessageId: persistedMessage.id,
    getCurrentChat: params.getCurrentChat,
    getCurrentCharacters: params.getCurrentCharacters,
  });
  return {
    persistedMessage,
    transition: transitionWithRecall,
    nextChat,
    nextCharacters,
  };
}
