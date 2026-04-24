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
  return phase.allowedActions.includes('send_message') || actions.some((action) => action.type === 'send_message');
}

async function maybeRunNonChatAction(chat: GroupChat, updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>, appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>) {
  const engine = getSessionEngine(chat.mode);
  const context = createSessionRuntimeContext(engine, chat);
  const actions = getAllowedSessionActions(engine, context);
  const actionSchema = engine.getActionSchema?.({ conversation: chat, participants: context.participants }) || null;
  const nonChatAction = actionSchema?.actions.find((action) => action.type === 'ask_question') || null;
  if (!nonChatAction || Math.random() > 0.08) return false;
  const result = runSessionActionExecutor(chat, nonChatAction);
  if (!result) return false;
  if (result.chatPatch) {
    await updateChat(chat.id, result.chatPatch);
  }
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

function getSessionEngineForChat(chat: GroupChat) {
  return getSessionEngine(chat.mode);
}

function shouldRunSpeakAction(chat: GroupChat) {
  return canRunSpeakWithEnginePolicy(chat);
}

function canAttemptNonChatAction(chat: GroupChat) {
  const engine = getSessionEngineForChat(chat);
  const context = createSessionRuntimeContext(engine, chat);
  return getAllowedSessionActions(engine, context).some((action) => action.type !== 'send_message');
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

function shouldSkipChatTurn(chat: GroupChat) {
  return !shouldRunSpeakAction(chat);
}

function getLoopControl(chat: GroupChat) {
  return {
    skipSpeak: shouldSkipChatTurn(chat),
    allowInterleaveAction: canInterleaveNonChatAction(chat),
  };
}

function shouldExecuteInterleavedAction(chat: GroupChat) {
  return getLoopControl(chat).allowInterleaveAction && Math.random() < 0.06;
}

function shouldExecuteStandaloneAction(chat: GroupChat) {
  return shouldRunNonChatAction(chat);
}

function canRunAnyAction(chat: GroupChat) {
  const control = getLoopControl(chat);
  return !control.skipSpeak || control.allowInterleaveAction;
}

function shouldRunSessionTurn(chat: GroupChat) {
  return canRunAnyAction(chat);
}

function shouldPauseForAction(chat: GroupChat) {
  return shouldExecuteStandaloneAction(chat) || shouldExecuteInterleavedAction(chat);
}

function getChatLoopGate(chat: GroupChat) {
  return {
    runTurn: shouldRunSessionTurn(chat),
    actionFirst: shouldPauseForAction(chat),
  };
}

function shouldRunRound(chat: GroupChat) {
  return getChatLoopGate(chat).runTurn;
}

function shouldRunActionBeforeRound(chat: GroupChat) {
  return getChatLoopGate(chat).actionFirst;
}

function getChatLoopPolicy(chat: GroupChat) {
  return {
    runRound: shouldRunRound(chat),
    runActionFirst: shouldRunActionBeforeRound(chat),
  };
}

function shouldInvokeChatEngine(chat: GroupChat) {
  return getChatLoopPolicy(chat).runRound && !shouldExecuteStandaloneAction(chat);
}

function shouldInvokeActionScaffold(chat: GroupChat) {
  return getChatLoopPolicy(chat).runActionFirst;
}

function getSessionLoopPlan(chat: GroupChat) {
  return {
    invokeChatEngine: shouldInvokeChatEngine(chat),
    invokeActionScaffold: shouldInvokeActionScaffold(chat),
  };
}

function shouldProcessChatEngine(chat: GroupChat) {
  return getSessionLoopPlan(chat).invokeChatEngine;
}

function shouldProcessActionScaffold(chat: GroupChat) {
  return getSessionLoopPlan(chat).invokeActionScaffold;
}

function canRunChatOrAction(chat: GroupChat) {
  const plan = getSessionLoopPlan(chat);
  return plan.invokeChatEngine || plan.invokeActionScaffold;
}

function shouldAdvanceSession(chat: GroupChat) {
  return canRunChatOrAction(chat);
}

function shouldRunSessionAction(chat: GroupChat) {
  return shouldProcessActionScaffold(chat);
}

function shouldRunSessionChat(chat: GroupChat) {
  return shouldProcessChatEngine(chat);
}

function canRunSession(chat: GroupChat) {
  return shouldAdvanceSession(chat);
}

function shouldWaitAfterSessionTick() {
  return true;
}

function shouldAbortSessionTick(chat: GroupChat) {
  return !canRunSession(chat);
}

function getSessionTickPolicy(chat: GroupChat) {
  return {
    abort: shouldAbortSessionTick(chat),
    runAction: shouldRunSessionAction(chat),
    runChat: shouldRunSessionChat(chat),
  };
}

function shouldRunActionTick(chat: GroupChat) {
  return getSessionTickPolicy(chat).runAction;
}

function shouldRunChatTick(chat: GroupChat) {
  return getSessionTickPolicy(chat).runChat;
}

function shouldAbortTick(chat: GroupChat) {
  return getSessionTickPolicy(chat).abort;
}

function canExecuteSessionTick(chat: GroupChat) {
  return !shouldAbortTick(chat);
}

function shouldExecuteSessionChat(chat: GroupChat) {
  return canExecuteSessionTick(chat) && shouldRunChatTick(chat);
}

function shouldExecuteSessionAction(chat: GroupChat) {
  return canExecuteSessionTick(chat) && shouldRunActionTick(chat);
}

function canExecuteSessionFlow(chat: GroupChat) {
  return shouldExecuteSessionChat(chat) || shouldExecuteSessionAction(chat);
}

function shouldUseSessionFlow(chat: GroupChat) {
  return canExecuteSessionFlow(chat);
}

function shouldSkipSessionIteration(chat: GroupChat) {
  return !shouldUseSessionFlow(chat);
}

function getSessionIterationPlan(chat: GroupChat) {
  return {
    skip: shouldSkipSessionIteration(chat),
    runAction: shouldExecuteSessionAction(chat),
    runChat: shouldExecuteSessionChat(chat),
  };
}

function shouldRunActionExecutor(chat: GroupChat) {
  return getSessionIterationPlan(chat).runAction;
}

function shouldRunChatExecutor(chat: GroupChat) {
  return getSessionIterationPlan(chat).runChat;
}

function shouldSkipIteration(chat: GroupChat) {
  return getSessionIterationPlan(chat).skip;
}

function getIterationPlan(chat: GroupChat) {
  return getSessionIterationPlan(chat);
}

function shouldPerformAction(chat: GroupChat) {
  return getIterationPlan(chat).runAction;
}

function shouldPerformChat(chat: GroupChat) {
  return getIterationPlan(chat).runChat;
}

function shouldSkipPerform(chat: GroupChat) {
  return getIterationPlan(chat).skip;
}

function getRunnerPlan(chat: GroupChat) {
  return getIterationPlan(chat);
}

function canRunActionFirst(chat: GroupChat) {
  return getRunnerPlan(chat).runAction;
}

function canRunChatFirst(chat: GroupChat) {
  return getRunnerPlan(chat).runChat;
}

function shouldSkipRunner(chat: GroupChat) {
  return getRunnerPlan(chat).skip;
}

function getSessionRunPlan(chat: GroupChat) {
  return {
    actionFirst: canRunActionFirst(chat),
    chatFirst: canRunChatFirst(chat),
    skip: shouldSkipRunner(chat),
  };
}

function shouldRunSessionActionFirst(chat: GroupChat) {
  return getSessionRunPlan(chat).actionFirst;
}

function shouldRunSessionChatFirst(chat: GroupChat) {
  return getSessionRunPlan(chat).chatFirst;
}

function shouldSkipSessionRun(chat: GroupChat) {
  return getSessionRunPlan(chat).skip;
}

function canRunSessionIteration(chat: GroupChat) {
  return !shouldSkipSessionRun(chat);
}

function shouldRunActionStep(chat: GroupChat) {
  return canRunSessionIteration(chat) && shouldRunSessionActionFirst(chat);
}

function shouldRunChatStep(chat: GroupChat) {
  return canRunSessionIteration(chat) && shouldRunSessionChatFirst(chat);
}

function shouldSkipSessionStep(chat: GroupChat) {
  return !shouldRunActionStep(chat) && !shouldRunChatStep(chat);
}

function getSessionStepPlan(chat: GroupChat) {
  return {
    runAction: shouldRunActionStep(chat),
    runChat: shouldRunChatStep(chat),
    skip: shouldSkipSessionStep(chat),
  };
}

function shouldHandleActionStep(chat: GroupChat) {
  return getSessionStepPlan(chat).runAction;
}

function shouldHandleChatStep(chat: GroupChat) {
  return getSessionStepPlan(chat).runChat;
}

function shouldSkipStep(chat: GroupChat) {
  return getSessionStepPlan(chat).skip;
}

function getExecutionPlan(chat: GroupChat) {
  return getSessionStepPlan(chat);
}

function shouldExecuteActionStep(chat: GroupChat) {
  return getExecutionPlan(chat).runAction;
}

function shouldExecuteChatStep(chat: GroupChat) {
  return getExecutionPlan(chat).runChat;
}

function shouldExecuteNothing(chat: GroupChat) {
  return getExecutionPlan(chat).skip;
}

function canRunExecution(chat: GroupChat) {
  return !shouldExecuteNothing(chat);
}

function getTickExecution(chat: GroupChat) {
  return {
    canRun: canRunExecution(chat),
    runAction: shouldExecuteActionStep(chat),
    runChat: shouldExecuteChatStep(chat),
  };
}

function shouldRunTickAction(chat: GroupChat) {
  return getTickExecution(chat).runAction;
}

function shouldRunTickChat(chat: GroupChat) {
  return getTickExecution(chat).runChat;
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
    message: Pick<Message, 'content' | 'type' | 'senderId'>;
    previousAiMessage: Pick<Message, 'senderId'> | null;
  }) => DriverMessageCommitResult;
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
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
        continue;
      }

      await runOneRound(
        params.chat,
        params.characters,
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
