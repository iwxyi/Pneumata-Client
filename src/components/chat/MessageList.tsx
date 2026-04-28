import { Box, Typography } from '@mui/material';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import { resolveCharacterOrDeleted } from '../../utils/deletedEntity';
import { buildChatRenderItems, type LiveChatMessage } from './chatRenderModel';

const TOP_REACH_THRESHOLD = 64;
const BOTTOM_STICKY_THRESHOLD = 96;

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

export default function MessageList({
  messages,
  characters,
  liveMessage = null,
  onDeleteMessage,
  onReachTop,
  isLoadingOlder = false,
  hasMore = false,
  topHint,
  loadingText,
}: MessageListProps) {
  const renderItems = buildChatRenderItems(messages, liveMessage);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const topLoadTriggeredRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const hasJumpedToBottomRef = useRef(false);
  const prependRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const autoFillTriggeredRef = useRef(false);
  const previousRenderMetricsRef = useRef({
    itemCount: renderItems.length,
    liveContentLength: liveMessage?.content.length ?? 0,
  });

  const topStatusText = useMemo(() => {
    if (messages.length === 0) return null;
    if (hasMore) return isLoadingOlder ? (loadingText || null) : '';
    return topHint || '没有更早的消息';
  }, [hasMore, isLoadingOlder, loadingText, messages.length, topHint]);

  const getDistanceFromBottom = useCallback((element: HTMLDivElement) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  ), []);

  const updatePinnedState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const pinned = getDistanceFromBottom(container) <= BOTTOM_STICKY_THRESHOLD;
    shouldStickToBottomRef.current = pinned;
    return pinned;
  }, [getDistanceFromBottom]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const top = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = top;
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || renderItems.length === 0 || hasJumpedToBottomRef.current) return;
    scrollToBottom();
    hasJumpedToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
  }, [renderItems.length, scrollToBottom]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const snapshot = prependRestoreRef.current;
    if (!container || !snapshot) return;
    prependRestoreRef.current = null;
    const delta = container.scrollHeight - snapshot.height;
    container.scrollTop = snapshot.top + delta;
    updatePinnedState();
  }, [messages, updatePinnedState]);

  useEffect(() => {
    const currentMetrics = {
      itemCount: renderItems.length,
      liveContentLength: liveMessage?.content.length ?? 0,
    };
    const previousMetrics = previousRenderMetricsRef.current;
    previousRenderMetricsRef.current = currentMetrics;

    if (!hasJumpedToBottomRef.current) return;
    if (!shouldStickToBottomRef.current) return;
    if (
      currentMetrics.itemCount === previousMetrics.itemCount
      && currentMetrics.liveContentLength === previousMetrics.liveContentLength
    ) {
      return;
    }

    scrollToBottom();
  }, [liveMessage?.content, renderItems.length, scrollToBottom]);

  useEffect(() => {
    if (!isLoadingOlder) {
      topLoadTriggeredRef.current = false;
      autoFillTriggeredRef.current = false;
    }
  }, [isLoadingOlder]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onReachTop || isLoadingOlder || !hasMore || autoFillTriggeredRef.current) return;
    if (container.scrollHeight > container.clientHeight + 1) return;

    prependRestoreRef.current = {
      height: container.scrollHeight,
      top: container.scrollTop,
    };
    autoFillTriggeredRef.current = true;
    topLoadTriggeredRef.current = true;
    void onReachTop();
  }, [hasMore, isLoadingOlder, onReachTop, renderItems.length]);

  return (
    <Box
      ref={containerRef}
      onScroll={() => {
        const container = containerRef.current;
        if (!container) return;

        updatePinnedState();

        if (container.scrollTop > TOP_REACH_THRESHOLD) {
          topLoadTriggeredRef.current = false;
          return;
        }

        if (!onReachTop || topLoadTriggeredRef.current || isLoadingOlder || !hasMore) return;

        prependRestoreRef.current = {
          height: container.scrollHeight,
          top: container.scrollTop,
        };
        topLoadTriggeredRef.current = true;
        void onReachTop();
      }}
      sx={{
        flex: 1,
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        py: 2,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5f5f5' : '#121212',
      }}
    >
      <Box>
        {messages.length > 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', px: 2, pb: 1, minHeight: 25 }}>
            <Typography
              variant="caption"
              sx={{
                color: topStatusText ? 'text.secondary' : 'transparent',
                userSelect: 'none',
              }}
            >
              {topStatusText || '没有更早的消息'}
            </Typography>
          </Box>
        ) : null}
        {renderItems.map((item) => (
          <MessageBubble
            key={item.key}
            message={item.message}
            character={item.message.type === 'ai' ? resolveCharacterOrDeleted(characters, item.message.senderId, item.message.senderName) : undefined}
            onDelete={item.pending || item.message.type === 'system' ? undefined : onDeleteMessage}
            pending={item.pending}
          />
        ))}
      </Box>
    </Box>
  );
}
