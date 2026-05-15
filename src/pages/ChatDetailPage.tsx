import { lazy, Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Box, IconButton, Button, Snackbar, Alert, Typography, Dialog, DialogTitle, DialogContent, CircularProgress, Chip, Stack } from '@mui/material';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';
import StatChipRow from '../components/common/StatChipRow';
import PeopleIcon from '@mui/icons-material/People';
import InfoIcon from '@mui/icons-material/Info';
import PlayIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
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
import { buildRuntimeEventMessageContent, normalizeRuntimeEvent } from '../services/runtimeEventFactory';
import { createCommittedLocalMessage, persistLocalFirstMessage, persistLocalFirstMessages } from '../services/chatCommitMessage';
import { buildPrivateSessionEvent } from '../services/directSessionHelpers';
import { resolveCharacterOrDeleted } from '../utils/deletedEntity';
import { deriveEmotionalState, derivePersonalityDrift } from '../services/personalityDrift';
import { updateCharacterLayeredMemories } from '../services/characterLayeredMemory';
import { accumulateCharacterRuntime } from '../services/characterRuntime';
import { resolveRuntimeEvolutionConfig } from '../services/runtimeEvolutionConfig';
import { getCharacterGroupLabel } from '../types/character';
import { generateResponse } from '../services/aiClient';
import { buildSystemPromptWithContext, buildChatMessages, buildDirectMemoryPanelContext } from '../services/promptBuilder';
import { getCharacterModelProfileId } from '../types/character';
import { getPreferredAIProfile } from '../types/settings';
import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';
import { shouldDiscardStreamingDraft } from '../services/streamingMessageLifecycle';

const ChatSidebarPanel = lazy(() => import('../components/chat/ChatSidebarPanel'));
const SessionActionPanel = lazy(() => import('../components/session/SessionActionPanel'));

type SessionProjectionData = Awaited<ReturnType<typeof import('../services/sessionEngineKernel')['resolveSessionProjectionData']>>;
type ProjectedChatDetailState = ReturnType<typeof import('../services/sessionProjection')['buildProjectedChatDetailState']>;
type AnalysisSection = { index: number; title: string; content: string };

function PanelFallback() {
  return null;
}

function LazyPanel({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PanelFallback />}>{children}</Suspense>;
}

function parseAnalysisSections(text: string): AnalysisSection[] {
  const sections: AnalysisSection[] = [];
  let current: AnalysisSection | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/^__(.+)__$/, '$1')
      .trim();
    const headingMatch = line.match(/^(\d{1,2})[.、]\s*(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      const heading = headingMatch[2].trim();
      const splitMatch = heading.match(/^(.+?)(?:[:：]\s*)(.+)$/);
      current = {
        index: Number(headingMatch[1]),
        title: splitMatch?.[1]?.trim() || heading,
        content: splitMatch?.[2]?.trim() || '',
      };
      continue;
    }
    if (current) {
      current.content = [current.content, rawLine].filter((item) => item.trim()).join('\n');
    }
  }
  if (current) sections.push(current);
  return sections;
}

