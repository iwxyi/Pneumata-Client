import { Box, CircularProgress, Stack, Typography, keyframes } from '@mui/material';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Message, MessageAttachment, NarrativeBlock, NarrativeTurnMetadata } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import EventMessageItem from './EventMessageItem';
import { getNarrativeDisplayBlocks, type NarrativeStoryChoiceOption } from './messageBubblePresentation';
import SystemMessageItem from './SystemMessageItem';
import { resolveCharacterOrDeleted } from '../../utils/deletedEntity';
import { buildChatRenderItems, type ChatRenderItem } from './chatRenderModel';
import type { ExpressionFeedbackKind } from '../../services/characterExpressionFeedback';
import ImageLightbox from '../common/ImageLightbox';
import { useSettingsStore } from '../../stores/useSettingsStore';

const TOP_PREFETCH_THRESHOLD = 520;
const BOTTOM_STICKY_THRESHOLD = 96;
const SMOOTH_SCROLL_DISTANCE_LIMIT = 900;
const FOLLOW_SCROLL_DURATION_MS = 180;
const storyNodeFadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;
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
  storyChoiceSubmittingValue?: string | null;
  onChooseStoryChoice?: (value: string) => void;
  onBottomPinnedChange?: (pinned: boolean) => void;
  narrativeRevealMessageKeys?: ReadonlySet<string>;
  onNarrativeRevealComplete?: (message: Message) => void;
}

function ChoiceMeta({ label, value }: { label: string; value: string }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        minWidth: 0,
        maxWidth: '100%',
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        bgcolor: theme.palette.mode === 'light' ? 'rgba(15,23,42,0.06)' : 'rgba(226,232,240,0.08)',
        color: 'text.secondary',
        fontSize: 12,
        lineHeight: 1.5,
      })}
    >
      <Box component="span" sx={{ flex: '0 0 auto', fontWeight: 700, mr: 0.5 }}>{label}</Box>
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{value}</Box>
    </Box>
  );
}

