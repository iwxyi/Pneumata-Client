import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
import type { SessionGenerationContext } from '../types/sessionEngine';
import type { Message } from '../types/message';
import type { APIConfig } from '../types/settings';
import { runOneRound } from './chatEngine';
import { runSessionCommitPipeline } from './sessionCommitPipeline';
import { getSessionEngine } from './sessionEngineRegistry';
import { createSessionRuntimeContext } from './sessionEngineKernel';
import { getCurrentSessionPhase } from './sessionStateMachine';
import { getAllowedSessionActions } from './sessionActionBus';
import { runSessionActionExecutor } from './sessionActionExecutors/sessionActionExecutorRegistry';
import { shouldInterviewAllowSpeak, shouldInterviewRunAction } from './interviewRunnerPolicy';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function revealMessageContent(params: {
  content: string;
  isActive: () => boolean;
  onChunk: (content: string) => void;
}) {
  const glyphs = Array.from(params.content);
  if (glyphs.length === 0) {
    params.onChunk('');
    return;
  }

  const targetSteps = Math.min(28, Math.max(10, Math.ceil(glyphs.length / 3)));
  const baseSize = Math.max(1, Math.ceil(glyphs.length / targetSteps));
  let index = 0;

  while (index < glyphs.length) {
    if (!params.isActive()) return;
    index = Math.min(glyphs.length, index + baseSize);
    params.onChunk(glyphs.slice(0, index).join(''));
    if (index < glyphs.length) {
      await sleep(glyphs.length <= 24 ? 24 : 18);
    }
  }
}

function buildEngineGenerationContext(chat: GroupChat, characters: AICharacter[], messages: Message[]): SessionGenerationContext {
  return {
    conversation: chat,
    characters,
    messages,
  };
}

function resolveEngineTurnPolicy(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  const engine = getSessionEngine(chat.mode);
  const context = buildEngineGenerationContext(chat, characters, messages);
  const policy = engine.resolveTurnPolicy?.(context);
  if (policy) return policy;
  return {
    runChat: shouldInterviewAllowSpeak(chat) && isSpeakAllowed(chat),
    runAction: canAttemptNonChatAction(chat) && (chat.mode !== 'interview' || shouldInterviewRunAction(chat)),
    interleaveAction: canAttemptNonChatAction(chat) && (shouldInterviewAllowSpeak(chat) && isSpeakAllowed(chat)),
  };
}

function canRunSpeakWithEnginePolicy(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return resolveEngineTurnPolicy(chat, characters, messages).runChat;
}

function canRunNonChatWithEnginePolicy(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return resolveEngineTurnPolicy(chat, characters, messages).runAction;
}

function getPhaseAwareLoopState(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return { speakAllowed: canRunSpeakWithEnginePolicy(chat, characters, messages), hasNonChatAction: canRunNonChatWithEnginePolicy(chat, characters, messages) };
}

function getPhaseAwareControl(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  const state = getPhaseAwareLoopState(chat, characters, messages);
  return {
    skipSpeak: !state.speakAllowed,
    allowInterleaveAction: state.hasNonChatAction,
  };
}

function shouldRunInterviewActionBeforeRound(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return getPhaseAwareControl(chat, characters, messages).allowInterleaveAction;
}

function shouldRunInterviewRound(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return !getPhaseAwareControl(chat, characters, messages).skipSpeak;
}

function getEngineLoopGate(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return {
    runTurn: shouldRunInterviewRound(chat, characters, messages),
    actionFirst: shouldRunInterviewActionBeforeRound(chat, characters, messages),
  };
}

function getLoopExecutionPolicy(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  const gate = getEngineLoopGate(chat, characters, messages);
  return {
    runAction: gate.actionFirst,
    runChat: gate.runTurn,
    skip: !gate.runTurn && !gate.actionFirst,
  };
}

function shouldExecuteLoopAction(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return getLoopExecutionPolicy(chat, characters, messages).runAction;
}

function shouldExecuteLoopChat(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return getLoopExecutionPolicy(chat, characters, messages).runChat;
}

function shouldSkipLoopExecution(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return getLoopExecutionPolicy(chat, characters, messages).skip;
}

function maybeRunEngineAction(chat: GroupChat, updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>, appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>) {
  return maybeRunNonChatAction(chat, updateChat, appendEventMessage);
}

function isSpeakAllowed(chat: GroupChat) {
  const engine = getSessionEngine(chat.mode);
  const context = createSessionRuntimeContext(engine, chat);
  const phase = getCurrentSessionPhase(engine, chat);
  const actions = getAllowedSessionActions(engine, context);
  return phase.allowedActions.includes('send_message')
    || phase.allowedActions.includes('speak')
    || phase.allowedActions.includes('all')
    || actions.some((action) => action.type === 'send_message' || action.type === 'speak');
}

async function maybeRunNonChatAction(chat: GroupChat, updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>, appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>) {
  const engine = getSessionEngine(chat.mode);
  const context = createSessionRuntimeContext(engine, chat);
  const actionSchema = engine.getActionSchema?.({ conversation: chat, participants: context.participants }) || null;
  const nonChatAction = actionSchema?.actions.find((action: { type: string }) => action.type === 'ask_question') || null;
  if (!nonChatAction || Math.random() > 0.08) return false;
  const result = runSessionActionExecutor(chat, nonChatAction);
  if (!result) return false;
  if (result.chatPatch) await updateChat(chat.id, result.chatPatch);
  for (const event of result.runtimeEvents || []) {
    await appendEventMessage(chat.id, event);
  }
  return true;
}

