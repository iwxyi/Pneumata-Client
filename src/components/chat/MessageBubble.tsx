import { useMemo, useRef, useState } from 'react';
import { Box, Typography, Avatar, Dialog, DialogContent, DialogTitle, Menu, MenuItem, keyframes } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { buildBubblePreview, resolveCharacterBubbleStyle } from '../../utils/bubbleStyle';
import { isImageAvatar } from '../../utils/avatar';
import { formatTimestamp } from '../../utils/format';
import { formatConflictMetricsForDisplay, formatRuntimeEventText, parseRuntimeEvent } from '../../services/runtimeEventFactory';

interface MessageBubbleProps {
  message: Message;
  character?: AICharacter;
  onDelete?: (id: string) => void;
  onAnalyze?: (message: Message) => void;
  pending?: boolean;
}

interface MenuPosition {
  mouseX: number;
  mouseY: number;
}

const LONG_PRESS_MOVE_THRESHOLD = 12;
const typingBounce = keyframes`
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-4px); opacity: 1; }
`;

function renderMessageContent(message: Message) {
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' }}>
      {message.content}
    </Typography>
  );
}

function renderPendingTypingDots() {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, py: 0.25 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: 'text.disabled',
            animation: `${typingBounce} 1.4s ease-in-out infinite`,
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </Box>
  );
}

function renderConflictEventMeta(payload: { metrics?: unknown }) {
  const metrics = formatConflictMetricsForDisplay(payload.metrics);
  if (!metrics) return null;
  const items = [
    metrics.type ? `类型：${metrics.type}` : '',
    metrics.stage ? `阶段：${metrics.stage}` : '',
    metrics.severity ? `强度：${metrics.severity}` : '',
    metrics.nextPressure ? `走向：${metrics.nextPressure}` : '',
  ].filter(Boolean);
  return (
    <Box sx={{ mt: 0.75, display: 'grid', gap: 0.5 }}>
      {items.length ? <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{items.join(' · ')}</Typography> : null}
      {metrics.hooks.length ? <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{`建议：${metrics.hooks.join(' / ')}`}</Typography> : null}
    </Box>
  );
}

function renderEventBubble(payload: { eventType?: string; title?: string; summary?: string; pair?: string[]; metrics?: unknown }) {
  const displayText = formatRuntimeEventText({
    eventType: payload.eventType || 'event',
    title: payload.title || '事件',
    summary: payload.summary || '',
    pair: payload.pair as [string, string] | undefined,
    metrics: payload.metrics,
  });
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.5, px: 2 }}>
      <Box sx={{ maxWidth: 620, width: 'fit-content', minWidth: 420, px: 1.75, py: 1, bgcolor: 'action.hover', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {displayText}
        </Typography>
        {payload.eventType === 'conflict_focus_shift' ? renderConflictEventMeta(payload) : null}
      </Box>
    </Box>
  );
}

