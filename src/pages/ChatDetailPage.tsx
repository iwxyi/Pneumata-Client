import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, Typography, IconButton, AppBar, Toolbar, Chip, Button } from '@mui/material';
import {
  ArrowBack as BackIcon,
  People as PeopleIcon,
  Campaign as GodIcon,
  Forum as TopicIcon,
  MoreVert as MoreIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
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
import PlayPauseButton from '../components/controls/PlayPauseButton';
import SpeedSlider from '../components/controls/SpeedSlider';
import MemberList from '../components/controls/MemberList';
import TopicGuideDialog from '../components/controls/TopicGuideDialog';
import RightPanel from '../components/layout/RightPanel';
import EmptyState from '../components/common/EmptyState';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { runOneRound } from '../services/chatEngine';

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isMobile } = useResponsive();

  const { chats, loadChats, updateChat, deleteChat } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const { messages, loadMessages, addMessage, clearMessages, deleteLastNMessages } = useMessageStore();
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak } = useSchedulerStore();
  const api = useSettingsStore((s) => s.api);
  const { godModeActive, setGodModeActive, topicGuideOpen, setTopicGuideOpen,
    speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, setRightPanelOpen } = useUIStore();

  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);

  const chat = chats.find((c) => c.id === id);

  useEffect(() => {
    loadChats();
    loadCharacters();
  }, []);

  useEffect(() => {
    if (id) {
      loadMessages(id);
      return () => {
        clearMessages();
        stop();
      };
    }
  }, [id]);

  useEffect(() => {
    isRunningRef.current = isRunning;
    isPausedRef.current = isPaused;
  }, [isRunning, isPaused]);

  const members = characters.filter((c) => chat?.memberIds.includes(c.id));

  // Core conversation loop
  const runLoop = useCallback(async () => {
    if (!chat || !id) return;

    while (isRunningRef.current && !isPausedRef.current) {
      try {
        const currentMessages = useMessageStore.getState().messages;

        await runOneRound(
          chat,
          characters,
          currentMessages,
          api,
          {
            onSpeakerSelected: (charId) => {
              setThinkingId(charId);
              setCurrentSpeaker(charId);
            },
            onMessageChunk: (content) => {
              setStreamingContent(content);
            },
            onMessageComplete: async (msg) => {
              setThinkingId(null);
              setStreamingContent('');
              setCurrentSpeaker(null);
              await addMessage(msg);
              recordSpeak(msg.senderId);
              // Update chat lastMessageAt
              updateChat(id, { lastMessageAt: Date.now() });
            },
            onError: (error) => {
              console.error('Chat engine error:', error);
              setThinkingId(null);
              setStreamingContent('');
              setCurrentSpeaker(null);
            },
          }
        );

        // Wait between rounds based on speed
        if (isRunningRef.current && !isPausedRef.current) {
          const waitTime = (3000 / (chat.speed || 1)) + Math.random() * 2000;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      } catch (err) {
        console.error('Loop error:', err);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }, [chat, characters, api, id]);

  const handlePlay = useCallback(() => {
    if (!api.apiKey) {
      navigate('/settings');
      return;
    }
    start();
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
    setTimeout(() => runLoop(), 100);
  }, [api.apiKey, id, runLoop]);

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
    setTimeout(() => runLoop(), 100);
  }, [id, runLoop]);

  const handleGodSend = useCallback(async (content: string) => {
    await addMessage({
      chatId: id!,
      type: 'god',
      senderId: 'user',
      senderName: 'God',
      content,
      emotion: 0,
    });
    updateChat(id!, { lastMessageAt: Date.now() });
    // Reset all cooldowns so AIs respond quickly
    useSchedulerStore.getState().resetAllCooldowns();
  }, [id]);

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

  const handleTopicGuide = useCallback(async (topic: string) => {
    await addMessage({
      chatId: id!,
      type: 'system',
      senderId: 'system',
      senderName: 'System',
      content: t('message.system.topicChanged', { topic }),
      emotion: 0,
    });
    // Also add it as a god message so AIs see it in context
    await addMessage({
      chatId: id!,
      type: 'god',
      senderId: 'user',
      senderName: 'God',
      content: `Let's shift the discussion to: ${topic}`,
      emotion: 0,
    });
    useSchedulerStore.getState().resetAllCooldowns();
  }, [id, t]);

  const handleSpeedChange = useCallback((speed: number) => {
    if (chat) updateChat(chat.id, { speed });
  }, [chat]);

  const handleDelete = async () => {
    stop();
    await deleteChat(id!);
    navigate('/chats');
  };

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
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar variant="dense" sx={{ gap: 1 }}>
            <IconButton edge="start" onClick={() => navigate('/chats')}>
              <BackIcon />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={600} noWrap>{chat.name}</Typography>
              {chat.topic && (
                <Typography variant="caption" color="text.secondary" noWrap>{chat.topic}</Typography>
              )}
            </Box>
            <Chip
              label={isRunning && !isPaused ? t('chat.active') : t('chat.paused')}
              size="small"
              color={isRunning && !isPaused ? 'success' : 'default'}
              variant="outlined"
            />
            <IconButton onClick={() => setGodModeActive(!godModeActive)} color={godModeActive ? 'warning' : 'default'}>
              <GodIcon />
            </IconButton>
            <IconButton onClick={() => setTopicGuideOpen(true)}>
              <TopicIcon />
            </IconButton>
            {!isMobile && (
              <IconButton onClick={() => setRightPanelOpen(!rightPanelOpen)}>
                <PeopleIcon />
              </IconButton>
            )}
            <IconButton onClick={() => setDeleteConfirm(true)} color="error">
              <DeleteIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        {/* Messages */}
        <MessageList
          messages={messages}
          characters={characters}
          thinkingCharacterId={thinkingId}
        />

        {/* Input area */}
        {godModeActive && (
          <ChatInput
            mode="god"
            onSend={handleGodSend}
            onClose={() => setGodModeActive(false)}
          />
        )}
        {speakAsChar && (
          <ChatInput
            mode="speakAs"
            characterName={speakAsChar.name}
            onSend={handleSpeakAs}
            onClose={() => setSpeakAsCharacter(null)}
          />
        )}

        {/* Mobile: members button */}
        {isMobile && (
          <IconButton
            onClick={() => setRightPanelOpen(true)}
            sx={{
              position: 'fixed',
              bottom: 140,
              right: 24,
              bgcolor: 'background.paper',
              boxShadow: 2,
              zIndex: 1050,
            }}
          >
            <PeopleIcon />
          </IconButton>
        )}
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
          <SpeedSlider value={chat.speed} onChange={handleSpeedChange} />
        </Box>
      </RightPanel>

      {/* Play/Pause FAB */}
      <PlayPauseButton
        isRunning={isRunning}
        isPaused={isPaused}
        onPlay={handlePlay}
        onPause={handlePause}
        onResume={handleResume}
      />

      {/* Topic Guide Dialog */}
      <TopicGuideDialog
        open={topicGuideOpen}
        onClose={() => setTopicGuideOpen(false)}
        onSubmit={handleTopicGuide}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteConfirm}
        title={t('chat.delete')}
        message={t('chat.deleteConfirm')}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(false)}
        destructive
      />
    </Box>
  );
}
