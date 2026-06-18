import { Box, CircularProgress, Typography } from '@mui/material';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Message, MessageAttachment } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import EventMessageItem from './EventMessageItem';
import NarrativeMessageItem, { type NarrativeStoryChoiceOption } from './NarrativeMessageItem';
import SystemMessageItem from './SystemMessageItem';
import { resolveCharacterOrDeleted } from '../../utils/deletedEntity';
import { buildChatRenderItems, type ChatRenderItem } from './chatRenderModel';
import type { ExpressionFeedbackKind } from '../../services/characterExpressionFeedback';
import ImageLightbox from '../common/ImageLightbox';

const TOP_PREFETCH_THRESHOLD = 520;
const BOTTOM_STICKY_THRESHOLD = 96;
const SMOOTH_SCROLL_DISTANCE_LIMIT = 900;
const FOLLOW_SCROLL_DURATION_MS = 180;
type ResponsiveInset = number | string | Record<string, number | string>;
interface ScrollAnchorSnapshot {
  messageId: string;
  offsetTop: number;
}

interface MessageListProps {
  messages: Message[];
  characters: AICharacter[];
  currentUser?: { nickname?: string; avatar?: string };
  onDeleteMessage?: (id: string) => void;
  onAnalyzeMessage?: (message: Message) => void;
  onExpressionFeedback?: (message: Message, kind: ExpressionFeedbackKind) => void;
  onRetryMedia?: (message: Message, attachmentId: string) => void | Promise<void>;
  onCharacterAvatarClick?: (character: AICharacter, anchorEl: HTMLElement) => void;
  onReachTop?: () => void | Promise<void>;
  isLoadingOlder?: boolean;
  hasMore?: boolean;
  topHint?: string;
  loadingText?: string;
  topInset?: ResponsiveInset;
  bottomInset?: ResponsiveInset;
  selfMemberId?: string | null;
  privateConversation?: boolean;
  tailContent?: ReactNode;
  storyChoiceMessageId?: string | null;
  storyChoiceOptions?: NarrativeStoryChoiceOption[];
  onChooseStoryChoice?: (value: string) => void;
}

