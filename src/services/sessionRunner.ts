import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { SessionEngineDefinition, SessionGenerationContext, SessionTurnPolicy } from '../types/sessionEngine';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import { runOneRound, type LocalInterceptionEvent } from './chatEngine';
import { commitGeneratedMessageTurn } from './generatedMessageTurnCommit';
import { createSessionRuntimeContext } from './sessionEngineKernel';
import { getAllowedSessionActions } from './sessionActionBus';
import { resolveSessionFamilyKey } from './sessionEngineKeys';
import { getCurrentSessionPhase } from './sessionStateMachine';
import { getPreferredAIProfile } from '../types/settings';
import { resolveUserInputHold, type UserDraftActivity } from './userInputBuffer';
import { isGenerationCancelledError } from './generationCancellation';
import { logDeveloperDiagnostic } from './developerDiagnostics';

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

type SessionEngineResolver = (chat: Pick<GroupChat, 'mode' | 'sessionKind'>) => SessionEngineDefinition | Promise<SessionEngineDefinition>;

async function defaultResolveSessionEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>) {
  const { loadSessionEngine } = await import('./sessionEngineLoader');
  return loadSessionEngine(chat);
}

async function getSessionEngine(chat: Pick<GroupChat, 'mode' | 'sessionKind'>, resolver?: SessionEngineResolver) {
  return resolver ? await resolver(chat) : await defaultResolveSessionEngine(chat);
}

function createFallbackTurnPolicy(engine: SessionEngineDefinition, chat: GroupChat) {
  const context = createSessionRuntimeContext(engine, chat);
  const phase = getCurrentSessionPhase(engine, chat);
  const actions = getAllowedSessionActions(engine, context);
  const canSpeak = phase.allowedActions.includes('send_message')
    || phase.allowedActions.includes('speak')
    || phase.allowedActions.includes('all')
    || actions.some((action) => action.type === 'send_message' || action.type === 'speak');
  const canAct = actions.some((action) => action.type !== 'send_message' && action.type !== 'speak');
  const family = resolveSessionFamilyKey(chat);
  if (family === 'interview') return { runChat: canSpeak, runAction: canAct, interleaveAction: canAct };
  if (family === 'deduction' || family === 'mystery') return { runChat: canSpeak, runAction: canAct, interleaveAction: true };
  if (family === 'board_game') return { runChat: canSpeak, runAction: true, interleaveAction: true };
  if (family === 'study' || family === 'analysis' || family === 'agent' || family === 'simulation') {
    return { runChat: canSpeak, runAction: canAct, interleaveAction: canAct };
  }
  return { runChat: canSpeak, runAction: canAct, interleaveAction: canSpeak && canAct };
}

function deriveLoopDecision(policy: SessionTurnPolicy) {
  return {
    canRun: Boolean(policy.runChat || policy.runAction),
    runAction: Boolean(policy.runAction),
    runChat: Boolean(policy.runChat),
    actionFirst: Boolean(policy.interleaveAction && policy.runAction),
  };
}

function getFallbackActionChance(chat: Pick<GroupChat, 'sessionKind' | 'type' | 'mode'>) {
  const family = resolveSessionFamilyKey(chat);
  if (family === 'board_game') return 0.22;
  if (family === 'interview') return 1;
  if (family === 'deduction' || family === 'mystery') return 0.16;
  if (family === 'study') return 0.12;
  if (family === 'analysis' || family === 'simulation') return 0.1;
  if (family === 'agent') return 0.2;
  return 0.08;
}

function resolveEngineTurnPolicy(engine: SessionEngineDefinition, chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  const context = buildEngineGenerationContext(chat, characters, messages);
  return engine.resolveTurnPolicy?.(context) || createFallbackTurnPolicy(engine, chat);
}

function resolveEngineLoopDecision(engine: SessionEngineDefinition, chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  const policy = resolveEngineTurnPolicy(engine, chat, characters, messages);
  return deriveLoopDecision(policy);
}

