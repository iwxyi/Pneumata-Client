import type { AICharacter } from '../types/character';
import type { GroupChat, DriverMessageCommitResult } from '../types/chat';
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

function canRunSpeakWithEnginePolicy(chat: GroupChat) {
  return shouldInterviewAllowSpeak(chat) && isSpeakAllowed(chat);
}

function canRunNonChatWithEnginePolicy(chat: GroupChat) {
  return canAttemptNonChatAction(chat) && (chat.mode !== 'interview' || shouldInterviewRunAction(chat));
}

function getPhaseAwareLoopState(chat: GroupChat) {
  return { speakAllowed: canRunSpeakWithEnginePolicy(chat), hasNonChatAction: canRunNonChatWithEnginePolicy(chat) };
}

function getPhaseAwareControl(chat: GroupChat) {
  const state = getPhaseAwareLoopState(chat);
  return {
    skipSpeak: !state.speakAllowed,
    allowInterleaveAction: state.hasNonChatAction,
  };
}

function shouldRunInterviewActionBeforeRound(chat: GroupChat) {
  return getPhaseAwareControl(chat).allowInterleaveAction;
}

function shouldRunInterviewRound(chat: GroupChat) {
  return !getPhaseAwareControl(chat).skipSpeak;
}

function getEngineLoopGate(chat: GroupChat) {
  return {
    runTurn: shouldRunInterviewRound(chat),
    actionFirst: shouldRunInterviewActionBeforeRound(chat),
  };
}

function shouldEngineInvokeChat(chat: GroupChat) {
  return getEngineLoopGate(chat).runTurn;
}

function shouldEngineInvokeAction(chat: GroupChat) {
  return getEngineLoopGate(chat).actionFirst;
}

function getEngineLoopPlan(chat: GroupChat) {
  return {
    invokeChatEngine: shouldEngineInvokeChat(chat),
    invokeActionScaffold: shouldEngineInvokeAction(chat),
  };
}

function shouldProcessEngineChat(chat: GroupChat) {
  return getEngineLoopPlan(chat).invokeChatEngine;
}

function shouldProcessEngineAction(chat: GroupChat) {
  return getEngineLoopPlan(chat).invokeActionScaffold;
}

function canRunEngineFlow(chat: GroupChat) {
  return shouldProcessEngineChat(chat) || shouldProcessEngineAction(chat);
}

function shouldSkipEngineIteration(chat: GroupChat) {
  return !canRunEngineFlow(chat);
}

function getEngineIterationPlan(chat: GroupChat) {
  return {
    skip: shouldSkipEngineIteration(chat),
    runAction: shouldProcessEngineAction(chat),
    runChat: shouldProcessEngineChat(chat),
  };
}

function shouldEngineRunAction(chat: GroupChat) {
  return getEngineIterationPlan(chat).runAction;
}

function shouldEngineRunChat(chat: GroupChat) {
  return getEngineIterationPlan(chat).runChat;
}

function shouldEngineSkip(chat: GroupChat) {
  return getEngineIterationPlan(chat).skip;
}

function getRunnerEnginePlan(chat: GroupChat) {
  return getEngineIterationPlan(chat);
}

function shouldRunActionWithEnginePolicy(chat: GroupChat) {
  return getRunnerEnginePlan(chat).runAction;
}

function shouldRunChatWithEnginePolicy(chat: GroupChat) {
  return getRunnerEnginePlan(chat).runChat;
}

function shouldSkipWithEnginePolicy(chat: GroupChat) {
  return getRunnerEnginePlan(chat).skip;
}

function getSessionEngineAwareState(chat: GroupChat) {
  return {
    runAction: shouldRunActionWithEnginePolicy(chat),
    runChat: shouldRunChatWithEnginePolicy(chat),
    skip: shouldSkipWithEnginePolicy(chat),
  };
}

function shouldExecuteActionWithPolicy(chat: GroupChat) {
  return getSessionEngineAwareState(chat).runAction;
}

function shouldExecuteChatWithPolicy(chat: GroupChat) {
  return getSessionEngineAwareState(chat).runChat;
}

function shouldSkipWithPolicy(chat: GroupChat) {
  return getSessionEngineAwareState(chat).skip;
}

function getPolicyResult(chat: GroupChat) {
  return {
    action: shouldExecuteActionWithPolicy(chat),
    chat: shouldExecuteChatWithPolicy(chat),
    skip: shouldSkipWithPolicy(chat),
  };
}

