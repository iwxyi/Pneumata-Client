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

function getDistanceFromBottom(container: HTMLDivElement) {
  return container.scrollHeight - container.scrollTop - container.clientHeight;
}

export default function MessageList({ messages, characters, thinkingCharacterId, streamingContent, onDeleteMessage, onReachTop, isLoadingOlder = false, hasMore = true, topHint, loadingText }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const prependAnchorScrollHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const topHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [topTriggerTick, setTopTriggerTick] = useState(0);
  const [showTopHint, setShowTopHint] = useState(false);

  const clearTopHintTimer = () => {
    if (topHintTimerRef.current) {
      clearTimeout(topHintTimerRef.current);
      topHintTimerRef.current = null;
    }
  };

  const revealTopHintTemporarily = () => {
    setShowTopHint(true);
    clearTopHintTimer();
    topHintTimerRef.current = setTimeout(() => {
      setShowTopHint(false);
      topHintTimerRef.current = null;
    }, 2600);
  };

  const hideTopHint = () => {
    clearTopHintTimer();
    setShowTopHint(false);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  };

  const characterMap = new Map(characters.map((c) => [c.id, c]));
  const visibleMessages = messages.filter((m) => !m.isDeleted);
  const thinkingChar = thinkingCharacterId ? characterMap.get(thinkingCharacterId) : null;
  const isTopHintVisible = !isLoadingOlder && !hasMore && visibleMessages.length > 0 && showTopHint;

  useEffect(() => {
    if (!isLoadingOlder && !hasMore && visibleMessages.length > 0) {
      revealTopHintTemporarily();
      return;
    }
    hideTopHint();
    return undefined;
  }, [hasMore, isLoadingOlder, visibleMessages.length]);

  useEffect(() => () => clearTopHintTimer(), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      pinnedToBottomRef.current = getDistanceFromBottom(container) <= AUTO_SCROLL_THRESHOLD;

      if (container.scrollTop > 80 && showTopHint) hideTopHint();

      if (container.scrollTop <= 80 && onReachTop && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        prependAnchorScrollHeightRef.current = container.scrollHeight;
        setTopTriggerTick((tick) => tick + 1);
      }
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [onReachTop, showTopHint]);

  useEffect(() => {
    if (!onReachTop || topTriggerTick === 0) return;
    void Promise.resolve(onReachTop()).finally(() => {
      loadingOlderRef.current = false;
    });
  }, [onReachTop, topTriggerTick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (prependAnchorScrollHeightRef.current > 0) {
      const delta = container.scrollHeight - prependAnchorScrollHeightRef.current;
      if (delta > 0) {
        container.scrollTop = container.scrollTop + delta;
      }
      prependAnchorScrollHeightRef.current = 0;
      return;
    }

    if (pinnedToBottomRef.current) {
      scrollToBottom();
    }
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
        ) : isTopHintVisible ? (
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

      {thinkingChar ? (
        <TypingIndicator
          characterName={thinkingChar.name}
          avatar={thinkingChar.avatar}
          bubbleStyleId={thinkingChar.bubbleStyleId}
          content={streamingContent}
        />
      ) : null}

      <div ref={bottomRef} />
    </Box>
  );
}
