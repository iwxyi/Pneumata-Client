import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box, Chip, CircularProgress, Fab, Stack, Typography, keyframes } from '@mui/material';
import { memo, type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Message, MessageAttachment, NarrativeBlock, NarrativeTurnMetadata } from '../../types/message';
import type { AICharacter } from '../../types/character';
import MessageBubble from './MessageBubble';
import EventMessageItem from './EventMessageItem';
import { shouldRenderEventMessage, type EventRenderFlags } from './eventMessagePresentation';
import type { NarrativeStoryChoiceOption } from './messageBubblePresentation';
import SystemMessageItem from './SystemMessageItem';
import { resolveCharacterOrDeleted } from '../../utils/deletedEntity';
import { buildChatRenderItems, type ChatRenderItem } from './chatRenderModel';
import { getVisibleNarrativeDisplayBlocks, isNarrativeRevealAllowed } from './messageListPresentation';
import type { ExpressionFeedbackKind } from '../../services/characterExpressionFeedback';
import ImageLightbox from '../common/ImageLightbox';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { logDeveloperDiagnostic } from '../../services/developerDiagnostics';
import { buildStoryNodeProgress, type StoryNodeProgressChip } from '../../services/storyNodeProgress';
import type { MessageBranchVersionInfo } from '../../services/messageBranching';
import { buildBubblePreview, resolveCharacterBubbleStyle } from '../../utils/bubbleStyle';
import { prefersReducedMotion } from '../../styles/motion';

const TOP_PREFETCH_THRESHOLD = 520;
const BOTTOM_STICKY_THRESHOLD = 96;
const JUMP_TO_BOTTOM_PAGE_MULTIPLIER = 3;
const BOTTOM_RESTORE_ANCHOR_THRESHOLD = 700;
const SMOOTH_SCROLL_DISTANCE_LIMIT = 900;
const FOLLOW_SCROLL_DURATION_MS = 180;
const MIN_BOTTOM_PREFETCH_PAGES = 1;
const MAX_BOTTOM_PREFETCH_PAGES = 3;
const storyNodeFadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;
type ResponsiveInset = number | string | Record<string, number | string>;
interface ScrollAnchorSnapshot {
  messageId: string;
  offsetTop: number;
  sourceTimestamp?: number;
}
export interface MessageListScrollPosition extends ScrollAnchorSnapshot {
  pinned: boolean;
}
export interface MessageListScrollRequest extends ScrollAnchorSnapshot {
  key: string;
  behavior?: ScrollBehavior;
  highlight?: boolean;
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
  onCreateRevision?: (message: Message, content: string) => void | Promise<void>;
  onSwitchRevision?: (message: Message, direction: -1 | 1) => void | Promise<void>;
  branchVersionInfoByMessageId?: Record<string, MessageBranchVersionInfo | null | undefined>;
  onReachTop?: () => void | Promise<void>;
  onReachBottom?: () => void | Promise<void>;
  onJumpToConversationBottom?: () => void | Promise<void>;
  isLoadingOlder?: boolean;
  isLoadingNewer?: boolean;
  hasMore?: boolean;
  hasMoreNewer?: boolean;
  topHint?: string;
  loadingText?: string;
  topInset?: ResponsiveInset;
  bottomInset?: ResponsiveInset;
  selfMemberId?: string | null;
  privateConversation?: boolean;
  emptyContent?: ReactNode;
  tailContent?: ReactNode;
  storyChoiceMessageId?: string | null;
  storyChoiceOptions?: NarrativeStoryChoiceOption[];
  storyChoiceSubmittingValue?: string | null;
  onChooseStoryChoice?: (value: string) => void;
  onBottomPinnedChange?: (pinned: boolean) => void;
  onNearBottomChange?: (nearBottom: boolean) => void;
  initialScrollPosition?: MessageListScrollPosition | null;
  scrollRequest?: MessageListScrollRequest | null;
  onScrollRequestResolved?: (request: MessageListScrollRequest, resolved: boolean) => void;
  onScrollPositionChange?: (position: MessageListScrollPosition) => void;
  narrativeRevealMessageKeys?: ReadonlySet<string>;
  onNarrativeRevealComplete?: (message: Message) => void;
  autoStickToBottom?: boolean;
}

type MessageListRenderKind =
  | ChatRenderItem['renderKind']
  | 'narrative-block'
  | 'narrative-progress'
  | 'story-choice';

interface MessageListRenderItem {
  key: string;
  message: Message;
  sourceItem: ChatRenderItem;
  pending: boolean;
  renderKind: MessageListRenderKind;
  block?: NarrativeBlock;
  blockIndex?: number;
  completeNarrativeReveal?: boolean;
}

function buildChatImageTimeline(messages: Message[]) {
  return messages
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
      })));
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

function getStoryNodeProgressChipSx(tone: StoryNodeProgressChip['tone']) {
  if (tone === 'recap') return { borderColor: 'rgba(245,158,11,0.34)', bgcolor: 'rgba(245,158,11,0.08)' };
  return { borderColor: 'rgba(14,165,233,0.32)', bgcolor: 'rgba(14,165,233,0.07)' };
}

