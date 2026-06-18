import { lazy, Suspense, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Box, IconButton, Button, Typography, Switch, Stack, TextField, Chip, Alert } from '@mui/material';
import PageSection from '../components/common/PageSection';
import AppSnackbar from '../components/common/AppSnackbar';
import LoadingState from '../components/common/LoadingState';
import PeopleIcon from '@mui/icons-material/People';
import InfoIcon from '@mui/icons-material/Info';
import PlayIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import ProfilePreviewOverlay from '../components/chat/ProfilePreviewOverlay';
import { buildRuntimeEventMessageContent, normalizeRuntimeEvent } from '../services/runtimeEventFactory';
import { persistLocalFirstMessage, persistLocalFirstMessages } from '../services/chatCommitMessage';
import { buildPrivateSessionEvent } from '../services/directSessionHelpers';
import { resolveCharacterOrDeleted } from '../utils/deletedEntity';
import type { Message, MessageAttachment } from '../types/message';
import type { AICharacter } from '../types/character';
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
import { api, type ChatShareState } from '../services/api';
import { copyTextToClipboard } from '../utils/clipboard';
import { getInputCapabilityWarning, getUsablePreferredAIProfile, resolveAIModelInputCapabilities } from '../types/settings';
import { buildStoryBranchOptions, normalizeStoryChoiceSuggestions } from '../services/storyChoices';

const ChatSidebarPanel = lazy(() => import('../components/chat/ChatSidebarPanel'));
const SessionActionPanel = lazy(() => import('../components/session/SessionActionPanel'));
const CHAT_MESSAGE_WINDOW_SIZE = 40;

type ProfilePreviewState =
  | { kind: 'character'; anchorRect: DOMRect; anchorElement: HTMLElement; character: AICharacter }
  | { kind: 'chat'; anchorRect: DOMRect; anchorElement: HTMLElement };

function PanelFallback() {
  return null;
}

function LazyPanel({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PanelFallback />}>{children}</Suspense>;
}

