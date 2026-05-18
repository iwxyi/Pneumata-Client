import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { SessionGenerationContext } from '../types/sessionEngine';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { runOneRound } from './chatEngine';
import { runSessionCommitPipeline } from './sessionCommitPipeline';
import { resolveSessionEngine } from './sessionEngineRegistry';
import { createSessionRuntimeContext } from './sessionEngineKernel';
import { runSessionActionExecutor } from './sessionActionExecutors/sessionActionExecutorRegistry';
import { createFamilyTurnPolicy, deriveFamilyLoopDecision, getFamilyActionChance } from './sessionFamilies';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SessionLoopPhase = 'starting' | 'paused' | 'waiting_commit' | 'selecting' | 'running_round' | 'sleeping' | 'error_sleeping';

const activeSessionLoops = new Map<string, {
  chatId: string;
  startedAt: number;
  updatedAt: number;
  iterationCount: number;
  phase: SessionLoopPhase;
}>();

function markSessionLoop(loopId: string, patch: Partial<Omit<NonNullable<ReturnType<typeof activeSessionLoops.get>>, 'chatId' | 'startedAt'>>) {
  const current = activeSessionLoops.get(loopId);
  if (!current) return;
  activeSessionLoops.set(loopId, {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  });
}

export function getSessionLoopDebugState() {
  const now = Date.now();
  const loops = Array.from(activeSessionLoops.entries()).map(([loopId, item]) => ({
    loopId,
    chatId: item.chatId,
    ageMs: now - item.startedAt,
    idleMs: now - item.updatedAt,
    iterationCount: item.iterationCount,
    phase: item.phase,
  }));
  return {
    count: loops.length,
    loops,
  };
}

function buildEngineGenerationContext(chat: GroupChat, characters: AICharacter[], messages: Message[]): SessionGenerationContext {
  return {
    conversation: chat,
    characters,
    messages,
  };
}

function getSessionEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  return resolveSessionEngine(chat);
}


function resolveEngineTurnPolicy(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  const engine = getSessionEngine(chat);
  const context = buildEngineGenerationContext(chat, characters, messages);
  return engine.resolveTurnPolicy?.(context) || createFamilyTurnPolicy(chat);
}

function resolveEngineLoopDecision(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  const policy = resolveEngineTurnPolicy(chat, characters, messages);
  return deriveFamilyLoopDecision(policy);
}

async function maybeRunNonChatAction(chat: GroupChat, updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>, appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>) {
  const engine = getSessionEngine(chat);
  const context = createSessionRuntimeContext(engine, chat);
  const actionSchema = engine.getActionSchema?.({ conversation: chat, participants: context.participants }) || null;
  const nonChatAction = actionSchema?.actions.find((action: { type: string }) => action.type !== 'send_message' && action.type !== 'speak') || null;
  if (!nonChatAction) return false;

  const actionChance = getFamilyActionChance(chat);
  if (Math.random() > actionChance) return false;

  const result = runSessionActionExecutor(chat, nonChatAction);
  if (!result) return false;
  if (result.chatPatch) await updateChat(chat.id, result.chatPatch);
  for (const event of result.runtimeEvents || []) {
    await appendEventMessage(chat.id, event);
  }
  return true;
}

function getLoopWaitTime(chat: GroupChat) {
  return (900 / (chat.speed || 1)) + Math.random() * 600;
}

function getLoopErrorWaitTime() {
  return 5000;
}

function shouldContinueLoop(params: { isRunning: () => boolean }) {
  return params.isRunning();
}

function isActiveLoop(params: { isActiveLoop: (loopId: string) => boolean; loopId: string }) {
  return params.isActiveLoop(params.loopId);
}

function getSessionMessages(getCurrentMessages: () => Message[]) {
  return getCurrentMessages();
}

function shouldWaitAfterSessionTick() {
  return true;
}

