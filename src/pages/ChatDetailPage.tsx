import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, IconButton, Tabs, Tab, Button, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, TextField, Stack, Snackbar, Alert } from '@mui/material';
import {
  People as PeopleIcon,
  Info as InfoIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useSchedulerStore } from '../stores/useSchedulerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUIStore } from '../stores/useUIStore';
import { useResponsive } from '../hooks/useResponsive';
import { DEFAULT_CONVERSATION_WORLD_STATE, DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE, type DriverMessageCommitResult, type GroupChat } from '../types/chat';
import { resolveRuntimeEvolutionConfig } from '../services/runtimeEvolutionConfig';
import { applyAiDirectFeedback, buildAiPrivateChatDraft } from '../services/directSessionRuntime';
import { getSessionEngine } from '../services/sessionEngineRegistry';
import { createSessionRuntimeContext, resolveSessionProjectionData, resolveSessionView } from '../services/sessionEngineKernel';
import MessageList from '../components/chat/MessageList';
import ChatInput from '../components/chat/ChatInput';
import MemberList from '../components/controls/MemberList';
import RelationshipPanel from '../components/controls/RelationshipPanel';
import RightPanel from '../components/layout/RightPanel';
import EmptyState from '../components/common/EmptyState';
import ChatSidebarPanel from '../components/chat/ChatSidebarPanel';
import { runChatLoop } from '../services/chatLoopRunner';
import { summarizeRelationshipShift, updateCharacterRelationship } from '../services/relationshipEngine';
import { deriveEmotionalState, derivePersonalityDrift } from '../services/personalityDrift';
import { updateCharacterLayeredMemories } from '../services/characterLayeredMemory';
import { accumulateCharacterRuntime } from '../services/characterRuntime';
import { buildRuntimeEvent } from '../services/runtimeEventFactory';
import { buildPrivateSessionEvent } from '../services/directSessionHelpers';
import { accumulateChatRuntime } from '../services/chatRuntime';
import { commitGeneratedMessage } from '../services/chatRoundExecution';
import { buildDeletedCharacter, resolveCharacterOrDeleted } from '../utils/deletedEntity';
import type { LiveChatMessage } from '../components/chat/chatRenderModel';
import type { AICharacter } from '../types/character';
import type { Message } from '../types/message';

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isMobile, isDesktop } = useResponsive();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();

  const { chats, loadChats, updateChat } = useChatStore();
  const { characters, loadCharacters, updateCharacter } = useCharacterStore();
  const { messages, hydrateMessagesFromCache, loadMessages, addMessage, upsertMessage, clearMessages, deleteMessage, hasMore, isLoadingOlder } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const loopTokenRef = useRef<string | null>(null);
  const api = useSettingsStore((s) => s.api);
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, setRightPanelOpen, rightPanelTab, setRightPanelTab } = useUIStore();
  const dramaBoost = useSettingsStore((s) => s.developerUI.dramaBoost);

  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<LiveChatMessage | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [runLoopError, setRunLoopError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'error' | 'success' }>({ open: false, message: '', severity: 'error' });

  const showErrorToast = useCallback((message: string) => {
    setSnackbar({ open: true, message, severity: 'error' });
  }, []);

  const closeSnackbar = useCallback(() => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  }, []);
  const [privateDialogOpen, setPrivateDialogOpen] = useState(false);
  const [privateStarterId, setPrivateStarterId] = useState<string>('');
  const [privateTargetId, setPrivateTargetId] = useState<string>('');
  const [privateCreating, setPrivateCreating] = useState(false);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(id ?? null);
  const liveMessageRef = useRef<LiveChatMessage | null>(null);
  const liveMessageSeedRef = useRef<Omit<LiveChatMessage, 'content'> | null>(null);
  const chat = chats.find((c) => c.id === id);

  useEffect(() => {
    (globalThis as { __MIRAGETEA_DRAMA_BOOST__?: boolean }).__MIRAGETEA_DRAMA_BOOST__ = dramaBoost;
    return () => {
      delete (globalThis as { __MIRAGETEA_DRAMA_BOOST__?: boolean }).__MIRAGETEA_DRAMA_BOOST__;
    };
  }, [dramaBoost]);

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
    loadChats();
    loadCharacters();
  }, []);

  useEffect(() => {
    if (id) {
      hydrateMessagesFromCache(id);
      loadMessages(id, { limit: 20 });
      return () => {
        activeChatIdRef.current = null;
        loopTokenRef.current = null;
        setThinkingId(null);
        clearLiveMessage();
        setChatError(null);
        clearMessages();
        stop();
      };
    }
  }, [clearLiveMessage, clearMessages, hydrateMessagesFromCache, id, loadMessages, stop]);

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

  useEffect(() => {
    isRunningRef.current = isRunning;
    isPausedRef.current = isPaused;
  }, [isRunning, isPaused]);

  useEffect(() => {
    activeChatIdRef.current = id ?? null;
    loopTokenRef.current = loopToken;
  }, [id, loopToken]);

  const members = chat ? chat.memberIds.map((memberId) => resolveCharacterOrDeleted(characters, memberId)) : [];
  const activeMembers = chat ? characters.filter((c) => chat.memberIds.includes(c.id)) : [];
  const sessionEngine = chat ? getSessionEngine(chat.mode) : null;
  const runtimeContext = chat && sessionEngine ? createSessionRuntimeContext(sessionEngine, chat) : null;
  const projectionData = runtimeContext && sessionEngine ? resolveSessionProjectionData(sessionEngine, runtimeContext) : { view: { visiblePanels: [], availableActions: [] }, actionSchema: null, runtimeState: null, privatePayloads: [] };
  const projectedRuntimeState = projectionData.runtimeState;
  const privatePayloads = projectionData.privatePayloads;
  const visiblePanels = projectionData.view.visiblePanels;
  const memberPanel = visiblePanels.find((panel) => panel.tabKey === 'members');
  const runtimePanel = visiblePanels.find((panel) => panel.tabKey === 'world');
  const showMemberTab = Boolean(memberPanel);
  const showRuntimeTab = Boolean(runtimePanel);
  const hasSidebarTabs = showMemberTab && showRuntimeTab;
  const activeSidebarTab = hasSidebarTabs ? rightPanelTab : showMemberTab ? 'members' : 'world';
  const sidebarTitle = activeSidebarTab === 'members'
    ? (memberPanel?.title || (chat?.type === 'group' ? t('controls.memberList') : chat?.type === 'ai_direct' ? 'AI私聊信息' : '单聊信息'))
    : (runtimePanel?.title || '状态');
  const canSendInput = true;
  void canSendInput;

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

  useEffect(() => {
    if (!id) return;
    if (!chat) {
      navigate('/chats', { replace: true });
      return;
    }
    const fromTab = new URLSearchParams(window.location.search).get('fromTab');
    setHeaderTitle(chat.name);
    setHeaderBackAction(() => () => navigate(fromTab ? `/chats?tab=${fromTab}` : '/chats'));
    setHideMobileBottomNav(true);
    setHeaderActions(
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {canAutoRun ? (
          <IconButton
            onClick={() => {
              if (!isRunning) {
                handlePlay();
              } else if (isPaused) {
                handleResume();
              } else {
                handlePause();
              }
            }}
            color={isRunning && !isPaused ? 'primary' : 'default'}
          >
            {isRunning && !isPaused ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
        ) : null}
        {isMobile ? (
          <IconButton onClick={() => setRightPanelOpen(true)}>
            <PeopleIcon />
          </IconButton>
        ) : null}
        {!isMobile ? (
          <IconButton onClick={() => setRightPanelOpen(!rightPanelOpen)}>
            <PeopleIcon />
          </IconButton>
        ) : null}
        <IconButton onClick={() => navigate(`/chats/${chat.id}/edit`)}>
          <InfoIcon />
        </IconButton>
      </Box>
    );

    return () => {
      setHeaderTitle(null);
      setHeaderActions(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
    };
  }, [chat, id, isMobile, navigate, rightPanelOpen, setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav, setRightPanelOpen]);

  useEffect(() => {
    if (id && chats.length > 0 && !chat) {
      navigate('/chats', { replace: true });
    }
  }, [chat, chats.length, id, navigate]);

  // Core conversation loop
  const runLoop = useCallback(async (loopId: string) => {
    if (!chat || !id) return;

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
        const seed = {
          key: `live-${loopId}-${charId}`,
          chatId: id,
          senderId: charId,
          senderName: speaker?.name || '',
          startedAt: Date.now(),
        };
        liveMessageSeedRef.current = seed;
        setRunLoopError(null);
        setThinkingId(charId);
        updateLiveMessage(() => ({ ...seed, content: '' }));
        setCurrentSpeaker(charId);
      },
      onMessageChunk: (content) => {
        updateLiveMessage((current) => {
          if (current) {
            return { ...current, content };
          }
          const seed = liveMessageSeedRef.current;
          return seed ? { ...seed, content } : current;
        });
        setChatError(null);
      },
      onClearStreamingState: () => {
        clearLiveMessage();
        setThinkingId(null);
        setCurrentSpeaker(null);
      },
      onEngineError: (error) => {
        console.error('Chat engine error:', error);
        clearLiveMessage();
        setThinkingId(null);
        setCurrentSpeaker(null);
        const message = error.message || t('common.error');
        setChatError(message);
        setRunLoopError(message);
        showErrorToast(message);
      },
      onLoopError: (error) => {
        console.error('Loop error:', error);
        const message = error instanceof Error ? error.message : String(error);
        const safeMessage = message || t('common.error');
        setRunLoopError(safeMessage);
        showErrorToast(safeMessage);
      },
      onCommit: (sessionEngine || getSessionEngine(chat.mode)).onMessageCommitted as (args: {
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
  }, [activeMembers, api, chat, clearLiveMessage, id, recordSpeak, setCurrentSpeaker, t, updateChat, updateLiveMessage, upsertMessage]);


  const handlePlay = useCallback(() => {
    if (!api.apiKey) {
      navigate('/settings');
      return;
    }
    setRunLoopError(null);
    resetAllCooldowns();
    const newLoopToken = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    loopTokenRef.current = newLoopToken;
    start(newLoopToken);
    updateChat(id!, { isActive: true });

    setTimeout(() => runLoop(newLoopToken), 100);
  }, [api.apiKey, id, navigate, resetAllCooldowns, runLoop, start, updateChat]);
  const handlePause = useCallback(() => {
    pause();
    updateChat(id!, { isActive: false });
  }, [id, pause, updateChat]);

  const handleResume = useCallback(() => {
    setRunLoopError(null);
    const newLoopToken = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    loopTokenRef.current = newLoopToken;
    start(newLoopToken);
    resume();
    updateChat(id!, { isActive: true });
    setTimeout(() => runLoop(newLoopToken), 100);
  }, [id, resume, runLoop, start, updateChat]);
  const handleSpeakAs = useCallback(async (content: string) => {
    if (!speakAsCharacterId) return;
    const char = characters.find((c) => c.id === speakAsCharacterId);
    if (!char) return;

    await addMessage({
      chatId: id!,
      type: 'ai',
      senderId: char.id,
      senderName: char.name,
      content,
      emotion: 0,
    });
    await updateCharacter(char.id, {
      layeredMemories: updateCharacterLayeredMemories({
        character: char,
        content,
        personalityDrift: {},
      }),
      runtimeTimeline: accumulateCharacterRuntime(char, { type: 'memory', text: `以角色身份发言：${content.slice(0, 48)}` }),
    });
    updateChat(id!, { lastMessageAt: Date.now() });
    setSpeakAsCharacter(null);
  }, [id, speakAsCharacterId, characters, updateCharacter]);

  const handleGuideSend = useCallback(async (content: string) => {
    await addMessage({
      chatId: id!,
      type: 'god',
      senderId: 'user',
      senderName: 'User',
      content,
      emotion: 0,
    });
    if (chat?.type === 'group') {
      await Promise.all(members.map((member) => updateCharacter(member.id, {
        layeredMemories: updateCharacterLayeredMemories({
          character: member,
          content,
          personalityDrift: {},
        }),
      })));
    }
    updateChat(id!, { lastMessageAt: Date.now(), topic: chat?.topic || content });
    useSchedulerStore.getState().resetAllCooldowns();

    await applyAiDirectFeedback({
      chat: chat!,
      chats,
      characters,
      content,
      updateCharacter,
      updateChat,
      appendEventMessage,
    });

    const currentMessages = useMessageStore.getState().messages;
    if (chat?.type === 'group' && !isRunningRef.current && currentMessages.length <= 1 && api.apiKey) {
      const newLoopToken = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      loopTokenRef.current = newLoopToken;
      start(newLoopToken);
      updateChat(id!, { isActive: true });
      setTimeout(() => runLoop(newLoopToken), 100);
    }
  }, [api.apiKey, chat, chats, characters, id, runLoop, start, updateCharacter, updateChat]);

  const handleOpenPrivateChatDialog = useCallback((starterId?: string) => {
    if (!chat || chat.type !== 'group') return;
    const defaultStarter = starterId || chat.memberIds[0] || '';
    const defaultTarget = chat.memberIds.find((memberId) => memberId !== defaultStarter) || '';
    setPrivateStarterId(defaultStarter);
    setPrivateTargetId(defaultTarget);
    setPrivateDialogOpen(true);
  }, [chat]);

  const handleCreatePrivateChat = useCallback(async () => {
    if (!chat || chat.type !== 'group' || !privateStarterId || !privateTargetId || privateStarterId === privateTargetId) return;

    const initiator = characters.find((item) => item.id === privateStarterId);
    const target = characters.find((item) => item.id === privateTargetId);
    if (!initiator || !target) return;

    const existing = chats.find((item) => item.type === 'ai_direct' && item.sourceChatId === chat.id && item.memberIds.includes(privateStarterId) && item.memberIds.includes(privateTargetId));
    if (existing) {
      setPrivateDialogOpen(false);
      navigate(`/chats/${existing.id}`);
      return;
    }

    setPrivateCreating(true);
    try {
      const privateChat = await useChatStore.getState().addChat({
        modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
        modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
        ...buildAiPrivateChatDraft(chat, initiator, target),
      });

      await addMessage({
        chatId: privateChat.id,
        type: 'system',
        senderId: 'system',
        senderName: 'System',
        content: `${initiator.name} 和 ${target.name} 从群聊 ${chat.name} 派生出一个AI私聊。`,
        emotion: 0,
      });

      await appendEventMessage(chat.id, {
        eventType: 'private_chat_started',
        title: `${initiator.name} 与 ${target.name} 开启了AI私聊`,
        summary: '群聊将跟踪这段私下互动带来的关系变化。',
        pair: [initiator.name, target.name],
      });

      setPrivateDialogOpen(false);
      navigate(`/chats/${privateChat.id}`);
    } finally {
      setPrivateCreating(false);
    }
  }, [addMessage, characters, chat, chats, navigate, privateStarterId, privateTargetId]);

  const canAutoRun = Boolean(chat?.mode === 'open_chat' && (chat?.type === 'group' || chat?.type === 'direct' || chat?.type === 'ai_direct') && activeMembers.length > 0);

  const privateCandidates = members;

  if (!chat) {
    return null;
  }

  const speakAsChar = speakAsCharacterId ? characters.find((c) => c.id === speakAsCharacterId) : null;
  const compactCharacterMemorySummary = speakAsChar?.layeredMemories?.slice(-2).map((item) => item.text).join(' / ');

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
      {/* Main chat area */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          height: '100%',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'minmax(0, 1fr) auto auto',
        }}
      >
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <MessageList
            key={id}
            messages={messages}
            characters={characters}
            liveMessage={liveMessage}
            onDeleteMessage={deleteMessage}
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
        <ChatInput
          mode={speakAsChar ? 'speakAs' : 'guide'}
          characterName={speakAsChar?.name}
          onSend={speakAsChar ? handleSpeakAs : handleGuideSend}
          onClose={speakAsChar ? () => setSpeakAsCharacter(null) : undefined}
        />

      </Box>

      {/* Right panel */}
      <RightPanel title={sidebarTitle}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {chat.type === 'ai_direct' && chat.sourceChatId ? (
            <Button variant="outlined" onClick={() => navigate(`/chats/${chat.sourceChatId}`)}>
              返回来源群聊
            </Button>
          ) : null}
          {chat.type === 'direct' ? (
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ fontSize: 12, color: 'text.secondary' }}>当前会话类型</Box>
              <Box sx={{ fontSize: 14, fontWeight: 700 }}>用户单聊</Box>
            </Box>
          ) : null}
          {chat.type === 'ai_direct' ? (
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ fontSize: 12, color: 'text.secondary' }}>当前会话类型</Box>
              <Box sx={{ fontSize: 14, fontWeight: 700 }}>AI私聊</Box>
            </Box>
          ) : null}
          <ChatSidebarPanel
            chat={{ ...chat, worldState: projectedRuntimeState?.worldState || chat.worldState, runtimeTimeline: projectedRuntimeState?.runtimeTimeline || chat.runtimeTimeline, runtimeSeed: projectedRuntimeState?.runtimeSeed || chat.runtimeSeed, runtimeEventsV2: projectedRuntimeState?.runtimeEventsV2 || chat.runtimeEventsV2, relationshipLedger: projectedRuntimeState?.relationshipLedger || chat.relationshipLedger, primaryRecentEvent: projectedRuntimeState?.primaryRecentEvent }}
            members={members}
            thinkingId={thinkingId}
            rightPanelTab={activeSidebarTab}
            setRightPanelTab={setRightPanelTab}
            showMemberTab={showMemberTab}
            showRuntimeTab={showRuntimeTab}
            memberPanelTitle={memberPanel?.title || (chat.type === 'group' ? '成员' : '角色')}
            runtimePanelTitle={runtimePanel?.title || '状态'}
            privatePayloads={privatePayloads}
            onSpeakAs={(charId) => setSpeakAsCharacter(charId)}
            onStartPrivateChat={chat.type === 'group' ? handleOpenPrivateChatDialog : undefined}
            onRemoveMember={chat.type === 'group' ? (charId) => {
              const newMembers = chat.memberIds.filter((m) => m !== charId);
              if (newMembers.length >= 2) {
                updateChat(chat.id, { memberIds: newMembers });
              }
            } : undefined}
          />

        </Box>
      </RightPanel>

      <Dialog open={privateDialogOpen} onClose={() => setPrivateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>发起AI私聊</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField
              select
              label="发起者"
              value={privateStarterId}
              onChange={(e) => setPrivateStarterId(e.target.value)}
              fullWidth
            >
              {privateCandidates.map((member) => (
                <MenuItem key={member.id} value={member.id}>{member.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="对象"
              value={privateTargetId}
              onChange={(e) => setPrivateTargetId(e.target.value)}
              fullWidth
            >
              {privateCandidates.filter((member) => member.id !== privateStarterId).map((member) => (
                <MenuItem key={member.id} value={member.id}>{member.name}</MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrivateDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleCreatePrivateChat} disabled={!privateStarterId || !privateTargetId || privateStarterId === privateTargetId || privateCreating}>创建</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={closeSnackbar}>
        <Alert severity={snackbar.severity} onClose={closeSnackbar}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
