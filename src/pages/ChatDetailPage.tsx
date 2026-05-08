import { lazy, Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Box, IconButton, Button, Snackbar, Alert, Typography, Dialog, DialogTitle, DialogContent, CircularProgress } from '@mui/material';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';
import StatChipRow from '../components/common/StatChipRow';
import {
  People as PeopleIcon,
  Info as InfoIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
} from '@mui/icons-material';
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
import type { SessionActionDefinition, SessionNormalizedIntentResult } from '../types/sessionEngine';
import MessageList from '../components/chat/MessageList';
import SessionComposerHost from '../components/session/SessionComposerHost';
import { buildDefaultSessionSurfaceProjection } from '../types/chat';
import { buildActionRuntimeContract, buildRuntimeEventContract } from '../services/sessionRuntimeContract';
import RightPanel from '../components/layout/RightPanel';
import { buildRuntimeEvent } from '../services/runtimeEventFactory';
import { buildPrivateSessionEvent } from '../services/directSessionHelpers';
import { resolveCharacterOrDeleted } from '../utils/deletedEntity';
import type { LiveChatMessage } from '../components/chat/chatRenderModel';
import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';

const ChatSidebarPanel = lazy(() => import('../components/chat/ChatSidebarPanel'));
const SessionActionPanel = lazy(() => import('../components/session/SessionActionPanel'));

type SessionProjectionData = Awaited<ReturnType<typeof import('../services/sessionEngineKernel')['resolveSessionProjectionData']>>;
type ProjectedChatDetailState = ReturnType<typeof import('../services/sessionProjection')['buildProjectedChatDetailState']>;

function PanelFallback() {
  return null;
}