function ChatSharePanel({ chat }: { chat: GroupChat }) {
  const [state, setState] = useState<ChatShareState>(() => ({
    enabled: Boolean(chat.shareEnabled),
    token: chat.shareToken || null,
    viewerCount: chat.shareViewerCount || 0,
  }));
  const [loading, setLoading] = useState(false);
  const [copyText, setCopyText] = useState('');
  const [error, setError] = useState('');
  const shareUrl = state.token && typeof window !== 'undefined'
    ? `${window.location.origin}/shared/${state.token}`
    : '';

  useEffect(() => {
    let cancelled = false;
    setError('');
    void api.getChatShareState(chat.id)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [chat.id]);

  const toggle = async (enabled: boolean) => {
    setLoading(true);
    setError('');
    setCopyText('');
    try {
      setState(await api.updateChatShareState(chat.id, enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    const copied = await copyTextToClipboard(shareUrl);
    setCopyText(copied ? '已复制' : '复制失败，请手动复制');
  };

  if (chat.type !== 'group') return null;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25, display: 'grid', gap: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>分享聊天记录</Typography>
          <Typography variant="caption" color="text.secondary">匿名只读访问，只显示群聊名称和聊天内容</Typography>
        </Box>
        <Switch checked={state.enabled} disabled={loading} onChange={(event) => void toggle(event.target.checked)} />
      </Stack>
      {error ? <Alert severity="error" sx={{ py: 0 }}>{error}</Alert> : null}
      {state.enabled && shareUrl ? (
        <Stack spacing={1}>
          <TextField
            size="small"
            value={shareUrl}
            fullWidth
            slotProps={{ input: { readOnly: true } }}
          />
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={copy}>复制链接</Button>
            <Chip size="small" variant="outlined" label={`访问人数 ${state.viewerCount}`} />
            {copyText ? <Typography variant="caption" color="text.secondary">{copyText}</Typography> : null}
          </Stack>
        </Stack>
      ) : null}
    </Box>
  );
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
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const { isMobile, isDesktop } = useResponsive();
  const pane = usePaneLayout();
  const isSplitDetailPane = pane.role === 'detail';
  const { setHideMobileBottomNav } = useLayoutHeaderActions();

  const { chats, updateChat, applyChatRuntimeDelta, loadChat, restoreLocalChats, markChatsWarm, isLoading: chatsLoading, remoteDeletedChatIds, remoteDeletedChats } = useChatStore();
  const { characters, updateCharacter, updateCharacters, loadCharacter, markCharactersWarm } = useCharacterStore();
  const { messages, messageWindowsByChatId, hydrateMessagesFromCache, openChatWindow, closeChatWindow, loadMessages, addMessage, upsertMessage, upsertMessages, deleteMessage, hasMore, isLoadingOlder } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const api = useSettingsStore((s) => s.api);
  const aiProfiles = useSettingsStore((s) => s.aiProfiles);
  const textProfile = getUsablePreferredAIProfile(aiProfiles, 'text');
  const textInputCapabilities = resolveAIModelInputCapabilities(textProfile);
  const textInputCapabilityWarning = getInputCapabilityWarning(textProfile, isZh ? 'zh' : 'en');
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, toggleRightPanel, setRightPanelOpen, rightPanelTab, setRightPanelTab } = useUIStore();
  const dramaBoost = useSettingsStore((s) => s.developerUI.dramaBoost);
  const showLocalInterceptionHints = useSettingsStore((s) => s.developerMode && s.developerUI.showLocalInterceptionHints);
  const currentUser = useAuthStore((s) => s.user);
  const isRemoteDeletedChat = Boolean(id && remoteDeletedChatIds.includes(id));

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'error' | 'success' }>({ open: false, message: '', severity: 'error' });
  const [detailBootstrapComplete, setDetailBootstrapComplete] = useState(false);
  const [sidebarMessagesReady, setSidebarMessagesReady] = useState(false);
  const [profilePreview, setProfilePreview] = useState<ProfilePreviewState | null>(null);
  const [aiDirectPerspectiveMemberId, setAiDirectPerspectiveMemberId] = useState<string | null>(null);
  const [guideTargetMemberId, setGuideTargetMemberId] = useState<string | null>(null);

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
      await restoreLocalChats();
      const loadedChat = id ? await loadChat(id) : null;
      const memberIds = loadedChat?.memberIds || useChatStore.getState().chats.find((item) => item.id === id)?.memberIds || [];
      await Promise.all(
        getSyncableCharacterMemberIds(memberIds)
          .filter((memberId) => !useCharacterStore.getState().hasCharacterLoaded(memberId))
          .map((memberId) => loadCharacter(memberId)),
      );
    })().finally(() => {
      if (!cancelled) setDetailBootstrapComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, loadCharacter, loadChat, markCharactersWarm, markChatsWarm, restoreLocalChats]);

  const remoteDeletedChat = remoteDeletedChats.find((c) => c.id === id);
  const chat = chats.find((c) => c.id === id) || remoteDeletedChat;
  const sessionInfoCards = useMemo(() => {
    if (!chat) return [];
    return projectSessionInfoCards({ chat, chats, members: characters, isZh: true });
  }, [chat, chats, characters]);
  const aiDirectSourceInfoCards = useMemo(
    () => chat?.type === 'ai_direct' ? sessionInfoCards.filter((card) => card.key === 'ai-direct-source-chat') : [],
    [chat?.type, sessionInfoCards]
  );
  const globalSessionInfoCards = useMemo(
    () => sessionInfoCards.filter((card) => card.key !== 'ai-direct-source-chat'),
    [sessionInfoCards]
  );
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
  const aiDirectMemberIds = useMemo(
    () => chat?.type === 'ai_direct' ? getSyncableCharacterMemberIds(chat.memberIds) : [],
    [chat]
  );
  const speakAsChar = useMemo(
    () => speakAsCharacterId ? characters.find((c) => c.id === speakAsCharacterId) ?? null : null,
    [characters, speakAsCharacterId]
  );
  useEffect(() => {
    if (!chat || chat.type !== 'ai_direct') {
      setAiDirectPerspectiveMemberId(null);
      return;
    }
    if (aiDirectPerspectiveMemberId && aiDirectMemberIds.includes(aiDirectPerspectiveMemberId)) return;
    setAiDirectPerspectiveMemberId(aiDirectMemberIds[0] || null);
  }, [aiDirectMemberIds, aiDirectPerspectiveMemberId, chat]);
  useEffect(() => {
    setGuideTargetMemberId(null);
  }, [id]);
  const aiDirectPerspectiveChar = useMemo(
    () => {
      if (chat?.type !== 'ai_direct') return null;
      const perspectiveId = aiDirectPerspectiveMemberId && aiDirectMemberIds.includes(aiDirectPerspectiveMemberId)
        ? aiDirectPerspectiveMemberId
        : aiDirectMemberIds[0] || null;
      return perspectiveId ? characters.find((c) => c.id === perspectiveId) ?? members.find((member) => member.id === perspectiveId) ?? null : null;
    },
    [aiDirectMemberIds, aiDirectPerspectiveMemberId, characters, chat, members]
  );
  const effectiveAiDirectPerspectiveMemberId = chat?.type === 'ai_direct'
    ? (aiDirectPerspectiveMemberId && aiDirectMemberIds.includes(aiDirectPerspectiveMemberId) ? aiDirectPerspectiveMemberId : aiDirectMemberIds[0] || null)
    : null;
  const effectiveSpeakAsChar = chat?.type === 'ai_direct' ? aiDirectPerspectiveChar : speakAsChar;
  const guideTargetMember = useMemo(
    () => guideTargetMemberId ? characters.find((c) => c.id === guideTargetMemberId) ?? null : null,
    [characters, guideTargetMemberId]
  );

  const openCharacterPreview = useCallback((character: AICharacter, anchorEl: HTMLElement) => {
    setProfilePreview({ kind: 'character', anchorRect: anchorEl.getBoundingClientRect(), anchorElement: anchorEl, character });
  }, []);

  const openChatPreview = useCallback((anchorEl: HTMLElement) => {
    setProfilePreview({ kind: 'chat', anchorRect: anchorEl.getBoundingClientRect(), anchorElement: anchorEl });
  }, []);
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
    speakAsChar: effectiveSpeakAsChar,
    language: i18n.language,
  });
  const sidebarTabValue = activeSidebarTab === 'actions' ? 'activities' : activeSidebarTab;
  const isStoryRoom = chat?.sessionKind?.scenarioId === 'story-reader';
  const effectiveComposerSurfaces = useMemo(() => {
    const primaryTextSurface = composerSurfaces.find((surface) => surface.type === 'text') || { key: 'member-guide-text', type: 'text' as const };
    const nonTextSurfaces = isStoryRoom ? [] : composerSurfaces.filter((surface) => surface.type !== 'text');
    if (guideTargetMember && !effectiveSpeakAsChar) {
      const nextSurface = {
        ...primaryTextSurface,
        key: 'member-guide-text',
        type: 'text' as const,
        mode: 'guide' as const,
        actorId: guideTargetMember.id,
        capability: 'guide' as const,
        placeholder: `安排${guideTargetMember.name}回应、说话或行动`,
      };
      return [nextSurface, ...nonTextSurfaces];
    }
    if (!effectiveSpeakAsChar && chat?.type === 'group' && chat.memberIds.includes('user')) {
      return [{
        ...primaryTextSurface,
        key: 'member-user-text',
        type: 'text' as const,
        mode: 'memberSpeak' as const,
        actorId: 'user',
        capability: 'speak' as const,
        placeholder: '输入消息',
      }, ...nonTextSurfaces];
    }
    if (!effectiveSpeakAsChar && chat?.type === 'direct') {
      return [{
        ...primaryTextSurface,
        key: 'direct-user-text',
        type: 'text' as const,
        mode: 'memberSpeak' as const,
        actorId: 'user',
        capability: 'speak' as const,
        placeholder: '输入消息',
      }, ...nonTextSurfaces];
    }
    if (!effectiveSpeakAsChar && chat?.type === 'ai_direct') {
      return [{
        ...primaryTextSurface,
        key: 'ai-direct-text',
        type: 'text' as const,
        mode: 'memberSpeak' as const,
        actorId: 'user',
        capability: 'speak' as const,
        placeholder: '输入消息',
      }, ...nonTextSurfaces];
    }
    return composerSurfaces;
  }, [chat, composerSurfaces, effectiveSpeakAsChar, guideTargetMember, isStoryRoom]);
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
    const normalized = message.trim();
    const imageInputCompatibilityHint = isZh
      ? '当前服务商不兼容图片输入格式。可关闭该模型的图片输入能力，或改用官方支持多模态的模型。'
      : 'Current provider is not compatible with the image input format. Disable image input for this model or switch to an officially supported multimodal model.';
    const corsHint = isZh
      ? '浏览器直连被目标服务的跨域策略拦截。可继续保存配置，正式使用建议走服务端代理。'
      : 'The target service blocked browser-direct requests via CORS. You can still save the config, but production use should go through your server proxy.';
    if (/unknown variant `image_url`|expected `text`/i.test(normalized)) {
      setSnackbar({ open: true, message: imageInputCompatibilityHint, severity: 'error' });
      return;
    }
    if (/failed to fetch|cors/i.test(normalized)) {
      setSnackbar({ open: true, message: corsHint, severity: 'error' });
      return;
    }
    setSnackbar({ open: true, message, severity: 'error' });
  }, [isZh]);

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

  const appendMembershipNotice = useCallback(async (content: string) => {
    if (!chat || !id) return;
    await useMessageStore.getState().addMessage({
      chatId: id,
      type: 'system',
      senderId: 'system',
      senderName: 'System',
      content,
      emotion: 0,
      timestamp: Date.now(),
    });
  }, [chat, id]);
  const addMessageStable = addAnchoredMessage;
  const getNextMessageTimestamp = useCallback(() => {
    const latestTimestamp = currentChatMessages.reduce((latest, message) => Math.max(latest, Number(message.timestamp || 0)), 0);
    return Math.max(Date.now(), latestTimestamp + 1);
  }, [currentChatMessages]);

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
    pause,
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

  const handleMemberSpeakSend = useCallback(async (content: string, attachments: MessageAttachment[] = []) => {
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
        timestamp: getNextMessageTimestamp(),
        metadata: attachments.length ? { attachments } : undefined,
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
  }, [addMessageStable, aiProfiles, api, appendEventMessage, appendEventMessageStable, appendEventMessagesStable, appendLocalInterceptionHint, applyChatRuntimeDelta, characters, chat, chats, commitPersistedManualRuntime, currentChatMessages, currentUser?.nickname, enqueueManualInput, getNextMessageTimestamp, id, recordSpeak, startConversationLoopIfNeeded, updateCharacter, updateCharacters, updateChat, upsertMessageStable]);

  const handleGuideSend = useCallback(async (content: string, attachments: MessageAttachment[] = []) => {
    if (!chat || !id) return;
    await enqueueManualInput(async () => {
      const recentMessages = currentChatMessages;
      const guidedMessage = await addMessageStable({
        chatId: id,
        type: 'god',
        senderId: 'user',
        senderName: '导演安排',
        content,
        emotion: 0,
        timestamp: getNextMessageTimestamp(),
        metadata: attachments.length ? { attachments } : undefined,
      });
      void updateChat(id, { lastMessageAt: guidedMessage.timestamp, latestMessage: guidedMessage });
      const recentMessagesWithGuide = [...recentMessages.filter((message) => message.id !== guidedMessage.id), guidedMessage];
      await commitPersistedManualRuntime(guidedMessage, recentMessagesWithGuide);
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, chat, commitPersistedManualRuntime, currentChatMessages, enqueueManualInput, getNextMessageTimestamp, id, startConversationLoopIfNeeded, updateChat]);

  const handleSpeakAs = useCallback(async (content: string, attachments: MessageAttachment[] = []) => {
    if (!chat || !id || !effectiveSpeakAsChar) return;
    const char = effectiveSpeakAsChar;
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
        timestamp: getNextMessageTimestamp(),
        metadata: {
          manualSpeaker: {
            actorId: char.id,
            actorName: char.name,
            avatar: char.avatar,
          },
          ...(attachments.length ? { attachments } : {}),
        },
      });
      void updateChat(id, { lastMessageAt: spokeMessage.timestamp, latestMessage: spokeMessage });
      const recentMessagesWithSpeaker = [...recentMessages.filter((message) => message.id !== spokeMessage.id), spokeMessage];
      await commitPersistedManualRuntime(spokeMessage, recentMessagesWithSpeaker);
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, chat, commitPersistedManualRuntime, currentChatMessages, effectiveSpeakAsChar, enqueueManualInput, getNextMessageTimestamp, id, startConversationLoopIfNeeded, updateChat]);

  const { runSessionAction, triggerPairPrivateThread, normalizeAndRunSurfaceIntent, runAutoSocialEventFlow } = useChatSurfaceActions({
    chat,
    chats,
    characters,
    updateChat,
    addMessage: addMessageStable,
    appendEventMessage: appendEventMessageStable,
    actionSchema,
    aiProfiles,
    speakAsChar: effectiveSpeakAsChar,
    handleGuideSend,
    handleMemberSpeakSend,
    handleSpeakAs,
    setSnackbar,
  });

  const storyChoiceSourceMessage = useMemo(
    () => {
      if (!isStoryRoom) return null;
      if (chat?.scenarioState?.phase !== 'choice') return null;
      for (let index = currentChatMessages.length - 1; index >= 0; index -= 1) {
        const message = currentChatMessages[index];
        if (!normalizeStoryChoiceSuggestions(message.metadata?.storyChoices).length) continue;
        return message;
      }
      return null;
    },
    [chat?.scenarioState?.phase, currentChatMessages, isStoryRoom],
  );
  const storyBranchOptions = useMemo(
    () => {
      const sourceId = storyChoiceSourceMessage?.id || '';
      return buildStoryBranchOptions({
        storyChoices: storyChoiceSourceMessage?.metadata?.storyChoices,
        branches: chat?.scenarioState?.branches,
        choiceEpoch: chat?.scenarioState?.choiceEpoch,
        sourceId,
      });
    },
    [chat?.scenarioState?.branches, chat?.scenarioState?.choiceEpoch, storyChoiceSourceMessage],
  );
  const visibleActionPanelActions = useMemo(
    () => (projectedActionPanelActions.length ? projectedActionPanelActions : sessionActions)
      .filter((action) => action.type !== 'choose_story_branch'),
    [projectedActionPanelActions, sessionActions],
  );
  const isStoryWaitingForChoice = chat?.sessionKind?.scenarioId === 'story-reader' && storyBranchOptions.length > 0;
  const runLoopStatusContent = (chatError || runLoopError) ? (
    <Alert severity="error" variant="outlined" sx={{ mx: { xs: 1.25, sm: 2 }, mt: 1, borderRadius: 3 }}>
      {chatError || runLoopError}
    </Alert>
  ) : null;
  const handleChooseStoryBranch = useCallback(async (optionValue: string) => {
    if (!chat || !id) return;
    const option = storyBranchOptions.find((item) => item.value === optionValue);
    const branches = chat.scenarioState?.branches || [];
    const selectedBranch = branches.find((branch) => branch.branchId === optionValue)
      || branches.find((branch) => branch.label === option?.label && branch.prompt === option?.prompt)
      || branches.find((branch) => branch.label === option?.label);
    const branchId = selectedBranch?.branchId || optionValue;
    const storyDirection = selectedBranch?.prompt || selectedBranch?.description || option?.prompt || option?.label || chat.scenarioState?.storyDirection;
    const choiceLabel = option?.label || selectedBranch?.label || storyDirection || branchId;
    const choiceMessage = await addMessageStable({
      chatId: id,
      type: 'user',
      senderId: 'user',
      senderName: currentUser?.nickname?.trim() || '我',
      content: `我选择：${choiceLabel}`,
      emotion: 0,
      timestamp: getNextMessageTimestamp(),
      metadata: {
        storyChoiceSelection: {
          branchId,
          label: choiceLabel,
          prompt: storyDirection || null,
          intent: option?.intent || selectedBranch?.intent || null,
          risk: option?.risk || selectedBranch?.risk || null,
          reward: option?.reward || selectedBranch?.reward || null,
          choiceEpoch: chat.scenarioState?.choiceEpoch,
        },
      },
    });
    void updateChat(id, { lastMessageAt: choiceMessage.timestamp, latestMessage: choiceMessage });
    const actionResult = await runSessionAction({ type: 'choose_story_branch', actorId: 'user' }, { branchId, prompt: storyDirection });
    const nextChat = actionResult?.chatPatch ? {
      ...chat,
      ...actionResult.chatPatch,
      scenarioState: {
        ...(chat.scenarioState || {}),
        ...(actionResult.chatPatch.scenarioState || {}),
      },
      worldState: {
        ...chat.worldState,
        ...(actionResult.chatPatch.worldState || {}),
      },
    } : chat;
    await updateChat(id, actionResult?.chatPatch || {});
    startConversationLoopIfNeeded(nextChat);
  }, [addMessageStable, chat, currentUser?.nickname, getNextMessageTimestamp, id, runSessionAction, startConversationLoopIfNeeded, storyBranchOptions, updateChat]);
  const storyBranchSuggestionContent = runLoopStatusContent;

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
            selfMemberId={effectiveAiDirectPerspectiveMemberId}
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
      <Box sx={{ display: 'grid', justifyItems: 'center', alignContent: 'start', height: '100%', p: 3, pt: { xs: 4, sm: 6 } }}>
        {!isRemoteDeletedChat && (chatsLoading || !detailBootstrapComplete) ? (
          <LoadingState title="正在打开会话" compact />
        ) : (
          <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'center', textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {isRemoteDeletedChat ? '这个会话已在其他设备删除' : '未找到这个会话'}
            </Typography>
            {isRemoteDeletedChat ? (
              <Button size="small" variant="outlined" onClick={() => navigate('/settings/recycle-bin')}>
                查看回收站
              </Button>
            ) : null}
          </Box>
        )}
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
          title={(
            <Box
              component="button"
              type="button"
              onClick={(event) => openChatPreview(event.currentTarget)}
              sx={{
                minWidth: 0,
                maxWidth: '100%',
                p: 0,
                m: 0,
                border: 0,
                bgcolor: 'transparent',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
                display: 'flex',
                alignItems: 'center',
                minHeight: 40,
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {chat.name}
              </Typography>
            </Box>
          )}
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
            onCharacterAvatarClick={openCharacterPreview}
            selfMemberId={effectiveAiDirectPerspectiveMemberId}
            onReachTop={handleNearTop}
            isLoadingOlder={isLoadingOlder}
            hasMore={hasMore}
            loadingText={t('common.loading')}
            topHint="没有更早的消息"
            topInset={isSplitDetailPane ? { xs: '76px', sm: '76px' } : { xs: 'calc(88px + env(safe-area-inset-top, 0px))', sm: '80px' }}
            bottomInset={isRemoteDeletedChat ? { xs: '24px', sm: '24px' } : { xs: 'calc(82px + env(safe-area-inset-bottom, 0px))', sm: '82px' }}
            privateConversation={chat.type === 'direct' || chat.type === 'ai_direct'}
            tailContent={storyBranchSuggestionContent}
            storyChoiceMessageId={isStoryWaitingForChoice ? storyChoiceSourceMessage?.id : null}
            storyChoiceOptions={storyBranchOptions}
            onChooseStoryChoice={isStoryWaitingForChoice ? handleChooseStoryBranch : undefined}
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
            surfaces={effectiveComposerSurfaces}
            speakAsCharacterName={effectiveSpeakAsChar?.name}
            onCloseSpeakAs={effectiveSpeakAsChar && chat.type !== 'ai_direct' ? () => setSpeakAsCharacter(null) : undefined}
            sendingLabel="等待角色发言结束"
            hideSpeakAsChip={chat.type === 'ai_direct'}
            inputCapabilities={textInputCapabilities}
            inputCapabilityWarning={textInputCapabilityWarning}
            onOpenPanel={isMobile ? () => setRightPanelOpen(true) : undefined}
            onDraftActivity={(activity) => {
              userDraftActivityRef.current = activity;
            }}
            onSubmitText={(submission, surface) => {
              if (!effectiveSpeakAsChar && guideTargetMember && surface.mode === 'guide') {
                const guidedContent = `${guideTargetMember.name}，${submission.content}`;
                setGuideTargetMemberId(null);
                return normalizeAndRunSurfaceIntent(surface, { ...submission, content: guidedContent, actorId: guideTargetMember.id });
              }
              const effectiveSurface = effectiveSpeakAsChar ? { ...surface, mode: 'speakAs' as const, actorId: effectiveSpeakAsChar.id } : surface;
              const effectiveSubmission = effectiveSpeakAsChar ? { ...submission, actorId: effectiveSpeakAsChar.id } : submission;
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
          <SessionInfoCards cards={globalSessionInfoCards} onOpenChat={(chatId) => navigate(`/chats/${chatId}`)} />
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <LazyPanel>
              {runtimePanelLoading ? <LoadingState title="正在加载" compact /> : <ChatSidebarPanel
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
                memberFooter={aiDirectSourceInfoCards.length ? (
                  <SessionInfoCards cards={aiDirectSourceInfoCards} onOpenChat={(chatId) => navigate(`/chats/${chatId}`)} />
                ) : null}
                privatePayloads={projectedDetailState?.sidebarChat.privatePayloads || privatePayloads}
                privatePayloadTitle={projectedDetailState?.privatePayloadTitle}
                directMemoryContext={directMemoryPanelContext}
                showActivityTab={showActionTab}
                activityPanel={showActionTab ? (
                  <LazyPanel>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'stretch' }}>
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
                        showHeader={false}
                      />
                      <ChatSharePanel chat={chat} />
                      <SessionActionPanel title={projectedDetailState?.actionPanel.title || actionPanelTitle} actions={visibleActionPanelActions} onRunAction={runSessionAction} hideHeader frameless />
                    </Box>
                  </LazyPanel>
                ) : null}
                onSpeakAs={(charId) => {
                  setGuideTargetMemberId(null);
                  setSpeakAsCharacter(charId);
                }}
                onGuideMember={chat.type === 'group' ? (charId) => {
                  setSpeakAsCharacter(null);
                  setGuideTargetMemberId(charId);
                } : undefined}
                onSetPerspectiveMember={chat.type === 'ai_direct' ? (charId) => {
                  setAiDirectPerspectiveMemberId(charId);
                } : undefined}
                perspectiveMemberId={effectiveAiDirectPerspectiveMemberId}
                onStartDirectChat={chat.type === 'group' ? handleStartDirectChat : undefined}
                onRemoveMember={chat.type === 'group' ? async (charId) => {
                  const newMembers = chat.memberIds.filter((m) => m !== charId);
                  if (newMembers.length < 2) return;
                  const removedName = members.find((member) => member.id === charId)?.name || charId;
                  await updateChat(chat.id, { memberIds: newMembers });
                  await appendMembershipNotice(`${removedName} 离开群聊`);
                } : undefined}
                onUpdateSeats={chat.type === 'group' ? async (memberIds) => {
                  const previousMembers = new Set(chat.memberIds);
                  const nextMembers = new Set(memberIds);
                  const addedMembers = memberIds.filter((memberId) => !previousMembers.has(memberId));
                  const removedMembers = chat.memberIds.filter((memberId) => !nextMembers.has(memberId));
                  await updateChat(chat.id, {
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
                  if (addedMembers.length) {
                    const names = addedMembers.map((memberId) => members.find((member) => member.id === memberId)?.name || memberId);
                    await appendMembershipNotice(`${names.join('、')} 加入群聊`);
                  }
                  if (removedMembers.length) {
                    const names = removedMembers.map((memberId) => members.find((member) => member.id === memberId)?.name || memberId);
                    await appendMembershipNotice(`${names.join('、')} 离开群聊`);
                  }
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

      <ProfilePreviewOverlay
        open={Boolean(profilePreview)}
        kind={profilePreview?.kind || 'chat'}
        anchorRect={profilePreview?.anchorRect || null}
        anchorElement={profilePreview?.anchorElement || null}
        character={profilePreview?.kind === 'character' ? profilePreview.character : null}
        chat={chat}
        members={members}
        chatStatusLabel={isRunning && !isPaused ? '运行中' : chat.isActive ? '已暂停' : '未运行'}
        actionLabel={profilePreview?.kind === 'character' ? '角色详情' : '群聊详情'}
        actionTiming="immediate"
        onAction={() => {
          if (profilePreview?.kind === 'character') {
            navigate(`/characters/${profilePreview.character.id}/edit?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
            return;
          }
          navigate(`/chats/${chat.id}/edit`);
        }}
        onClose={() => setProfilePreview(null)}
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
