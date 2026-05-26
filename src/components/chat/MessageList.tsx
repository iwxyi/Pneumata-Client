import { Box, Typography } from '@mui/material';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import { resolveCharacterOrDeleted } from '../../utils/deletedEntity';
import { buildChatRenderItems } from './chatRenderModel';
import type { ExpressionFeedbackKind } from '../../services/characterExpressionFeedback';

const TOP_REACH_THRESHOLD = 64;
const BOTTOM_STICKY_THRESHOLD = 96;
type ResponsiveInset = number | string | Record<string, number | string>;

interface MessageListProps {
  messages: Message[];
  characters: AICharacter[];
  currentUser?: { nickname?: string; avatar?: string };
  onDeleteMessage?: (id: string) => void;
  onAnalyzeMessage?: (message: Message) => void;
  onExpressionFeedback?: (message: Message, kind: ExpressionFeedbackKind) => void;
  onRetryMedia?: (message: Message, attachmentId: string) => void | Promise<void>;
  onReachTop?: () => void | Promise<void>;
  isLoadingOlder?: boolean;
  hasMore?: boolean;
  topHint?: string;
  loadingText?: string;
  topInset?: ResponsiveInset;
  bottomInset?: ResponsiveInset;
}

export default function MessageList({
  messages,
  characters,
  currentUser,
  onDeleteMessage,
  onAnalyzeMessage,
  onExpressionFeedback,
  onRetryMedia,
  onReachTop,
  isLoadingOlder = false,
  hasMore = false,
  topHint,
  loadingText,
  topInset,
  bottomInset,
}: MessageListProps) {
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const topLoadTriggeredRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const hasJumpedToBottomRef = useRef(false);
  const prependRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const autoFillTriggeredRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const previousRenderMetricsRef = useRef({
    itemCount: renderItems.length,
    lastItemKey: renderItems.at(-1)?.key ?? null,
    lastItemContentLength: renderItems.at(-1)?.message.content.length ?? 0,
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
    lastScrollTopRef.current = top;
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
    lastScrollTopRef.current = container.scrollTop;
    updatePinnedState();
  }, [messages, updatePinnedState]);

  useLayoutEffect(() => {
    const currentMetrics = {
      itemCount: renderItems.length,
      lastItemKey: renderItems.at(-1)?.key ?? null,
      lastItemContentLength: renderItems.at(-1)?.message.content.length ?? 0,
    };
    const previousMetrics = previousRenderMetricsRef.current;
    previousRenderMetricsRef.current = currentMetrics;

    if (!hasJumpedToBottomRef.current) return;
    if (!shouldStickToBottomRef.current) return;
    if (
      currentMetrics.itemCount === previousMetrics.itemCount
      && currentMetrics.lastItemContentLength === previousMetrics.lastItemContentLength
      && currentMetrics.lastItemKey === previousMetrics.lastItemKey
    ) {
      return;
    }

    scrollToBottom();
  }, [renderItems, scrollToBottom]);

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

        const previousScrollTop = lastScrollTopRef.current;
        const isScrollingUp = container.scrollTop < previousScrollTop - 2;
        lastScrollTopRef.current = container.scrollTop;
        if (isScrollingUp) {
          shouldStickToBottomRef.current = false;
        } else {
          updatePinnedState();
        }

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
        pt: topInset || 2,
        pb: bottomInset || 2,
        bgcolor: 'transparent',
        scrollPaddingTop: topInset || 16,
        scrollPaddingBottom: bottomInset || 16,
      }}
    >
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

      <Box>
        {renderItems.map((item) => (
          <MessageBubble
            key={item.key}
            message={item.message}
            character={item.message.type === 'ai' ? resolveCharacterOrDeleted(characters, item.message.senderId, item.message.senderName) : undefined}
            currentUser={currentUser}
            members={characters}
            onDelete={item.pending || item.message.type === 'system' ? undefined : onDeleteMessage}
            onAnalyze={item.pending || item.message.type === 'system' ? undefined : onAnalyzeMessage}
            onExpressionFeedback={item.pending || item.message.type !== 'ai' ? undefined : onExpressionFeedback}
            onRetryMedia={item.pending ? undefined : onRetryMedia}
            pending={item.pending}
          />
        ))}
      </Box>
    </Box>
  );
}
