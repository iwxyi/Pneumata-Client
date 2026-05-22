import { useCallback, useRef, useState } from 'react';
import type { AICharacter } from '../types/character';
import type { DriverMessageCommitResult, GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { APIConfig, AIModelProfile } from '../types/settings';
import { createCommittedLocalMessage } from '../services/chatCommitMessage';
import { projectCurrentChatMessages } from '../services/currentChatMessages';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useSchedulerStore } from '../stores/useSchedulerStore';

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
  discardStreamingMessage: () => void;
  clearStreamingMessageRef: () => void;
  isManualInputPending: () => boolean;
  setCurrentSpeaker: (characterId: string | null) => void;
  resetAllCooldowns: () => void;
  start: (loopToken: string) => void;
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
}) {
  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [runLoopError, setRunLoopError] = useState<string | null>(null);
  const activeRunLoopTokenRef = useRef<string | null>(null);
  const pendingCommitCountRef = useRef(0);
  const runLoopRef = useRef<((loopId: string) => Promise<void>) | null>(null);

  const isCommitSettled = useCallback(() => pendingCommitCountRef.current === 0, []);
  const hasPendingTurnWork = useCallback(() => Boolean(params.streamingMessageRef.current || pendingCommitCountRef.current > 0), [params.streamingMessageRef]);

  const runLoop = useCallback(async (loopId: string) => {
    if (!params.chat || !params.chatId) return;
    if (activeRunLoopTokenRef.current === loopId) return;
    activeRunLoopTokenRef.current = loopId;
    const [{ runChatLoop }, { getSessionEngine }] = await Promise.all([
      import('../services/chatLoopRunner'),
      import('../services/sessionEngineRegistry'),
    ]);
    const sessionEngine = getSessionEngine(params.chat.mode);
    try {
      await runChatLoop({
        loopId,
        chatId: params.chatId,
        chat: params.chat,
        characters: params.activeMembers,
        api: params.aiProfiles,
        getCurrentMessages: () => projectCurrentChatMessages({
          chatId: params.chatId!,
          activeMessages: useMessageStore.getState().messages,
          cachedWindow: useMessageStore.getState().messageWindowsByChatId[params.chatId!],
        }),
        getStreamingMessage: () => params.streamingMessageRef.current,
        getCurrentChat: () => useChatStore.getState().chats.find((item) => item.id === params.chatId),
        getCurrentCharacters: () => useCharacterStore.getState().characters,
        isRunning: () => params.isRunningRef.current,
        isPaused: () => params.isPausedRef.current || (params.isManualInputPending() && !params.streamingMessageRef.current && pendingCommitCountRef.current === 0),
        isActiveLoop: (currentLoopId) => params.activeChatIdRef.current === params.chatId && params.loopTokenRef.current === currentLoopId,
        onCommitSettled: isCommitSettled,
        onCommitStarted: () => {
          pendingCommitCountRef.current += 1;
        },
        onCommitFinished: () => {
          pendingCommitCountRef.current = Math.max(0, pendingCommitCountRef.current - 1);
        },
        onSpeakerSelected: (charId) => {
          const speaker = params.activeMembers.find((member) => member.id === charId);
          const streamingMessage = createCommittedLocalMessage({
            chatId: params.chatId!,
            type: 'ai',
            senderId: charId,
            senderName: speaker?.name || '',
            content: '',
            emotion: 0,
          });
          const nextStreamingMessage = { ...streamingMessage, isStreaming: true };
          params.streamingMessageRef.current = nextStreamingMessage;
          params.upsertMessage(nextStreamingMessage);
          setRunLoopError(null);
          setThinkingId(charId);
          params.setCurrentSpeaker(charId);
        },
        onMessageChunk: (content) => {
          params.updateStreamingMessage((current) => current ? { ...current, content, isStreaming: true } : current);
          setChatError(null);
        },
        onIdle: (reason) => {
          params.discardStreamingMessage();
          setThinkingId(null);
          params.setCurrentSpeaker(null);
          setRunLoopError(reason);
        },
        onClearStreamingState: () => {
          params.clearStreamingMessageRef();
          setThinkingId(null);
          params.setCurrentSpeaker(null);
        },
        onEngineError: (error) => {
          params.discardStreamingMessage();
          setThinkingId(null);
          params.setCurrentSpeaker(null);
          const message = error.message || params.t('common.error');
          setChatError(message);
          setRunLoopError(message);
          params.showErrorToast(message);
        },
        onLoopError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          const safeMessage = message || params.t('common.error');
          setRunLoopError(safeMessage);
        },
        onCommit: async (args) => {
          return await (sessionEngine.onMessageCommitted as (commitArgs: {
            conversation: GroupChat;
            characters: AICharacter[];
            message: Pick<Message, 'content' | 'type' | 'senderId'>;
            previousAiMessage: Pick<Message, 'senderId'> | null;
            recentMessages?: Message[];
            apiConfig?: APIConfig;
          }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>)(args);
        },
        upsertMessage: params.upsertMessage,
        updateCharacter: params.updateCharacter,
        updateCharacters: async (patches) => params.updateCharacters(patches.map((patch) => ({ id: patch.id, updates: patch.patch }))),
        appendEventMessage: params.appendEventMessage,
        appendEventMessages: params.appendEventMessages,
        updateChat: params.updateChat,
        applyChatRuntimeDelta: params.applyChatRuntimeDelta,
        recordSpeak: params.recordSpeak,
        getCooldownMap: () => useSchedulerStore.getState().lastSpeakTimestamps,
      });
    } finally {
      if (activeRunLoopTokenRef.current === loopId) activeRunLoopTokenRef.current = null;
    }
  }, [isCommitSettled, params]);
  runLoopRef.current = runLoop;

  const startConversationLoopIfNeeded = useCallback((conversationChat: GroupChat) => {
    if (conversationChat.type === 'direct') return;
    if (params.isRunningRef.current && !params.isPausedRef.current) return;
    const run = runLoopRef.current;
    if (!run) return;
    params.resetAllCooldowns();
    const newLoopToken = `${conversationChat.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    params.loopTokenRef.current = newLoopToken;
    params.activeChatIdRef.current = conversationChat.id;
    params.isRunningRef.current = true;
    params.isPausedRef.current = false;
    params.start(newLoopToken);
    params.updateChat(conversationChat.id, { isActive: true });
    window.setTimeout(() => void run(newLoopToken), 100);
  }, [params]);

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
