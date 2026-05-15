import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult, DriverMessageCommitTransition } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { mergeSessionChatPatch } from '../types/sessionEngine';
import { runChatCommitPipeline } from './chatCommitPipeline';
import { resolveSessionEngine } from './sessionEngineRegistry';
import { consolidateMemoryCandidates } from './memoryConsolidation';
import { createMemoryDistillationRuntimeEvent, localizeDistillationEventInfo, shouldEmitMemoryDistillationEvent } from './memoryDistillation';
import { buildLlmDistillationSource, debugLlmCharacterDistillation, debugLlmChatDistillation, distillChatMemoriesWithLlm, distillCharacterMemoriesWithLlm, shouldRunLlmCharacterDistillation, shouldRunLlmChatDistillation } from './llmMemoryDistillation';
import { createRuntimeMemoryTimer, recordRuntimeMemory } from './runtimeMemoryMonitor';

interface DeferredLlmDistillationState {
  running: boolean;
  rerunRequested: boolean;
  lastSettledFingerprint: string | null;
  cancelled: boolean;
}

const deferredLlmDistillationStates = new Map<string, DeferredLlmDistillationState>();
const deferredLlmDistillationTasks = new Set<Promise<void>>();

function getDeferredLlmDistillationState(ownerKey: string) {
  const existing = deferredLlmDistillationStates.get(ownerKey);
  if (existing) return existing;
  const created: DeferredLlmDistillationState = {
    running: false,
    rerunRequested: false,
    lastSettledFingerprint: null,
    cancelled: false,
  };
  deferredLlmDistillationStates.set(ownerKey, created);
  return created;
}

function buildDistillationOwnerKey(ownerType: 'chat' | 'character', ownerId: string) {
  return `${ownerType}:${ownerId}`;
}

function buildLlmDistillationFingerprint(owner: { layeredMemories?: AICharacter['layeredMemories'] | GroupChat['layeredMemories'] }) {
  const source = buildLlmDistillationSource(owner);
  if (!source.length) return '';
  return source
    .map((item) => [
      item.id,
      item.updatedAt,
      item.distilledAt || 0,
      item.sourceTag || '',
      (item.sourceEventIds || []).join(','),
    ].join(':'))
    .join('|');
}

function scheduleDeferredLlmDistillation(ownerKey: string, runner: (state: DeferredLlmDistillationState) => Promise<void>) {
  const state = getDeferredLlmDistillationState(ownerKey);
  if (state.cancelled) return;
  state.rerunRequested = true;
  if (state.running) return;
  state.running = true;
  let task!: Promise<void>;
  task = (async () => {
    try {
      while (!state.cancelled && state.rerunRequested) {
        state.rerunRequested = false;
        await runner(state);
      }
    } catch (error) {
      console.warn('[llm-distillation] deferred run failed', error);
    } finally {
      state.running = false;
      state.rerunRequested = false;
      deferredLlmDistillationTasks.delete(task);
    }
  })();
  deferredLlmDistillationTasks.add(task);
  void task;
}

export function __resetDeferredLlmDistillationStateForTests() {
  deferredLlmDistillationStates.forEach((state) => {
    state.cancelled = true;
    state.rerunRequested = false;
  });
  deferredLlmDistillationStates.clear();
}

export async function __flushDeferredLlmDistillationForTests() {
  await Promise.allSettled(Array.from(deferredLlmDistillationTasks));
}

