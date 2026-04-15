import { useRef, useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';

const AUTO_SCROLL_THRESHOLD = 96;

interface MessageListProps {
  messages: Message[];
  characters: AICharacter[];
  thinkingCharacterId: string | null;
  streamingContent?: string;
  onDeleteMessage?: (id: string) => void;
  onReachTop?: () => void | Promise<void>;
  isLoadingOlder?: boolean;
  hasMore?: boolean;
  topHint?: string;
  loadingText?: string;
}

export default function MessageList({ messages, characters, thinkingCharacterId, streamingContent, onDeleteMessage, onReachTop, isLoadingOlder = false, hasMore = true, topHint, loadingText }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const previousScrollHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const [topTriggerTick, setTopTriggerTick] = useState(0);

  const characterMap = new Map(characters.map((c) => [c.id, c]));
  const visibleMessages = messages.filter((m) => !m.isDeleted);
  const thinkingChar = thinkingCharacterId ? characterMap.get(thinkingCharacterId) : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
      if (container.scrollTop <= 80 && onReachTop && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        previousScrollHeightRef.current = container.scrollHeight;
        setTopTriggerTick((tick) => tick + 1);
      }
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (thinkingCharacterId && !streamingContent) {
      shouldAutoScrollRef.current = true;
    }
  }, [thinkingCharacterId, streamingContent]);

  useEffect(() => {
    if (!onReachTop || topTriggerTick === 0) return;
    void Promise.resolve(onReachTop()).finally(() => {
      loadingOlderRef.current = false;
    });
  }, [onReachTop, topTriggerTick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (previousScrollHeightRef.current > 0) {
      const nextScrollHeight = container.scrollHeight;
      const delta = nextScrollHeight - previousScrollHeightRef.current;
      if (delta > 0) {
        container.scrollTop = container.scrollTop + delta;
      }
      previousScrollHeightRef.current = 0;
      return;
    }

    if (!shouldAutoScrollRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length, thinkingCharacterId, streamingContent]);

  useEffect(() => {
    if (!loadingOlderRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    if (container.scrollTop > 80) {
      loadingOlderRef.current = false;
    }
  }, [visibleMessages.length]);

  return (
    <Box
      ref={containerRef}
      sx={{
        flex: 1,
        overflow: 'auto',
        py: 2,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5f5f5' : '#121212',
      }}
    >
      <Box sx={{ px: 2, pb: 1, display: 'flex', justifyContent: 'center' }}>
        {isLoadingOlder ? (
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              bgcolor: 'background.paper',
              color: 'text.secondary',
              boxShadow: 1,
            }}
          >
            <CircularProgress size={16} thickness={5} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {loadingText}
            </Typography>
          </Box>
        ) : !hasMore && visibleMessages.length > 0 ? (
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              px: 1.5,
              py: 0.75,
              borderRadius: 999,
              bgcolor: 'action.hover',
              color: 'text.secondary',
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 500 }}>
              {topHint}
            </Typography>
          </Box>
        ) : null}
      </Box>

      {visibleMessages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          character={msg.type === 'ai' ? characterMap.get(msg.senderId) : undefined}
          onDelete={msg.type === 'system' ? undefined : onDeleteMessage}
        />
      ))}

      {thinkingChar && (
        <TypingIndicator
          characterName={thinkingChar.name}
          avatar={thinkingChar.avatar}
          bubbleStyleId={thinkingChar.bubbleStyleId}
          content={streamingContent}
        />
      )}

      <div ref={bottomRef} />
    </Box>
  );
}