function StoryNodeProgressBar({ message }: { message: Message }) {
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const progress = buildStoryNodeProgress(message);
  if (!progress) return null;
  const maxContentWidth = chatAppearance.maxContentWidthUnlimited ? '100%' : chatAppearance.maxContentWidth;
  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, pt: 0.15, pb: 0.55, width: '100%' }}>
      <Stack direction="row" spacing={0.55} useFlexGap sx={{ flexWrap: 'wrap', maxWidth: maxContentWidth, mx: 'auto', px: { xs: 0.5, sm: 1 } }}>
        {progress.chips.map((chip) => (
          <Chip
            key={`${chip.tone}:${chip.label}`}
            size="small"
            label={chip.label}
            variant="outlined"
            sx={{
              height: 22,
              maxWidth: '100%',
              ...getStoryNodeProgressChipSx(chip.tone),
              '& .MuiChip-label': { px: 0.8, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' },
            }}
          />
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

function buildNarrativeBlockScrollAnchor(message: Message, block: NarrativeBlock, index: number) {
  return `${message.id}:story-block:${block.id || index}`;
}

function getElementScrollAnchorId(element: HTMLElement) {
  return element.dataset.scrollAnchor || element.dataset.messageId || '';
}

function getElementScrollTimestamp(element: HTMLElement) {
  const raw = element.dataset.scrollTimestamp || element.closest<HTMLElement>('[data-scroll-timestamp]')?.dataset.scrollTimestamp;
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
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

function getStoryReaderFontFamily(fontFamily: string | undefined) {
  if (fontFamily === 'serif') return 'Georgia, "Times New Roman", "Noto Serif SC", "Songti SC", serif';
  if (fontFamily === 'sans') return 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  return undefined;
}

function getHistoricalBubbleShadow(shadow: string | undefined) {
  if (!shadow || shadow === 'none') return '0 1px 3px rgba(0,0,0,0.10)';
  return '0 1px 3px rgba(0,0,0,0.10)';
}

const LightweightNarrativeBlock = memo(function LightweightNarrativeBlock({
  block,
  character,
  characters,
  maxContentWidth,
  storyReaderFontFamily,
  storyReaderFontSize,
  storyReaderLineHeight,
  customBubbleStyles,
  onCharacterAvatarClick,
}: {
  block: NarrativeBlock;
  character?: AICharacter | null;
  characters: AICharacter[];
  maxContentWidth: string | number;
  storyReaderFontFamily?: string;
  storyReaderFontSize: number;
  storyReaderLineHeight: number;
  customBubbleStyles: ReturnType<typeof useSettingsStore.getState>['customBubbleStyles'];
  onCharacterAvatarClick?: (character: AICharacter, anchorEl: HTMLElement) => void;
}) {
  if (block.displayMode === 'bubble') {
    const resolvedStyle = character
      ? resolveCharacterBubbleStyle({ bubbleStyle: character.bubbleStyle, bubbleStyleId: character.bubbleStyleId, customStyles: customBubbleStyles })
      : null;
    const bubblePreview = resolvedStyle ? buildBubblePreview(resolvedStyle, false) : null;
    const senderName = character?.name || block.actorName || '角色';
    const avatarText = senderName.slice(0, 1);
    const wrapperStyle: CSSProperties = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '6px 16px',
      width: '100%',
      boxSizing: 'border-box',
    };
    const contentStyle: CSSProperties = {
      maxWidth: typeof maxContentWidth === 'number' ? maxContentWidth : maxContentWidth,
      minWidth: 0,
      display: 'grid',
      gap: 3,
      justifyItems: 'start',
    };
    const avatarStyle: CSSProperties = {
      width: 34,
      height: 34,
      borderRadius: '50%',
      flex: '0 0 auto',
      display: 'grid',
      placeItems: 'center',
      background: resolvedStyle?.backgroundColor || '#6366f1',
      color: resolvedStyle?.textColor || '#fff',
      fontSize: 14,
      fontWeight: 700,
      cursor: character && onCharacterAvatarClick ? 'pointer' : 'default',
      userSelect: 'none',
    };
    const nameStyle: CSSProperties = {
      color: 'rgba(100, 116, 139, 0.92)',
      fontSize: 12,
      lineHeight: '18px',
      fontWeight: 500,
      padding: '0 4px',
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };
    const bubbleStyle: CSSProperties = {
      padding: '8px 12px',
      borderRadius: bubblePreview?.borderRadius || '18px',
      background: bubblePreview?.background || '#fff',
      color: bubblePreview?.color || '#1f2937',
      border: bubblePreview?.border || '1px solid rgba(15, 23, 42, 0.08)',
      boxShadow: getHistoricalBubbleShadow(bubblePreview?.boxShadow),
      fontSize: 14,
      lineHeight: 1.85,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      userSelect: 'text',
    };
    return (
      <div style={wrapperStyle}>
        <div
          style={avatarStyle}
          onClick={(event) => {
            if (character && onCharacterAvatarClick) onCharacterAvatarClick(character, event.currentTarget);
          }}
        >
          {avatarText}
        </div>
        <div style={contentStyle}>
          <div style={nameStyle}>{senderName}</div>
          <div style={bubbleStyle}>{block.text}</div>
        </div>
      </div>
    );
  }

  if (block.displayMode === 'system_panel') {
    const lines = block.text.split('\n').map((line) => line.trim()).filter(Boolean);
    const title = lines[0] || '章节回顾';
    const body = lines.slice(1).join('\n');
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 24px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', maxWidth: maxContentWidth, border: '1px solid rgba(14,165,233,0.24)', borderRadius: 8, background: 'rgba(240,249,255,0.72)', padding: '10px 13px', boxSizing: 'border-box' }}>
          <div style={{ color: 'rgba(100, 116, 139, 0.96)', fontSize: 12, fontWeight: 700, lineHeight: 1.5, marginBottom: body ? 5 : 0 }}>{title}</div>
          {body ? <div style={{ color: '#1f2937', fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body}</div> : null}
        </div>
      </div>
    );
  }

  if (block.displayMode === 'choice_card') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 24px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ width: '100%', maxWidth: maxContentWidth, border: '1px solid rgba(99,102,241,0.22)', borderRadius: 8, background: 'rgba(238,242,255,0.62)', padding: '10px 13px', boxSizing: 'border-box' }}>
          <div style={{ color: 'rgba(100, 116, 139, 0.96)', fontSize: 12, fontWeight: 700, lineHeight: 1.5, marginBottom: 4 }}>你选择了</div>
          <div style={{ color: '#1f2937', fontSize: 14, lineHeight: 1.75, fontWeight: 700, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{block.text}</div>
        </div>
      </div>
    );
  }

  const paragraphStyle: CSSProperties = {
    width: '100%',
    maxWidth: maxContentWidth,
    padding: '4px 4px',
    boxSizing: 'border-box',
    fontFamily: storyReaderFontFamily,
    fontSize: storyReaderFontSize,
    lineHeight: storyReaderLineHeight,
    color: '#1f2937',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 24px', width: '100%', boxSizing: 'border-box' }}>
      <div style={paragraphStyle}>{block.text}</div>
    </div>
  );
});

export function buildMessageListRenderItems(params: {
  messages: Message[];
  eventRenderFlags: EventRenderFlags;
  showDeveloperDetails: boolean;
  storyChoiceMessageId?: string | null;
  storyChoiceOptions?: NarrativeStoryChoiceOption[];
}): MessageListRenderItem[] {
  const baseItems = buildChatRenderItems(params.messages)
    .filter((item) => item.renderKind !== 'event' || shouldRenderEventMessage(item.message, params.eventRenderFlags));
  const flattened: MessageListRenderItem[] = [];

  for (const item of baseItems) {
    if (item.renderKind !== 'narrative') {
      flattened.push({
        key: item.key,
        message: item.message,
        sourceItem: item,
        pending: item.pending,
        renderKind: item.renderKind,
      });
      continue;
    }

    const showStoryChoices = item.message.id === params.storyChoiceMessageId
      && (params.storyChoiceOptions?.length ?? 0) > 0;
    const blocks = getVisibleNarrativeDisplayBlocks(item.message, params.showDeveloperDetails);
    if (!blocks.length) {
      if (showStoryChoices) {
        flattened.push({
          key: `${item.key}:story-choice`,
          message: item.message,
          sourceItem: item,
          pending: item.pending,
          renderKind: 'story-choice',
        });
      }
      continue;
    }

    blocks.forEach((block, index) => {
      const blockKey = `${item.key}:block:${block.id || index}`;
      flattened.push({
        key: blockKey,
        message: item.message,
        sourceItem: item,
        pending: item.pending,
        renderKind: 'narrative-block',
        block,
        blockIndex: index,
        completeNarrativeReveal: index === 0,
      });
    });
    if (buildStoryNodeProgress(item.message)) {
      flattened.push({
        key: `${item.key}:story-progress`,
        message: item.message,
        sourceItem: item,
        pending: item.pending,
        renderKind: 'narrative-progress',
      });
    }
    if (showStoryChoices) {
      flattened.push({
        key: `${item.key}:story-choice`,
        message: item.message,
        sourceItem: item,
        pending: item.pending,
        renderKind: 'story-choice',
      });
    }
  }

  return flattened;
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
  onCreateRevision,
  onSwitchRevision,
  branchVersionInfoByMessageId,
  onReachTop,
  onReachBottom,
  onJumpToConversationBottom,
  isLoadingOlder = false,
  isLoadingNewer = false,
  hasMore = false,
  hasMoreNewer = false,
  topHint,
  loadingText,
  topInset,
  bottomInset,
  selfMemberId = null,
  privateConversation = false,
  emptyContent,
  tailContent,
  storyChoiceMessageId = null,
  storyChoiceOptions = [],
  storyChoiceSubmittingValue = null,
  onChooseStoryChoice,
  onBottomPinnedChange,
  onNearBottomChange,
  initialScrollPosition = null,
  scrollRequest = null,
  onScrollRequestResolved,
  onScrollPositionChange,
  narrativeRevealMessageKeys,
  onNarrativeRevealComplete,
  autoStickToBottom = true,
}: MessageListProps) {
  const developerMode = useSettingsStore((state) => state.developerMode);
  const developerUI = useSettingsStore((state) => state.developerUI);
  const eventRenderFlags = useMemo<EventRenderFlags>(() => ({
    developerMode,
    showRelationshipEvents: developerUI.showRelationshipEvents,
    showAffectEvents: developerUI.showAffectEvents,
    showConflictEvents: developerUI.showConflictEvents,
    showStateEvents: developerUI.showStateEvents,
    showMemoryDistillationEvents: developerUI.showMemoryDistillationEvents,
    showCalendarEvents: developerUI.showCalendarEvents,
    showMemoryDebug: developerUI.showMemoryDebug,
    showLocalInterceptionHints: developerUI.showLocalInterceptionHints,
  }), [
    developerMode,
    developerUI.showAffectEvents,
    developerUI.showCalendarEvents,
    developerUI.showConflictEvents,
    developerUI.showLocalInterceptionHints,
    developerUI.showMemoryDebug,
    developerUI.showMemoryDistillationEvents,
    developerUI.showRelationshipEvents,
    developerUI.showStateEvents,
  ]);
  const renderItems = useMemo(() => buildMessageListRenderItems({
    messages,
    eventRenderFlags,
    showDeveloperDetails: developerMode,
    storyChoiceMessageId,
    storyChoiceOptions,
  }), [developerMode, eventRenderFlags, messages, storyChoiceMessageId, storyChoiceOptions]);
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const customBubbleStyles = useSettingsStore((state) => state.customBubbleStyles);
  const storyRevealMode = chatAppearance.storyReader.revealMode;
  const storyReaderFontFamily = useMemo(() => getStoryReaderFontFamily(chatAppearance.storyReader.fontFamily), [chatAppearance.storyReader.fontFamily]);
  const contentMaxWidth = chatAppearance.maxContentWidthUnlimited ? '100%' : chatAppearance.maxContentWidth;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const showJumpToBottomRef = useRef(false);
  const topLoadTriggeredRef = useRef(false);
  const bottomLoadTriggeredRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const lastReportedBottomPinnedRef = useRef<boolean | null>(null);
  const lastReportedNearBottomRef = useRef<boolean | null>(null);
  const hasJumpedToBottomRef = useRef(false);
  const initialScrollPositionRef = useRef(initialScrollPosition);
  const pendingInitialRestoreRef = useRef<MessageListScrollPosition | null>(initialScrollPosition?.pinned ? null : initialScrollPosition);
  const appliedInitialRestoreKeyRef = useRef<string | null>(null);
  const prependRestoreRef = useRef<ScrollAnchorSnapshot | null>(null);
  const bottomRestoreDistanceRef = useRef<number | null>(null);
  const latestScrollAnchorRef = useRef<ScrollAnchorSnapshot | null>(null);
  const autoFillTriggeredRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const hasUserScrollIntentRef = useRef(false);
  const adaptiveBottomPagesRef = useRef(MIN_BOTTOM_PREFETCH_PAGES);
  const lastScrollSampleRef = useRef<{ top: number; at: number } | null>(null);
  const scrollAnchorFrameRef = useRef<number | null>(null);
  const followScrollAnimationRef = useRef<number | null>(null);
  const previousStoryChoiceSubmittingValueRef = useRef<string | null>(storyChoiceSubmittingValue);
  const appliedScrollRequestKeyRef = useRef<string | null>(null);
  const previousRenderMetricsRef = useRef({
    itemCount: renderItems.length,
    lastItemKey: renderItems.at(-1)?.key ?? null,
    lastItemContentLength: renderItems.at(-1)?.message.content.length ?? 0,
    hasTailContent: Boolean(tailContent),
    storyChoiceKey: `${storyChoiceMessageId || ''}:${storyChoiceSubmittingValue || ''}:${storyChoiceOptions.map((option) => option.value).join('|')}`,
  });

  const chatImageTimeline = useMemo(() => buildChatImageTimeline(messages), [messages]);
  const messageVirtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => containerRef.current,
    getItemKey: (index) => renderItems[index]?.key || index,
    estimateSize: () => 108,
    overscan: 2,
  });
  const virtualMessageItems = messageVirtualizer.getVirtualItems();

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
      onCreateRevision={item.pending ? undefined : onCreateRevision}
      onSwitchRevision={item.pending ? undefined : onSwitchRevision}
      branchVersionInfo={branchVersionInfoByMessageId?.[options?.message?.id || item.message.id] || null}
      pending={item.pending}
      selfMemberId={selfMemberId}
      privateConversation={privateConversation}
    />
  ), [branchVersionInfoByMessageId, characters, currentUser, onAnalyzeMessage, onCharacterAvatarClick, onCreateRevision, onDeleteMessage, onExpressionFeedback, onRetryMedia, onSwitchRevision, openChatImage, privateConversation, selfMemberId]);

  const renderMessageItem = useCallback((item: MessageListRenderItem) => {
    const anchorProps = {
      'data-message-id': item.message.id,
      'data-message-client-key': item.message.clientKey || undefined,
      'data-message-server-id': item.message.serverId || undefined,
      'data-scroll-timestamp': String(item.message.timestamp),
    };
    if (item.renderKind === 'system') {
      return <Box key={item.key} {...anchorProps}><SystemMessageItem message={item.message} /></Box>;
    }
    if (item.renderKind === 'event') {
      return <Box key={item.key} {...anchorProps}><EventMessageItem message={item.message} members={characters} /></Box>;
    }
    if (item.renderKind === 'story-choice') {
      return (
        <Box key={item.key} {...anchorProps} sx={{ display: 'grid' }}>
          <Box data-scroll-anchor={`${item.message.id}:story-choice`} data-scroll-timestamp={item.message.timestamp}>
            <StoryChoicePanel options={storyChoiceOptions} onChoose={onChooseStoryChoice} showDeveloperDetails={developerMode} submittingValue={storyChoiceSubmittingValue} />
          </Box>
        </Box>
      );
    }
    if (item.renderKind === 'narrative-progress') {
      return <Box key={item.key} {...anchorProps}><StoryNodeProgressBar message={item.message} /></Box>;
    }
    if (item.renderKind === 'narrative-block') {
      const block = item.block;
      const index = item.blockIndex ?? 0;
      if (!block) return null;
      const recentNarrative = !item.pending && isNarrativeRevealAllowed({ item: item.sourceItem, revealMessageKeys: narrativeRevealMessageKeys });
      const shouldFadeNode = recentNarrative && storyRevealMode === 'fade' && !prefersReducedMotion();
      const character = block.displayMode === 'bubble' ? resolveNarrativeBlockCharacter(block, characters) : undefined;
      if (!item.pending) {
        return (
          <div
            key={item.key}
            {...anchorProps}
            data-scroll-anchor={buildNarrativeBlockScrollAnchor(item.message, block, index)}
            onAnimationEnd={shouldFadeNode && item.completeNarrativeReveal ? () => onNarrativeRevealComplete?.(item.message) : undefined}
            style={{
              display: 'grid',
              ...(shouldFadeNode ? {
                animation: `${storyNodeFadeIn} 220ms ease-out both`,
              } : {}),
            }}
          >
            <LightweightNarrativeBlock
              block={block}
              character={character}
              characters={characters}
              maxContentWidth={contentMaxWidth}
              storyReaderFontFamily={storyReaderFontFamily}
              storyReaderFontSize={chatAppearance.storyReader.fontSize}
              storyReaderLineHeight={chatAppearance.storyReader.lineHeight}
              customBubbleStyles={customBubbleStyles}
              onCharacterAvatarClick={onCharacterAvatarClick}
            />
          </div>
        );
      }
      const blockMessage = buildNarrativeBlockMessage(item.message, block, item.message.metadata?.narrativeTurn, index, character);
      return (
        <Box
          key={item.key}
          {...anchorProps}
          data-scroll-anchor={buildNarrativeBlockScrollAnchor(item.message, block, index)}
          onAnimationEnd={shouldFadeNode && item.completeNarrativeReveal ? () => onNarrativeRevealComplete?.(item.message) : undefined}
          sx={{
            display: 'grid',
            ...(shouldFadeNode ? {
              animation: `${storyNodeFadeIn} 220ms ease-out both`,
            } : {}),
          }}
        >
          {renderBubble(item.sourceItem, {
            key: `${item.key}:bubble`,
            message: blockMessage,
            character: character || (blockMessage.type === 'ai' ? resolveCharacterOrDeleted(characters, blockMessage.senderId, blockMessage.senderName) : undefined),
          })}
        </Box>
      );
    }
    return <Box key={item.key} {...anchorProps}>{renderBubble(item.sourceItem)}</Box>;
  }, [characters, chatAppearance.storyReader.fontSize, chatAppearance.storyReader.lineHeight, contentMaxWidth, customBubbleStyles, developerMode, narrativeRevealMessageKeys, onCharacterAvatarClick, onChooseStoryChoice, onNarrativeRevealComplete, renderBubble, storyChoiceOptions, storyChoiceSubmittingValue, storyReaderFontFamily, storyRevealMode]);

  const topStatusText = useMemo(() => {
    if (messages.length === 0) return null;
    if (hasMore) return isLoadingOlder ? (loadingText || null) : '';
    return topHint || '没有更早的消息';
  }, [hasMore, isLoadingOlder, loadingText, messages.length, topHint]);

  const getDistanceFromBottom = useCallback((element: HTMLDivElement) => (
    element.scrollHeight - element.scrollTop - element.clientHeight
  ), []);

  const shouldShowJumpToBottomButton = useCallback((element: HTMLDivElement) => (
    getDistanceFromBottom(element) > element.clientHeight * JUMP_TO_BOTTOM_PAGE_MULTIPLIER
  ), [getDistanceFromBottom]);

  const updateJumpToBottomVisibility = useCallback((visible: boolean) => {
    if (showJumpToBottomRef.current === visible) return;
    showJumpToBottomRef.current = visible;
    setShowJumpToBottom(visible);
  }, []);

  const getAdaptiveBottomThreshold = useCallback((element: HTMLDivElement) => (
    element.clientHeight * adaptiveBottomPagesRef.current
  ), []);

  const reportNearBottomState = useCallback((element: HTMLDivElement) => {
    const nearBottom = getDistanceFromBottom(element) <= getAdaptiveBottomThreshold(element) && !hasMoreNewer;
    if (lastReportedNearBottomRef.current !== nearBottom) {
      lastReportedNearBottomRef.current = nearBottom;
      onNearBottomChange?.(nearBottom);
    }
    return nearBottom;
  }, [getAdaptiveBottomThreshold, getDistanceFromBottom, hasMoreNewer, onNearBottomChange]);

  const markUserScrollIntent = useCallback(() => {
    hasUserScrollIntentRef.current = true;
  }, []);

  const updateAdaptiveBottomPrefetch = useCallback((element: HTMLDivElement, isScrollingDown: boolean) => {
    if (!hasUserScrollIntentRef.current || !isScrollingDown) return;
    const now = performance.now();
    const previous = lastScrollSampleRef.current;
    lastScrollSampleRef.current = { top: element.scrollTop, at: now };
    if (!previous) return;
    const deltaTop = element.scrollTop - previous.top;
    const deltaTime = Math.max(16, now - previous.at);
    const velocity = deltaTop / deltaTime;
    if (velocity >= 1.2) {
      adaptiveBottomPagesRef.current = MAX_BOTTOM_PREFETCH_PAGES;
    } else if (velocity >= 0.45) {
      adaptiveBottomPagesRef.current = 2;
    } else {
      adaptiveBottomPagesRef.current = MIN_BOTTOM_PREFETCH_PAGES;
    }
  }, []);

  const captureScrollAnchor = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const distanceFromBottom = getDistanceFromBottom(container);
    const scrollAnchorNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-scroll-anchor]'));
    const messageAnchorNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
    const nodes = scrollAnchorNodes.length ? scrollAnchorNodes : messageAnchorNodes;
    const visibleNodes = nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > containerRect.top + 1 && rect.top < containerRect.bottom - 1;
    });
    const candidates = visibleNodes.length ? visibleNodes : nodes;
    const targetLine = distanceFromBottom <= BOTTOM_RESTORE_ANCHOR_THRESHOLD
      ? containerRect.bottom - Math.min(120, containerRect.height * 0.25)
      : containerRect.top + containerRect.height * 0.42;
    const anchorNode = candidates
      .map((node) => ({ node, distance: Math.abs(node.getBoundingClientRect().top - targetLine) }))
      .sort((left, right) => left.distance - right.distance)[0]?.node;
    const messageId = anchorNode ? getElementScrollAnchorId(anchorNode) : '';
    if (!anchorNode || !messageId) return null;
    return {
      messageId,
      offsetTop: anchorNode.getBoundingClientRect().top - containerRect.top,
      sourceTimestamp: getElementScrollTimestamp(anchorNode),
    };
  }, [getDistanceFromBottom]);

  const restoreScrollAnchor = useCallback((snapshot: ScrollAnchorSnapshot & { behavior?: ScrollBehavior }) => {
    const container = containerRef.current;
    if (!container) return false;
    const containerRect = container.getBoundingClientRect();
    const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-message-id]'));
    const target = nodes
      .find((node) => getElementScrollAnchorId(node) === snapshot.messageId);
    const fallbackTarget = target || (snapshot.sourceTimestamp !== undefined
      ? nodes
        .map((node) => ({ node, timestamp: getElementScrollTimestamp(node) }))
        .filter((item): item is { node: HTMLElement; timestamp: number } => item.timestamp !== undefined)
        .sort((left, right) => Math.abs(left.timestamp - snapshot.sourceTimestamp!) - Math.abs(right.timestamp - snapshot.sourceTimestamp!))[0]?.node
      : null);
    if (!fallbackTarget) return false;
    const currentOffset = fallbackTarget.getBoundingClientRect().top - containerRect.top;
    const delta = currentOffset - snapshot.offsetTop;
    if (Math.abs(delta) >= 1) {
      if ('behavior' in snapshot && snapshot.behavior && snapshot.behavior !== 'auto') {
        container.scrollTo({ top: container.scrollTop + delta, behavior: snapshot.behavior });
      } else {
        container.scrollTop += delta;
      }
    }
    lastScrollTopRef.current = container.scrollTop;
    return true;
  }, []);

  const highlightScrollTarget = useCallback((messageId: string) => {
    const container = containerRef.current;
    if (!container) return;
    const target = Array.from(container.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-message-id]'))
      .find((node) => getElementScrollAnchorId(node) === messageId);
    if (!target) return;
    const previousOutline = target.style.outline;
    const previousOutlineOffset = target.style.outlineOffset;
    target.style.outline = '2px solid rgba(59,130,246,0.88)';
    target.style.outlineOffset = '3px';
    window.setTimeout(() => {
      target.style.outline = previousOutline;
      target.style.outlineOffset = previousOutlineOffset;
    }, 1300);
  }, []);

  const getInitialRestoreKey = useCallback((position: MessageListScrollPosition | null) => (
    position && !position.pinned
      ? `${position.messageId}:${Math.round(position.offsetTop)}:${position.sourceTimestamp ?? ''}`
      : null
  ), []);

  useEffect(() => {
    if (hasJumpedToBottomRef.current) return;
    initialScrollPositionRef.current = initialScrollPosition;
    const restoreKey = getInitialRestoreKey(initialScrollPosition);
    if (!restoreKey || appliedInitialRestoreKeyRef.current === restoreKey) return;
    pendingInitialRestoreRef.current = initialScrollPosition;
    logDeveloperDiagnostic('chat-scroll:restore-pending', {
      messageId: initialScrollPosition?.messageId,
      offsetTop: initialScrollPosition?.offsetTop,
      sourceTimestamp: initialScrollPosition?.sourceTimestamp,
      renderItemCount: renderItems.length,
    }, 'info');
  }, [getInitialRestoreKey, initialScrollPosition, renderItems.length]);

  const rememberScrollAnchor = useCallback(() => {
    const snapshot = captureScrollAnchor();
    latestScrollAnchorRef.current = snapshot;
    if (snapshot) {
      onScrollPositionChange?.({
        ...snapshot,
        pinned: shouldStickToBottomRef.current,
      });
    }
    if (isLoadingOlder && snapshot) {
      prependRestoreRef.current = snapshot;
    }
    return snapshot;
  }, [captureScrollAnchor, isLoadingOlder, onScrollPositionChange]);

  const scheduleRememberScrollAnchor = useCallback(() => {
    if (scrollAnchorFrameRef.current != null) return;
    scrollAnchorFrameRef.current = window.requestAnimationFrame(() => {
      scrollAnchorFrameRef.current = null;
      rememberScrollAnchor();
    });
  }, [rememberScrollAnchor]);

  useEffect(() => () => {
    if (scrollAnchorFrameRef.current != null) {
      window.cancelAnimationFrame(scrollAnchorFrameRef.current);
      scrollAnchorFrameRef.current = null;
    }
  }, []);

  const triggerReachBottom = useCallback(() => {
    if (!onReachBottom || isLoadingNewer || !hasMoreNewer || bottomLoadTriggeredRef.current) return;
    const container = containerRef.current;
    bottomRestoreDistanceRef.current = container ? getDistanceFromBottom(container) : null;
    bottomLoadTriggeredRef.current = true;
    void onReachBottom();
  }, [getDistanceFromBottom, hasMoreNewer, isLoadingNewer, onReachBottom]);

  useEffect(() => {
    if (storyRevealMode !== 'instant' || !onNarrativeRevealComplete) return;
    if (!narrativeRevealMessageKeys?.size) return;
    renderItems.forEach((item) => {
      if (item.renderKind === 'narrative-block' && item.completeNarrativeReveal && isNarrativeRevealAllowed({ item: item.sourceItem, revealMessageKeys: narrativeRevealMessageKeys })) {
        onNarrativeRevealComplete(item.message);
      }
    });
  }, [narrativeRevealMessageKeys, onNarrativeRevealComplete, renderItems, storyRevealMode]);

  const updatePinnedState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const distance = getDistanceFromBottom(container);
    const pinned = distance <= BOTTOM_STICKY_THRESHOLD && !hasMoreNewer;
    updateJumpToBottomVisibility(shouldShowJumpToBottomButton(container));
    shouldStickToBottomRef.current = pinned;
    if (lastReportedBottomPinnedRef.current !== pinned) {
      lastReportedBottomPinnedRef.current = pinned;
      onBottomPinnedChange?.(pinned);
    }
    return pinned;
  }, [getDistanceFromBottom, hasMoreNewer, onBottomPinnedChange, shouldShowJumpToBottomButton, updateJumpToBottomVisibility]);

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
    const effectiveBehavior = prefersReducedMotion() || distance > SMOOTH_SCROLL_DISTANCE_LIMIT ? 'auto' : behavior;
    container.scrollTo({ top, behavior: effectiveBehavior });
    shouldStickToBottomRef.current = !hasMoreNewer;
    updateJumpToBottomVisibility(false);
    if (!hasMoreNewer && lastReportedBottomPinnedRef.current !== true) {
      lastReportedBottomPinnedRef.current = true;
      onBottomPinnedChange?.(true);
    }
    if (effectiveBehavior === 'auto') {
      lastScrollTopRef.current = top;
    }
  }, [hasMoreNewer, onBottomPinnedChange, stopFollowScrollAnimation, updateJumpToBottomVisibility]);

  const followScrollToBottom = useCallback((options?: { animate?: boolean }) => {
    const container = containerRef.current;
    if (!container) return;
    stopFollowScrollAnimation();
    const startTop = container.scrollTop;
    const targetTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const distance = targetTop - startTop;
    if (options?.animate === false || prefersReducedMotion() || Math.abs(distance) > SMOOTH_SCROLL_DISTANCE_LIMIT) {
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
    if (autoStickToBottom) return;
    stopFollowScrollAnimation();
    const snapshot = latestScrollAnchorRef.current || captureScrollAnchor();
    latestScrollAnchorRef.current = snapshot;
    shouldStickToBottomRef.current = false;
    const container = containerRef.current;
    if (container) updateJumpToBottomVisibility(shouldShowJumpToBottomButton(container));
    if (lastReportedBottomPinnedRef.current !== false) {
      lastReportedBottomPinnedRef.current = false;
      onBottomPinnedChange?.(false);
    }
  }, [autoStickToBottom, captureScrollAnchor, onBottomPinnedChange, shouldShowJumpToBottomButton, stopFollowScrollAnimation, updateJumpToBottomVisibility]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return undefined;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (!hasJumpedToBottomRef.current) return;
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (shouldStickToBottomRef.current && autoStickToBottom) {
          followScrollToBottom({ animate: false });
          return;
        }
        const snapshot = latestScrollAnchorRef.current;
        if (!snapshot) return;
        restoreScrollAnchor(snapshot);
        lastScrollTopRef.current = containerRef.current?.scrollTop ?? lastScrollTopRef.current;
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [autoStickToBottom, followScrollToBottom, restoreScrollAnchor]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || renderItems.length === 0 || hasJumpedToBottomRef.current) return;
    const initialPosition = initialScrollPositionRef.current;
    if (initialPosition && !initialPosition.pinned) {
      const restored = restoreScrollAnchor(initialPosition);
      if (!restored) {
        pendingInitialRestoreRef.current = initialPosition;
        shouldStickToBottomRef.current = false;
        lastReportedBottomPinnedRef.current = false;
        onBottomPinnedChange?.(false);
        logDeveloperDiagnostic('chat-scroll:initial-restore-miss', {
          messageId: initialPosition.messageId,
          offsetTop: initialPosition.offsetTop,
          sourceTimestamp: initialPosition.sourceTimestamp,
          renderItemCount: renderItems.length,
          firstMessageId: renderItems[0]?.message.id,
          firstTimestamp: renderItems[0]?.message.timestamp,
          lastMessageId: renderItems.at(-1)?.message.id,
          lastTimestamp: renderItems.at(-1)?.message.timestamp,
        }, 'warn');
        return;
      }
      hasJumpedToBottomRef.current = true;
      shouldStickToBottomRef.current = false;
      lastReportedBottomPinnedRef.current = false;
      appliedInitialRestoreKeyRef.current = getInitialRestoreKey(initialPosition);
      pendingInitialRestoreRef.current = null;
      latestScrollAnchorRef.current = initialPosition;
      onBottomPinnedChange?.(false);
      logDeveloperDiagnostic('chat-scroll:initial-restore-hit', {
        messageId: initialPosition.messageId,
        offsetTop: initialPosition.offsetTop,
        sourceTimestamp: initialPosition.sourceTimestamp,
        scrollTop: container.scrollTop,
        renderItemCount: renderItems.length,
      }, 'info');
      const handle = window.requestAnimationFrame(() => {
        restoreScrollAnchor(initialPosition);
        lastScrollTopRef.current = container.scrollTop;
      });
      return () => window.cancelAnimationFrame(handle);
    }
    pendingInitialRestoreRef.current = null;
    scrollToBottom('auto');
    hasJumpedToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
    if (lastReportedBottomPinnedRef.current !== true) {
      lastReportedBottomPinnedRef.current = true;
      onBottomPinnedChange?.(true);
    }
  }, [getInitialRestoreKey, onBottomPinnedChange, renderItems, restoreScrollAnchor, scrollToBottom]);

  useLayoutEffect(() => {
    if (!scrollRequest || appliedScrollRequestKeyRef.current === scrollRequest.key) return;
    const restored = restoreScrollAnchor(scrollRequest);
    appliedScrollRequestKeyRef.current = scrollRequest.key;
    if (!restored) {
      onScrollRequestResolved?.(scrollRequest, false);
      return;
    }
    shouldStickToBottomRef.current = false;
    lastReportedBottomPinnedRef.current = false;
    onBottomPinnedChange?.(false);
    updatePinnedState();
    if (scrollRequest.highlight) highlightScrollTarget(scrollRequest.messageId);
    onScrollRequestResolved?.(scrollRequest, true);
    logDeveloperDiagnostic('chat-scroll:request-hit', {
      messageId: scrollRequest.messageId,
      offsetTop: scrollRequest.offsetTop,
      key: scrollRequest.key,
      renderItemCount: renderItems.length,
    }, 'info');
  }, [highlightScrollTarget, onBottomPinnedChange, onScrollRequestResolved, renderItems.length, restoreScrollAnchor, scrollRequest, updatePinnedState]);

  useLayoutEffect(() => {
    const pending = pendingInitialRestoreRef.current;
    const container = containerRef.current;
    if (!pending || !container || pending.pinned || renderItems.length === 0) return;
    const restoreKey = getInitialRestoreKey(pending);
    if (restoreKey && appliedInitialRestoreKeyRef.current === restoreKey) {
      pendingInitialRestoreRef.current = null;
      return;
    }
    if (!restoreScrollAnchor(pending)) return;
    hasJumpedToBottomRef.current = true;
    shouldStickToBottomRef.current = false;
    lastReportedBottomPinnedRef.current = false;
    appliedInitialRestoreKeyRef.current = restoreKey;
    pendingInitialRestoreRef.current = null;
    latestScrollAnchorRef.current = pending;
    onBottomPinnedChange?.(false);
    updatePinnedState();
    logDeveloperDiagnostic('chat-scroll:deferred-restore-hit', {
      messageId: pending.messageId,
      offsetTop: pending.offsetTop,
      sourceTimestamp: pending.sourceTimestamp,
      scrollTop: container.scrollTop,
      renderItemCount: renderItems.length,
    }, 'info');
  }, [getInitialRestoreKey, onBottomPinnedChange, renderItems, restoreScrollAnchor, updatePinnedState]);

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
    const distance = bottomRestoreDistanceRef.current;
    const container = containerRef.current;
    if (distance == null || !container) return;
    bottomRestoreDistanceRef.current = null;
    const restoreBottomDistance = () => {
      if (distance <= BOTTOM_STICKY_THRESHOLD) {
        scrollToBottom('auto');
        return;
      }
      container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight - distance);
      lastScrollTopRef.current = container.scrollTop;
      updatePinnedState();
    };
    restoreBottomDistance();
    const handle = window.requestAnimationFrame(restoreBottomDistance);
    return () => window.cancelAnimationFrame(handle);
  }, [isLoadingNewer, renderItems, scrollToBottom, updatePinnedState]);

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
    if (!autoStickToBottom) {
      const snapshot = latestScrollAnchorRef.current;
      if (snapshot) {
        restoreScrollAnchor(snapshot);
      }
      return;
    }
    if (!shouldStickToBottomRef.current) return;
    if (!lastReportedBottomPinnedRef.current) return;
    if (
      currentMetrics.itemCount === previousMetrics.itemCount
      && currentMetrics.lastItemContentLength === previousMetrics.lastItemContentLength
      && currentMetrics.lastItemKey === previousMetrics.lastItemKey
      && currentMetrics.hasTailContent === previousMetrics.hasTailContent
      && currentMetrics.storyChoiceKey === previousMetrics.storyChoiceKey
    ) {
      return;
    }

    followScrollToBottom({ animate: false });
  }, [autoStickToBottom, followScrollToBottom, renderItems, restoreScrollAnchor, storyChoiceMessageId, storyChoiceOptions, storyChoiceSubmittingValue, tailContent]);

  useLayoutEffect(() => {
    const previousValue = previousStoryChoiceSubmittingValueRef.current;
    previousStoryChoiceSubmittingValueRef.current = storyChoiceSubmittingValue;
    if (!storyChoiceSubmittingValue || previousValue === storyChoiceSubmittingValue) return;
    if (!autoStickToBottom) return;
    if (!hasJumpedToBottomRef.current) return;
    shouldStickToBottomRef.current = true;
    followScrollToBottom();
  }, [autoStickToBottom, followScrollToBottom, storyChoiceSubmittingValue]);

  useEffect(() => {
    if (!isLoadingOlder) {
      topLoadTriggeredRef.current = false;
      autoFillTriggeredRef.current = false;
    }
  }, [isLoadingOlder]);

  useEffect(() => {
    if (!isLoadingNewer) {
      bottomLoadTriggeredRef.current = false;
    }
  }, [isLoadingNewer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onReachTop || isLoadingOlder || !hasMore || autoFillTriggeredRef.current) return;
    if (container.scrollHeight > container.clientHeight + 1) return;

    prependRestoreRef.current = latestScrollAnchorRef.current || captureScrollAnchor();
    autoFillTriggeredRef.current = true;
    topLoadTriggeredRef.current = true;
    void onReachTop();
  }, [captureScrollAnchor, hasMore, isLoadingOlder, onReachTop, renderItems.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasMoreNewer || isLoadingNewer) return;
    if (container.scrollHeight > container.clientHeight + 1) return;
    triggerReachBottom();
  }, [hasMoreNewer, isLoadingNewer, renderItems.length, triggerReachBottom]);

  return (
    <Box
      ref={containerRef}
      data-chat-message-list
      onWheel={markUserScrollIntent}
      onTouchStart={markUserScrollIntent}
      onPointerDown={markUserScrollIntent}
      onKeyDown={markUserScrollIntent}
      tabIndex={0}
      aria-label="聊天消息列表"
      onScroll={() => {
        const container = containerRef.current;
        if (!container) return;

        const previousScrollTop = lastScrollTopRef.current;
        const isScrollingUp = container.scrollTop < previousScrollTop - 2;
        const isScrollingDown = container.scrollTop > previousScrollTop + 2;
        updateAdaptiveBottomPrefetch(container, isScrollingDown);
        lastScrollTopRef.current = container.scrollTop;
        if (!autoStickToBottom && !hasUserScrollIntentRef.current) {
          shouldStickToBottomRef.current = false;
          updateJumpToBottomVisibility(shouldShowJumpToBottomButton(container));
          if (lastReportedBottomPinnedRef.current !== false) {
            lastReportedBottomPinnedRef.current = false;
            onBottomPinnedChange?.(false);
          }
          scheduleRememberScrollAnchor();
          return;
        }
        if (isScrollingUp) {
          shouldStickToBottomRef.current = false;
          updateJumpToBottomVisibility(shouldShowJumpToBottomButton(container));
          if (hasUserScrollIntentRef.current) reportNearBottomState(container);
          if (lastReportedBottomPinnedRef.current !== false) {
            lastReportedBottomPinnedRef.current = false;
            onBottomPinnedChange?.(false);
          }
        } else {
          updatePinnedState();
          if (hasUserScrollIntentRef.current) reportNearBottomState(container);
        }
        scheduleRememberScrollAnchor();

        const distanceFromBottom = getDistanceFromBottom(container);
        if (autoStickToBottom && distanceFromBottom < getAdaptiveBottomThreshold(container)) {
          triggerReachBottom();
        } else {
          bottomLoadTriggeredRef.current = false;
        }

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
        position: 'relative',
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
        scrollbarGutter: 'stable',
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
        {messages.length === 0 && emptyContent ? emptyContent : null}
        {renderItems.length > 0 ? (
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: `${messageVirtualizer.getTotalSize()}px`,
            }}
          >
            {virtualMessageItems.map((virtualItem) => {
              const item = renderItems[virtualItem.index];
              if (!item) return null;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={messageVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: `${virtualItem.start}px`,
                    left: 0,
                    width: '100%',
                    contain: 'layout paint style',
                  }}
                >
                  {renderMessageItem(item)}
                </div>
              );
            })}
          </div>
        ) : null}
        {isLoadingNewer ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', px: 2, py: 1, minHeight: 34 }}>
            <CircularProgress size={16} thickness={4} sx={{ color: 'text.secondary' }} />
          </Box>
        ) : null}
        {tailContent}
      </Box>
      {showJumpToBottom ? (
        <Fab
          size="small"
          color="primary"
          aria-label="滚动到底部"
          onClick={() => {
            markUserScrollIntent();
            if (onJumpToConversationBottom) {
              void onJumpToConversationBottom();
              return;
            }
            scrollToBottom('smooth');
          }}
          sx={{
            position: 'fixed',
            right: { xs: 16, sm: 24 },
            bottom: { xs: 'calc(104px + env(safe-area-inset-bottom, 0px))', sm: 104 },
            zIndex: 6,
            boxShadow: 4,
          }}
        >
          <KeyboardArrowDownIcon />
        </Fab>
      ) : null}
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