function StoryChoicePanel({ options, onChoose, showDeveloperDetails = false, submittingValue = null }: { options: NarrativeStoryChoiceOption[]; onChoose?: (value: string) => void; showDeveloperDetails?: boolean; submittingValue?: string | null }) {
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const maxContentWidth = chatAppearance.maxContentWidthUnlimited ? '100%' : chatAppearance.maxContentWidth;
  if (!options.length) return null;
  const isSubmitting = Boolean(submittingValue);
  return (
    <Box data-message-id="story-choice-panel" data-message-type="story-choice" sx={{ px: { xs: 2, sm: 3 }, py: 0.75, width: '100%' }}>
      <Stack spacing={0.75} sx={{ width: '100%', maxWidth: maxContentWidth, mx: 'auto', px: { xs: 0.5, sm: 1 }, transition: 'gap 220ms ease' }}>
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, fontWeight: 700, transition: 'opacity 180ms ease, max-height 220ms ease, margin 220ms ease', opacity: isSubmitting ? 0 : 1, maxHeight: isSubmitting ? 0 : 24, overflow: 'hidden' }}>
          {isSubmitting ? '已选择剧情走向' : '选择接下来的剧情走向'}
        </Typography>
        {options.map((option) => (
          <Box
            key={option.value}
            component="button"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              if (!isSubmitting) onChoose?.(option.value);
            }}
            sx={(theme) => ({
              '--choice-option-max-height': submittingValue && option.value !== submittingValue ? '0px' : '260px',
              '--choice-option-opacity': submittingValue && option.value !== submittingValue ? 0 : 1,
              '--choice-option-scale': submittingValue && option.value !== submittingValue ? 0.985 : 1,
              width: '100%',
              border: `1px solid ${theme.palette.mode === 'light' ? 'rgba(148,163,184,0.32)' : 'rgba(226,232,240,0.16)'}`,
              borderRadius: 2,
              px: { xs: 1.5, sm: 1.75 },
              py: submittingValue && option.value !== submittingValue ? 0 : { xs: 1, sm: 1.1 },
              mt: submittingValue && option.value !== submittingValue ? '0 !important' : undefined,
              maxHeight: 'var(--choice-option-max-height)',
              opacity: 'var(--choice-option-opacity)',
              transform: 'scale(var(--choice-option-scale))',
              overflow: 'hidden',
              bgcolor: submittingValue === option.value
                ? theme.palette.mode === 'light' ? 'rgba(238,242,255,0.92)' : 'rgba(49,46,129,0.42)'
                : theme.palette.mode === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.82)',
              color: 'text.primary',
              textAlign: 'left',
              font: 'inherit',
              cursor: isSubmitting ? 'default' : 'pointer',
              boxShadow: theme.palette.mode === 'light' ? '0 10px 28px rgba(15,23,42,0.10)' : '0 14px 34px rgba(0,0,0,0.28)',
              transition: 'max-height 260ms ease, opacity 180ms ease, transform 220ms ease, box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease, padding 220ms ease, margin 220ms ease',
              '&:hover': {
                transform: isSubmitting ? 'scale(var(--choice-option-scale))' : 'translateY(-1px)',
                borderColor: submittingValue === option.value
                  ? theme.palette.mode === 'light' ? 'rgba(99,102,241,0.42)' : 'rgba(129,140,248,0.5)'
                  : theme.palette.mode === 'light' ? 'rgba(99,102,241,0.38)' : 'rgba(129,140,248,0.44)',
                bgcolor: isSubmitting
                  ? undefined
                  : theme.palette.mode === 'light' ? 'rgba(255,255,255,0.98)' : 'rgba(30,41,59,0.9)',
              },
              '&:active': { transform: 'translateY(0) scale(0.992)' },
              '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
              '&:disabled': {
                color: 'text.primary',
              },
            })}
          >
            <Typography variant="body2" sx={{ fontSize: { xs: 14, sm: 14.5 }, fontWeight: 400, lineHeight: 1.7 }}>{option.label}</Typography>
            {showDeveloperDetails && (option.intent || option.risk || option.reward) ? (
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                {option.intent ? <ChoiceMeta label="意图" value={option.intent} /> : null}
                {option.risk ? <ChoiceMeta label="风险" value={option.risk} /> : null}
                {option.reward ? <ChoiceMeta label="收益" value={option.reward} /> : null}
              </Stack>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function resolveNarrativeBlockCharacter(block: NarrativeBlock, characters: AICharacter[]) {
  if (block.characterId) {
    const byId = characters.find((character) => character.id === block.characterId);
    if (byId) return byId;
  }
  const actorName = (block.actorName || '').trim();
  return actorName ? characters.find((character) => character.name === actorName) || null : null;
}

function buildNarrativeBlockMessage(parent: Message, block: NarrativeBlock, turn: NarrativeTurnMetadata | undefined, index: number, character?: AICharacter | null): Message {
  const blockKey = `${parent.id}:narrative-block:${block.id || index}`;
  if (block.displayMode === 'bubble') {
    const senderId = character?.id || block.characterId || block.actorId || parent.senderId;
    const senderName = character?.name || block.actorName || parent.senderName || '角色';
    return {
      id: blockKey,
      clientKey: blockKey,
      chatId: parent.chatId,
      type: 'ai',
      senderId,
      senderName,
      content: block.text,
      emotion: parent.emotion,
      timestamp: parent.timestamp,
      isDeleted: false,
    };
  }
  return {
    id: blockKey,
    clientKey: blockKey,
    chatId: parent.chatId,
    type: parent.type,
    senderId: parent.senderId,
    senderName: parent.senderName,
    content: block.text,
    emotion: parent.emotion,
    timestamp: parent.timestamp,
    isDeleted: false,
    metadata: {
      narrativeTurn: {
        turnId: `${turn?.turnId || parent.id}:${block.id || index}`,
        turnKind: turn?.turnKind || 'narrative_beat',
        sceneId: turn?.sceneId,
        phase: turn?.phase,
        povActorId: turn?.povActorId || parent.senderId,
        blocks: [block],
      },
      storyChoiceSelection: block.displayMode === 'choice_card' ? parent.metadata?.storyChoiceSelection : undefined,
    },
  };
}

export function isNarrativeRevealAllowed(params: {
  item: ChatRenderItem;
  revealMessageKeys?: ReadonlySet<string>;
}) {
  const keys = params.revealMessageKeys;
  if (!keys?.size) return false;
  return [
    params.item.key,
    params.item.message.id,
    params.item.message.clientKey,
    params.item.message.serverId,
  ].some((key) => Boolean(key && keys.has(key)));
}

export function getVisibleNarrativeDisplayBlocks(message: Message, showDeveloperDetails: boolean) {
  return getNarrativeDisplayBlocks(message)
    .filter((block) => block.displayMode !== 'system_panel' || showDeveloperDetails);
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
  storyChoiceSubmittingValue = null,
  onChooseStoryChoice,
  onBottomPinnedChange,
  narrativeRevealMessageKeys,
  onNarrativeRevealComplete,
}: MessageListProps) {
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const storyRevealMode = useSettingsStore((state) => state.chatAppearance.storyReader.revealMode);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const topLoadTriggeredRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const lastReportedBottomPinnedRef = useRef<boolean | null>(null);
  const hasJumpedToBottomRef = useRef(false);
  const prependRestoreRef = useRef<ScrollAnchorSnapshot | null>(null);
  const latestScrollAnchorRef = useRef<ScrollAnchorSnapshot | null>(null);
  const autoFillTriggeredRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const followScrollAnimationRef = useRef<number | null>(null);
  const previousStoryChoiceSubmittingValueRef = useRef<string | null>(storyChoiceSubmittingValue);
  const previousRenderMetricsRef = useRef({
    itemCount: renderItems.length,
    lastItemKey: renderItems.at(-1)?.key ?? null,
    lastItemContentLength: renderItems.at(-1)?.message.content.length ?? 0,
    hasTailContent: Boolean(tailContent),
    storyChoiceKey: `${storyChoiceMessageId || ''}:${storyChoiceSubmittingValue || ''}:${storyChoiceOptions.map((option) => option.value).join('|')}`,
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

  const renderBubble = useCallback((item: ChatRenderItem, options?: { key?: string; message?: Message; character?: AICharacter }) => (
    <MessageBubble
      key={options?.key || item.key}
      message={options?.message || item.message}
      characters={characters}
      character={options?.character || (item.message.type === 'ai' ? resolveCharacterOrDeleted(characters, item.message.senderId, item.message.senderName) : undefined)}
      currentUser={currentUser}
      onDelete={item.pending || item.message.type === 'system' || (options?.message && options.message.id !== item.message.id) ? undefined : onDeleteMessage}
      onAnalyze={item.pending || item.message.type === 'system' ? undefined : onAnalyzeMessage}
      onExpressionFeedback={item.pending || (options?.message || item.message).type !== 'ai' ? undefined : onExpressionFeedback}
      onRetryMedia={item.pending ? undefined : onRetryMedia}
      onOpenImage={item.pending ? undefined : openChatImage}
      onCharacterAvatarClick={item.pending ? undefined : onCharacterAvatarClick}
      pending={item.pending}
      selfMemberId={selfMemberId}
      privateConversation={privateConversation}
    />
  ), [characters, currentUser, onAnalyzeMessage, onCharacterAvatarClick, onDeleteMessage, onExpressionFeedback, onRetryMedia, openChatImage, privateConversation, selfMemberId]);

  const renderMessageItem = useCallback((item: ChatRenderItem) => {
    const anchorProps = {
      'data-message-id': item.message.id,
      'data-message-client-key': item.message.clientKey || undefined,
      'data-message-server-id': item.message.serverId || undefined,
    };
    if (item.renderKind === 'system') {
      return <Box key={item.key} {...anchorProps}><SystemMessageItem message={item.message} /></Box>;
    }
    if (item.renderKind === 'event') {
      return <Box key={item.key} {...anchorProps}><EventMessageItem message={item.message} members={characters} /></Box>;
    }
    const showStoryChoices = item.renderKind === 'narrative'
      && item.message.id === storyChoiceMessageId
      && storyChoiceOptions.length > 0
      && (Boolean(onChooseStoryChoice) || Boolean(storyChoiceSubmittingValue));
    const blocks = item.renderKind === 'narrative'
      ? getVisibleNarrativeDisplayBlocks(item.message, developerMode)
      : [];
    if (!blocks.length) {
      if (showStoryChoices) {
        return (
          <Box key={item.key} {...anchorProps} sx={{ display: 'grid' }}>
            <StoryChoicePanel options={storyChoiceOptions} onChoose={onChooseStoryChoice} showDeveloperDetails={developerMode} submittingValue={storyChoiceSubmittingValue} />
          </Box>
        );
      }
      if (item.renderKind === 'narrative') return null;
      return <Box key={item.key} {...anchorProps}>{renderBubble(item)}</Box>;
    }
    const recentNarrative = !item.pending && isNarrativeRevealAllowed({ item, revealMessageKeys: narrativeRevealMessageKeys });
    const shouldFadeNode = recentNarrative && storyRevealMode === 'fade';
    const renderedBlocks = blocks.map((block, index) => {
      const character = block.displayMode === 'bubble' ? resolveNarrativeBlockCharacter(block, characters) : undefined;
      const blockMessage = buildNarrativeBlockMessage(item.message, block, item.message.metadata?.narrativeTurn, index, character);
      const blockKey = `${item.key}:block:${block.id || index}`;
      return renderBubble(item, {
        key: blockKey,
        message: blockMessage,
        character: character || (blockMessage.type === 'ai' ? resolveCharacterOrDeleted(characters, blockMessage.senderId, blockMessage.senderName) : undefined),
      });
    });
    return (
      <Box
        key={item.key}
        {...anchorProps}
        onAnimationEnd={shouldFadeNode ? () => onNarrativeRevealComplete?.(item.message) : undefined}
        sx={{
          display: 'grid',
          ...(shouldFadeNode ? {
            animation: `${storyNodeFadeIn} 220ms ease-out both`,
          } : {}),
        }}
      >
        {renderedBlocks}
        {showStoryChoices ? (
          <StoryChoicePanel options={storyChoiceOptions} onChoose={onChooseStoryChoice} showDeveloperDetails={developerMode} submittingValue={storyChoiceSubmittingValue} />
        ) : null}
      </Box>
    );
  }, [characters, developerMode, narrativeRevealMessageKeys, onChooseStoryChoice, onNarrativeRevealComplete, renderBubble, storyChoiceMessageId, storyChoiceOptions, storyChoiceSubmittingValue, storyRevealMode]);

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

  useEffect(() => {
    if (storyRevealMode !== 'instant' || !onNarrativeRevealComplete) return;
    if (!narrativeRevealMessageKeys?.size) return;
    renderItems.forEach((item) => {
      if (item.renderKind === 'narrative' && isNarrativeRevealAllowed({ item, revealMessageKeys: narrativeRevealMessageKeys })) {
        onNarrativeRevealComplete(item.message);
      }
    });
  }, [narrativeRevealMessageKeys, onNarrativeRevealComplete, renderItems, storyRevealMode]);

  const updatePinnedState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const pinned = getDistanceFromBottom(container) <= BOTTOM_STICKY_THRESHOLD;
    shouldStickToBottomRef.current = pinned;
    if (lastReportedBottomPinnedRef.current !== pinned) {
      lastReportedBottomPinnedRef.current = pinned;
      onBottomPinnedChange?.(pinned);
    }
    return pinned;
  }, [getDistanceFromBottom, onBottomPinnedChange]);

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

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (!hasJumpedToBottomRef.current || !shouldStickToBottomRef.current) return;
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (shouldStickToBottomRef.current) followScrollToBottom();
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [followScrollToBottom]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || renderItems.length === 0 || hasJumpedToBottomRef.current) return;
    scrollToBottom('auto');
    hasJumpedToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
    if (lastReportedBottomPinnedRef.current !== true) {
      lastReportedBottomPinnedRef.current = true;
      onBottomPinnedChange?.(true);
    }
  }, [onBottomPinnedChange, renderItems.length, scrollToBottom]);

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
      storyChoiceKey: `${storyChoiceMessageId || ''}:${storyChoiceSubmittingValue || ''}:${storyChoiceOptions.map((option) => option.value).join('|')}`,
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
  }, [followScrollToBottom, renderItems, storyChoiceMessageId, storyChoiceOptions, storyChoiceSubmittingValue, tailContent]);

  useLayoutEffect(() => {
    const previousValue = previousStoryChoiceSubmittingValueRef.current;
    previousStoryChoiceSubmittingValueRef.current = storyChoiceSubmittingValue;
    if (!storyChoiceSubmittingValue || previousValue === storyChoiceSubmittingValue) return;
    if (!hasJumpedToBottomRef.current) return;
    shouldStickToBottomRef.current = true;
    followScrollToBottom();
  }, [followScrollToBottom, storyChoiceSubmittingValue]);

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
          if (lastReportedBottomPinnedRef.current !== false) {
            lastReportedBottomPinnedRef.current = false;
            onBottomPinnedChange?.(false);
          }
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

      <Box ref={contentRef}>
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