function getLoopWaitTime(chat: GroupChat) {
  return (3000 / (chat.speed || 1)) + Math.random() * 2000;
}

function getLoopErrorWaitTime() {
  return 5000;
}

function shouldContinueLoop(params: { isRunning: () => boolean; isPaused: () => boolean }) {
  return params.isRunning() && !params.isPaused();
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

function getSessionEngineForChat(chat: GroupChat) {
  return getSessionEngine(chat.mode);
}

function canAttemptNonChatAction(chat: GroupChat) {
  const engine = getSessionEngineForChat(chat);
  const context = createSessionRuntimeContext(engine, chat);
  return getAllowedSessionActions(engine, context).some((action) => action.type !== 'send_message' && action.type !== 'speak');
}

function getSessionLoopMode(chat: GroupChat) {
  return chat.mode;
}

function canRunLoop(chat: GroupChat) {
  return Boolean(getSessionLoopMode(chat));
}

function shouldRunSpeakAction(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return canRunSpeakWithEnginePolicy(chat, characters, messages);
}

function shouldRunTickAction(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return shouldExecuteLoopAction(chat, characters, messages);
}

function shouldRunTickChat(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return shouldRunSpeakAction(chat, characters, messages);
}

function getTickExecution(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return {
    canRun: canRunLoop(chat) && !shouldSkipLoopExecution(chat, characters, messages),
    runAction: shouldExecuteLoopAction(chat, characters, messages),
    runChat: shouldExecuteLoopChat(chat, characters, messages),
  };
}

function shouldExecuteAnyTick(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return getTickExecution(chat, characters, messages).canRun;
}

function shouldExecuteTickAction(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return shouldRunTickAction(chat, characters, messages);
}

function shouldExecuteTickChat(chat: GroupChat, characters: AICharacter[], messages: Message[]) {
  return shouldRunTickChat(chat, characters, messages);
}

export async function runSessionLoop(params: {
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
    message: Pick<Message, 'content' | 'type' | 'senderId'> & { interactionHint?: import('../types/runtimeEvent').InteractionEventPayload | null };
    previousAiMessage: Pick<Message, 'senderId'> | null;
    recentMessages?: Message[];
    apiConfig?: APIConfig;
  }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>;
  upsertMessage: (message: Message) => void;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
}) {
  while (shouldContinueLoop(params)) {
    if (!isActiveLoop(params)) return;

    try {
      const currentMessages = getSessionMessages(params.getCurrentMessages);
      if (params.chat.memberIds.length && params.characters.length === 0) {
        params.onLoopError(new Error('No active character records available for this chat loop'));
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
        continue;
      }

      const loopCharacters = params.characters.filter((character) => params.chat.memberIds.includes(character.id));
      if (params.chat.memberIds.length && loopCharacters.length === 0) {
        params.onLoopError(new Error('All selected members are missing from the active character set'));
        await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
        continue;
      }

      const effectiveCharacters = loopCharacters.length ? loopCharacters : params.characters;
      const engine = getSessionEngine(params.chat.mode);
      const generationContext = buildEngineGenerationContext(params.chat, effectiveCharacters, currentMessages);

      if (shouldExecuteAnyTick(params.chat, effectiveCharacters, currentMessages) && shouldExecuteTickAction(params.chat, effectiveCharacters, currentMessages)) {
        const handled = await maybeRunNonChatAction(params.chat, params.updateChat, params.appendEventMessage);
        if (handled) {
          if (params.isRunning() && !params.isPaused() && shouldWaitAfterSessionTick()) {
            await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
          }
          continue;
        }
      }

      if (!shouldExecuteTickChat(params.chat, effectiveCharacters, currentMessages)) {
        params.onLoopError(new Error('Current session phase does not allow speaking'));
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
        continue;
      }

      const preselectedSpeaker = effectiveCharacters.find((character) => character.id === currentMessages.filter((message) => message.type === 'ai' && !message.isDeleted).at(-1)?.senderId)
        || effectiveCharacters[0]
        || null;
      const roundPromptContext: ReturnType<NonNullable<typeof engine.buildGenerationPromptContext>> | null = preselectedSpeaker
        ? engine.buildGenerationPromptContext?.({
            ...generationContext,
            speaker: preselectedSpeaker,
          }) || null
        : null;
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
          onMessageComplete: async (message) => {
            if (!isActiveLoop(params)) return;
            try {
              await revealMessageContent({
                content: message.content,
                isActive: () => isActiveLoop(params),
                onChunk: params.onMessageChunk,
              });
              await runSessionCommitPipeline({
                api: params.api,
                chatId: params.chatId,
                chat: params.chat,
                characters: params.characters,
                message,
                currentMessages: params.getCurrentMessages(),
                onCommit: params.onCommit,
                upsertMessage: params.upsertMessage,
                updateCharacter: params.updateCharacter,
                appendEventMessage: params.appendEventMessage,
                updateChat: params.updateChat,
                recordSpeak: params.recordSpeak,
              });
            } finally {
              if (!isActiveLoop(params)) return;
              params.onClearStreamingState();
            }
          },
          onError: (error) => {
            if (!isActiveLoop(params)) return;
            params.onEngineError(error);
          },
        },
        undefined,
        {
          promptContext: roundPromptContext,
        }
      );

      if (!isActiveLoop(params)) return;
      if (shouldContinueLoop(params)) {
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
      }
    } catch (error) {
      if (!isActiveLoop(params)) return;
      params.onLoopError(error);
      await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
    }
  }
}
