import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, IconButton } from '@mui/material';
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
import MessageList from '../components/chat/MessageList';
import ChatInput from '../components/chat/ChatInput';
import MemberList from '../components/controls/MemberList';
import RightPanel from '../components/layout/RightPanel';
import EmptyState from '../components/common/EmptyState';
import { runOneRound } from '../services/chatEngine';

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();

  const { chats, loadChats, updateChat } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const { messages, hydrateMessagesFromCache, loadMessages, addMessage, clearMessages, deleteMessage, hasMore, isLoadingOlder } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const loopTokenRef = useRef<string | null>(null);
  const api = useSettingsStore((s) => s.api);
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, setRightPanelOpen } = useUIStore();

  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
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

  useEffect(() => {
    if (!chat) return;
    setHeaderTitle(chat.name);
    setHeaderBackAction(() => () => navigate('/chats'));
    setHideMobileBottomNav(true);
    setHeaderActions(
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
              setThinkingId(null);
              setStreamingContent('');
              setCurrentSpeaker(null);
              recordSpeak(msg.senderId);
              updateChat(id, { lastMessageAt: Date.now() });
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

    // If no messages yet and there's a topic seed, add initial system message
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
    }

    // Start the loop
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
    updateChat(id!, { lastMessageAt: Date.now() });
    useSchedulerStore.getState().resetAllCooldowns();
  }, [id]);

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
        />

      </Box>

      {/* Right panel */}
      <RightPanel title={t('controls.memberList')}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <MemberList
            members={members}
            thinkingId={thinkingId}
            onSpeakAs={(charId) => setSpeakAsCharacter(charId)}
            onRemove={(charId) => {
              const newMembers = chat.memberIds.filter((m) => m !== charId);
              if (newMembers.length >= 2) {
                updateChat(chat.id, { memberIds: newMembers });
              }
            }}
          />
        </Box>
      </RightPanel>

    </Box>
  );
}