export default function MessageList({
  messages,
  characters,
  currentUser,
  onDeleteMessage,
  onAnalyzeMessage,
  onExpressionFeedback,
  onRetryMedia,
  onCharacterAvatarClick,
  onReachTop,
  isLoadingOlder = false,
  hasMore = false,
  topHint,
  loadingText,
  topInset,
  bottomInset,
  selfMemberId = null,
  privateConversation = false,
  tailContent,
  storyChoiceMessageId = null,
  storyChoiceOptions = [],
  onChooseStoryChoice,
}: MessageListProps) {
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const topLoadTriggeredRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const hasJumpedToBottomRef = useRef(false);
  const prependRestoreRef = useRef<ScrollAnchorSnapshot | null>(null);
  const latestScrollAnchorRef = useRef<ScrollAnchorSnapshot | null>(null);
  const autoFillTriggeredRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const followScrollAnimationRef = useRef<number | null>(null);
  const previousRenderMetricsRef = useRef({
    itemCount: renderItems.length,
    lastItemKey: renderItems.at(-1)?.key ?? null,
    lastItemContentLength: renderItems.at(-1)?.message.content.length ?? 0,
    hasTailContent: Boolean(tailContent),
    storyChoiceKey: `${storyChoiceMessageId || ''}:${storyChoiceOptions.map((option) => option.value).join('|')}`,
  });

  const chatImageTimeline = useMemo(() => messages
    .filter((message) => !message.isDeleted)
    .sort((left, right) => left.timestamp - right.timestamp)
    .flatMap((message) => (message.metadata?.attachments || [])
      .filter((attachment) => attachment.kind === 'image' && attachment.status === 'ready' && Boolean(attachment.url))
      .map((attachment) => ({
        key: `${message.id}-${attachment.id}`,
        messageId: message.id,
        attachmentId: attachment.id,
        src: attachment.url as string,
        fullSrc: attachment.url as string,
        alt: attachment.altText || message.senderName,
      }))), [messages]);

  const viewerIndex = viewerKey ? chatImageTimeline.findIndex((item) => item.key === viewerKey) : -1;
  const viewerOpen = viewerIndex >= 0;

  const openChatImage = useCallback((message: Message, attachment: MessageAttachment) => {
    const key = `${message.id}-${attachment.id}`;
    if (!chatImageTimeline.some((item) => item.key === key)) return;
    setViewerKey(key);
  }, [chatImageTimeline]);

  const loadOlderFromViewer = useCallback(() => {
    if (!onReachTop || isLoadingOlder || !hasMore) return;
    void onReachTop();
  }, [hasMore, isLoadingOlder, onReachTop]);

  const renderMessageItem = useCallback((item: ChatRenderItem) => {
    if (item.renderKind === 'system') return <SystemMessageItem key={item.key} message={item.message} />;
    if (item.renderKind === 'event') return <EventMessageItem key={item.key} message={item.message} members={characters} />;
    if (item.renderKind === 'narrative') {
      const showStoryChoices = item.message.id === storyChoiceMessageId && Boolean(onChooseStoryChoice);
      return (
        <NarrativeMessageItem
          key={item.key}
          message={item.message}
          pending={item.pending}
          storyChoiceOptions={showStoryChoices ? storyChoiceOptions : []}
          onChooseStoryChoice={showStoryChoices ? onChooseStoryChoice : undefined}
        />
      );
    }
    return (
      <MessageBubble
        key={item.key}
        message={item.message}
        character={item.message.type === 'ai' ? resolveCharacterOrDeleted(characters, item.message.senderId, item.message.senderName) : undefined}
        currentUser={currentUser}
        onDelete={item.pending || item.message.type === 'system' ? undefined : onDeleteMessage}
        onAnalyze={item.pending || item.message.type === 'system' ? undefined : onAnalyzeMessage}
        onExpressionFeedback={item.pending || item.message.type !== 'ai' ? undefined : onExpressionFeedback}
        onRetryMedia={item.pending ? undefined : onRetryMedia}
        onOpenImage={item.pending ? undefined : openChatImage}
        onCharacterAvatarClick={item.pending ? undefined : onCharacterAvatarClick}
        pending={item.pending}
        selfMemberId={selfMemberId}
        privateConversation={privateConversation}
      />
    );
  }, [characters, currentUser, onAnalyzeMessage, onCharacterAvatarClick, onChooseStoryChoice, onDeleteMessage, onExpressionFeedback, onRetryMedia, openChatImage, privateConversation, selfMemberId, storyChoiceMessageId, storyChoiceOptions]);

  const topStatusText = useMemo(() => {
    if (messages.length === 0) return null;
    if (hasMore) return isLoadingOlder ? (loadingText || null) : '';
    return topHint || '没有更早的消息';
  }, [hasMore, isLoadingOlder, loadingText, messages.length, topHint]);

  const getDistanceFromBottom = useCallback((element: HTMLDivElement) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  ), []);

  const captureScrollAnchor = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
    const firstVisible = nodes.find((node) => node.getBoundingClientRect().bottom > containerRect.top + 1) || nodes[0];
    const messageId = firstVisible?.dataset.messageId;
    if (!firstVisible || !messageId) return null;
    return {
      messageId,
      offsetTop: firstVisible.getBoundingClientRect().top - containerRect.top,
    };
  }, []);

  const restoreScrollAnchor = useCallback((snapshot: ScrollAnchorSnapshot) => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const target = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
      .find((node) => node.dataset.messageId === snapshot.messageId);
    if (!target) return;
    const currentOffset = target.getBoundingClientRect().top - containerRect.top;
    const delta = currentOffset - snapshot.offsetTop;
    if (Math.abs(delta) < 1) return;
    container.scrollTop += delta;
    lastScrollTopRef.current = container.scrollTop;
  }, []);

  const rememberScrollAnchor = useCallback(() => {
    const snapshot = captureScrollAnchor();
    latestScrollAnchorRef.current = snapshot;
    if (isLoadingOlder && snapshot) {
      prependRestoreRef.current = snapshot;
    }
    return snapshot;
  }, [captureScrollAnchor, isLoadingOlder]);

  const updatePinnedState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const pinned = getDistanceFromBottom(container) <= BOTTOM_STICKY_THRESHOLD;
    shouldStickToBottomRef.current = pinned;
    return pinned;
  }, [getDistanceFromBottom]);

  const stopFollowScrollAnimation = useCallback(() => {
    if (followScrollAnimationRef.current == null) return;
    window.cancelAnimationFrame(followScrollAnimationRef.current);
    followScrollAnimationRef.current = null;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current;
    if (!container) return;
    stopFollowScrollAnimation();
    const top = Math.max(0, container.scrollHeight - container.clientHeight);
    const distance = Math.abs(top - container.scrollTop);
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const effectiveBehavior = prefersReducedMotion || distance > SMOOTH_SCROLL_DISTANCE_LIMIT ? 'auto' : behavior;
    container.scrollTo({ top, behavior: effectiveBehavior });
    if (effectiveBehavior === 'auto') {
      lastScrollTopRef.current = top;
    }
  }, [stopFollowScrollAnimation]);

  const followScrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    stopFollowScrollAnimation();
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const startTop = container.scrollTop;
    const targetTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const distance = targetTop - startTop;
    if (prefersReducedMotion || Math.abs(distance) > SMOOTH_SCROLL_DISTANCE_LIMIT) {
      container.scrollTop = targetTop;
      lastScrollTopRef.current = targetTop;
      return;
    }
    if (Math.abs(distance) < 1) return;
    let startTime: number | null = null;
    const step = (time: number) => {
      if (!shouldStickToBottomRef.current) {
        followScrollAnimationRef.current = null;
        return;
      }
      if (startTime == null) startTime = time;
      const progress = Math.min(1, (time - startTime) / FOLLOW_SCROLL_DURATION_MS);
      const eased = 1 - ((1 - progress) ** 3);
      const nextTop = startTop + distance * eased;
      container.scrollTop = nextTop;
      lastScrollTopRef.current = nextTop;
      if (progress < 1) {
        followScrollAnimationRef.current = window.requestAnimationFrame(step);
      } else {
        followScrollAnimationRef.current = null;
      }
    };
    followScrollAnimationRef.current = window.requestAnimationFrame(step);
  }, [stopFollowScrollAnimation]);

  useEffect(() => stopFollowScrollAnimation, [stopFollowScrollAnimation]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || renderItems.length === 0 || hasJumpedToBottomRef.current) return;
    scrollToBottom('auto');
    hasJumpedToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
  }, [renderItems.length, scrollToBottom]);

  useLayoutEffect(() => {
    const snapshot = prependRestoreRef.current;
    if (!snapshot) return;
    prependRestoreRef.current = null;
    restoreScrollAnchor(snapshot);
    updatePinnedState();
    const handle = window.requestAnimationFrame(() => {
      restoreScrollAnchor(snapshot);
      updatePinnedState();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [renderItems, restoreScrollAnchor, updatePinnedState]);

  useLayoutEffect(() => {
    const currentMetrics = {
      itemCount: renderItems.length,
      lastItemKey: renderItems.at(-1)?.key ?? null,
      lastItemContentLength: renderItems.at(-1)?.message.content.length ?? 0,
      hasTailContent: Boolean(tailContent),
      storyChoiceKey: `${storyChoiceMessageId || ''}:${storyChoiceOptions.map((option) => option.value).join('|')}`,
    };
    const previousMetrics = previousRenderMetricsRef.current;
    previousRenderMetricsRef.current = currentMetrics;

    if (!hasJumpedToBottomRef.current) return;
    if (!shouldStickToBottomRef.current) return;
    if (
      currentMetrics.itemCount === previousMetrics.itemCount
      && currentMetrics.lastItemContentLength === previousMetrics.lastItemContentLength
      && currentMetrics.lastItemKey === previousMetrics.lastItemKey
      && currentMetrics.hasTailContent === previousMetrics.hasTailContent
      && currentMetrics.storyChoiceKey === previousMetrics.storyChoiceKey
    ) {
      return;
    }

    followScrollToBottom();
  }, [followScrollToBottom, renderItems, storyChoiceMessageId, storyChoiceOptions, tailContent]);

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

    prependRestoreRef.current = latestScrollAnchorRef.current || captureScrollAnchor();
    autoFillTriggeredRef.current = true;
    topLoadTriggeredRef.current = true;
    void onReachTop();
  }, [captureScrollAnchor, hasMore, isLoadingOlder, onReachTop, renderItems.length]);

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
        rememberScrollAnchor();

        if (container.scrollTop > TOP_PREFETCH_THRESHOLD) {
          topLoadTriggeredRef.current = false;
          return;
        }

        if (!onReachTop || topLoadTriggeredRef.current || isLoadingOlder || !hasMore) return;

        prependRestoreRef.current = latestScrollAnchorRef.current || captureScrollAnchor();
        topLoadTriggeredRef.current = true;
        void onReachTop();
      }}
      sx={{
        flex: 1,
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        pt: topInset || 2,
        pb: bottomInset || 2,
        bgcolor: 'transparent',
        scrollPaddingTop: topInset || 16,
        scrollPaddingBottom: bottomInset || 16,
        overflowAnchor: 'none',
      }}
    >
      {messages.length > 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', px: 2, pb: 1, minHeight: 25 }}>
          {isLoadingOlder ? (
            <CircularProgress size={16} thickness={4} sx={{ color: 'text.secondary' }} />
          ) : (
            <Typography
              variant="caption"
              sx={{
                color: topStatusText ? 'text.secondary' : 'transparent',
                userSelect: 'none',
              }}
            >
              {topStatusText || '没有更早的消息'}
            </Typography>
          )}
        </Box>
      ) : null}

      <Box>
        {renderItems.map(renderMessageItem)}
        {tailContent}
      </Box>
      <ImageLightbox
        open={viewerOpen}
        images={chatImageTimeline}
        index={Math.max(0, viewerIndex)}
        onIndexChange={(index) => setViewerKey(chatImageTimeline[index]?.key || null)}
        onReachStart={hasMore && !isLoadingOlder ? loadOlderFromViewer : undefined}
        reachStartVersion={messages.length}
        onClose={() => setViewerKey(null)}
      />
    </Box>
  );
}