function LazyPanel({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PanelFallback />}>{children}</Suspense>;
}

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();

  const { chats, updateChat, loadChats, markChatsWarm, isLoading: chatsLoading } = useChatStore();
  const { characters, updateCharacter, loadCharacters, markCharactersWarm } = useCharacterStore();
  const { messages, openChatWindow, closeChatWindow, loadMessages, addMessage, upsertMessage, deleteMessage, hasMore, isLoadingOlder } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const api = useSettingsStore((s) => s.api);
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, toggleRightPanel, rightPanelTab, setRightPanelTab } = useUIStore();
  const dramaBoost = useSettingsStore((s) => s.developerUI.dramaBoost);

  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<LiveChatMessage | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [runLoopError, setRunLoopError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'error' | 'success' }>({ open: false, message: '', severity: 'error' });
  const [projectionData, setProjectionData] = useState<SessionProjectionData | null>(null);
  const [projectedDetailState, setProjectedDetailState] = useState<ProjectedChatDetailState | null>(null);
  const [analysisTarget, setAnalysisTarget] = useState<Message | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [detailBootstrapComplete, setDetailBootstrapComplete] = useState(false);

  const loopTokenRef = useRef<string | null>(null);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(id ?? null);
  const liveMessageRef = useRef<LiveChatMessage | null>(null);
  const liveMessageSeedRef = useRef<Omit<LiveChatMessage, 'content'> | null>(null);
  const lastAutoThreadCandidateIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetailBootstrapComplete(false);
    markChatsWarm();
    markCharactersWarm();
    void Promise.all([loadChats(), loadCharacters()]).finally(() => {
      if (!cancelled) setDetailBootstrapComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loadCharacters, loadChats, markCharactersWarm, markChatsWarm]);

  const chat = chats.find((c) => c.id === id);
  const members = useMemo(
    () => chat ? chat.memberIds.map((memberId) => resolveCharacterOrDeleted(characters, memberId)) : [],
    [characters, chat]
  );
  const activeMembers = useMemo(
    () => chat ? characters.filter((c) => chat.memberIds.includes(c.id)) : [],
    [characters, chat]
  );
  const projectedRuntimeState = projectionData?.runtimeState || null;
  const frameworkState = projectionData?.frameworkState || null;
  const privatePayloads = projectionData?.privatePayloads || [];
  const actionSchema = projectionData?.actionSchema || null;
  const inputSurfaces = frameworkState?.surfaces.surfaces || [];
  const actionTabActions = useMemo(() => actionSchema?.actions || [], [actionSchema]);
  const speakAsChar = useMemo(
    () => speakAsCharacterId ? characters.find((c) => c.id === speakAsCharacterId) ?? null : null,
    [characters, speakAsCharacterId]
  );
  const showMemberTab = projectedDetailState?.showMemberTab ?? true;
  const showRuntimeTab = projectedDetailState?.showRuntimeTab ?? true;
  const showActionTab = projectedDetailState?.showActionTab ?? (chat?.type === 'group');
  const activeSidebarTab = projectedDetailState?.activeSidebarTab
    || (showMemberTab && rightPanelTab === 'members' ? 'members'
      : showRuntimeTab && rightPanelTab === 'world' ? 'world'
        : showMemberTab ? 'members' : 'world');
  const memberTabTitle = projectedDetailState?.memberTabTitle || (chat?.type === 'group' ? '成员' : '角色');
  const runtimeTabTitle = projectedDetailState?.runtimeTabTitle || (chat?.type === 'group' ? '运行态' : '状态');
  const sidebarTitle = projectedDetailState?.sidebarTitle || (activeSidebarTab === 'members' ? memberTabTitle : activeSidebarTab === 'actions' ? '动作' : runtimeTabTitle);

  const manualPrivateThreadAction: SessionActionDefinition = {
    type: 'start_private_thread',
    label: '发起 AI 私聊',
    description: '从群聊中手动选择两名成员，派生一条独立 AI 私聊。',
    visibility: 'public',
    fields: [
      { key: 'actorId', label: '发起者', type: 'single_select', required: true, options: members.map((member) => ({ value: member.id, label: member.name })) },
      { key: 'targetId', label: '对象', type: 'single_select', required: true, options: members.map((member) => ({ value: member.id, label: member.name })) },
    ],
  };
  const sessionActions = chat?.type === 'group'
    ? [manualPrivateThreadAction, ...actionTabActions.filter((action: SessionActionDefinition) => action.type !== 'start_private_thread')]
    : actionTabActions;
  const actionPanelTitle = chat?.type === 'group' ? '动作与派生' : actionSchema?.title;
  const compactCharacterMemorySummary = projectedDetailState?.compactCharacterMemorySummary || speakAsChar?.layeredMemories?.slice(-2).map((item) => item.text).join(' / ');
  const composerSurfaces = projectedDetailState?.composerSurfaces || (inputSurfaces.length ? inputSurfaces : (chat ? buildDefaultSessionSurfaceProjection(chat).surfaces : []));
  const actionPanel = sessionActions.length ? <LazyPanel><SessionActionPanel title={actionPanelTitle} actions={sessionActions} onRunAction={() => undefined} /></LazyPanel> : null;
  void runLoopError;
  void chatError;
  void dramaBoost;
  void rightPanelOpen;
  void actionPanel;

  const showErrorToast = useCallback((message: string) => {
    setSnackbar({ open: true, message, severity: 'error' });
  }, []);

  const closeSnackbar = useCallback(() => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  }, []);

  const updateLiveMessage = useCallback((updater: (current: LiveChatMessage | null) => LiveChatMessage | null) => {
    setLiveMessage((current) => {
      const next = updater(current);
      liveMessageRef.current = next;
      return next;
    });
  }, []);

  const clearLiveMessage = useCallback(() => {
    liveMessageRef.current = null;
    liveMessageSeedRef.current = null;
    setLiveMessage(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!chat) {
      setProjectionData(null);
      setProjectedDetailState(null);
      return undefined;
    }

    void Promise.all([
      import('../services/sessionEngineRegistry'),
      import('../services/sessionEngineKernel'),
      import('../services/sessionProjection'),
    ]).then(([registry, kernel, projection]) => {
      if (cancelled) return;
      const engine = registry.getSessionEngine(chat.mode);
      const runtimeContext = kernel.createSessionRuntimeContext(engine, chat);
      const nextProjectionData = kernel.resolveSessionProjectionData(engine, runtimeContext);
      setProjectionData(nextProjectionData);
      setProjectedDetailState(nextProjectionData.frameworkState.definition ? projection.buildProjectedChatDetailState({
        chat,
        runtimeState: nextProjectionData.runtimeState,
        privatePayloads: nextProjectionData.privatePayloads,
        visiblePanels: nextProjectionData.view.visiblePanels,
        schemaActions: nextProjectionData.actionSchema?.actions || [],
        schemaTitle: nextProjectionData.actionSchema?.title,
        rightPanelTab,
        frameworkState: nextProjectionData.frameworkState,
        speakAsChar,
      }) : null);
    });

    return () => {
      cancelled = true;
    };
  }, [chat, rightPanelTab, speakAsChar]);


  useEffect(() => {
    if (id) {
      void openChatWindow(id, { limit: 20, revalidate: true });
      return () => {
        activeChatIdRef.current = null;
        loopTokenRef.current = null;
        setThinkingId(null);
        clearLiveMessage();
        setChatError(null);
        closeChatWindow(id, { clearActiveOnly: true });
        stop();
      };
    }
  }, [clearLiveMessage, closeChatWindow, id, openChatWindow, stop]);

  useEffect(() => {
    isRunningRef.current = isRunning;
    isPausedRef.current = isPaused;
  }, [isPaused, isRunning]);

  useEffect(() => {
    activeChatIdRef.current = id ?? null;
    loopTokenRef.current = loopToken;
  }, [id, loopToken]);

  const appendEventMessage = useCallback(async (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[] }) => {
    const targetChat = chats.find((item) => item.id === chatId);
    const eventPayload = targetChat ? buildPrivateSessionEvent(targetChat, payload) : payload;
    await addMessage({
      chatId,
      type: 'event',
      senderId: 'system',
      senderName: 'System',
      content: buildRuntimeEvent(eventPayload),
      emotion: 0,
    });
  }, [addMessage, chats]);

  const triggerPairPrivateThread = useCallback(async (sourceChat: GroupChat, actorId: string, targetId: string, navigateAfterCreate = false) => {
    if (!actorId || !targetId || actorId === targetId) return null;
    const { createAiPrivateThread } = await import('../services/directSessionRuntime');
    const privateChat = await createAiPrivateThread({
      sourceChat,
      chats,
      characters,
      starterId: actorId,
      targetId,
      addChat: async (input) => useChatStore.getState().addChat(input),
      addMessage,
      appendEventMessage,
    });
    if (privateChat && navigateAfterCreate) navigate(`/chats/${privateChat.id}`);
    return privateChat;
  }, [addMessage, appendEventMessage, characters, chats, navigate]);

  const runSessionAction = useCallback(async (action: { type: string; actorId?: string }, payload: Record<string, unknown>) => {
    if (!chat) return;
    if (action.type === 'start_private_thread') {
      const actorId = typeof payload.actorId === 'string' ? payload.actorId : action.actorId || '';
      const targetId = typeof payload.targetId === 'string' ? payload.targetId : '';
      if (!actorId || !targetId || actorId === targetId) return;
      await triggerPairPrivateThread(chat, actorId, targetId, true);
      return;
    }

    const { buildDefaultActionIntent, buildSessionIntentSummary } = await import('../types/sessionEngine');
    const intent = buildDefaultActionIntent(action.type, payload, action.actorId);
    const summary = `${action.type}：${buildSessionIntentSummary(intent)}`;
    await updateChat(chat.id, {
      worldState: {
        ...chat.worldState,
        recentEvent: summary,
      },
    });
    await appendEventMessage(chat.id, buildActionRuntimeContract(chat, action.type, payload, action.actorId, {
      eventType: 'session_action_intent',
      title: action.type,
      summary,
      metrics: payload,
      visibilityScope: 'public',
    }));
  }, [appendEventMessage, chat, triggerPairPrivateThread, updateChat]);

  const handleGuideSend = useCallback(async (content: string) => {
    if (!chat || !id) return;
    await addMessage({ chatId: id, type: 'user', senderId: 'user', senderName: 'User', content, emotion: 0 });
    if (chat.type === 'direct') {
      const { applyAiDirectFeedback } = await import('../services/directSessionRuntime');
      await applyAiDirectFeedback({ chat, chats, characters, content, updateCharacter, updateChat, appendEventMessage });
    }
  }, [addMessage, appendEventMessage, characters, chat, chats, id, updateCharacter, updateChat]);

  const handleSpeakAs = useCallback(async (content: string) => {
    if (!chat || !id || !speakAsCharacterId) return;
    const char = characters.find((c) => c.id === speakAsCharacterId);
    if (!char) return;
    await addMessage({ chatId: id, type: 'ai', senderId: char.id, senderName: char.name, content, emotion: 0 });
    setSpeakAsCharacter(null);
  }, [addMessage, characters, chat, id, setSpeakAsCharacter, speakAsCharacterId]);

  const runSurfaceIntent = useCallback(async (surfaceResult: SessionNormalizedIntentResult) => {
    if (!chat) return;
    const { buildActionFromIntent, buildBoardArtifactEventSummary } = await import('../types/sessionEngine');
    const { intent } = surfaceResult;

    if (intent.type === 'message_intent') {
      const content = typeof intent.payload.content === 'string' ? intent.payload.content : '';
      if (!content) return;
      if ((intent.payload.mode === 'speakAs' || speakAsChar) && speakAsChar) {
        await handleSpeakAs(content);
        return;
      }
      await handleGuideSend(content);
      return;
    }

    if (intent.type === 'board_intent') {
      const summary = buildBoardArtifactEventSummary(intent);
      await updateChat(chat.id, {
        worldState: {
          ...chat.worldState,
          recentEvent: summary,
        },
      });
      await appendEventMessage(chat.id, buildRuntimeEventContract(chat, intent, {
        eventType: 'board_intent',
        title: '棋盘动作',
        summary,
        metrics: intent.payload,
        visibilityScope: 'public',
      }));
      return;
    }

    const action = buildActionFromIntent(actionSchema, intent);
    if (action) {
      await runSessionAction(action, typeof intent.payload.fields === 'object' && intent.payload.fields ? intent.payload.fields as Record<string, unknown> : {});
    }
  }, [actionSchema, appendEventMessage, chat, handleGuideSend, handleSpeakAs, runSessionAction, speakAsChar, updateChat]);

  const normalizeAndRunSurfaceIntent = useCallback(async (...args: Parameters<typeof import('../types/sessionEngine')['buildNormalizedIntentResult']>) => {
    const { buildNormalizedIntentResult } = await import('../types/sessionEngine');
    await runSurfaceIntent(buildNormalizedIntentResult(...args));
  }, [runSurfaceIntent]);

  const runAutoSocialEventFlow = useCallback(async (sourceChat: GroupChat) => {
    const { runSocialEventAutoFlow } = await import('../services/directSessionRuntime');
    return runSocialEventAutoFlow(sourceChat, {
      chats,
      characters,
      updateChat,
      addChat: async (input) => useChatStore.getState().addChat(input),
      addMessage,
      appendEventMessage,
    });
  }, [addMessage, appendEventMessage, characters, chats, updateChat]);

  useEffect(() => {
    if (!chat || chat.type !== 'group') return;
    const latestEventId = chat.runtimeEventsV2?.at(-1)?.id || null;
    const autoFlowKey = `${chat.id}:${chat.updatedAt}:${latestEventId}`;
    if (lastAutoThreadCandidateIdRef.current === autoFlowKey) return;
    lastAutoThreadCandidateIdRef.current = autoFlowKey;
    void runAutoSocialEventFlow(chat);
  }, [chat, runAutoSocialEventFlow]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!id || loadingMoreRef.current || !hasMore || messages.length === 0) return;
    loadingMoreRef.current = true;
    try {
      await loadMessages(id, { append: true, before: messages[0].timestamp, limit: 20 });
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, id, loadMessages, messages]);

  const handleNearTop = useCallback(() => {
    void handleLoadOlderMessages();
  }, [handleLoadOlderMessages]);

  const handleAnalyzeMessage = useCallback(async (targetMessage: Message) => {
    if (!chat) return;
    setAnalysisTarget(targetMessage);
    setAnalysisDialogOpen(true);
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisText('');
    try {
      const { analyzeChatMessage } = await import('../services/messageAnalysis');
      const result = await analyzeChatMessage(api, {
        chat,
        message: targetMessage,
        messages,
        characters,
      });
      setAnalysisText(result.trim() || '未生成有效分析结果。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAnalysisError(message || t('common.error'));
    } finally {
      setAnalysisLoading(false);
    }
  }, [api, characters, chat, messages, t]);

  const runLoop = useCallback(async (loopId: string) => {
    if (!chat || !id) return;
    const [{ runChatLoop }, { getSessionEngine }] = await Promise.all([
      import('../services/chatLoopRunner'),
      import('../services/sessionEngineRegistry'),
    ]);
    const sessionEngine = getSessionEngine(chat.mode);
    await runChatLoop({
      loopId,
      chatId: id,
      chat,
      characters: activeMembers,
      api,
      getCurrentMessages: () => useMessageStore.getState().messages,
      isRunning: () => isRunningRef.current,
      isPaused: () => isPausedRef.current,
      isActiveLoop: (currentLoopId) => activeChatIdRef.current === id && loopTokenRef.current === currentLoopId,
      onSpeakerSelected: (charId) => {
        const speaker = activeMembers.find((member) => member.id === charId);
        const seed = { key: `live-${loopId}-${charId}`, chatId: id, senderId: charId, senderName: speaker?.name || '', startedAt: Date.now() };
        liveMessageSeedRef.current = seed;
        setRunLoopError(null);
        setThinkingId(charId);
        updateLiveMessage(() => ({ ...seed, content: '' }));
        setCurrentSpeaker(charId);
      },
      onMessageChunk: (content) => {
        updateLiveMessage((current) => current ? { ...current, content } : current);
        setChatError(null);
      },
      onClearStreamingState: () => {
        clearLiveMessage();
        setThinkingId(null);
        setCurrentSpeaker(null);
      },
      onEngineError: (error) => {
        clearLiveMessage();
        setThinkingId(null);
        setCurrentSpeaker(null);
        const message = error.message || t('common.error');
        setChatError(message);
        setRunLoopError(message);
        showErrorToast(message);
      },
      onLoopError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const safeMessage = message || t('common.error');
        setRunLoopError(safeMessage);
      },
      onCommit: sessionEngine.onMessageCommitted as (args: {
        conversation: GroupChat;
        characters: AICharacter[];
        message: Pick<Message, 'content' | 'type' | 'senderId'>;
        previousAiMessage: Pick<Message, 'senderId'> | null;
        recentMessages?: Message[];
        apiConfig?: import('../types/settings').APIConfig;
      }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>,
      upsertMessage,
      updateCharacter,
      appendEventMessage,
      updateChat,
      recordSpeak,
    });
  }, [activeMembers, api, appendEventMessage, chat, clearLiveMessage, id, recordSpeak, setCurrentSpeaker, showErrorToast, t, updateCharacter, updateChat, updateLiveMessage, upsertMessage]);

  const fromTab = useMemo(() => new URLSearchParams(window.location.search).get('fromTab'), []);

  const handleHeaderBack = useCallback(() => {
    navigate(fromTab ? `/chats?tab=${fromTab}` : '/chats');
  }, [fromTab, navigate]);

  const handleHeaderPrimaryAction = useCallback(() => {
    if (!id) return;
    if (!isRunning) {
      resetAllCooldowns();
      const newLoopToken = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      loopTokenRef.current = newLoopToken;
      start(newLoopToken);
      updateChat(id, { isActive: true });
      setTimeout(() => void runLoop(newLoopToken), 100);
    } else if (isPaused) {
      const newLoopToken = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      loopTokenRef.current = newLoopToken;
      start(newLoopToken);
      resume();
    } else {
      pause();
      updateChat(id, { isActive: false });
    }
  }, [id, isPaused, isRunning, pause, resetAllCooldowns, resume, runLoop, start, updateChat]);

  useEffect(() => {
    if (!chat) return;
    setHeaderTitle(chat.name);
    setHeaderBackAction(() => handleHeaderBack);
    setHideMobileBottomNav(true);
    setHeaderActions(
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton onClick={handleHeaderPrimaryAction} color={isRunning && !isPaused ? 'primary' : 'default'}>
          {isRunning && !isPaused ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton onClick={toggleRightPanel}>
          <PeopleIcon />
        </IconButton>
        <IconButton onClick={() => navigate(`/chats/${chat.id}/edit`)}>
          <InfoIcon />
        </IconButton>
      </Box>
    );
  }, [chat, handleHeaderBack, handleHeaderPrimaryAction, isPaused, isRunning, navigate, setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav, toggleRightPanel]);

  useEffect(() => () => {
    setHeaderTitle(null);
    setHeaderBackAction(null);
    setHideMobileBottomNav(false);
    setHeaderActions(null);
  }, [setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav]);

  if (!chat) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {chatsLoading || !detailBootstrapComplete ? '正在打开会话...' : '未找到这个会话'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, minHeight: 0, height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto auto' }}>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <MessageList
            key={id}
            messages={messages}
            characters={characters}
            liveMessage={liveMessage}
            onDeleteMessage={deleteMessage}
            onAnalyzeMessage={handleAnalyzeMessage}
            onReachTop={handleNearTop}
            isLoadingOlder={isLoadingOlder}
            hasMore={hasMore}
            loadingText={t('common.loading')}
            topHint="没有更早的消息"
          />
        </Box>
        <Box sx={{ px: 2, pb: 1, flexShrink: 0 }}>
          {compactCharacterMemorySummary && speakAsChar ? <Box sx={{ mb: 0.75, px: 1.25, py: 0.75, borderRadius: 2, bgcolor: 'action.hover', color: 'text.secondary', fontSize: 12 }}>{`${speakAsChar.name}：${compactCharacterMemorySummary}`}</Box> : null}
        </Box>
        <SessionComposerHost
          surfaces={composerSurfaces}
          speakAsCharacterName={speakAsChar?.name}
          onCloseSpeakAs={speakAsChar ? () => setSpeakAsCharacter(null) : undefined}
          onSubmitText={(submission, surface) => {
            void normalizeAndRunSurfaceIntent(surface, submission);
          }}
          onSubmitForm={(submission, surface) => {
            void normalizeAndRunSurfaceIntent(surface, submission);
          }}
          onSubmitBoard={(submission, surface) => {
            void normalizeAndRunSurfaceIntent(surface, submission);
          }}
        />
      </Box>

      <RightPanel title={sidebarTitle}>
        <PageSection spacing={2}>
          {chat.type === 'ai_direct' && chat.sourceChatId ? (
            <Button variant="outlined" onClick={() => navigate(`/chats/${chat.sourceChatId}`)}>返回来源群聊</Button>
          ) : null}
          {(chat.type === 'direct' || chat.type === 'ai_direct') ? (
            <SurfaceCard>
              <SectionHeader title="会话信息" dense />
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>{chat.type === 'ai_direct' ? 'AI私聊' : '用户单聊'}</Typography>
              <StatChipRow items={[chat.mode, `${members.length} 成员`]} />
            </SurfaceCard>
          ) : null}
          <LazyPanel>
            <ChatSidebarPanel
              chat={projectedDetailState?.sidebarChat.chat || { ...chat, primaryRecentEvent: projectedRuntimeState?.primaryRecentEvent }}
              members={members}
              thinkingId={thinkingId}
              rightPanelTab={activeSidebarTab}
              setRightPanelTab={setRightPanelTab}
              showMemberTab={showMemberTab}
              showRuntimeTab={showRuntimeTab}
              memberPanelTitle={memberTabTitle}
              runtimePanelTitle={runtimeTabTitle}
              privatePayloads={projectedDetailState?.sidebarChat.privatePayloads || privatePayloads}
              showActionTab={showActionTab}
              actionPanel={showActionTab ? <LazyPanel><SessionActionPanel title={projectedDetailState?.actionPanel.title || actionPanelTitle} actions={projectedDetailState?.actionPanel.actions || sessionActions} onRunAction={runSessionAction} /></LazyPanel> : null}
              onSpeakAs={(charId) => setSpeakAsCharacter(charId)}
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
            />
          </LazyPanel>
        </PageSection>
      </RightPanel>

      <Dialog open={analysisDialogOpen} onClose={() => setAnalysisDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>AI分析</DialogTitle>
        <DialogContent>
          {analysisTarget ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{analysisTarget.senderName || '消息'}：{analysisTarget.content}</Typography> : null}
          {analysisLoading ? (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          ) : analysisError ? (
            <Typography variant="body2" color="error">{analysisError}</Typography>
          ) : (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' }}>
              {analysisText}
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={closeSnackbar}>
        <Alert severity={snackbar.severity} onClose={closeSnackbar}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