function getAnalysisSectionTone(index: number) {
  if (index === 1) return { color: '#2563eb', bgcolor: 'rgba(37,99,235,0.10)' };
  if ([3, 4, 8].includes(index)) return { color: '#7c3aed', bgcolor: 'rgba(124,58,237,0.10)' };
  if ([5, 7].includes(index)) return { color: '#0f766e', bgcolor: 'rgba(15,118,110,0.10)' };
  if (index === 9) return { color: '#b45309', bgcolor: 'rgba(180,83,9,0.10)' };
  return { color: '#475569', bgcolor: 'rgba(71,85,105,0.10)' };
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <Box key={index} component="code" sx={{ px: 0.5, py: 0.1, borderRadius: 0.75, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: 'inherit' }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Box key={index} component="strong" sx={{ fontWeight: 800 }}>{part.slice(2, -2)}</Box>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <Box key={index} component="em" sx={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Box>;
    }
    return part;
  });
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: Array<{ ordered: boolean; text: string }> = [];

  const flushList = () => {
    if (!listItems.length) return;
    const ordered = listItems[0].ordered;
    const items = listItems;
    listItems = [];
    blocks.push(
      <Box key={`list-${blocks.length}`} component={ordered ? 'ol' : 'ul'} sx={{ m: 0, pl: 2.5, fontSize: 'inherit', '& li': { mb: 0.45, lineHeight: 1.75, fontSize: 'inherit' } }}>
        {items.map((item, index) => <li key={index}>{renderInlineMarkdown(item.text)}</li>)}
      </Box>
    );
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(
        <Box key={`heading-${blocks.length}`} sx={{ mt: blocks.length ? 1 : 0, mb: 0.5, fontWeight: 850, fontSize: 'inherit', lineHeight: 1.75 }}>
          {renderInlineMarkdown(heading[2])}
        </Box>
      );
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push({ ordered: false, text: bullet[1] });
      return;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      listItems.push({ ordered: true, text: ordered[1] });
      return;
    }
    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushList();
      blocks.push(
        <Box key={`quote-${blocks.length}`} sx={{ borderLeft: '3px solid', borderColor: 'divider', pl: 1, py: 0.25, fontStyle: 'italic', lineHeight: 1.75 }}>
          {renderInlineMarkdown(quote[1])}
        </Box>
      );
      return;
    }
    flushList();
    blocks.push(
      <Box key={`p-${blocks.length}`} sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.75, mb: 0.5, fontSize: 'inherit' }}>
        {renderInlineMarkdown(line)}
      </Box>
    );
  });
  flushList();

  return <>{blocks}</>;
}