export function getDeferredLlmDistillationDebugState() {
  let running = 0;
  let rerunRequested = 0;
  let cancelled = 0;
  for (const state of deferredLlmDistillationStates.values()) {
    if (state.running) running += 1;
    if (state.rerunRequested) rerunRequested += 1;
    if (state.cancelled) cancelled += 1;
  }
  return {
    stateCount: deferredLlmDistillationStates.size,
    taskCount: deferredLlmDistillationTasks.size,
    running,
    rerunRequested,
    cancelled,
  };
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

async function applyDeferredLlmDistillation(params: {
  api: APIConfig;
  chat: GroupChat;
  characters: AICharacter[];
  characterIdsToCheck?: string[];
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number], sourceMessageId?: string) => Promise<void>;
  appendEventMessages?: (chatId: string, payloads: DriverMessageCommitResult['runtimeEvents'], sourceMessageId?: string) => Promise<void>;
  sourceMessageId?: string;
  getCurrentChat?: (id: string) => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
}) {
  const getCurrentCharacters = () => params.getCurrentCharacters?.() || params.characters;
  const getCurrentChat = () => params.getCurrentChat?.(params.chat.id) || params.chat;

  scheduleDeferredLlmDistillation(buildDistillationOwnerKey('chat', params.chat.id), async (state) => {
    const currentChat = getCurrentChat();
    if (!shouldRunLlmChatDistillation(currentChat, 0)) {
      recordRuntimeMemory('llm-distillation-chat:skip', {
        chatId: currentChat.id,
        chat: currentChat,
        characters: getCurrentCharacters(),
        extra: { reason: 'not-eligible' },
      });
      return;
    }
    const startFingerprint = buildLlmDistillationFingerprint(currentChat);
    if (!startFingerprint || state.lastSettledFingerprint === startFingerprint) {
      recordRuntimeMemory('llm-distillation-chat:skip', {
        chatId: currentChat.id,
        chat: currentChat,
        characters: getCurrentCharacters(),
        extra: {
          reason: !startFingerprint ? 'empty-fingerprint' : 'same-fingerprint',
          fingerprintLength: startFingerprint.length,
        },
      });
      return;
    }

    const timer = createRuntimeMemoryTimer('llm-distillation-chat', {
      chatId: currentChat.id,
      chat: currentChat,
      characters: getCurrentCharacters(),
      extra: { fingerprintLength: startFingerprint.length },
    });
    const distilled = await distillChatMemoriesWithLlm(params.api, currentChat);
    timer.mark('after-generate', {
      chat: getCurrentChat(),
      characters: getCurrentCharacters(),
      extra: { distilledCount: distilled.length },
    });
    const latestChat = getCurrentChat();
    const latestFingerprint = buildLlmDistillationFingerprint(latestChat);
    if (!latestFingerprint) {
      timer.finish({
        chat: latestChat,
        characters: getCurrentCharacters(),
        extra: { result: 'empty-latest-fingerprint' },
      });
      return;
    }
    if (latestFingerprint !== startFingerprint) {
      state.rerunRequested = true;
      timer.finish({
        chat: latestChat,
        characters: getCurrentCharacters(),
        extra: { result: 'fingerprint-changed', latestFingerprintLength: latestFingerprint.length },
      });
      return;
    }

    state.lastSettledFingerprint = startFingerprint;
    if (!distilled.length) {
      timer.finish({
        chat: latestChat,
        characters: getCurrentCharacters(),
        extra: { result: 'empty-distilled' },
      });
      return;
    }

    const layeredMemories = consolidateMemoryCandidates(latestChat.layeredMemories || [], distilled);
    timer.mark('after-consolidate', {
      chat: { ...latestChat, layeredMemories } as GroupChat,
      characters: getCurrentCharacters(),
      extra: { layeredMemoryCount: layeredMemories.length },
    });
    await params.updateChat(latestChat.id, { layeredMemories });
    timer.mark('after-update-chat', {
      chat: getCurrentChat(),
      characters: getCurrentCharacters(),
      extra: { layeredMemoryCount: layeredMemories.length },
    });

    const llmDebug = debugLlmChatDistillation({ ...latestChat, layeredMemories } as GroupChat);
    const llmSource = buildLlmDistillationSource({ layeredMemories });
    const llmInfo = {
      ownerType: 'chat' as const,
      ownerId: latestChat.id,
      triggered: true,
      reason: 'llm_distilled',
      eligibleCount: llmDebug.eligibleCount,
      newEvidenceCount: Array.from(new Set(llmSource.flatMap((item) => item.sourceEventIds || []))).length,
      candidateTexts: distilled.map((item) => item.text),
    };
    if (!shouldEmitMemoryDistillationEvent(llmInfo)) {
      timer.finish({
        chat: getCurrentChat(),
        characters: getCurrentCharacters(),
        extra: { result: 'event-not-emitted', eligibleCount: llmInfo.eligibleCount, newEvidenceCount: llmInfo.newEvidenceCount },
      });
      return;
    }

    const participants = getCurrentCharacters().map((item) => ({ id: item.id, name: item.name }));
    await params.appendEventMessage(
      latestChat.id,
      createMemoryDistillationRuntimeEvent(localizeDistillationEventInfo(llmInfo, participants)),
      params.sourceMessageId,
    );
    timer.finish({
      chat: getCurrentChat(),
      characters: getCurrentCharacters(),
      extra: { result: 'event-emitted', eligibleCount: llmInfo.eligibleCount, newEvidenceCount: llmInfo.newEvidenceCount },
    });
  });

  const characterIdsToCheck = new Set(params.characterIdsToCheck || []);
  for (const characterId of characterIdsToCheck) {
    const seedCharacter = getCurrentCharacters().find((item) => item.id === characterId) || params.characters.find((item) => item.id === characterId);
    if (!seedCharacter) continue;
    scheduleDeferredLlmDistillation(buildDistillationOwnerKey('character', characterId), async (state) => {
      const currentCharacter = getCurrentCharacters().find((item) => item.id === characterId) || seedCharacter;
      if (!shouldRunLlmCharacterDistillation(currentCharacter, 0)) {
        recordRuntimeMemory('llm-distillation-character:skip', {
          chatId: params.chat.id,
          speakerId: characterId,
          characters: [currentCharacter],
          extra: { reason: 'not-eligible' },
        });
        return;
      }
      const startFingerprint = buildLlmDistillationFingerprint(currentCharacter);
      if (!startFingerprint || state.lastSettledFingerprint === startFingerprint) {
        recordRuntimeMemory('llm-distillation-character:skip', {
          chatId: params.chat.id,
          speakerId: characterId,
          characters: [currentCharacter],
          extra: {
            reason: !startFingerprint ? 'empty-fingerprint' : 'same-fingerprint',
            fingerprintLength: startFingerprint.length,
          },
        });
        return;
      }

      const timer = createRuntimeMemoryTimer('llm-distillation-character', {
        chatId: params.chat.id,
        speakerId: characterId,
        characters: [currentCharacter],
        extra: { fingerprintLength: startFingerprint.length },
      });
      const distilled = await distillCharacterMemoriesWithLlm(params.api, currentCharacter);
      timer.mark('after-generate', {
        characters: [getCurrentCharacters().find((item) => item.id === characterId) || currentCharacter],
        extra: { distilledCount: distilled.length },
      });
      const latestCharacter = getCurrentCharacters().find((item) => item.id === characterId) || currentCharacter;
      const latestFingerprint = buildLlmDistillationFingerprint(latestCharacter);
      if (!latestFingerprint) {
        timer.finish({
          characters: [latestCharacter],
          extra: { result: 'empty-latest-fingerprint' },
        });
        return;
      }
      if (latestFingerprint !== startFingerprint) {
        state.rerunRequested = true;
        timer.finish({
          characters: [latestCharacter],
          extra: { result: 'fingerprint-changed', latestFingerprintLength: latestFingerprint.length },
        });
        return;
      }

      state.lastSettledFingerprint = startFingerprint;
      if (!distilled.length) {
        timer.finish({
          characters: [latestCharacter],
          extra: { result: 'empty-distilled' },
        });
        return;
      }

      const layeredMemories = consolidateMemoryCandidates(latestCharacter.layeredMemories || [], distilled);
      timer.mark('after-consolidate', {
        characters: [{ ...latestCharacter, layeredMemories } as AICharacter],
        extra: { layeredMemoryCount: layeredMemories.length },
      });
      await params.updateCharacter(latestCharacter.id, { layeredMemories });
      timer.mark('after-update-character', {
        characters: [getCurrentCharacters().find((item) => item.id === characterId) || latestCharacter],
        extra: { layeredMemoryCount: layeredMemories.length },
      });

      const llmDebug = debugLlmCharacterDistillation({ ...latestCharacter, layeredMemories } as AICharacter);
      const llmSource = buildLlmDistillationSource({ layeredMemories });
      const llmInfo = {
        ownerType: 'character' as const,
        ownerId: latestCharacter.id,
        triggered: true,
        reason: 'llm_distilled',
        eligibleCount: llmDebug.eligibleCount,
        newEvidenceCount: Array.from(new Set(llmSource.flatMap((item) => item.sourceEventIds || []))).length,
        candidateTexts: distilled.map((item) => item.text),
      };
      if (!shouldEmitMemoryDistillationEvent(llmInfo)) {
        timer.finish({
          characters: [getCurrentCharacters().find((item) => item.id === characterId) || latestCharacter],
          extra: { result: 'event-not-emitted', eligibleCount: llmInfo.eligibleCount, newEvidenceCount: llmInfo.newEvidenceCount },
        });
        return;
      }

      const participants = getCurrentCharacters().map((item) => ({ id: item.id, name: item.name }));
      await params.appendEventMessage(
        params.chat.id,
        createMemoryDistillationRuntimeEvent(localizeDistillationEventInfo(llmInfo, participants)),
        params.sourceMessageId,
      );
      timer.finish({
        characters: [getCurrentCharacters().find((item) => item.id === characterId) || latestCharacter],
        extra: { result: 'event-emitted', eligibleCount: llmInfo.eligibleCount, newEvidenceCount: llmInfo.newEvidenceCount },
      });
    });
  }
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
  getCurrentChat?: (id: string) => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
}) {
  const { persistedMessage, transition } = await runChatCommitPipeline({
    ...params,
    onCommit: wrapCommitWithFrameworkPatch(params),
  });
  const nextCharacters = applyTransitionToCharacters(params.characters, transition);
  const nextChat = applyTransitionToChat(params.chat, transition);
  const characterIdsToCheck = transition.characterPatches
    .filter((item) => Array.isArray(item.patch.layeredMemories))
    .map((item) => item.characterId);
  void applyDeferredLlmDistillation({
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
}
