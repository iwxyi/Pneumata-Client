import { useRef, useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import { resolveCharacterOrDeleted } from '../../utils/deletedEntity';
import { buildChatRenderItems, type LiveChatMessage } from './chatRenderModel';

const AUTO_SCROLL_THRESHOLD = 96;

interface MessageListProps {
  messages: Message[];
  characters: AICharacter[];
  liveMessage?: LiveChatMessage | null;
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

export default function MessageList({ messages, characters, liveMessage = null, onDeleteMessage, onReachTop, isLoadingOlder = false, hasMore = true, topHint, loadingText }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const prependAnchorScrollHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const topReachAttemptedRef = useRef(false);
  const hasLeftTopRef = useRef(false);
  const lastSmoothScrollAtRef = useRef(0);
  const topHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [topTriggerTick, setTopTriggerTick] = useState(0);
  const [showTopHint, setShowTopHint] = useState(false);

  const visibleMessages = messages.filter((message) => !message.isDeleted);
  const renderItems = buildChatRenderItems(messages, liveMessage);
  const lastRenderItem = renderItems.at(-1);
  const isTopHintVisible = !isLoadingOlder && !hasMore && visibleMessages.length > 0 && showTopHint;

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

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current;
    if (!container) {
      bottomRef.current?.scrollIntoView({ behavior });
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  };

  useEffect(() => {
    if (topReachAttemptedRef.current && !isLoadingOlder && !hasMore && visibleMessages.length > 0) {
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

      if (container.scrollTop > 80) {
        hasLeftTopRef.current = true;
      }

      if (container.scrollTop > 80 && showTopHint) hideTopHint();

      if (container.scrollTop <= 80 && onReachTop && hasMore && !loadingOlderRef.current && hasLeftTopRef.current) {
        loadingOlderRef.current = true;
        topReachAttemptedRef.current = true;
        prependAnchorScrollHeightRef.current = container.scrollHeight;
        setTopTriggerTick((tick) => tick + 1);
      }
    };

    pinnedToBottomRef.current = getDistanceFromBottom(container) <= AUTO_SCROLL_THRESHOLD;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasMore, onReachTop, showTopHint]);

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
      const now = Date.now();
      const useSmooth = now - lastSmoothScrollAtRef.current > 140;
      scrollToBottom(useSmooth ? 'smooth' : 'auto');
      if (useSmooth) {
        lastSmoothScrollAtRef.current = now;
      }
    }
  }, [renderItems.length, lastRenderItem?.key, lastRenderItem?.message.content, lastRenderItem?.pending]);

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
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, borderRadius: 999, bgcolor: 'background.paper', color: 'text.secondary', boxShadow: 1 }}>
            <CircularProgress size={16} thickness={5} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>{loadingText}</Typography>
          </Box>
        ) : isTopHintVisible ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1.5, py: 0.75, borderRadius: 999, bgcolor: 'action.hover', color: 'text.secondary' }}>
            <Typography variant="caption" sx={{ fontWeight: 500 }}>{topHint}</Typography>
          </Box>
        ) : null}
      </Box>

      {renderItems.map((item) => (
        <MessageBubble
          key={item.key}
          message={item.message}
          character={item.message.type === 'ai' ? resolveCharacterOrDeleted(characters, item.message.senderId, item.message.senderName) : undefined}
          onDelete={item.pending || item.message.type === 'system' ? undefined : onDeleteMessage}
          pending={item.pending}
        />
      ))}

      <div ref={bottomRef} />
    </Box>
  );
}
