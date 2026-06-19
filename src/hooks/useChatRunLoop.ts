import { useCallback, useRef, useState } from 'react';
import type { AICharacter } from '../types/character';
import type { DriverMessageCommitResult, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import { createStreamingLocalMessage } from '../services/chatCommitMessage';
import type { LocalInterceptionEvent } from '../services/chatEngine';
import { projectCurrentChatMessages } from '../services/currentChatMessages';
import { getOpenStoryChoiceState } from '../services/storyChoices';
import type { UserDraftActivity } from '../services/userInputBuffer';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useSchedulerStore } from '../stores/useSchedulerStore';

export type ConversationLoopStartBlockReason = 'direct_chat' | 'waiting_story_choice' | 'already_active';

export function getConversationLoopStartBlockReason(params: {
  conversationType?: GroupChat['type'] | null;
  isRunning: boolean;
  isPaused: boolean;
  isStoryChoiceBlocked: boolean;
  hasActiveLoop: boolean;
}): ConversationLoopStartBlockReason | null {
  if (params.conversationType === 'direct') return 'direct_chat';
  if (params.isStoryChoiceBlocked) return 'waiting_story_choice';
  if (params.isRunning && !params.isPaused && params.hasActiveLoop) return 'already_active';
  return null;
}

export function shouldSkipConversationLoopStart(params: {
  isRunning: boolean;
  isPaused: boolean;
  isStoryChoiceBlocked: boolean;
  hasActiveLoop: boolean;
}) {
  return getConversationLoopStartBlockReason({ ...params, conversationType: 'group' }) === 'already_active';
}

export function shouldStartConversationLoop(params: {
  conversationType?: GroupChat['type'] | null;
  isRunning: boolean;
  isPaused: boolean;
  isStoryChoiceBlocked: boolean;
  hasActiveLoop: boolean;
}) {
  return getConversationLoopStartBlockReason(params) === null;
}

