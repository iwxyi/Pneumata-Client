import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, IconButton, Tabs, Tab, Button, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, TextField } from '@mui/material';
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
import { DEFAULT_CONVERSATION_WORLD_STATE, DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE, OPEN_CHAT_MODE_DRIVER } from '../types/chat';
import MessageList from '../components/chat/MessageList';
import ChatInput from '../components/chat/ChatInput';
import MemberList from '../components/controls/MemberList';
import RelationshipPanel from '../components/controls/RelationshipPanel';
import RightPanel from '../components/layout/RightPanel';
import EmptyState from '../components/common/EmptyState';
import { runOneRound } from '../services/chatEngine';
import { summarizeRelationshipShift, updateCharacterRelationship } from '../services/relationshipEngine';
import { derivePersonalityDrift } from '../services/personalityDrift';
import { accumulateChatRuntime } from '../services/chatRuntime';
import { accumulateCharacterRuntime } from '../services/characterRuntime';
import { buildRuntimeEvent } from '../services/runtimeEventFactory';
import { refineMemoryCandidate } from '../services/memoryEngine';

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();

  const { chats, loadChats, updateChat } = useChatStore();
  const { characters, loadCharacters, updateCharacter } = useCharacterStore();
  const { messages, hydrateMessagesFromCache, loadMessages, addMessage, clearMessages, deleteMessage, hasMore, isLoadingOlder } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const loopTokenRef = useRef<string | null>(null);
  const api = useSettingsStore((s) => s.api);
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, setRightPanelOpen, rightPanelTab, setRightPanelTab } = useUIStore();

  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [privateDialogOpen, setPrivateDialogOpen] = useState(false);
  const [privateStarterId, setPrivateStarterId] = useState<string>('');
  const [privateTargetId, setPrivateTargetId] = useState<string>('');
  const [privateCreating, setPrivateCreating] = useState(false);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(id ?? null);

  const chat = chats.find((c) => c.id === id);

  useEffect(() => {
    loadChats();
    loadCharacters();
  }, []);

  useEffect(() => {
    if (id) {
      hydrateMessagesFromCache(id);
      loadMessages(id, { limit: 16 });
      return () => {
        activeChatIdRef.current = null;
        loopTokenRef.current = null;
        setThinkingId(null);
        setStreamingContent('');
        clearMessages();
        stop();
      };
    }
  }, [clearMessages, hydrateMessagesFromCache, id, loadMessages, stop]);

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

  const members = characters.filter((c) => chat?.memberIds.includes(c.id));
  const runtimeContext = chat ? { conversation: chat, participants: OPEN_CHAT_MODE_DRIVER.buildParticipants(chat) } : null;
  const visiblePanels = runtimeContext ? OPEN_CHAT_MODE_DRIVER.getVisiblePanels(runtimeContext) : [];
  const availableActions = runtimeContext ? OPEN_CHAT_MODE_DRIVER.getAvailableActions(runtimeContext) : [];
  const memberPanel = visiblePanels.find((panel) => panel.tabKey === 'members');
  const runtimePanel = visiblePanels.find((panel) => panel.tabKey === 'world');
  const showMemberTab = Boolean(memberPanel);
  const showRuntimeTab = Boolean(runtimePanel);

  const appendEventMessage = useCallback(async (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown }) => {
    await addMessage({
      chatId,
      type: 'event',
      senderId: 'system',
      senderName: 'System',
      content: buildRuntimeEvent(payload),
      emotion: 0,
    });
  }, [addMessage]);

  useEffect(() => {
    if (!chat) return;
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
  }, [chat, isMobile, navigate, rightPanelOpen, setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav, setRightPanelOpen]);

  // Core conversation loop
  const runLoop = useCallback(async (loopId: string) => {
    if (!chat || !id) return;

    while (isRunningRef.current && !isPausedRef.current) {
      if (activeChatIdRef.current !== id || loopTokenRef.current !== loopId) {
        return;
      }

      try {
        const currentMessages = useMessageStore.getState().messages;

        await runOneRound(
          chat,
          characters,
          currentMessages,
          api,
          {
            onSpeakerSelected: (charId) => {
              if (activeChatIdRef.current !== id || loopTokenRef.current !== loopId) return;
              setThinkingId(charId);
              setCurrentSpeaker(charId);
            },
            onMessageChunk: (content) => {
              if (activeChatIdRef.current !== id || loopTokenRef.current !== loopId) return;
              setStreamingContent(content);
            },
            onMessageComplete: async (msg) => {
              if (activeChatIdRef.current !== id || loopTokenRef.current !== loopId) return;
              await addMessage(msg);
              const currentAiMessages = useMessageStore.getState().messages.filter((item) => item.type === 'ai' && !item.isDeleted);
              const previousAiMessage = currentAiMessages.length >= 2 ? currentAiMessages.at(-2) || null : null;
              const commitResult = OPEN_CHAT_MODE_DRIVER.onMessageCommitted({
                conversation: chat,
                characters,
                message: msg,
                previousAiMessage,
              });
              const candidate = msg.type === 'ai' ? commitResult.chatPatch.runtimeNotes?.at(-1) || commitResult.chatPatch.runtimeArtifacts?.at(-1) : null;
              if (candidate && api.apiKey && msg.type === 'ai') {
                const refined = await refineMemoryCandidate(api, chat, msg, {
                  kind: commitResult.chatPatch.runtimeArtifacts?.at(-1) === candidate ? 'artifact' : 'note',
                  text: candidate,
                  reason: 'driver post-processing candidate',
                });
                if (refined) {
                  commitResult.chatPatch = {
                    ...commitResult.chatPatch,
                    ...accumulateChatRuntime(chat, msg, refined),
                  };
                }
              }
              for (const patch of commitResult.characterPatches) {
                await updateCharacter(patch.characterId, patch.patch);
              }
              for (const eventPayload of commitResult.eventMessages) {
                await appendEventMessage(id, eventPayload);
              }
              setThinkingId(null);
              setStreamingContent('');
              setCurrentSpeaker(null);
              recordSpeak(msg.senderId);
              updateChat(id, { lastMessageAt: Date.now(), ...commitResult.chatPatch });
            },
            onError: (error) => {
              console.error('Chat engine error:', error);
              if (activeChatIdRef.current !== id || loopTokenRef.current !== loopId) return;
              setThinkingId(null);
              setStreamingContent('');
              setCurrentSpeaker(null);
            },
          }
        );

        if (activeChatIdRef.current !== id || loopTokenRef.current !== loopId) {
          return;
        }

        if (isRunningRef.current && !isPausedRef.current) {
          const waitTime = (3000 / (chat.speed || 1)) + Math.random() * 2000;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      } catch (err) {
        console.error('Loop error:', err);
        if (activeChatIdRef.current !== id || loopTokenRef.current !== loopId) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }, [chat, characters, api, id, addMessage, recordSpeak, setCurrentSpeaker, updateChat]);

  const handlePlay = useCallback(() => {
    if (!api.apiKey) {
      navigate('/settings');
      return;
    }
    resetAllCooldowns();
    const newLoopToken = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    loopTokenRef.current = newLoopToken;
    start(newLoopToken);
    updateChat(id!, { isActive: true });

    const currentMessages = useMessageStore.getState().messages;
    if (currentMessages.length === 0) {
      addMessage({
        chatId: id!,
        type: 'system',
        senderId: 'system',
        senderName: 'System',
        content: t('message.system.chatCreated'),
        emotion: 0,
      });
      pause();
      updateChat(id!, { isActive: false });
      return;
    }

    setTimeout(() => runLoop(newLoopToken), 100);
  }, [api.apiKey, id, resetAllCooldowns, runLoop, start, updateChat]);

  const handlePause = useCallback(() => {
    pause();
    updateChat(id!, { isActive: false });
    addMessage({
      chatId: id!,
      type: 'system',
      senderId: 'system',
      senderName: 'System',
      content: t('message.system.chatPaused'),
      emotion: 0,
    });
  }, [id]);

  const handleResume = useCallback(() => {
    const newLoopToken = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    loopTokenRef.current = newLoopToken;
    start(newLoopToken);
    resume();
    updateChat(id!, { isActive: true });
    addMessage({
      chatId: id!,
      type: 'system',
      senderId: 'system',
      senderName: 'System',
      content: t('message.system.chatResumed'),
      emotion: 0,
    });
    setTimeout(() => runLoop(newLoopToken), 100);
  }, [addMessage, id, resume, runLoop, start, t, updateChat]);

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
    updateChat(id!, { lastMessageAt: Date.now() });
    setSpeakAsCharacter(null);
  }, [id, speakAsCharacterId, characters]);

  const handleGuideSend = useCallback(async (content: string) => {
    await addMessage({
      chatId: id!,
      type: 'god',
      senderId: 'user',
      senderName: 'User',
      content,
      emotion: 0,
    });
    updateChat(id!, { lastMessageAt: Date.now(), topic: chat?.topic || content });
    useSchedulerStore.getState().resetAllCooldowns();

    if (chat?.type === 'ai_direct' && chat.sourceChatId && chat.sourceMemberIds?.length === 2) {
      const [starterId, targetId] = chat.sourceMemberIds;
      const starter = characters.find((item) => item.id === starterId);
      const target = characters.find((item) => item.id === targetId);
      if (starter && target) {
        const updatedStarter = updateCharacterRelationship(starter, targetId, content, 1.35);
        const updatedTarget = updateCharacterRelationship(target, starterId, content, 1.2);
        const starterDrift = derivePersonalityDrift(starter, content);
        const targetDrift = derivePersonalityDrift(target, content);
        await updateCharacter(starterId, {
          relationships: updatedStarter.relationships,
          personalityDrift: starterDrift,
          runtimeTimeline: accumulateCharacterRuntime(starter, { type: 'relationship', text: `与 ${target.name} 的AI私聊带来了关系变化` }).concat(
            Object.keys(starterDrift).length ? [{ type: 'drift', text: `与 ${target.name} 互动后产生性格漂移`, createdAt: Date.now() }] : []
          ).slice(-20),
        });
        await updateCharacter(targetId, {
          relationships: updatedTarget.relationships,
          personalityDrift: targetDrift,
          runtimeTimeline: accumulateCharacterRuntime(target, { type: 'relationship', text: `与 ${starter.name} 的AI私聊带来了关系变化` }).concat(
            Object.keys(targetDrift).length ? [{ type: 'drift', text: `与 ${starter.name} 互动后产生性格漂移`, createdAt: Date.now() }] : []
          ).slice(-20),
        });
        const starterRelation = updatedStarter.relationships.find((item) => item.characterId === targetId);
        const targetRelation = updatedTarget.relationships.find((item) => item.characterId === starterId);
        const summary = `${starter.name}→${target.name}${summarizeRelationshipShift(starterRelation)}，${target.name}→${starter.name}${summarizeRelationshipShift(targetRelation)}`;
        await appendEventMessage(chat.sourceChatId, {
          eventType: 'relationship_shift',
          title: `${starter.name} 与 ${target.name} 的AI私聊影响了关系`,
          summary,
          pair: [starter.name, target.name],
          metrics: {
            starterToTarget: starterRelation || null,
            targetToStarter: targetRelation || null,
          },
        });
        const sourceChat = chats.find((item) => item.id === chat.sourceChatId);
        if (sourceChat) {
          await updateChat(chat.sourceChatId, {
            lastMessageAt: Date.now(),
            worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, ...(sourceChat.worldState || {}), recentEvent: `${starter.name} 与 ${target.name} 的AI私聊：${summary}` },
            ...accumulateChatRuntime(sourceChat, { type: 'event', content: `${starter.name} 与 ${target.name} 的AI私聊：${summary}` }),
          });
        }
      }
    }

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
        type: 'ai_direct',
        mode: 'open_chat',
        modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
        modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
        name: `${initiator.name} × ${target.name}`,
        topic: `${initiator.name} 和 ${target.name} 的AI私聊`,
        style: 'free',
        memberIds: [privateStarterId, privateTargetId],
        speed: 1,
        isActive: false,
        allowIntervention: true,
        showRoleActions: true,
        topicSeed: '',
        sourceChatId: chat.id,
        sourceMemberIds: [privateStarterId, privateTargetId],
        governance: { ownerCharacterId: privateStarterId, adminCharacterIds: [], autoModeration: false, allowMute: false, allowPrivateThreads: false },
        dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
        worldState: { phase: 'warming', mood: 'private', focus: chat.topic || '', recentEvent: `派生自 ${chat.name}` },
        directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: false, allowForcedReply: true },
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

  const canAutoRun = chat?.mode === 'open_chat' && chat?.type === 'group';

  const detailTitle = memberPanel?.title || (chat?.type === 'group' ? t('controls.memberList') : chat?.type === 'ai_direct' ? 'AI私聊信息' : '单聊信息');

  const privateCandidates = members;

  if (!chat) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState icon="🔍" message="Chat not found" />
      </Box>
    );
  }

  const speakAsChar = speakAsCharacterId ? characters.find((c) => c.id === speakAsCharacterId) : null;

  return (
    <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Main chat area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', pb: { xs: 11, md: 11 } }}>
          <MessageList
            messages={messages}
            characters={characters}
            thinkingCharacterId={thinkingId}
            streamingContent={streamingContent}
            onDeleteMessage={deleteMessage}
            onReachTop={handleNearTop}
            isLoadingOlder={isLoadingOlder}
            hasMore={hasMore}
            loadingText={t('common.loading')}
            topHint={t('chat.empty')}
          />
        </Box>

        <ChatInput
          mode={speakAsChar ? 'speakAs' : 'guide'}
          characterName={speakAsChar?.name}
          onSend={speakAsChar ? handleSpeakAs : handleGuideSend}
          onClose={speakAsChar ? () => setSpeakAsCharacter(null) : undefined}
          placeholderOverride={availableActions.some((action) => action.type === 'director_intervention') ? undefined : '当前模式限制发送'}
        />

      </Box>

      {/* Right panel */}
      <RightPanel title={detailTitle}>
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
          {visiblePanels.length > 1 ? (
            <Tabs value={rightPanelTab} onChange={(_, value) => setRightPanelTab(value)}>
              {showMemberTab ? <Tab value="members" label={memberPanel?.title || (chat.type === 'group' ? '成员' : '角色')} /> : null}
              {showRuntimeTab ? <Tab value="world" label={runtimePanel?.title || '状态'} /> : null}
            </Tabs>
          ) : null}

          {rightPanelTab === 'members' && showMemberTab ? (
            <MemberList
              members={members}
              thinkingId={thinkingId}
              onSpeakAs={(charId) => setSpeakAsCharacter(charId)}
              onStartPrivateChat={chat.type === 'group' ? handleOpenPrivateChatDialog : undefined}
              onRemove={chat.type === 'group' ? (charId) => {
                const newMembers = chat.memberIds.filter((m) => m !== charId);
                if (newMembers.length >= 2) {
                  updateChat(chat.id, { memberIds: newMembers });
                }
              } : undefined}
            />
          ) : (
            <RelationshipPanel chat={chat} members={members} />
          )}

          {chat.type === 'group' ? (
            <Button variant="outlined" onClick={() => setRightPanelTab(rightPanelTab === 'members' ? 'world' : 'members')}>
              {rightPanelTab === 'members' ? '查看世界状态' : '查看成员'}
            </Button>
          ) : null}
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

    </Box>
  );
}
