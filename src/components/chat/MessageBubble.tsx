import { useMemo, useRef, useState } from 'react';
import { Box, Typography, Avatar, Dialog, DialogContent, DialogTitle, Menu, MenuItem, Tooltip, Divider } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Message, MessageAttachment } from '../../types/message';
import type { AICharacter } from '../../types/character';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { buildBubblePreview, resolveCharacterBubbleStyle } from '../../utils/bubbleStyle';
import { isImageAvatar } from '../../utils/avatar';
import { rememberFailedAvatarUrl, resolveSafeAvatarSrc } from '../../utils/avatarFallback';
import { formatTimestamp } from '../../utils/format';
import { buildGenerationRuntimeDebugRows } from '../../services/generationRuntimePresentation';
import { MessageContent, NarrativeParagraphContent, PendingTypingDots } from './ChatMessageContent';
import DebugChip from '../common/DebugChip';
import AppSnackbar from '../common/AppSnackbar';
import { EXPRESSION_FEEDBACK_MENU_GROUPS, type ExpressionFeedbackKind } from '../../services/characterExpressionFeedback';
import { copyTextToClipboard } from '../../utils/clipboard';
import { getNarrativeDisplayBlocks, isNarrativeParagraphMessage, shouldUseCompactMessageBubble } from './messageBubblePresentation';

interface MessageBubbleProps {
  message: Message;
  character?: AICharacter;
  characters?: AICharacter[];
  onDelete?: (id: string) => void;
  onAnalyze?: (message: Message) => void;
  onExpressionFeedback?: (message: Message, kind: ExpressionFeedbackKind) => void;
  onRetryMedia?: (message: Message, attachmentId: string) => void | Promise<void>;
  onOpenImage?: (message: Message, attachment: MessageAttachment) => void;
  onCharacterAvatarClick?: (character: AICharacter, anchorEl: HTMLElement) => void;
  pending?: boolean;
  currentUser?: { nickname?: string; avatar?: string };
  selfMemberId?: string | null;
  privateConversation?: boolean;
  revealText?: boolean;
  onRevealComplete?: () => void;
}

interface MenuPosition {
  mouseX: number;
  mouseY: number;
}

const LONG_PRESS_MOVE_THRESHOLD = 12;