function shouldRunActionByPolicy(chat: GroupChat) {
  return getPolicyResult(chat).action;
}

function shouldRunChatByPolicy(chat: GroupChat) {
  return getPolicyResult(chat).chat;
}

function shouldSkipByPolicy(chat: GroupChat) {
  return getPolicyResult(chat).skip;
}

function getPolicyLoopState(chat: GroupChat) {
  return {
    runAction: shouldRunActionByPolicy(chat),
    runChat: shouldRunChatByPolicy(chat),
    skip: shouldSkipByPolicy(chat),
  };
}

function shouldRunPolicyAction(chat: GroupChat) {
  return getPolicyLoopState(chat).runAction;
}

function shouldRunPolicyChat(chat: GroupChat) {
  return getPolicyLoopState(chat).runChat;
}

function shouldSkipPolicy(chat: GroupChat) {
  return getPolicyLoopState(chat).skip;
}

function getLoopExecutionPolicy(chat: GroupChat) {
  return {
    runAction: shouldRunPolicyAction(chat),
    runChat: shouldRunPolicyChat(chat),
    skip: shouldSkipPolicy(chat),
  };
}

function shouldExecuteLoopAction(chat: GroupChat) {
  return getLoopExecutionPolicy(chat).runAction;
}

function shouldExecuteLoopChat(chat: GroupChat) {
  return getLoopExecutionPolicy(chat).runChat;
}

function shouldSkipLoopExecution(chat: GroupChat) {
  return getLoopExecutionPolicy(chat).skip;
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

function shouldUseChatEngine(chat: GroupChat) {
  return shouldRunSpeakAction(chat);
}

function canUseNonChatAction(chat: GroupChat) {
  return canAttemptNonChatAction(chat);
}

function getLoopState(chat: GroupChat) {
  return { mode: chat.mode, speakAllowed: shouldRunSpeakAction(chat), hasNonChatAction: canUseNonChatAction(chat) };
}

function shouldRunNonChatAction(chat: GroupChat) {
  const state = getLoopState(chat);
  return state.hasNonChatAction && !state.speakAllowed;
}

function canInterleaveNonChatAction(chat: GroupChat) {
  const state = getLoopState(chat);
  return state.hasNonChatAction && state.speakAllowed;
}

function shouldRunSpeakAction(chat: GroupChat) {
  return canRunSpeakWithEnginePolicy(chat);
}

function getLoopMode(chat: GroupChat) {
  return {
    speak: shouldRunSpeakAction(chat),
    nonChat: shouldRunNonChatAction(chat),
    interleave: canInterleaveNonChatAction(chat),
  };
}

function shouldRunTickAction(chat: GroupChat) {
  const mode = getLoopMode(chat);
  return mode.nonChat || mode.interleave;
}

function shouldRunTickChat(chat: GroupChat) {
  return getLoopMode(chat).speak;
}

function getTickExecution(chat: GroupChat) {
  return {
    canRun: canRunLoop(chat) && !shouldSkipLoopExecution(chat),
    runAction: shouldExecuteLoopAction(chat),
    runChat: shouldExecuteLoopChat(chat),
  };
}

function canRunTick(chat: GroupChat) {
  return getTickExecution(chat).canRun;
}

function getPhaseAwareExecution(chat: GroupChat) {
  return {
    canRunTick: canRunTick(chat),
    runTickAction: shouldRunTickAction(chat),
    runTickChat: shouldRunTickChat(chat),
  };
}

function shouldExecuteAnyTick(chat: GroupChat) {
  return getPhaseAwareExecution(chat).canRunTick;
}

function shouldExecuteTickAction(chat: GroupChat) {
  return getPhaseAwareExecution(chat).runTickAction;
}

function shouldExecuteTickChat(chat: GroupChat) {
  return getPhaseAwareExecution(chat).runTickChat;
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

      if (shouldExecuteAnyTick(params.chat) && shouldExecuteTickAction(params.chat)) {
        const handled = await maybeRunNonChatAction(params.chat, params.updateChat, params.appendEventMessage);
        if (handled) {
          if (params.isRunning() && !params.isPaused() && shouldWaitAfterSessionTick()) {
            await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
          }
          continue;
        }
      }

      if (!shouldExecuteTickChat(params.chat)) {
        params.onLoopError(new Error('Current session phase does not allow speaking'));
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
        continue;
      }

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