async function maybeRunNonChatAction(
  engine: SessionEngineDefinition,
  chat: GroupChat,
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>,
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>,
  random: () => number = Math.random,
) {
  const context = createSessionRuntimeContext(engine, chat);
  const actionSchema = engine.getActionSchema?.({ conversation: chat, participants: context.participants }) || null;
  const nonChatAction = actionSchema?.actions.find((action: { type: string }) => action.type !== 'send_message' && action.type !== 'speak') || null;
  if (!nonChatAction) return false;

  const actionChance = getFallbackActionChance(chat);
  if (random() > actionChance) return false;

  const { runSessionActionExecutor } = await import('./sessionActionExecutors/sessionActionExecutorRegistry');
  const result = runSessionActionExecutor(chat, nonChatAction);
  if (!result) return false;
  if (result.chatPatch) await updateChat(chat.id, result.chatPatch);
  for (const event of result.runtimeEvents || []) {
    await appendEventMessage(chat.id, event);
  }
  return true;
}

function getLoopWaitTime(chat: GroupChat, random: () => number = Math.random) {
  return (900 / (chat.speed || 1)) + random() * 600;
}

function getLoopErrorWaitTime() {
  return 5000;
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function buildRuntimeErrorEvent(error: unknown, title: string): DriverMessageCommitResult['runtimeEvents'][number] {
  return {
    eventType: 'runtime_error',
    title,
    summary: formatErrorMessage(error),
    eventClass: 'phase',
    visibilityScope: 'public',
    channelId: 'public',
  };
}

async function appendRecoverableRuntimeError(params: {
  chatId: string;
  error: unknown;
  title: string;
  sourceMessageId?: string;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number], sourceMessageId?: string) => Promise<void>;
  onLoopError: (error: unknown) => void;
}) {
  try {
    await params.appendEventMessage(params.chatId, buildRuntimeErrorEvent(params.error, params.title), params.sourceMessageId);
  } catch (appendError) {
    params.onLoopError(appendError);
  }
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

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function shouldWaitAfterSessionTick() {
  return true;
}

function resolveCommitApiConfig(api: APIConfig | AIModelProfile[]): APIConfig {
  if (!Array.isArray(api)) return api;
  const profile = getPreferredAIProfile(api, 'text') || api.find((item) => (item.type || 'text') === 'text') || api[0];
  return {
    provider: profile.provider,
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    model: profile.model,
  };
}

export async function runSessionLoop(params: {
  loopId: string;
  chatId: string;
  chat: GroupChat;
  characters: AICharacter[];
  api: APIConfig | AIModelProfile[];
  getCurrentMessages: () => Message[];
  getUserDraftActivity?: () => UserDraftActivity | null;
  getStreamingMessage?: () => Message | null;
  getCurrentChat?: () => GroupChat | undefined;
  getCurrentCharacters?: () => AICharacter[];
  ensureCharacterDetail?: (characterId: string) => Promise<AICharacter | null>;
  isRunning: () => boolean;
  isPaused: () => boolean;
  isActiveLoop: (loopId: string) => boolean;
  onSpeakerSelected: (characterId: string, speaker?: AICharacter) => void;
  onCommitSettled?: () => boolean;
  onCommitStarted?: () => void;
  onCommitFinished?: () => void;
  pauseLoop?: () => void;
  onTurnWorkStarted?: () => void;
  onTurnWorkFinished?: () => void;
  onIdle?: (reason: string) => void;
  onMessageChunk: (content: string) => void;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
  onClearStreamingState: () => void;
  onEngineError: (error: Error) => void;
  onLoopError: (error: unknown) => void;
  onCommit: (args: {
    conversation: GroupChat;
    characters: AICharacter[];
    message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'> & { interactionHint?: import('../types/runtimeEvent').InteractionEventPayload | null };
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
  resolveSessionEngine?: SessionEngineResolver;
  random?: () => number;
  signal?: AbortSignal;
}) {
  const random = params.random || Math.random;
  activeSessionLoops.set(params.loopId, {
    chatId: params.chatId,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    iterationCount: 0,
    phase: 'starting',
  });
  try {
    while (shouldContinueLoop(params)) {
      if (params.signal?.aborted) return;
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
      const turnStartedAt = nowMs();
      let roundStreamingMessage: Message | null = null;
      let turnWorkActive = true;
      params.onTurnWorkStarted?.();
      try {
        markSessionLoop(params.loopId, {
          phase: 'selecting',
          iterationCount: (activeSessionLoops.get(params.loopId)?.iterationCount || 0) + 1,
        });
      const currentMessages = getSessionMessages(params.getCurrentMessages);
      const currentChat = params.getCurrentChat?.() || params.chat;
      const currentCharacters = params.getCurrentCharacters?.() || params.characters;
      const inputHold = resolveUserInputHold({
        messages: currentMessages,
        draft: params.getUserDraftActivity?.() || null,
      });
      if (inputHold.shouldHold) {
        turnWorkActive = false;
        params.onTurnWorkFinished?.();
        markSessionLoop(params.loopId, { phase: 'sleeping' });
        await new Promise((resolve) => setTimeout(resolve, inputHold.delayMs));
        continue;
      }
      if (currentChat.memberIds.length && currentCharacters.length === 0) {
        turnWorkActive = false;
        params.onTurnWorkFinished?.();
        params.onLoopError(new Error('No active character records available for this chat loop'));
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
        continue;
      }

      const loopCharacters = currentCharacters.filter((character) => currentChat.memberIds.includes(character.id));
      if (currentChat.memberIds.length && loopCharacters.length === 0) {
        turnWorkActive = false;
        params.onTurnWorkFinished?.();
        params.onLoopError(new Error('All selected members are missing from the active character set'));
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
        continue;
      }

      const effectiveCharacters = loopCharacters.length ? loopCharacters : currentCharacters;
      const engine = await getSessionEngine(currentChat, params.resolveSessionEngine);
      const generationContext = buildEngineGenerationContext(currentChat, effectiveCharacters, currentMessages);
      const loopDecision = resolveEngineLoopDecision(engine, currentChat, effectiveCharacters, currentMessages);
      logDeveloperDiagnostic('chat-run:turn-selected', {
        chatId: params.chatId,
        loopId: params.loopId,
        messageCount: currentMessages.length,
        characterCount: effectiveCharacters.length,
        phase: currentChat.scenarioState?.phase || null,
        loopDecision,
        elapsedMs: Number((nowMs() - turnStartedAt).toFixed(2)),
      }, 'debug', 'chat-run');

      if (loopDecision.canRun && loopDecision.actionFirst) {
        const handled = await maybeRunNonChatAction(engine, currentChat, params.updateChat, params.appendEventMessage, random);
        if (handled) {
          turnWorkActive = false;
          params.onTurnWorkFinished?.();
          if (params.isRunning() && !params.isPaused() && shouldWaitAfterSessionTick()) {
            await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(currentChat, random)));
          }
          continue;
        }
      }

      if (!loopDecision.runChat) {
        turnWorkActive = false;
        params.onTurnWorkFinished?.();
        params.onLoopError(new Error('Current session phase does not allow speaking'));
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(currentChat, random)));
        continue;
      }

      markSessionLoop(params.loopId, { phase: 'running_round' });
      const roundStartedAt = nowMs();
      let firstChunkLogged = false;
      await runOneRound(
        currentChat,
        effectiveCharacters,
        currentMessages,
        params.api,
        {
          onSpeakerSelected: (charId, speaker) => {
            if (!isActiveLoop(params)) return;
            logDeveloperDiagnostic('chat-run:speaker-selected', {
              chatId: params.chatId,
              loopId: params.loopId,
              speakerId: charId,
              speakerName: speaker?.name || null,
              elapsedMs: Number((nowMs() - roundStartedAt).toFixed(2)),
            }, 'debug', 'chat-run');
            params.onSpeakerSelected(charId, speaker);
            roundStreamingMessage = params.getStreamingMessage?.() || null;
          },
          ensureSpeakerDetail: (charId) => params.ensureCharacterDetail?.(charId) || Promise.resolve(undefined),
          onMessageChunk: (content) => {
            if (!isActiveLoop(params)) return;
            if (!firstChunkLogged) {
              firstChunkLogged = true;
              logDeveloperDiagnostic('chat-run:first-chunk', {
                chatId: params.chatId,
                loopId: params.loopId,
                speakerId: roundStreamingMessage?.senderId || null,
                contentLength: content.length,
                elapsedMs: Number((nowMs() - roundStartedAt).toFixed(2)),
              }, 'info', 'chat-run');
            }
            params.onMessageChunk(content);
          },
          onLocalInterception: async (event) => {
            if (!isActiveLoop(params)) return;
            await params.onLocalInterception?.(event);
          },
          onIdle: (reason) => {
            if (!isActiveLoop(params)) return;
            params.onIdle?.(reason);
          },
          onMessageComplete: async (message) => {
            if (!isActiveLoop(params)) return;
            logDeveloperDiagnostic('chat-run:message-complete', {
              chatId: params.chatId,
              loopId: params.loopId,
              speakerId: message.senderId,
              contentLength: message.content.length,
              elapsedMs: Number((nowMs() - roundStartedAt).toFixed(2)),
            }, 'info', 'chat-run');
            params.onCommitStarted?.();
            const commitStartedAt = nowMs();
            try {
              await commitGeneratedMessageTurn({
                api: resolveCommitApiConfig(params.api),
                chatId: params.chatId,
                chat: currentChat,
                characters: currentCharacters,
                message,
                streamingMessage: roundStreamingMessage || params.getStreamingMessage?.() || null,
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
                aiProfiles: Array.isArray(params.api) ? params.api : undefined,
                getCurrentChat: params.getCurrentChat,
                getCurrentCharacters: params.getCurrentCharacters,
              });
            } catch (error) {
              params.onLoopError(error);
              if (isActiveLoop(params)) {
                await appendRecoverableRuntimeError({
                  chatId: params.chatId,
                  error,
                  title: '提交失败',
                  sourceMessageId: roundStreamingMessage?.id,
                  appendEventMessage: params.appendEventMessage,
                  onLoopError: params.onLoopError,
                });
              }
            } finally {
              logDeveloperDiagnostic('chat-run:commit-finished', {
                chatId: params.chatId,
                loopId: params.loopId,
                speakerId: message.senderId,
                elapsedMs: Number((nowMs() - commitStartedAt).toFixed(2)),
              }, 'info', 'chat-run');
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
          signal: params.signal,
        },
        undefined,
        engine.buildGenerationPromptContext
          ? {
              sessionEngine: engine,
              buildPromptContext: (speaker) => engine.buildGenerationPromptContext?.({
                ...generationContext,
                speaker,
              }) || null,
            }
          : { sessionEngine: engine },
        params.getCooldownMap?.()
      );

      turnWorkActive = false;
      params.onTurnWorkFinished?.();
      logDeveloperDiagnostic('chat-run:turn-finished', {
        chatId: params.chatId,
        loopId: params.loopId,
        elapsedMs: Number((nowMs() - turnStartedAt).toFixed(2)),
      }, 'info', 'chat-run');

      if (params.isRunning() && !params.isPaused() && shouldWaitAfterSessionTick()) {
        markSessionLoop(params.loopId, { phase: 'sleeping' });
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(currentChat, random)));
      }
      } finally {
        if (turnWorkActive) params.onTurnWorkFinished?.();
      }
      } catch (error) {
        if (isGenerationCancelledError(error) || params.signal?.aborted) {
          params.onClearStreamingState();
          params.pauseLoop?.();
          return;
        }
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('[session-runner:loop-error]', {
            error,
            chatId: params.chatId,
            loopId: params.loopId,
            phase: activeSessionLoops.get(params.loopId)?.phase,
            running: params.isRunning(),
            paused: params.isPaused(),
            streamingMessage: params.getStreamingMessage?.() || null,
          });
        }
        params.onLoopError(error);
        if (!isActiveLoop(params)) return;
        await appendRecoverableRuntimeError({
          chatId: params.chatId,
          error,
          title: '运行异常',
          sourceMessageId: params.getStreamingMessage?.()?.id,
          appendEventMessage: params.appendEventMessage,
          onLoopError: params.onLoopError,
        });
        markSessionLoop(params.loopId, { phase: 'error_sleeping' });
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
      }
    }
  } finally {
    activeSessionLoops.delete(params.loopId);
  }
}