export async function runSessionLoop(params: {
  loopId: string;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  api: APIConfig;
  getCurrentMessages: () => Message[];
  getStreamingMessage?: () => Message | null;
  getCurrentChat?: () => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
  isRunning: () => boolean;
  isPaused: () => boolean;
  isActiveLoop: (loopId: string) => boolean;
  onSpeakerSelected: (characterId: string) => void;
  onCommitSettled?: () => boolean;
  onCommitStarted?: () => void;
  onCommitFinished?: () => void;
  onIdle?: (reason: string) => void;
  onMessageChunk: (content: string) => void;
  onClearStreamingState: () => void;
  onEngineError: (error: Error) => void;
  onLoopError: (error: unknown) => void;
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: import('../types/runtimeEvent').InteractionEventPayload | null };
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
  getCooldownMap?: () => Record<string, number>;
}) {
  activeSessionLoops.set(params.loopId, {
    chatId: params.chatId,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    iterationCount: 0,
    phase: 'starting',
  });
  try {
    while (shouldContinueLoop(params)) {
      if (!isActiveLoop(params)) return;
      if (params.isPaused()) {
        markSessionLoop(params.loopId, { phase: 'paused' });
        await sleep(120);
        continue;
      }
      if (params.onCommitSettled && !params.onCommitSettled()) {
        markSessionLoop(params.loopId, { phase: 'waiting_commit' });
        await sleep(80);
        continue;
      }

      try {
        markSessionLoop(params.loopId, {
          phase: 'selecting',
          iterationCount: (activeSessionLoops.get(params.loopId)?.iterationCount || 0) + 1,
        });
      const currentMessages = getSessionMessages(params.getCurrentMessages);
      const currentChat = params.getCurrentChat?.() || params.chat;
      const currentCharacters = params.getCurrentCharacters?.() || params.characters;
      if (currentChat.memberIds.length && currentCharacters.length === 0) {
        params.onLoopError(new Error('No active character records available for this chat loop'));
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
        continue;
      }

      const loopCharacters = currentCharacters.filter((character) => currentChat.memberIds.includes(character.id));
      if (currentChat.memberIds.length && loopCharacters.length === 0) {
        params.onLoopError(new Error('All selected members are missing from the active character set'));
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
        continue;
      }

      const effectiveCharacters = loopCharacters.length ? loopCharacters : currentCharacters;
      const engine = getSessionEngine(currentChat);
      const generationContext = buildEngineGenerationContext(currentChat, effectiveCharacters, currentMessages);
      const loopDecision = resolveEngineLoopDecision(currentChat, effectiveCharacters, currentMessages);

      if (loopDecision.canRun && loopDecision.actionFirst) {
        const handled = await maybeRunNonChatAction(currentChat, params.updateChat, params.appendEventMessage);
        if (handled) {
          if (params.isRunning() && !params.isPaused() && shouldWaitAfterSessionTick()) {
            await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
          }
          continue;
        }
      }

      if (!loopDecision.runChat) {
        params.onLoopError(new Error('Current session phase does not allow speaking'));
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
        continue;
      }

      markSessionLoop(params.loopId, { phase: 'running_round' });
      await runOneRound(
        params.chat,
        effectiveCharacters,
        currentMessages,
        params.api,
        {
          onSpeakerSelected: (charId) => {
            if (!isActiveLoop(params)) return;
            params.onSpeakerSelected(charId);
          },
          onMessageChunk: (content) => {
            if (!isActiveLoop(params)) return;
            params.onMessageChunk(content);
          },
          onIdle: (reason) => {
            if (!isActiveLoop(params)) return;
            params.onIdle?.(reason);
          },
          onMessageComplete: async (message) => {
            if (!isActiveLoop(params)) return;
            params.onCommitStarted?.();
            try {
              await runSessionCommitPipeline({
                api: params.api,
                chatId: params.chatId,
                chat: currentChat,
                characters: currentCharacters,
                message,
                streamingMessage: params.getStreamingMessage?.() || null,
                currentMessages: params.getCurrentMessages(),
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
            } finally {
              params.onCommitFinished?.();
              if (isActiveLoop(params)) {
                params.onClearStreamingState();
              }
            }
          },
          onError: (error) => {
            if (!isActiveLoop(params)) return;
            params.onEngineError(error);
          },
        },
        undefined,
        engine.buildGenerationPromptContext
          ? {
              buildPromptContext: (speaker) => engine.buildGenerationPromptContext?.({
                ...generationContext,
                speaker,
              }) || null,
            }
          : undefined,
        params.getCooldownMap?.()
      );

      if (params.isRunning() && !params.isPaused() && shouldWaitAfterSessionTick()) {
        markSessionLoop(params.loopId, { phase: 'sleeping' });
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
      }
      } catch (error) {
        params.onLoopError(error);
        if (!isActiveLoop(params)) return;
        markSessionLoop(params.loopId, { phase: 'error_sleeping' });
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
      }
    }
  } finally {
    activeSessionLoops.delete(params.loopId);
  }
}