function AnalysisResultView({ text }: { text: string }) {
  const sections = useMemo(() => parseAnalysisSections(text), [text]);
  if (!sections.length) {
    return (
      <Box sx={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
        <MarkdownText text={text} />
      </Box>
    );
  }

  const summary = sections.find((section) => section.index === 1) || sections[0];
  const followUps = sections.find((section) => section.index === 9);
  const bodySections = sections.filter((section) => section !== summary && section !== followUps);

  return (
    <Stack spacing={1.5} sx={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
      <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.78, mb: 0.5 }}>一句话总评</Typography>
        <Box sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7, fontWeight: 650 }}>
          <MarkdownText text={summary.content || summary.title} />
        </Box>
      </Box>

      <Box sx={{ columnCount: { xs: 1, sm: 2 }, columnGap: 1.25 }}>
        {bodySections.map((section) => {
          const tone = getAnalysisSectionTone(section.index);
          return (
            <Box key={section.index} sx={{ display: 'inline-block', width: '100%', mb: 1.25, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', minWidth: 0, breakInside: 'avoid' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                <Box sx={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: tone.bgcolor, color: tone.color, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                  {section.index}
                </Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, minWidth: 0 }}>{section.title}</Typography>
              </Box>
              <MarkdownText text={section.content || '无'} />
            </Box>
          );
        })}
      </Box>

      {followUps ? (
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: (theme) => theme.palette.mode === 'light' ? '#fff7ed' : 'rgba(180,83,9,0.16)', border: '1px solid', borderColor: (theme) => theme.palette.mode === 'light' ? '#fed7aa' : 'rgba(251,146,60,0.35)' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>{followUps.title}</Typography>
          <MarkdownText text={followUps.content} />
        </Box>
      ) : null}
    </Stack>
  );
}

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();

  const { chats, updateChat, applyChatRuntimeDelta, loadChats, markChatsWarm, isLoading: chatsLoading } = useChatStore();
  const { characters, updateCharacter, updateCharacters, loadCharacters, markCharactersWarm } = useCharacterStore();
  const { messages, openChatWindow, closeChatWindow, loadMessages, addMessage, upsertMessage, upsertMessages, deleteMessage, hasMore, isLoadingOlder } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const api = useSettingsStore((s) => s.api);
  const aiProfiles = useSettingsStore((s) => s.aiProfiles);
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, toggleRightPanel, rightPanelTab, setRightPanelTab } = useUIStore();
  const dramaBoost = useSettingsStore((s) => s.developerUI.dramaBoost);

  const [thinkingId, setThinkingId] = useState<string | null>(null);
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
  const streamingMessageRef = useRef<Message | null>(null);
  const streamingFlushFrameRef = useRef<number | null>(null);
  const pendingStreamingMessageRef = useRef<Message | null>(null);
  const lastAutoThreadCandidateIdRef = useRef<string | null>(null);
  const pendingCommitCountRef = useRef(0);
  const isCommitSettled = useCallback(() => pendingCommitCountRef.current === 0, []);

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
  const directMemoryPanelContext = useMemo(() => {
    if (!chat || chat.type !== 'direct' || !activeMembers[0]) return null;
    return buildDirectMemoryPanelContext(activeMembers[0], messages.filter((item) => item.chatId === chat.id), new Map(characters.map((item) => [item.id, item] as const)));
  }, [activeMembers, characters, chat, messages]);
  const sidebarTitle = projectedDetailState?.sidebarTitle || (activeSidebarTab === 'members' ? memberTabTitle : activeSidebarTab === 'actions' ? '动作' : runtimeTabTitle);
  const runtimePanelLoading = !projectionData && Boolean(chat);

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

  const updateStreamingMessage = useCallback((updater: (current: Message | null) => Message | null, options?: { immediate?: boolean }) => {
    const next = updater(streamingMessageRef.current);
    streamingMessageRef.current = next;
    if (!next) return;
    pendingStreamingMessageRef.current = next;
    if (options?.immediate) {
      if (streamingFlushFrameRef.current != null) {
        cancelAnimationFrame(streamingFlushFrameRef.current);
        streamingFlushFrameRef.current = null;
      }
      pendingStreamingMessageRef.current = null;
      upsertMessage(next);
      return;
    }
    if (streamingFlushFrameRef.current != null) return;
    streamingFlushFrameRef.current = requestAnimationFrame(() => {
      streamingFlushFrameRef.current = null;
      const pending = pendingStreamingMessageRef.current;
      pendingStreamingMessageRef.current = null;
      if (pending) upsertMessage(pending);
    });
  }, [upsertMessage]);

  const discardStreamingMessage = useCallback(() => {
    if (streamingFlushFrameRef.current != null) {
      cancelAnimationFrame(streamingFlushFrameRef.current);
      streamingFlushFrameRef.current = null;
    }
    pendingStreamingMessageRef.current = null;
    const current = streamingMessageRef.current;
    if (current) {
      const state = useMessageStore.getState();
      const persisted = state.messageWindowsByChatId[current.chatId]?.messages.find((message) => message.id === current.id)
        || state.messages.find((message) => message.id === current.id)
        || null;
      if (shouldDiscardStreamingDraft(current, persisted)) {
        upsertMessage({ ...current, isDeleted: true, isStreaming: false });
      }
    }
    streamingMessageRef.current = null;
  }, [upsertMessage]);

  const clearStreamingMessageRef = useCallback(() => {
    if (streamingFlushFrameRef.current != null) {
      cancelAnimationFrame(streamingFlushFrameRef.current);
      streamingFlushFrameRef.current = null;
    }
    pendingStreamingMessageRef.current = null;
    streamingMessageRef.current = null;
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
        discardStreamingMessage();
        setChatError(null);
        closeChatWindow(id, { clearActiveOnly: true });
        stop();
      };
    }
  }, [closeChatWindow, discardStreamingMessage, id, openChatWindow, stop]);

  useEffect(() => {
    isRunningRef.current = isRunning;
    isPausedRef.current = isPaused;
  }, [isPaused, isRunning]);

  useEffect(() => {
    activeChatIdRef.current = id ?? null;
    loopTokenRef.current = loopToken;
  }, [id, loopToken]);

  const appendEventMessage = useCallback(async (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[]; createdAt?: number; sourceMessageId?: string }) => {
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
        content: buildRuntimeEventMessageContent(eventPayload),
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
      addMessage: addMessageStable,
      appendEventMessage: appendEventMessageStable,
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
    await appendEventMessageStable(chat.id, buildActionRuntimeContract(chat, action.type, payload, action.actorId, {
      eventType: 'session_action_intent',
      title: action.type,
      summary,
      metrics: payload,
      visibilityScope: 'public',
    }));
  }, [appendEventMessage, chat, triggerPairPrivateThread, updateChat]);

  const shouldDirectCharacterFollowUp = useCallback(async (directCharacter: AICharacter, userContent: string) => {
    const textProfileId = getCharacterModelProfileId(directCharacter, 'text');
    const profile = aiProfiles.find((item) => item.id === textProfileId) || getPreferredAIProfile(aiProfiles, 'text') || api;
    if (!profile?.apiKey || !profile?.model || !chat) return null;

    const recentMessages = messages.filter((item) => item.chatId === chat.id && !item.isDeleted).slice(-8);
    const characterMap = new Map(characters.map((item) => [item.id, item] as const));
    const systemPrompt = `${buildSystemPromptWithContext(directCharacter, chat, 0, recentMessages, characterMap)}\n\n## Task\nDecide whether this character would naturally send one short follow-up message right after replying to the user's latest message. Return strict JSON only: {"shouldFollowUp":true|false,"content":"short follow-up if true"}. If there should be no follow-up, return shouldFollowUp false and empty content.`;
    const raw = await generateResponse(profile, systemPrompt, [{ role: 'user', content: `Latest user message: ${userContent}\nRecent conversation:\n${buildChatMessages(recentMessages, characterMap, 8).map((item) => item.content).join('\n')}` }]);
    const parsed = JSON.parse(raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')) as { shouldFollowUp?: boolean; content?: string };
    const contentText = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    return parsed.shouldFollowUp && contentText ? contentText : null;
  }, [aiProfiles, api, characters, chat, messages]);

  const handleGuideSend = useCallback(async (content: string) => {
    if (!chat || !id) return;
    await addMessageStable({ chatId: id, type: 'user', senderId: 'user', senderName: 'User', content, emotion: 0, timestamp: Date.now() });
    if (chat.type === 'direct') {
      const directCharacter = characters.find((item) => item.id === chat.memberIds[0]);
      if (directCharacter) {
        const evolution = resolveRuntimeEvolutionConfig(chat.runtimeEvolutionIntensity);
        const drift = derivePersonalityDrift(directCharacter, content, evolution.driftMultiplier * 0.5);
        const emotion = deriveEmotionalState(directCharacter, content, evolution.emotionMultiplier * 0.85, evolution.emotionDecayBias);
        await updateCharacter(directCharacter.id, {
          personalityDrift: drift,
          emotionalState: emotion,
          layeredMemories: updateCharacterLayeredMemories({
            character: { ...directCharacter, emotionalState: emotion },
            content,
            personalityDrift: drift,
            sourceEventTag: 'direct_user_message',
          }),
          runtimeTimeline: accumulateCharacterRuntime(directCharacter, {
            type: 'memory',
            text: `${getCharacterGroupLabel(directCharacter.group) || '单聊'}中与用户互动：${content.slice(0, 48)}`,
          }).concat(
            Object.keys(drift).length ? [{ type: 'drift' as const, text: '与用户互动后产生性格漂移', createdAt: Date.now() }] : []
          ).slice(-24),
        });
        const followUp = await shouldDirectCharacterFollowUp(directCharacter, content);
        if (followUp) {
          await addMessageStable({ chatId: id, type: 'ai', senderId: directCharacter.id, senderName: directCharacter.name, content: followUp, emotion: 0, timestamp: Date.now() });
          const followUpDrift = derivePersonalityDrift(directCharacter, followUp, evolution.driftMultiplier * 0.35);
          const followUpEmotion = deriveEmotionalState(directCharacter, followUp, evolution.emotionMultiplier * 0.6, evolution.emotionDecayBias);
          await updateCharacter(directCharacter.id, {
            personalityDrift: followUpDrift,
            emotionalState: followUpEmotion,
            layeredMemories: updateCharacterLayeredMemories({
              character: { ...directCharacter, emotionalState: followUpEmotion },
              content: followUp,
              personalityDrift: followUpDrift,
              sourceEventTag: 'direct_ai_follow_up',
            }),
            runtimeTimeline: accumulateCharacterRuntime(directCharacter, {
              type: 'memory',
              text: `单聊续发：${followUp.slice(0, 48)}`,
            }).concat(
              Object.keys(followUpDrift).length ? [{ type: 'drift' as const, text: '续发后产生性格漂移', createdAt: Date.now() }] : []
            ).slice(-24),
          });
        }
      }
      return;
    }
    if (chat.type === 'ai_direct') {
      const { applyAiDirectFeedback } = await import('../services/directSessionRuntime');
      await applyAiDirectFeedback({ chat, chats, characters, content, updateCharacter, updateChat, appendEventMessage });
    }
  }, [addMessage, appendEventMessage, characters, chat, chats, id, updateCharacter, updateChat]);

  const handleSpeakAs = useCallback(async (content: string) => {
    if (!chat || !id || !speakAsCharacterId) return;
    const char = characters.find((c) => c.id === speakAsCharacterId);
    if (!char) return;
    await addMessageStable({ chatId: id, type: 'ai', senderId: char.id, senderName: char.name, content, emotion: 0, timestamp: Date.now() });
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
      await appendEventMessageStable(chat.id, buildRuntimeEventContract(chat, intent, {
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
      addMessage: addMessageStable,
      appendEventMessage: appendEventMessageStable,
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
      getStreamingMessage: () => streamingMessageRef.current,
      getCurrentChat: () => useChatStore.getState().chats.find((item) => item.id === id),
      getCurrentCharacters: () => useCharacterStore.getState().characters,
      isRunning: () => isRunningRef.current,
      isPaused: () => isPausedRef.current,
      isActiveLoop: (currentLoopId) => activeChatIdRef.current === id && loopTokenRef.current === currentLoopId,
      onCommitSettled: isCommitSettled,
      onCommitStarted: () => {
        pendingCommitCountRef.current += 1;
      },
      onCommitFinished: () => {
        pendingCommitCountRef.current = Math.max(0, pendingCommitCountRef.current - 1);
      },
      onSpeakerSelected: (charId) => {
        const speaker = activeMembers.find((member) => member.id === charId);
        const streamingMessage = createCommittedLocalMessage({
          chatId: id,
          type: 'ai',
          senderId: charId,
          senderName: speaker?.name || '',
          content: '',
          emotion: 0,
        });
        const nextStreamingMessage = { ...streamingMessage, isStreaming: true };
        streamingMessageRef.current = nextStreamingMessage;
        upsertMessage(nextStreamingMessage);
        setRunLoopError(null);
        setThinkingId(charId);
        setCurrentSpeaker(charId);
      },
      onMessageChunk: (content) => {
        updateStreamingMessage((current) => current ? { ...current, content, isStreaming: true } : current);
        setChatError(null);
      },
      onIdle: (reason) => {
        discardStreamingMessage();
        setThinkingId(null);
        setCurrentSpeaker(null);
        setRunLoopError(reason);
      },
      onClearStreamingState: () => {
        clearStreamingMessageRef();
        setThinkingId(null);
        setCurrentSpeaker(null);
      },
      onEngineError: (error) => {
        discardStreamingMessage();
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
      onCommit: async (args) => {
        return await (sessionEngine.onMessageCommitted as (args: {
          conversation: GroupChat;
          characters: AICharacter[];
          message: Pick<Message, 'content' | 'type' | 'senderId'>;
          previousAiMessage: Pick<Message, 'senderId'> | null;
          recentMessages?: Message[];
          apiConfig?: import('../types/settings').APIConfig;
        }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>)(args);
      },
      upsertMessage: upsertMessageStable,
      updateCharacter,
      updateCharacters: async (patches) => updateCharacters(patches.map((patch) => ({ id: patch.id, updates: patch.patch }))),
      appendEventMessage: appendEventMessageStable,
      appendEventMessages: appendEventMessagesStable,
      updateChat,
      applyChatRuntimeDelta,
      recordSpeak,
      getCooldownMap: () => useSchedulerStore.getState().lastSpeakTimestamps,
    });
  }, [activeMembers, api, appendEventMessage, appendEventMessages, applyChatRuntimeDelta, chat, clearStreamingMessageRef, discardStreamingMessage, id, recordSpeak, setCurrentSpeaker, showErrorToast, t, updateCharacter, updateCharacters, updateChat, updateStreamingMessage, upsertMessage]);

  const fromTab = useMemo(() => new URLSearchParams(window.location.search).get('fromTab'), []);

  const handleHeaderBack = useCallback(() => {
    navigate(fromTab ? `/chats?tab=${fromTab}` : '/chats');
  }, [fromTab, navigate]);

  const canAutoRunConversation = chat?.type !== 'direct';

  const handleHeaderPrimaryAction = useCallback(() => {
    if (!id || !canAutoRunConversation) return;
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
  }, [canAutoRunConversation, id, isPaused, isRunning, pause, resetAllCooldowns, resume, runLoop, start, updateChat]);

  const headerPrimaryActionButton = canAutoRunConversation ? (
    <IconButton onClick={handleHeaderPrimaryAction} color={isRunning && !isPaused ? 'primary' : 'default'}>
      {isRunning && !isPaused ? <PauseIcon /> : <PlayIcon />}
    </IconButton>
  ) : null;

  useEffect(() => {
    if (!chat) return;
    setHeaderTitle(chat.name);
    setHeaderBackAction(() => handleHeaderBack);
    setHideMobileBottomNav(true);
    setHeaderActions(
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {headerPrimaryActionButton}
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
            onDeleteMessage={deleteMessage}
            onAnalyzeMessage={handleAnalyzeMessage}
            onReachTop={handleNearTop}
            isLoadingOlder={isLoadingOlder}
            hasMore={hasMore}
            loadingText={t('common.loading')}
            topHint="没有更早的消息"
          />
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
              <StatChipRow items={[chat.mode, `${members.length} 成员`, chat.type === 'direct' ? '回应式' : '可运行']} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {chat.type === 'direct'
                  ? '用户单聊默认不持续运行，角色会基于自身记忆、关系与最近变化进行回应。'
                  : 'AI私聊是两个AI之间的线程，可持续运行并沉淀关系与记忆。'}
              </Typography>
            </SurfaceCard>
          ) : null}
          <LazyPanel>
            {runtimePanelLoading ? <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">加载中…</Typography></Box> : <ChatSidebarPanel
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
              directMemoryContext={directMemoryPanelContext}
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
            />}
          </LazyPanel>
        </PageSection>
      </RightPanel>

      <Dialog open={analysisDialogOpen} onClose={() => setAnalysisDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography component="span" variant="h6" sx={{ fontWeight: 800 }}>AI分析</Typography>
            {analysisTarget ? <Chip size="small" label={analysisTarget.senderName || '消息'} /> : null}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ maxHeight: '72vh', overflowY: 'auto', pb: 3 }}>
          {analysisTarget ? (
            <Box sx={{ mb: 1.75, p: 1.25, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>目标消息</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.65 }}>
                {analysisTarget.content}
              </Typography>
            </Box>
          ) : null}
          {analysisLoading ? (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          ) : analysisError ? (
            <Typography variant="body2" color="error">{analysisError}</Typography>
          ) : (
            <AnalysisResultView text={analysisText} />
          )}
        </DialogContent>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={closeSnackbar}>
        <Alert severity={snackbar.severity} onClose={closeSnackbar}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
