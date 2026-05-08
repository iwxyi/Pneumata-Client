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
      const engine = getSessionEngine(params.chat);
      const generationContext = buildEngineGenerationContext(params.chat, effectiveCharacters, currentMessages);
      const loopDecision = resolveEngineLoopDecision(params.chat, effectiveCharacters, currentMessages);

      if (loopDecision.canRun && loopDecision.actionFirst) {
        const handled = await maybeRunNonChatAction(params.chat, params.updateChat, params.appendEventMessage);
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
          : undefined
      );

      if (params.isRunning() && !params.isPaused() && shouldWaitAfterSessionTick()) {
        await new Promise((resolve) => setTimeout(resolve, getLoopWaitTime(params.chat)));
      }
    } catch (error) {
      params.onLoopError(error);
      if (!isActiveLoop(params)) return;
      await new Promise((resolve) => setTimeout(resolve, getLoopErrorWaitTime()));
    }
  }
}