function buildWithdrawalDebugTitle(withdrawal: NonNullable<Message['metadata']>['withdrawal'] | null) {
  if (!withdrawal?.originalContent) return '';
  return (
    <Box sx={{ maxWidth: 360 }}>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>撤回原文</Typography>
      <Typography variant="caption" sx={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {withdrawal.originalContent}
      </Typography>
      {withdrawal.reason ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.75, opacity: 0.78, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {withdrawal.reason}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function MessageBubble({ message, character, characters = [], onDelete, onAnalyze, onExpressionFeedback, onRetryMedia, onOpenImage, onCharacterAvatarClick, pending = false, currentUser, selfMemberId = null, privateConversation = false, revealText = false, onRevealComplete }: MessageBubbleProps) {
  const customBubbleStyles = useSettingsStore((state) => state.customBubbleStyles);
  const userBubbleStyleId = useSettingsStore((state) => state.userBubbleStyleId);
  const userBubbleStyle = useSettingsStore((state) => state.userBubbleStyle);
  const compactBubbleMode = useSettingsStore((state) => state.compactBubbleMode);
  const compactPrivateBubbleMode = useSettingsStore((state) => state.compactPrivateBubbleMode);
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showMemoryDebug = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showAdvancedRuntimePanels = useSettingsStore((state) => state.developerUI.showAdvancedRuntimePanels);
  const showWithdrawnMessageContent = useSettingsStore((state) => state.developerUI.showWithdrawnMessageContent);
  const navigate = useNavigate();
  const location = useLocation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [feedbackAnchorEl, setFeedbackAnchorEl] = useState<HTMLElement | null>(null);
  const [copyStatus, setCopyStatus] = useState<'success' | 'error' | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<MenuPosition | null>(null);
  const canDelete = useMemo(() => !pending && message.type !== 'system' && Boolean(onDelete), [message.type, onDelete, pending]);
  const canFeedback = useMemo(() => !pending && message.type === 'ai' && Boolean(onExpressionFeedback), [message.type, onExpressionFeedback, pending]);

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const openMenuAt = (x: number, y: number) => {
    if (pending) return;
    setMenuPosition({ mouseX: x, mouseY: y });
  };

  const closeMenus = () => {
    setFeedbackAnchorEl(null);
    setMenuPosition(null);
  };

  const handlePressStart = (x: number, y: number) => {
    clearPressTimer();
    touchStartRef.current = { mouseX: x, mouseY: y };
    pressTimerRef.current = setTimeout(() => openMenuAt(x, y), 450);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const touch = e.touches[0];
    const start = touchStartRef.current;
    if (!touch || !start) return;
    const deltaX = touch.clientX - start.mouseX;
    const deltaY = touch.clientY - start.mouseY;
    if (Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_THRESHOLD) {
      clearPressTimer();
      touchStartRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    clearPressTimer();
    touchStartRef.current = null;
  };

  const handleCopy = async () => {
    const copied = await copyTextToClipboard(message.content);
    closeMenus();
    setCopyStatus(copied ? 'success' : 'error');
  };

  const handleDelete = () => {
    if (onDelete) onDelete(message.id);
    closeMenus();
  };

  const handleAnalyze = () => {
    if (onAnalyze) onAnalyze(message);
    closeMenus();
  };

  const handleExpressionFeedback = (kind: ExpressionFeedbackKind) => {
    if (onExpressionFeedback) onExpressionFeedback(message, kind);
    closeMenus();
  };

  const handleAvatarClick = (event: React.MouseEvent<HTMLElement>) => {
    if (message.type === 'ai' && !pending) {
      if (onCharacterAvatarClick) {
        onCharacterAvatarClick(effectiveCharacter || ({
          id: message.senderId,
          name: message.senderName,
          avatar: '',
        } as AICharacter), event.currentTarget);
        return;
      }
      navigate(`/characters/${message.senderId}/edit?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
    }
  };

  const bubbleHandlers = pending
    ? {}
    : {
        onDoubleClick: () => setViewerOpen(true),
        onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY);
        },
        onMouseDown: clearPressTimer,
        onMouseUp: clearPressTimer,
        onMouseLeave: clearPressTimer,
        onMouseMove: clearPressTimer,
        onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
          const touch = e.touches[0];
          if (touch) handlePressStart(touch.clientX, touch.clientY);
        },
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
        onTouchCancel: handleTouchEnd,
      };

  if (message.isDeleted) return null;

  const manualSpeaker = message.metadata?.manualSpeaker;
  const isManualSpeaker = message.type === 'user' && Boolean(manualSpeaker);
  const isPerspectiveSelf = Boolean(selfMemberId && message.type === 'ai' && message.senderId === selfMemberId);
  const isUser = message.type === 'user' || message.type === 'god' || isPerspectiveSelf;
  const effectiveCharacter = message.type === 'ai' ? character : undefined;
  const resolvedStyle = effectiveCharacter
    ? resolveCharacterBubbleStyle({ bubbleStyle: effectiveCharacter.bubbleStyle, bubbleStyleId: effectiveCharacter.bubbleStyleId, customStyles: customBubbleStyles })
    : null;
  const resolvedUserStyle = isUser && userBubbleStyleId
    ? resolveCharacterBubbleStyle({ bubbleStyle: userBubbleStyle, bubbleStyleId: userBubbleStyleId, customStyles: customBubbleStyles })
    : null;
  const isGuidanceBubble = message.type === 'god';
  const useCompactBubble = shouldUseCompactMessageBubble({
    compactBubbleMode,
    compactPrivateBubbleMode,
    privateConversation,
    selfMemberId,
    isUser,
    isGuidanceBubble,
  });
  const bubblePreview = useCompactBubble
    ? { borderRadius: '18px', background: '#ffffff', color: '#111827', border: '1px solid rgba(15, 23, 42, 0.08)', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' }
    : (resolvedStyle ? buildBubblePreview(resolvedStyle, isUser) : (resolvedUserStyle ? buildBubblePreview(resolvedUserStyle, true) : null));
  const avatar = effectiveCharacter?.avatar;
  const wrapperJustify = isUser ? 'flex-end' : 'flex-start';
  const selfAvatarValue = isPerspectiveSelf ? effectiveCharacter?.avatar?.trim() : (isManualSpeaker ? manualSpeaker?.avatar?.trim() : currentUser?.avatar?.trim());
  const selfAvatarText = (isPerspectiveSelf ? effectiveCharacter?.name : (isManualSpeaker ? manualSpeaker?.actorName : currentUser?.nickname))?.trim() || message.senderName;
  const selfAvatar = selfAvatarValue || selfAvatarText.slice(0, 1);
  const selfAvatarAlt = selfAvatarText || message.senderName;
  const withdrawal = message.metadata?.withdrawal;
  const isFinalWithdrawn = Boolean(withdrawal?.withdrawn && !withdrawal.visiblePending);
  const finalWithdrawal = isFinalWithdrawn ? withdrawal : null;
  const showWithdrawalDebug = developerMode && showWithdrawnMessageContent && Boolean(finalWithdrawal?.originalContent);
  const withdrawalNotice = message.content || `${message.senderName}撤回了一条消息`;
  const withdrawalNoticeNode = (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.25, minWidth: 0 }}>
      <Typography variant="body2" sx={{ color: isUser ? 'rgba(15, 23, 42, 0.72)' : 'text.secondary', fontStyle: 'italic', userSelect: 'text', WebkitUserSelect: 'text', minWidth: 0 }}>
        {withdrawalNotice}
      </Typography>
      {showWithdrawalDebug ? <DebugChip sx={{ height: 20, flexShrink: 0 }} /> : null}
    </Box>
  );
  const useNarrativeParagraph = !isFinalWithdrawn && (!pending || isNarrativeParagraphMessage(message));
  const narrativeParagraphBlocks = useNarrativeParagraph ? getNarrativeDisplayBlocks(message) : [];
  const contentMaxWidth = chatAppearance.maxContentWidthUnlimited ? '100%' : chatAppearance.maxContentWidth;
  if (narrativeParagraphBlocks.length || (pending && useNarrativeParagraph)) {
    const narrativeCharacters = characters.length ? characters : effectiveCharacter ? [effectiveCharacter] : [];
    const storyReaderFontFamily = chatAppearance.storyReader.fontFamily === 'serif'
      ? 'Georgia, "Times New Roman", "Noto Serif SC", "Songti SC", serif'
      : chatAppearance.storyReader.fontFamily === 'sans'
        ? 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : undefined;
    return (
      <>
        <Box data-message-id={message.id} data-message-type={message.type} sx={{ display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 3 }, py: 1.1, width: '100%' }}>
          <Box
            {...bubbleHandlers}
            sx={{
              width: '100%',
              maxWidth: contentMaxWidth,
              px: { xs: 0.5, sm: 1 },
              py: 0.5,
              fontFamily: storyReaderFontFamily,
              fontSize: chatAppearance.storyReader.fontSize,
              lineHeight: chatAppearance.storyReader.lineHeight,
              '& .MuiTypography-root': {
                fontSize: 'inherit',
                lineHeight: 'inherit',
              },
              '& .MuiBox-root': {
                fontSize: 'inherit',
                lineHeight: 'inherit',
              },
            }}
          >
            {narrativeParagraphBlocks.length ? <NarrativeParagraphContent blocks={narrativeParagraphBlocks} characters={narrativeCharacters} reveal={revealText} showDeveloperDetails={developerMode} activeBlockId={revealText ? narrativeParagraphBlocks[0]?.id || null : null} onRevealComplete={() => onRevealComplete?.()} /> : <PendingTypingDots />}
          </Box>
        </Box>
        <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{message.senderName}</DialogTitle>
          <DialogContent><NarrativeParagraphContent blocks={narrativeParagraphBlocks} characters={narrativeCharacters} /></DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Box data-message-id={message.id} data-message-type={message.type} sx={{ display: 'flex', justifyContent: wrapperJustify, px: 2, py: 0.75, gap: 1.25, alignItems: 'flex-start' }}>
        {!isUser ? (
          <Box onClick={handleAvatarClick} sx={{ cursor: message.type === 'ai' && !pending ? 'pointer' : 'default', flexShrink: 0 }}>
            {avatar && isImageAvatar(avatar) ? (
              <Avatar src={resolveSafeAvatarSrc(avatar)} alt={message.senderName} slotProps={{ img: { onError: () => rememberFailedAvatarUrl(avatar) } }} sx={{ width: 38, height: 38 }} />
            ) : (
              <Avatar sx={{ width: 38, height: 38, bgcolor: resolvedStyle?.backgroundColor || 'primary.main' }}>{message.senderName.slice(0, 1)}</Avatar>
            )}
          </Box>
        ) : null}

        <Box sx={{ maxWidth: contentMaxWidth, minWidth: 0, display: 'grid', gap: 0.35, justifyItems: isUser ? 'end' : 'start' }}>
          <Tooltip title={formatTimestamp(message.timestamp)} placement="top" arrow>
            <Typography variant="caption" sx={{ color: 'text.secondary', px: 0.5, width: 'fit-content', textAlign: isUser ? 'right' : 'left' }}>
              {message.senderName}
            </Typography>
          </Tooltip>
          <Box
            {...bubbleHandlers}
            sx={{
              px: 1.4,
              py: 1,
              borderRadius: bubblePreview?.borderRadius || '18px',
              bgcolor: isUser && !bubblePreview ? 'primary.main' : undefined,
              background: bubblePreview?.background || (isUser ? undefined : '#ffffff'),
              color: bubblePreview?.color || (isUser ? 'primary.contrastText' : (resolvedStyle?.textColor || '#1f2937')),
              border: bubblePreview?.border || '1px solid rgba(15, 23, 42, 0.08)',
              boxShadow: bubblePreview?.boxShadow || '0 8px 24px rgba(15, 23, 42, 0.08)',
            }}
          >
            {pending && !message.content ? <PendingTypingDots /> : isFinalWithdrawn ? (
              showWithdrawalDebug ? (
                <Tooltip title={buildWithdrawalDebugTitle(finalWithdrawal)} arrow placement="top" enterTouchDelay={0}>
                  <Box sx={{ cursor: 'help', '&:hover .MuiTypography-root': { textDecoration: 'underline' } }}>
                    {withdrawalNoticeNode}
                  </Box>
                </Tooltip>
              ) : withdrawalNoticeNode
            ) : <MessageContent message={message} onRetryMedia={onRetryMedia} onOpenImage={onOpenImage} revealText={revealText} onRevealComplete={onRevealComplete} />}
          </Box>
        </Box>

        {isUser ? (
          <Box sx={{ flexShrink: 0 }}>
            {selfAvatarValue && isImageAvatar(selfAvatarValue) ? (
              <Avatar src={resolveSafeAvatarSrc(selfAvatarValue)} alt={selfAvatarAlt} slotProps={{ img: { onError: () => rememberFailedAvatarUrl(selfAvatarValue) } }} sx={{ width: 38, height: 38 }} />
            ) : (
              <Avatar sx={{ width: 38, height: 38, bgcolor: 'primary.dark' }}>{selfAvatar}</Avatar>
            )}
          </Box>
        ) : null}
      </Box>

      <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{message.senderName}</DialogTitle>
        <DialogContent><MessageContent message={message} onRetryMedia={onRetryMedia} onOpenImage={onOpenImage} /></DialogContent>
      </Dialog>

      <Menu
        open={Boolean(menuPosition)}
        onClose={closeMenus}
        anchorReference="anchorPosition"
        anchorPosition={menuPosition ? { top: menuPosition.mouseY, left: menuPosition.mouseX } : undefined}
        slotProps={{
          paper: {
            sx: {
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(20,22,30,0.76)',
              backdropFilter: 'blur(24px) saturate(1.18)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.18)',
              border: '1px solid',
              borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.10)' : 'rgba(226,232,240,0.12)',
            },
          },
        }}
      >
        <MenuItem onClick={handleCopy}>复制</MenuItem>
        {onAnalyze ? <MenuItem onClick={handleAnalyze}>AI分析</MenuItem> : null}
        {canFeedback ? (
          <MenuItem
            onMouseEnter={(event) => setFeedbackAnchorEl(event.currentTarget)}
            onClick={(event) => setFeedbackAnchorEl((prev) => prev ? null : event.currentTarget)}
            sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
          >
            <Typography variant="body2">表达反馈</Typography>
            <Typography variant="body2" color="text.secondary">›</Typography>
          </MenuItem>
        ) : null}
        {canDelete ? <MenuItem onClick={handleDelete}>删除</MenuItem> : null}
      </Menu>
      <Menu
        open={Boolean(feedbackAnchorEl)}
        anchorEl={feedbackAnchorEl}
        onClose={() => setFeedbackAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(20,22,30,0.76)',
              backdropFilter: 'blur(24px) saturate(1.18)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.18)',
              border: '1px solid',
              borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.10)' : 'rgba(226,232,240,0.12)',
            },
          },
        }}
      >
        {EXPRESSION_FEEDBACK_MENU_GROUPS.map((group, index) => (
          <Box key={group.key}>
            {index > 0 ? <Divider /> : null}
            <Box sx={{ px: 1.5, py: 0.75 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>{group.title}</Typography>
            </Box>
            {group.items.map((item) => (
              <MenuItem key={item.kind} onClick={() => handleExpressionFeedback(item.kind)}>{item.label}</MenuItem>
            ))}
          </Box>
        ))}
      </Menu>
      <AppSnackbar
        open={Boolean(copyStatus)}
        autoHideDuration={1600}
        severity={copyStatus === 'error' ? 'error' : 'success'}
        message={copyStatus === 'error' ? '复制失败' : '已复制'}
        onClose={() => setCopyStatus(null)}
        offset="composer"
        alertVariant="filled"
      />
    </>
  );
}