export function useChatRunLoop(params: {
  chat: GroupChat | undefined;
  chatId: string | undefined;
  activeMembers: AICharacter[];
  api: APIConfig | AIModelProfile[];
  aiProfiles: AIModelProfile[];
  isRunningRef: React.MutableRefObject<boolean>;
  isPausedRef: React.MutableRefObject<boolean>;
  loopTokenRef: React.MutableRefObject<string | null>;
  activeChatIdRef: React.MutableRefObject<string | null>;
  streamingMessageRef: React.MutableRefObject<Message | null>;
  updateStreamingMessage: (updater: (current: Message | null) => Message | null, options?: { immediate?: boolean }) => void;
  onLocalInterception?: (event: LocalInterceptionEvent) => void | Promise<void>;
  discardStreamingMessage: () => void;
  clearStreamingMessageRef: () => void;
  isManualInputPending: () => boolean;
  setCurrentSpeaker: (characterId: string | null) => void;
  resetAllCooldowns: () => void;
  start: (loopToken: string) => void;
  pause: () => void;
  updateChat: (id: string, patch: Partial<GroupChat>) => Promise<void>;
  showErrorToast: (message: string) => void;
  t: (key: string) => string;
  upsertMessage: (message: Message) => void;
  updateCharacter: (id: string, patch: Partial<AICharacter>) => Promise<void>;
  updateCharacters: (patches: Array<{ id: string; updates: Partial<AICharacter> }>) => Promise<void>;
  appendEventMessage: (chatId: string, payload: DriverMessageCommitResult['runtimeEvents'][number]) => Promise<void>;
  appendEventMessages?: (chatId: string, payloads: DriverMessageCommitResult['runtimeEvents'], sourceMessageId?: string) => Promise<void>;
  applyChatRuntimeDelta?: (id: string, delta: NonNullable<DriverMessageCommitResult['chatRuntimeDelta']>, patch?: Partial<GroupChat>) => Promise<void>;
  recordSpeak: (characterId: string) => void;
  getUserDraftActivity?: () => UserDraftActivity | null;
}) {
  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [runLoopError, setRunLoopError] = useState<string | null>(null);
  const paramsRef = useRef(params);
  const activeRunLoopTokenRef = useRef<string | null>(null);
  const pendingCommitCountRef = useRef(0);
  const pendingTurnWorkCountRef = useRef(0);
  const runLoopRef = useRef<((loopId: string) => Promise<void>) | null>(null);

  paramsRef.current = params;
  const isCommitSettled = useCallback(() => pendingCommitCountRef.current === 0, []);
  const hasPendingTurnWork = useCallback(() => Boolean(
    paramsRef.current.streamingMessageRef.current
    || pendingCommitCountRef.current > 0
    || pendingTurnWorkCountRef.current > 0,
  ), []);

  const runLoop = useCallback(async (loopId: string) => {
    const current = paramsRef.current;
    if (!current.chat || !current.chatId) return;
    if (activeRunLoopTokenRef.current === loopId) return;
    activeRunLoopTokenRef.current = loopId;
    const [{ runChatLoop }, { resolveSessionEngine }] = await Promise.all([
      import('../services/chatLoopRunner'),
      import('../services/sessionEngineRegistry'),
    ]);
    const sessionEngine = resolveSessionEngine(current.chat);
    try {
      await runChatLoop({
        loopId,
        chatId: current.chatId,
        chat: current.chat,
        characters: current.activeMembers,
        api: current.aiProfiles,
        getCurrentMessages: () => projectCurrentChatMessages({
          chatId: current.chatId!,
          activeMessages: useMessageStore.getState().messages,
          cachedWindow: useMessageStore.getState().messageWindowsByChatId[current.chatId!],
        }),
        getUserDraftActivity: current.getUserDraftActivity,
        getStreamingMessage: () => current.streamingMessageRef.current,
        getCurrentChat: () => useChatStore.getState().chats.find((item) => item.id === current.chatId),
        getCurrentCharacters: () => useCharacterStore.getState().characters,
        ensureCharacterDetail: (characterId) => useCharacterStore.getState().loadCharacter(characterId),
        isRunning: () => current.isRunningRef.current,
        isPaused: () => {
          const latestChat = useChatStore.getState().chats.find((item) => item.id === current.chatId);
          const latestMessages = projectCurrentChatMessages({
            chatId: current.chatId!,
            activeMessages: useMessageStore.getState().messages,
            cachedWindow: useMessageStore.getState().messageWindowsByChatId[current.chatId!],
          });
          const storyChoice = getOpenStoryChoiceState(latestChat, latestMessages);
          const manualInputPending = current.isManualInputPending() && !current.streamingMessageRef.current && pendingCommitCountRef.current === 0;
          return current.isPausedRef.current || Boolean(storyChoice) || manualInputPending;
        },
        isActiveLoop: (currentLoopId) => current.activeChatIdRef.current === current.chatId && current.loopTokenRef.current === currentLoopId,
        onCommitSettled: isCommitSettled,
        onCommitStarted: () => {
          pendingCommitCountRef.current += 1;
        },
        onCommitFinished: () => {
          pendingCommitCountRef.current = Math.max(0, pendingCommitCountRef.current - 1);
        },
        pauseLoop: () => {
          current.isPausedRef.current = true;
          current.pause();
          void current.updateChat(current.chatId!, { isActive: false });
        },
        onTurnWorkStarted: () => {
          pendingTurnWorkCountRef.current += 1;
        },
        onTurnWorkFinished: () => {
          pendingTurnWorkCountRef.current = Math.max(0, pendingTurnWorkCountRef.current - 1);
        },
        onSpeakerSelected: (charId: string, speaker?: AICharacter) => {
          const activeSpeaker = speaker || current.activeMembers.find((member) => member.id === charId);
          const streamingMessage = createStreamingLocalMessage({
            chatId: current.chatId!,
            type: 'ai',
            senderId: charId,
            senderName: activeSpeaker?.name || '',
            content: '',
            emotion: 0,
          });
          const nextStreamingMessage = { ...streamingMessage, isStreaming: true };
          current.updateStreamingMessage(() => nextStreamingMessage, { immediate: true });
          setRunLoopError(null);
          setThinkingId(charId);
          current.setCurrentSpeaker(charId);
        },
        onMessageChunk: (content) => {
          current.updateStreamingMessage((message) => message ? { ...message, content, isStreaming: true } : message);
          setChatError(null);
        },
        onLocalInterception: current.onLocalInterception,
        onIdle: (reason) => {
          current.discardStreamingMessage();
          setThinkingId(null);
          current.setCurrentSpeaker(null);
          setRunLoopError(reason);
        },
        onClearStreamingState: () => {
          current.clearStreamingMessageRef();
          setThinkingId(null);
          current.setCurrentSpeaker(null);
        },
        onEngineError: async (error) => {
          if (typeof console !== 'undefined' && typeof console.error === 'function') {
            console.error('[chat-run-loop:engine-error]', {
              error,
              chatId: current.chatId,
              loopId,
              activeChatId: current.activeChatIdRef.current,
              activeLoopToken: current.loopTokenRef.current,
              paused: current.isPausedRef.current,
              running: current.isRunningRef.current,
              streamingMessage: current.streamingMessageRef.current,
            });
          }
          current.discardStreamingMessage();
          setThinkingId(null);
          current.setCurrentSpeaker(null);
          current.isPausedRef.current = true;
          current.pause();
          const message = error.message || current.t('common.error');
          setChatError(message);
          setRunLoopError(message);
          current.showErrorToast(message);
          await current.updateChat(current.chatId!, { isActive: false });
        },
        onLoopError: (error) => {
          if (typeof console !== 'undefined' && typeof console.error === 'function') {
            console.error('[chat-run-loop:loop-error]', {
              error,
              chatId: current.chatId,
              loopId,
              activeChatId: current.activeChatIdRef.current,
              activeLoopToken: current.loopTokenRef.current,
              paused: current.isPausedRef.current,
              running: current.isRunningRef.current,
              streamingMessage: current.streamingMessageRef.current,
            });
          }
          const message = error instanceof Error ? error.message : String(error);
          const safeMessage = message || current.t('common.error');
          setRunLoopError(safeMessage);
        },
        onCommit: async (args) => {
          return await (sessionEngine.onMessageCommitted as (commitArgs: {
            conversation: GroupChat;
            characters: AICharacter[];
            message: Pick<Message, 'content' | 'type' | 'senderId' | 'metadata'>;
            previousAiMessage: Pick<Message, 'senderId'> | null;
            recentMessages?: Message[];
            apiConfig?: APIConfig;
          }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>)(args);
        },
        upsertMessage: current.upsertMessage,
        updateCharacter: current.updateCharacter,
        updateCharacters: async (patches) => current.updateCharacters(patches.map((patch) => ({ id: patch.id, updates: patch.patch }))),
        appendEventMessage: current.appendEventMessage,
        appendEventMessages: current.appendEventMessages,
        updateChat: current.updateChat,
        applyChatRuntimeDelta: current.applyChatRuntimeDelta,
        recordSpeak: current.recordSpeak,
        getCooldownMap: () => useSchedulerStore.getState().lastSpeakTimestamps,
      });
    } finally {
      if (activeRunLoopTokenRef.current === loopId) activeRunLoopTokenRef.current = null;
    }
  }, [isCommitSettled]);
  runLoopRef.current = runLoop;

  const startConversationLoopIfNeeded = useCallback((conversationChat: GroupChat) => {
    const current = paramsRef.current;
    const latestMessages = projectCurrentChatMessages({
      chatId: conversationChat.id,
      activeMessages: useMessageStore.getState().messages,
      cachedWindow: useMessageStore.getState().messageWindowsByChatId[conversationChat.id],
    });
    const storyChoice = getOpenStoryChoiceState(conversationChat, latestMessages);
    const isStoryChoiceBlocked = Boolean(storyChoice);
    const hasActiveLoop = Boolean(activeRunLoopTokenRef.current)
      && current.loopTokenRef.current === activeRunLoopTokenRef.current;
    const blockReason = getConversationLoopStartBlockReason({
      conversationType: conversationChat.type,
      isRunning: current.isRunningRef.current,
      isPaused: current.isPausedRef.current,
      isStoryChoiceBlocked,
      hasActiveLoop,
    });
    if (blockReason) return blockReason;
    const run = runLoopRef.current;
    if (!run) return null;
    current.resetAllCooldowns();
    const newLoopToken = `${conversationChat.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    current.loopTokenRef.current = newLoopToken;
    current.activeChatIdRef.current = conversationChat.id;
    current.isRunningRef.current = true;
    current.isPausedRef.current = false;
    current.start(newLoopToken);
    current.updateChat(conversationChat.id, { isActive: true });
    window.setTimeout(() => void run(newLoopToken), 100);
    return null;
  }, []);

  const resetRunLoopUiState = useCallback(() => {
    activeRunLoopTokenRef.current = null;
    setThinkingId(null);
    setChatError(null);
    setRunLoopError(null);
  }, []);

  return {
    thinkingId,
    chatError,
    runLoopError,
    hasPendingTurnWork,
    startConversationLoopIfNeeded,
    resetRunLoopUiState,
  };
}
