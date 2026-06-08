import { lazy, Suspense, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Box, IconButton, Button, Typography } from '@mui/material';
import PageSection from '../components/common/PageSection';
import AppSnackbar from '../components/common/AppSnackbar';
import PeopleIcon from '@mui/icons-material/People';
import InfoIcon from '@mui/icons-material/Info';
import PlayIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useSchedulerStore } from '../stores/useSchedulerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUIStore } from '../stores/useUIStore';
import { type DriverMessageCommitResult, type GroupChat } from '../types/chat';
import MessageList from '../components/chat/MessageList';
import { MessageAnalysisDialog } from '../components/chat/MessageAnalysisDialog';
import SessionComposerHost from '../components/session/SessionComposerHost';
import RightPanel from '../components/layout/RightPanel';
import GlassHeader from '../components/layout/GlassHeader';
import { buildRuntimeEventMessageContent, normalizeRuntimeEvent } from '../services/runtimeEventFactory';
import { persistLocalFirstMessage, persistLocalFirstMessages } from '../services/chatCommitMessage';
import { buildPrivateSessionEvent } from '../services/directSessionHelpers';
import { resolveCharacterOrDeleted } from '../utils/deletedEntity';
import type { Message } from '../types/message';
import { buildExpressionFeedbackPatch, getExpressionFeedbackLabel, type ExpressionFeedbackKind } from '../services/characterExpressionFeedback';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrentChatMessages } from '../hooks/useCurrentChatMessages';
import { useManualInputQueue } from '../hooks/useManualInputQueue';
import { useStreamingMessageState } from '../hooks/useStreamingMessageState';
import { useChatRunLoop } from '../hooks/useChatRunLoop';
import { useChatSidebarProjection } from '../hooks/useChatSidebarProjection';
import { useMessageAnalysis } from '../hooks/useMessageAnalysis';
import { useChatSurfaceActions } from '../hooks/useChatSurfaceActions';
import { useChatAutoSocialFlow } from '../hooks/useChatAutoSocialFlow';
import { runDirectUserReplyFlow } from '../services/directUserReplyFlow';
import { buildDirectChatDraft } from '../services/chatDraftBuilder';
import { getSyncableCharacterMemberIds } from '../services/pageSyncScopeContract';
import SessionInfoCards from '../components/chat/SessionInfoCards';
import { projectSessionInfoCards } from '../services/sessionInfoProjection';
import { useResponsive } from '../hooks/useResponsive';
import type { UserDraftActivity } from '../services/userInputBuffer';
import { usePaneLayout } from '../components/layout/PaneLayoutContext';
import type { LocalInterceptionEvent } from '../services/chatEngine';
import WorldCalendarPanel from '../components/calendar/WorldCalendarPanel';

const ChatSidebarPanel = lazy(() => import('../components/chat/ChatSidebarPanel'));
const SessionActionPanel = lazy(() => import('../components/session/SessionActionPanel'));
const CHAT_MESSAGE_WINDOW_SIZE = 40;

function PanelFallback() {
  return null;
}

function LazyPanel({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PanelFallback />}>{children}</Suspense>;
}

function localizeLocalInterceptionReason(reason: string) {
  const normalized = reason.trim();
  const exact: Record<string, string> = {
    empty_content: '生成内容为空或不可见',
    missing_requested_image: '没有完成图片请求',
    missing_requested_subject: '图片对象没有对准',
    missing_topic_focus: '偏离了当前话题',
    missing_question_answer: '没有回答当前问题',
    missing_direct_reply_focus: '没有先回应点名要求',
    no_media_capability: '当前模型能力不足',
    message_withdrawn: '角色内在冲动触发撤回',
  };
  if (exact[normalized]) return exact[normalized];
  if (/exactly repeats/i.test(normalized)) return '完全复用了近期发言';
  if (/substring/i.test(normalized)) return '截取了近期发言的一部分';
  if (/copies a recent line/i.test(normalized)) return '复制了近期发言';
  if (/too close/i.test(normalized) || /surface overlap/i.test(normalized)) return '与近期措辞过于接近';
  if (/opening pattern/i.test(normalized)) return '复用了房间里的高频开头';
  if (/emoji|sticker/i.test(normalized)) return '复用了近期高频表情或贴纸标记';
  return normalized || '本地规则判定不应直接发出';
}