export default function MessageBubble({ message, character, onDelete, onAnalyze, pending = false }: MessageBubbleProps) {
  const customBubbleStyles = useSettingsStore((state) => state.customBubbleStyles);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showRelationshipEvents = useSettingsStore((state) => state.developerUI.showRelationshipEvents);
  const showAffectEvents = useSettingsStore((state) => state.developerUI.showAffectEvents);
  const showConflictEvents = useSettingsStore((state) => state.developerUI.showConflictEvents);
  const navigate = useNavigate();
  const location = useLocation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<MenuPosition | null>(null);
  const canDelete = useMemo(() => !pending && message.type !== 'system' && Boolean(onDelete), [message.type, onDelete, pending]);

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
    await navigator.clipboard.writeText(message.content);
    setMenuPosition(null);
  };

  const handleDelete = () => {
    if (onDelete) onDelete(message.id);
    setMenuPosition(null);
  };

  const handleAnalyze = () => {
    if (onAnalyze) onAnalyze(message);
    setMenuPosition(null);
  };

  const handleAvatarClick = () => {
    if (message.type === 'ai' && !pending) {
      navigate(`/characters/${message.senderId}/edit?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
    }
  };

  const bubbleHandlers = message.type === 'system' || pending
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

  if (message.type === 'system') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic', px: 2, py: 0.5, bgcolor: 'action.hover', borderRadius: 2 }}>
          {message.content}
        </Typography>
      </Box>
    );
  }

  if (message.type === 'event') {
    if (!developerMode) return null;
    const parsed = parseRuntimeEvent(message.content);
    const payload: { eventType?: string; title?: string; summary?: string; pair?: string[]; metrics?: unknown } = parsed || { title: '事件', summary: message.content };
    if (payload?.eventType && !['group_relationship_shift', 'relationship_shift', 'speaker_drift_shift', 'speaker_emotion_shift', 'target_emotion_shift', 'conflict_focus_shift'].includes(String(payload.eventType))) return null;
    if ((payload?.eventType === 'group_relationship_shift' || payload?.eventType === 'relationship_shift') && !showRelationshipEvents) return null;
    if ((payload?.eventType === 'speaker_drift_shift' || payload?.eventType === 'speaker_emotion_shift' || payload?.eventType === 'target_emotion_shift') && !showAffectEvents) return null;
    if (payload?.eventType === 'conflict_focus_shift' && !showConflictEvents) return null;
    return renderEventBubble(payload);
  }

  const isUser = message.type === 'user' || message.type === 'god';

  const isGod = message.type === 'god';
  const senderName = message.senderName || character?.name || '';
  const senderAvatar = character?.avatar || message.senderName.charAt(0);
  const aiBubbleStyle = resolveCharacterBubbleStyle({ bubbleStyle: character?.bubbleStyle, bubbleStyleId: character?.bubbleStyleId, customStyles: customBubbleStyles });
  const aiBubblePreview = buildBubblePreview(aiBubbleStyle);

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-start', mb: 0.75, px: 2, gap: 1 }}>
        {!isUser && (
          <Avatar
            src={!isGod && isImageAvatar(senderAvatar) ? senderAvatar : undefined}
            onClick={handleAvatarClick}
            sx={{
              width: 36,
              height: 36,
              fontSize: '1.2rem',
              bgcolor: 'transparent',
              border: '1px solid',
              borderColor: isGod ? 'warning.main' : 'divider',
              color: 'text.primary',
              flexShrink: 0,
              mt: 0.5,
              cursor: message.type === 'ai' && !pending ? 'pointer' : 'default',
            }}
          >
            {isGod ? '👑' : (isImageAvatar(senderAvatar) ? undefined : senderAvatar)}
          </Avatar>
        )}

        <Box
          sx={{
            maxWidth: '70%',
            minWidth: 0,
            '&:hover .message-timestamp': {
              opacity: 1,
            },
          }}
        >
          {!isUser && (
            <Typography variant="caption" sx={{ color: isGod ? 'warning.main' : 'text.secondary', fontWeight: 600, ml: 1 }}>
              {isGod ? '👑 God Mode' : senderName}
            </Typography>
          )}

          <Box
            {...bubbleHandlers}
            sx={{
              px: 2,
              py: 1,
              borderRadius: isUser ? '18px 18px 6px 18px' : aiBubblePreview.borderRadius,
              bgcolor: isUser
                ? (theme) => theme.palette.mode === 'light' ? '#95ec69' : '#2f8f46'
                : isGod
                  ? 'transparent'
                  : aiBubblePreview.background,
              background: !isUser && !isGod ? aiBubblePreview.background : undefined,
              color: isUser
                ? (theme) => theme.palette.mode === 'light' ? '#111111' : '#f7fff7'
                : isGod
                  ? 'text.primary'
                  : aiBubblePreview.color,
              border: isGod ? '1.5px dashed' : aiBubblePreview.border,
              borderColor: isGod ? 'warning.main' : undefined,
              boxShadow: isGod ? 'none' : aiBubblePreview.boxShadow,
              position: 'relative',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              cursor: pending ? 'default' : 'text',
            }}
          >
            {pending && !message.content ? renderPendingTypingDots() : renderMessageContent(message)}
          </Box>

          <Typography
            variant="caption"
            className="message-timestamp"
            sx={{
              color: 'text.disabled',
              ml: 1,
              mt: 0,
              display: 'block',
              lineHeight: 1.2,
              minHeight: 14,
              opacity: 0,
              transition: 'opacity 120ms ease',
              pointerEvents: 'none',
            }}
          >
            {formatTimestamp(message.timestamp)}
          </Typography>
        </Box>

        {isUser && (
          <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.dark', flexShrink: 0, mt: 0.5 }}>
            U
          </Avatar>
        )}
      </Box>

      <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)} maxWidth="sm" fullWidth>
        <DialogContent>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' }}>
            {message.content}
          </Typography>
        </DialogContent>
      </Dialog>

      <Menu
        open={Boolean(menuPosition)}
        onClose={() => setMenuPosition(null)}
        anchorReference="anchorPosition"
        anchorPosition={menuPosition ? { top: menuPosition.mouseY, left: menuPosition.mouseX } : undefined}
      >
        <MenuItem onClick={handleCopy}>复制</MenuItem>
        <MenuItem onClick={handleAnalyze}>AI分析</MenuItem>
        {canDelete ? <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>删除</MenuItem> : null}
      </Menu>
    </>
  );
}