function compactInterceptedDraft(draft: string | undefined) {
  const normalized = (draft || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '（无可展示草稿）';
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function buildLocalInterceptionSummary(event: LocalInterceptionEvent) {
  return `拦截了${event.speakerName || '角色'}的发言：${compactInterceptedDraft(event.draft)}（原因：${localizeLocalInterceptionReason(event.reason)}）`;
}

type SidebarTabValue = 'members' | 'narrative' | 'world' | 'activities';
const EMPTY_MESSAGES: never[] = [];

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const { isMobile, isDesktop } = useResponsive();
  const pane = usePaneLayout();
  const isSplitDetailPane = pane.role === 'detail';
  const { setHideMobileBottomNav } = useLayoutHeaderActions();

  const { chats, updateChat, applyChatRuntimeDelta, loadChat, markChatsWarm, isLoading: chatsLoading, remoteDeletedChatIds, remoteDeletedChats } = useChatStore();
  const { characters, updateCharacter, updateCharacters, loadCharacter, markCharactersWarm } = useCharacterStore();
  const { messages, messageWindowsByChatId, hydrateMessagesFromCache, openChatWindow, closeChatWindow, loadMessages, addMessage, upsertMessage, upsertMessages, deleteMessage, hasMore, isLoadingOlder } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const api = useSettingsStore((s) => s.api);
  const aiProfiles = useSettingsStore((s) => s.aiProfiles);
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, toggleRightPanel, setRightPanelOpen, rightPanelTab, setRightPanelTab } = useUIStore();
  const dramaBoost = useSettingsStore((s) => s.developerUI.dramaBoost);
  const showLocalInterceptionHints = useSettingsStore((s) => s.developerMode && s.developerUI.showLocalInterceptionHints);
  const currentUser = useAuthStore((s) => s.user);
  const isRemoteDeletedChat = Boolean(id && remoteDeletedChatIds.includes(id));

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'error' | 'success' }>({ open: false, message: '', severity: 'error' });
  const [detailBootstrapComplete, setDetailBootstrapComplete] = useState(false);
  const [sidebarMessagesReady, setSidebarMessagesReady] = useState(false);

  const loopTokenRef = useRef<string | null>(null);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(id ?? null);
  const isManualInputPendingRef = useRef<() => boolean>(() => false);
  const userDraftActivityRef = useRef<UserDraftActivity | null>(null);
  const {
    streamingMessageRef,
    updateStreamingMessage,
    discardStreamingMessage,
    clearStreamingMessageRef,
  } = useStreamingMessageState(upsertMessage);

  useLayoutEffect(() => {
    if (!id) return;
    if (!useChatStore.persist.hasHydrated()) void useChatStore.persist.rehydrate();
    if (!useCharacterStore.persist.hasHydrated()) void useCharacterStore.persist.rehydrate();
    void hydrateMessagesFromCache(id);
  }, [hydrateMessagesFromCache, id]);

  useEffect(() => {
    let cancelled = false;
    setDetailBootstrapComplete(false);
    markChatsWarm();
    markCharactersWarm();
    void (async () => {
      const loadedChat = id ? await loadChat(id) : null;
      const memberIds = loadedChat?.memberIds || useChatStore.getState().chats.find((item) => item.id === id)?.memberIds || [];
      void Promise.all(getSyncableCharacterMemberIds(memberIds).map((memberId) => loadCharacter(memberId)));
    })().finally(() => {
      if (!cancelled) setDetailBootstrapComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, loadCharacter, loadChat, markCharactersWarm, markChatsWarm]);

  const remoteDeletedChat = remoteDeletedChats.find((c) => c.id === id);
  const chat = chats.find((c) => c.id === id) || remoteDeletedChat;
  const sessionInfoCards = useMemo(() => {
    if (!chat) return [];
    return projectSessionInfoCards({ chat, chats, members: characters, isZh: true });
  }, [chat, chats, characters]);
  const currentChatMessages = useCurrentChatMessages({ chatId: id, activeMessages: messages, cachedWindows: messageWindowsByChatId });
  const sidebarMessages = sidebarMessagesReady ? currentChatMessages : EMPTY_MESSAGES;
  const {
    analysisDialogOpen,
    analysisError,
    analysisLoading,
    analysisTarget,
    analysisText,
    analyzeMessage,
    closeAnalysisDialog,
  } = useMessageAnalysis({
    api,
    chat,
    messages: currentChatMessages,
    characters,
    fallbackError: t('common.error'),
  });
  const members = useMemo(
    () => chat ? chat.memberIds.map((memberId) => resolveCharacterOrDeleted(characters, memberId)) : [],
    [characters, chat]
  );
  const activeMembers = useMemo(
    () => chat ? characters.filter((c) => chat.memberIds.includes(c.id)) : [],
    [characters, chat]
  );
  const speakAsChar = useMemo(
    () => speakAsCharacterId ? characters.find((c) => c.id === speakAsCharacterId) ?? null : null,
    [characters, speakAsCharacterId]
  );
  const {
    actionSchema,
    actionPanelTitle,
    activeSidebarTab,
    composerSurfaces,
    directMemoryPanelContext,
    memberTabTitle,
    privatePayloads,
    projectedActionPanelActions,
    projectedDetailState,
    projectedRuntimeState,
    projectedSidebarChat,
    runtimePanelLoading,
    runtimeTabTitle,
    sessionActions,
    showActionTab,
    showMemberTab,
    showRuntimeTab,
    sidebarTitle,
  } = useChatSidebarProjection({
    chat,
    members,
    activeMembers,
    characters,
    currentChatMessages: sidebarMessages,
    rightPanelTab,
    speakAsChar,
  });
  const sidebarTabValue = activeSidebarTab === 'actions' ? 'activities' : activeSidebarTab;
  const handleSidebarTabChange = useCallback((value: SidebarTabValue) => {
    setRightPanelTab(value === 'activities' ? 'actions' : value);
  }, [setRightPanelTab]);
  void dramaBoost;
  void rightPanelOpen;

  useEffect(() => {
    setSidebarMessagesReady(false);
    const scheduler = (window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    if (typeof scheduler === 'function') {
      const handle = scheduler(() => setSidebarMessagesReady(true), { timeout: 700 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setSidebarMessagesReady(true), 160);
    return () => window.clearTimeout(handle);
  }, [id]);

  useEffect(() => {
    if (!isDesktop) setRightPanelOpen(false);
  }, [id, isDesktop, setRightPanelOpen]);

  const showErrorToast = useCallback((message: string) => {
    setSnackbar({ open: true, message, severity: 'error' });
  }, []);

  const closeSnackbar = useCallback(() => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  }, []);

  useEffect(() => {
    isRunningRef.current = isRunning;
    isPausedRef.current = isPaused;
  }, [isPaused, isRunning]);

  useEffect(() => {
    if (!isRemoteDeletedChat) return;
    pause();
    stop();
  }, [isRemoteDeletedChat, pause, stop]);

  useEffect(() => {
    activeChatIdRef.current = id ?? null;
    loopTokenRef.current = loopToken;
  }, [id, loopToken]);

  const appendEventMessage = useCallback(async (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[]; createdAt?: number; sourceMessageId?: string }, sourceMessageId?: string) => {
    const targetChat = chats.find((item) => item.id === chatId);
    const eventPayload = normalizeRuntimeEvent(targetChat ? buildPrivateSessionEvent(targetChat, payload) : payload);
    await persistLocalFirstMessage({
      upsertMessage,
      timestamp: eventPayload.createdAt,
      message: {
        chatId,
        type: 'event',
        senderId: 'system',
        senderName: 'System',
        content: buildRuntimeEventMessageContent({
          ...eventPayload,
          sourceMessageId: eventPayload.sourceMessageId || sourceMessageId,
        }),
        emotion: 0,
      },
    });
  }, [chats, upsertMessage]);

  const appendEventMessages = useCallback(async (chatId: string, payloads: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[]; createdAt?: number; sourceMessageId?: string }>, sourceMessageId?: string) => {
    if (!payloads.length) return;
    const targetChat = chats.find((item) => item.id === chatId);
    await persistLocalFirstMessages({
      upsertMessages,
      deferLocalUpsert: true,
      messages: payloads.map((payload, index) => {
        const eventPayload = normalizeRuntimeEvent(targetChat ? buildPrivateSessionEvent(targetChat, payload) : payload);
        const createdAt = eventPayload.createdAt ?? Date.now() + index;
        return {
          timestamp: createdAt,
          message: {
            chatId,
            type: 'event' as const,
            senderId: 'system',
            senderName: 'System',
            content: buildRuntimeEventMessageContent({
              ...eventPayload,
              createdAt,
              sourceMessageId: eventPayload.sourceMessageId || sourceMessageId,
            }),
            emotion: 0,
          },
        };
      }),
    });
  }, [chats, upsertMessages]);

  const addAnchoredMessage = useCallback(async (message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'> & { timestamp?: number }) => {
    return addMessage(message as Parameters<typeof addMessage>[0]);
  }, [addMessage]);

  const upsertMessageStable = useCallback((message: Message) => {
    upsertMessage(message);
  }, [upsertMessage]);

  const appendEventMessageStable = appendEventMessage;
  const appendEventMessagesStable = appendEventMessages;
  const addMessageStable = addAnchoredMessage;

  const appendLocalInterceptionHint = useCallback(async (event: LocalInterceptionEvent) => {
    if (!chat?.id || !showLocalInterceptionHints) return;
    await appendEventMessageStable(chat.id, {
      eventType: 'local_interception',
      title: '提示：本地拦截',
      summary: buildLocalInterceptionSummary(event),
      visibilityScope: 'moderator_only',
      metrics: {
        kind: event.kind,
        speakerId: event.speakerId,
        speakerName: event.speakerName,
        reason: event.reason,
        attempt: event.attempt,
      },
    });
  }, [appendEventMessageStable, chat?.id, showLocalInterceptionHints]);

  const handleStartDirectChat = useCallback(async (characterId: string) => {
    const character = characters.find((item) => item.id === characterId);
    if (!character) return;
    const existing = chats.find((item) => item.type === 'direct' && item.memberIds.length === 1 && item.memberIds[0] === characterId);
    if (existing) {
      navigate(`/chats/${existing.id}?fromTab=1`);
      return;
    }
    try {
      const directChat = await useChatStore.getState().addChat(buildDirectChatDraft(character.id, character.name));
      navigate(`/chats/${directChat.id}?fromTab=1`);
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    }
  }, [characters, chats, navigate, t]);

  const {
    thinkingId,
    chatError,
    runLoopError,
    hasPendingTurnWork,
    startConversationLoopIfNeeded,
    resetRunLoopUiState,
  } = useChatRunLoop({
    chat,
    chatId: id,
    activeMembers,
    api,
    aiProfiles,
    isRunningRef,
    isPausedRef,
    loopTokenRef,
    activeChatIdRef,
    streamingMessageRef,
    updateStreamingMessage,
    onLocalInterception: appendLocalInterceptionHint,
    discardStreamingMessage,
    clearStreamingMessageRef,
    isManualInputPending: () => isManualInputPendingRef.current(),
    setCurrentSpeaker,
    resetAllCooldowns,
    start,
    updateChat,
    showErrorToast,
    t,
    upsertMessage,
    updateCharacter,
    updateCharacters,
    appendEventMessage: appendEventMessageStable,
    appendEventMessages: appendEventMessagesStable,
    applyChatRuntimeDelta,
    recordSpeak,
    getUserDraftActivity: () => userDraftActivityRef.current,
  });
  const { enqueueManualInput, isManualInputPending } = useManualInputQueue({
    isRunningRef,
    isPausedRef,
    hasPendingTurnWork,
    pause,
  });
  isManualInputPendingRef.current = isManualInputPending;
  void runLoopError;
  void chatError;

  const commitPersistedManualRuntime = useCallback(async (message: Message, recentMessages: Message[]) => {
    if (!chat || !id) return;
    const [{ runPersistedSessionCommitRuntime }, { resolveSessionEngine }] = await Promise.all([
      import('../services/sessionCommitPipeline'),
      import('../services/sessionEngineRegistry'),
    ]);
    const sessionEngine = resolveSessionEngine(chat);
    await runPersistedSessionCommitRuntime({
      api,
      chatId: id,
      chat,
      characters,
      message,
      currentMessages: recentMessages,
      onCommit: async (args) => await (sessionEngine.onMessageCommitted as (commitArgs: {
        conversation: GroupChat;
        characters: typeof characters;
        message: Pick<Message, 'content' | 'type' | 'senderId'>;
        previousAiMessage: Pick<Message, 'senderId'> | null;
        recentMessages?: Message[];
        apiConfig?: typeof api;
      }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>)(args),
      updateCharacter,
      updateCharacters: async (patches) => updateCharacters(patches.map((patch) => ({ id: patch.id, updates: patch.patch }))),
      appendEventMessage: appendEventMessageStable,
      appendEventMessages: appendEventMessagesStable,
      updateChat,
      applyChatRuntimeDelta,
      recordSpeak,
      getCurrentChat: (chatId) => useChatStore.getState().chats.find((item) => item.id === chatId),
      getCurrentCharacters: () => useCharacterStore.getState().characters,
    });
  }, [api, appendEventMessageStable, appendEventMessagesStable, applyChatRuntimeDelta, characters, chat, id, recordSpeak, updateCharacter, updateCharacters, updateChat]);

  useEffect(() => {
    if (id) {
      void openChatWindow(id, { limit: CHAT_MESSAGE_WINDOW_SIZE, revalidate: true });
      return () => {
        activeChatIdRef.current = null;
        loopTokenRef.current = null;
        resetRunLoopUiState();
        discardStreamingMessage();
        closeChatWindow(id, { clearActiveOnly: true });
        stop();
      };
    }
  }, [closeChatWindow, discardStreamingMessage, id, openChatWindow, resetRunLoopUiState, stop]);

  const handleMemberSpeakSend = useCallback(async (content: string) => {
    if (!chat || !id) return;
    await enqueueManualInput(async () => {
      const recentMessages = currentChatMessages;
      const userMessage = await addMessageStable({
        chatId: id,
        type: 'user',
        senderId: 'user',
        senderName: currentUser?.nickname?.trim() || '我',
        content,
        emotion: 0,
        timestamp: Date.now(),
      });
      void updateChat(id, { lastMessageAt: userMessage.timestamp, latestMessage: userMessage });
      const recentMessagesWithUser = [...recentMessages.filter((message) => message.id !== userMessage.id), userMessage];
      if (chat.type === 'direct') {
        await runDirectUserReplyFlow({
          api,
          aiProfiles,
          chatId: id,
          chat,
          userMessage,
          content,
          characters,
          updateCharacter,
          updateCharacters,
          upsertMessage: upsertMessageStable,
          appendEventMessage: appendEventMessageStable,
          appendEventMessages: appendEventMessagesStable,
          updateChat,
          applyChatRuntimeDelta,
          recordSpeak,
          onLocalInterception: appendLocalInterceptionHint,
        });
        return;
      }
      await commitPersistedManualRuntime(userMessage, recentMessagesWithUser);
      if (chat.type === 'ai_direct') {
        startConversationLoopIfNeeded(chat);
        const { applyAiDirectFeedback } = await import('../services/directSessionRuntime');
        await applyAiDirectFeedback({ chat, chats, characters, content, updateCharacter, updateChat, appendEventMessage });
        return;
      }
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, aiProfiles, api, appendEventMessage, appendEventMessageStable, appendEventMessagesStable, appendLocalInterceptionHint, applyChatRuntimeDelta, characters, chat, chats, commitPersistedManualRuntime, currentChatMessages, currentUser?.nickname, enqueueManualInput, id, recordSpeak, startConversationLoopIfNeeded, updateCharacter, updateCharacters, updateChat, upsertMessageStable]);

  const handleGuideSend = useCallback(async (content: string) => {
    if (!chat || !id) return;
    await enqueueManualInput(async () => {
      const recentMessages = currentChatMessages;
      const guidedMessage = await addMessageStable({
        chatId: id,
        type: 'god',
        senderId: 'user',
        senderName: '话题引导',
        content,
        emotion: 0,
        timestamp: Date.now(),
      });
      void updateChat(id, { lastMessageAt: guidedMessage.timestamp, latestMessage: guidedMessage });
      const recentMessagesWithGuide = [...recentMessages.filter((message) => message.id !== guidedMessage.id), guidedMessage];
      await commitPersistedManualRuntime(guidedMessage, recentMessagesWithGuide);
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, chat, commitPersistedManualRuntime, currentChatMessages, enqueueManualInput, id, startConversationLoopIfNeeded, updateChat]);

  const handleSpeakAs = useCallback(async (content: string) => {
    if (!chat || !id || !speakAsCharacterId) return;
    const char = characters.find((c) => c.id === speakAsCharacterId);
    if (!char) return;
    await enqueueManualInput(async () => {
      const recentMessages = currentChatMessages;
      const spokeMessage = await addMessageStable({
        chatId: id,
        type: 'user',
        senderId: char.id,
        senderName: char.name,
        content,
        emotion: 0,
        timestamp: Date.now(),
        metadata: {
          manualSpeaker: {
            actorId: char.id,
            actorName: char.name,
            avatar: char.avatar,
          },
        },
      });
      void updateChat(id, { lastMessageAt: spokeMessage.timestamp, latestMessage: spokeMessage });
      const recentMessagesWithSpeaker = [...recentMessages.filter((message) => message.id !== spokeMessage.id), spokeMessage];
      await commitPersistedManualRuntime(spokeMessage, recentMessagesWithSpeaker);
      setSpeakAsCharacter(null);
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, characters, chat, commitPersistedManualRuntime, currentChatMessages, enqueueManualInput, id, setSpeakAsCharacter, speakAsCharacterId, startConversationLoopIfNeeded, updateChat]);

  const { runSessionAction, triggerPairPrivateThread, normalizeAndRunSurfaceIntent, runAutoSocialEventFlow } = useChatSurfaceActions({
    chat,
    chats,
    characters,
    updateChat,
    addMessage: addMessageStable,
    appendEventMessage: appendEventMessageStable,
    actionSchema,
    aiProfiles,
    speakAsChar,
    handleGuideSend,
    handleMemberSpeakSend,
    handleSpeakAs,
    setSnackbar,
  });

  const handleExpressionFeedback = useCallback(async (message: Message, kind: ExpressionFeedbackKind) => {
    if (message.type !== 'ai') return;
    const character = characters.find((item) => item.id === message.senderId);
    if (!character) {
      setSnackbar({ open: true, message: '未找到这个角色，无法记录反馈', severity: 'error' });
      return;
    }
    const patch = buildExpressionFeedbackPatch({ character, message, kind });
    await updateCharacter(character.id, patch);
    setSnackbar({ open: true, message: `已记录反馈：${getExpressionFeedbackLabel(kind)}`, severity: 'success' });
  }, [characters, updateCharacter]);

  const handleRetryMedia = useCallback(async (message: Message, attachmentId: string) => {
    const character = message.type === 'ai' ? characters.find((item) => item.id === message.senderId) : null;
    const { retryRichMessageMedia } = await import('../services/richMessageMedia');
    await retryRichMessageMedia({
      message,
      attachmentId,
      character,
      characters,
      aiProfiles,
      upsertMessage: upsertMessageStable,
    });
  }, [aiProfiles, characters, upsertMessageStable]);

  useChatAutoSocialFlow({ chat, runAutoSocialEventFlow });

  const handleLoadOlderMessages = useCallback(async () => {
    if (!id || loadingMoreRef.current || !hasMore || currentChatMessages.length === 0) return;
    loadingMoreRef.current = true;
    try {
      await loadMessages(id, { append: true, before: currentChatMessages[0].timestamp, limit: CHAT_MESSAGE_WINDOW_SIZE });
    } finally {
      loadingMoreRef.current = false;
    }
  }, [currentChatMessages, hasMore, id, loadMessages]);

  const handleNearTop = useCallback(() => {
    void handleLoadOlderMessages();
  }, [handleLoadOlderMessages]);

  const fromTab = useMemo(() => new URLSearchParams(window.location.search).get('fromTab'), []);

  const handleHeaderBack = useCallback(() => {
    navigate(fromTab ? `/chats?tab=${fromTab}` : '/chats');
  }, [fromTab, navigate]);

  const canAutoRunConversation = chat?.type !== 'direct' && !isRemoteDeletedChat;

  const handleHeaderPrimaryAction = useCallback(() => {
    if (!chat || !id || !canAutoRunConversation) return;
    if (!isRunning || isPaused) {
      resume();
      startConversationLoopIfNeeded(chat);
    } else {
      isPausedRef.current = true;
      pause();
      updateChat(id, { isActive: false });
    }
  }, [canAutoRunConversation, chat, id, isPaused, isRunning, pause, resume, startConversationLoopIfNeeded, updateChat]);

  const headerPrimaryActionButton = canAutoRunConversation ? (
    <IconButton onClick={handleHeaderPrimaryAction} color={isRunning && !isPaused ? 'primary' : 'default'}>
      {isRunning && !isPaused ? <PauseIcon /> : <PlayIcon />}
    </IconButton>
  ) : null;

  useEffect(() => {
    setHideMobileBottomNav(true);
    return () => setHideMobileBottomNav(false);
  }, [setHideMobileBottomNav]);

  if (!chat && currentChatMessages.length > 0) {
    return (
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden', position: 'relative' }}>
        <GlassHeader
          title={detailBootstrapComplete
            ? (isZh ? '本地聊天记录' : 'Local messages')
            : (isZh ? '本地聊天记录 · 后台同步中' : 'Local messages · syncing')}
          leading={(
            <IconButton onClick={() => navigate('/chats')}>
              <ArrowBackIcon />
            </IconButton>
          )}
        />
        <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1 }}>
          <MessageList
            key={id}
            messages={currentChatMessages}
            characters={characters}
            currentUser={currentUser ? { nickname: currentUser.nickname, avatar: currentUser.avatar } : undefined}
            isLoadingOlder={isLoadingOlder}
            hasMore={hasMore}
            loadingText={t('common.loading')}
            topHint="没有更早的消息"
            topInset={isSplitDetailPane ? { xs: '76px', sm: '76px' } : { xs: 'calc(88px + env(safe-area-inset-top, 0px))', sm: '80px' }}
            bottomInset={{ xs: '24px', sm: '24px' }}
          />
        </Box>
      </Box>
    );
  }

  if (!chat) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', p: 3 }}>
        <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'center', textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {isRemoteDeletedChat
              ? '这个会话已在其他设备删除'
              : (chatsLoading || !detailBootstrapComplete ? '正在打开会话...' : '未找到这个会话')}
          </Typography>
          {isRemoteDeletedChat ? (
            <Button size="small" variant="outlined" onClick={() => navigate('/settings/recycle-bin')}>
              查看回收站
            </Button>
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Box sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
        display: 'block',
        position: 'relative',
        bgcolor: 'background.default',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: (theme) => theme.palette.mode === 'light'
            ? 'repeating-linear-gradient(0deg, rgba(15,23,42,0.030) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(15,23,42,0.024) 0 1px, transparent 1px 28px)'
            : 'repeating-linear-gradient(0deg, rgba(226,232,240,0.030) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(226,232,240,0.024) 0 1px, transparent 1px 28px)',
        },
      }}>
        <GlassHeader
          title={chat.name}
          safeAreaTop={!isSplitDetailPane}
          zIndex={4}
          leading={!isSplitDetailPane ? (
            <IconButton onClick={handleHeaderBack} sx={{ flexShrink: 0 }}>
                <ArrowBackIcon />
            </IconButton>
          ) : null}
          actions={isRemoteDeletedChat ? null : (
            <>
              {headerPrimaryActionButton}
              {!isMobile ? (
                <IconButton onClick={toggleRightPanel}>
                <PeopleIcon />
                </IconButton>
              ) : null}
              <IconButton onClick={() => navigate(`/chats/${chat.id}/edit`)}>
                <InfoIcon />
              </IconButton>
            </>
          )}
        />
        {isRemoteDeletedChat ? (
          <Box sx={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: isSplitDetailPane ? 76 : 'calc(88px + env(safe-area-inset-top, 0px))',
            zIndex: 3,
            p: 1.25,
            borderRadius: 1,
            bgcolor: 'warning.light',
            color: 'warning.contrastText',
            boxShadow: 2,
          }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>此会话已在其他设备删除</Typography>
            <Typography variant="caption">当前仅保留本地只读历史；已停止自动生成和新消息提交。</Typography>
          </Box>
        ) : null}
        <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1 }}>
          <MessageList
            key={id}
            messages={currentChatMessages}
            characters={characters}
            currentUser={currentUser ? { nickname: currentUser.nickname, avatar: currentUser.avatar } : undefined}
            onDeleteMessage={deleteMessage}
            onAnalyzeMessage={analyzeMessage}
            onExpressionFeedback={handleExpressionFeedback}
            onRetryMedia={handleRetryMedia}
            onReachTop={handleNearTop}
            isLoadingOlder={isLoadingOlder}
            hasMore={hasMore}
            loadingText={t('common.loading')}
            topHint="没有更早的消息"
            topInset={isSplitDetailPane ? { xs: '76px', sm: '76px' } : { xs: 'calc(88px + env(safe-area-inset-top, 0px))', sm: '80px' }}
            bottomInset={isRemoteDeletedChat ? { xs: '24px', sm: '24px' } : { xs: 'calc(82px + env(safe-area-inset-bottom, 0px))', sm: '82px' }}
          />
        </Box>
        {isRemoteDeletedChat ? null : <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
          }}
        >
          <SessionComposerHost
            surfaces={composerSurfaces}
            speakAsCharacterName={speakAsChar?.name}
            onCloseSpeakAs={speakAsChar ? () => setSpeakAsCharacter(null) : undefined}
            sendingLabel="等待角色发言结束"
            onOpenPanel={isMobile ? () => setRightPanelOpen(true) : undefined}
            onDraftActivity={(activity) => {
              userDraftActivityRef.current = activity;
            }}
            onSubmitText={(submission, surface) => {
              const effectiveSurface = speakAsChar ? { ...surface, mode: 'speakAs' as const, actorId: speakAsChar.id } : surface;
              const effectiveSubmission = speakAsChar ? { ...submission, actorId: speakAsChar.id } : submission;
              return normalizeAndRunSurfaceIntent(effectiveSurface, effectiveSubmission);
            }}
            onSendError={showErrorToast}
            onSubmitForm={(submission, surface) => {
              return normalizeAndRunSurfaceIntent(surface, submission);
            }}
            onSubmitBoard={(submission, surface) => {
              return normalizeAndRunSurfaceIntent(surface, submission);
            }}
          />
        </Box>}
      </Box>

      {isRemoteDeletedChat ? null : <RightPanel title={sidebarTitle} hideMobileTitle>
        <PageSection spacing={2} fill animate={false}>
          <SessionInfoCards cards={sessionInfoCards} onOpenChat={(chatId) => navigate(`/chats/${chatId}`)} />
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <LazyPanel>
              {runtimePanelLoading ? <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">加载中…</Typography></Box> : <ChatSidebarPanel
                chat={projectedSidebarChat || { ...chat, primaryRecentEvent: projectedRuntimeState?.primaryRecentEvent }}
                members={members}
                messages={sidebarMessages}
                thinkingId={thinkingId}
                rightPanelTab={sidebarTabValue}
                setRightPanelTab={handleSidebarTabChange}
                showMemberTab={showMemberTab}
                showRuntimeTab={showRuntimeTab}
                memberPanelTitle={memberTabTitle}
                runtimePanelTitle={runtimeTabTitle}
                privatePayloads={projectedDetailState?.sidebarChat.privatePayloads || privatePayloads}
                privatePayloadTitle={projectedDetailState?.privatePayloadTitle}
                directMemoryContext={directMemoryPanelContext}
                showActivityTab={showActionTab}
                activityPanel={showActionTab ? (
                  <LazyPanel>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Button size="small" variant="outlined" onClick={() => navigate(`/calendar?conversationId=${chat.id}`)}>
                        查看当前会话日历
                      </Button>
                      <WorldCalendarPanel
                        chats={chats}
                        characters={characters}
                        updateChat={updateChat}
                        isZh={isZh}
                        conversationId={chat.id}
                        compact
                        title="会话日历"
                        subtitle="世界事件驱动的会话活动时间线"
                        showHeader
                      />
                      <SessionActionPanel title={projectedDetailState?.actionPanel.title || actionPanelTitle} actions={projectedActionPanelActions.length ? projectedActionPanelActions : sessionActions} onRunAction={runSessionAction} hideHeader frameless />
                    </Box>
                  </LazyPanel>
                ) : null}
                onSpeakAs={(charId) => setSpeakAsCharacter(charId)}
                onStartDirectChat={chat.type === 'group' ? handleStartDirectChat : undefined}
                onRemoveMember={chat.type === 'group' ? (charId) => {
                  const newMembers = chat.memberIds.filter((m) => m !== charId);
                  if (newMembers.length >= 2) updateChat(chat.id, { memberIds: newMembers });
                } : undefined}
                onUpdateSeats={chat.type === 'group' ? (memberIds) => {
                  updateChat(chat.id, {
                    memberIds,
                    scenarioState: {
                      ...chat.scenarioState,
                      seats: memberIds.map((memberId, index) => {
                        const existing = chat.scenarioState?.seats?.find((seat) => seat.actorId === memberId);
                        return {
                          seatId: existing?.seatId || `seat-${index + 1}`,
                          seatIndex: index,
                          actorId: memberId,
                          roleId: existing?.roleId || null,
                          teamId: existing?.teamId || null,
                          displayName: existing?.displayName,
                        };
                      }),
                      turnOrder: memberIds,
                    },
                    layoutState: {
                      slots: memberIds.map((memberId, index) => ({
                        slotId: `slot-${index + 1}`,
                        x: index,
                        y: 0,
                        actorId: memberId,
                      })),
                    },
                  });
                } : undefined}
              />}
            </LazyPanel>
          </Box>
        </PageSection>
      </RightPanel>}

      <MessageAnalysisDialog
        open={analysisDialogOpen}
        target={analysisTarget}
        members={members}
        text={analysisText}
        loading={analysisLoading}
        error={analysisError}
        onClose={closeAnalysisDialog}
      />

      <AppSnackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={closeSnackbar}
        severity={snackbar.severity}
        message={snackbar.message}
        offset="composer"
      />
    </Box>
  );
}
