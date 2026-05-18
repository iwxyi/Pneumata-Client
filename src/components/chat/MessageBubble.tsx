import { useMemo, useRef, useState } from 'react';
import { Box, Typography, Avatar, Dialog, DialogContent, DialogTitle, Menu, MenuItem, Chip, Tooltip, keyframes } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Message } from '../../types/message';
import type { AICharacter } from '../../types/character';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { buildBubblePreview, resolveCharacterBubbleStyle } from '../../utils/bubbleStyle';
import { isImageAvatar } from '../../utils/avatar';
import { formatTimestamp } from '../../utils/format';
import { parseRuntimeEvent } from '../../services/runtimeEventFactory';
import { buildConflictEventMeta, buildEventDisplayText, buildMemoryDistillationMeta, shouldHideEmptyConflictEvent } from './messageBubbleEventHelpers';

function isConflictDeveloperEvent(eventType: string | undefined) {
  return ['conflict_focus_shift', 'conflict_axis_shift'].includes(String(eventType || ''));
}

function isStateDeveloperEvent(eventType: string | undefined) {
  return ['world_state_shift', 'room_state_snapshot_v2'].includes(String(eventType || ''));
}

function renderMemoryDistillationMeta(payload: { metrics?: unknown }) {
  const meta = buildMemoryDistillationMeta(payload);
  if (!meta) return null;
  return (
    <Box sx={{ mt: 0.75, display: 'grid', gap: 0.5 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{[meta.sourceLabel, meta.ownerLabel, meta.reasonLabel].filter(Boolean).join(' · ')}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{`证据事件 ${meta.evidenceCount} · 合并方式 ${meta.mergeModeLabel}`}</Typography>
      {meta.candidateTexts.length ? <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{meta.candidateTexts.join(' / ')}</Typography> : null}
    </Box>
  );
}

function shouldRenderDeveloperEvent(payload: { eventType?: string }, flags: { showRelationshipEvents: boolean; showAffectEvents: boolean; showConflictEvents: boolean; showStateEvents: boolean; showMemoryDistillationEvents: boolean; showMemoryDebug: boolean }) {
  if (!payload?.eventType) return false;
  if (['group_relationship_shift', 'relationship_shift'].includes(String(payload.eventType))) return flags.showRelationshipEvents;
  if (['speaker_drift_shift', 'speaker_emotion_shift', 'target_emotion_shift'].includes(String(payload.eventType))) return flags.showAffectEvents;
  if (isConflictDeveloperEvent(payload.eventType)) return flags.showConflictEvents;
  if (isStateDeveloperEvent(payload.eventType)) return flags.showStateEvents;
  if (payload.eventType === 'memory_distillation') return flags.showMemoryDistillationEvents || flags.showMemoryDebug;
  return false;
}

function buildEventTypeChip(payload: { eventType?: string }) {
  const eventType = payload.eventType || 'event';
  const config: Record<string, { label: string; color: 'primary' | 'secondary' | 'warning' | 'success' | 'info' | 'error' | 'default' }> = {
    group_relationship_shift: { label: '关系', color: 'secondary' },
    relationship_shift: { label: '关系', color: 'secondary' },
    speaker_drift_shift: { label: '行为', color: 'warning' },
    speaker_emotion_shift: { label: '情绪', color: 'success' },
    target_emotion_shift: { label: '情绪', color: 'success' },
    conflict_focus_shift: { label: '矛盾', color: 'error' },
    conflict_axis_shift: { label: '矛盾', color: 'error' },
    world_state_shift: { label: '态势', color: 'primary' },
    room_state_snapshot_v2: { label: '态势', color: 'primary' },
    memory_distillation: { label: '蒸馏', color: 'info' },
  };
  const item = config[eventType] || { label: '提示', color: 'default' as const };
  return <Chip size="small" label={item.label} color={item.color} variant="outlined" />;
}

function renderConflictEventMeta(payload: { metrics?: unknown }) {
  const metrics = buildConflictEventMeta(payload);
  if (!metrics) return null;
  const items = [
    metrics.type ? `类型：${metrics.type}` : '',
    metrics.stage ? `阶段：${metrics.stage}` : '',
    metrics.severity ? `强度：${metrics.severity}` : '',
    metrics.nextPressure ? `走向：${metrics.nextPressure}` : '',
  ].filter(Boolean);
  if (!items.length && !metrics.hooks.length) return null;
  return (
    <Box sx={{ mt: 0.75, display: 'grid', gap: 0.5 }}>
      {items.length ? <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{items.join(' · ')}</Typography> : null}
      {metrics.hooks.length ? <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{`建议：${metrics.hooks.join(' / ')}`}</Typography> : null}
    </Box>
  );
}

function renderEventBubble(messageId: string, payload: { eventType?: string; title?: string; summary?: string; pair?: string[]; metrics?: unknown }) {
  if (shouldHideEmptyConflictEvent(payload)) return null;
  return (
    <Box data-message-id={messageId} data-message-type="event" sx={{ display: 'flex', justifyContent: 'center', py: 0.5, px: 2, pointerEvents: 'none' }}>
      <Box sx={{ maxWidth: 620, width: 'fit-content', minWidth: 420, px: 1.75, py: 1, bgcolor: 'action.hover', borderRadius: 2, border: '1px solid', borderColor: 'divider', pointerEvents: 'none' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 0.25 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {buildEventDisplayText(payload)}
            </Typography>
          </Box>
          {buildEventTypeChip(payload)}
        </Box>
        {isConflictDeveloperEvent(payload.eventType) ? renderConflictEventMeta(payload) : null}
        {payload.eventType === 'memory_distillation' ? renderMemoryDistillationMeta(payload) : null}
      </Box>
    </Box>
  );
}

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

export default function MessageBubble({ message, character, onDelete, onAnalyze, pending = false }: MessageBubbleProps) {
  const customBubbleStyles = useSettingsStore((state) => state.customBubbleStyles);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const showMemoryDebug = useSettingsStore((state) => state.developerUI.showMemoryDebug);
  const showRelationshipEvents = useSettingsStore((state) => state.developerUI.showRelationshipEvents);
  const showAffectEvents = useSettingsStore((state) => state.developerUI.showAffectEvents);
  const showConflictEvents = useSettingsStore((state) => state.developerUI.showConflictEvents);
  const showStateEvents = useSettingsStore((state) => state.developerUI.showStateEvents);
  const showMemoryDistillationEvents = useSettingsStore((state) => state.developerUI.showMemoryDistillationEvents);
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
      <Box data-message-id={message.id} data-message-type="system" sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
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
    if (!shouldRenderDeveloperEvent(payload, { showRelationshipEvents, showAffectEvents, showConflictEvents, showStateEvents, showMemoryDistillationEvents, showMemoryDebug })) return null;
    return renderEventBubble(message.id, payload);
  }

  const isUser = message.type === 'user' || message.type === 'god';
  const effectiveCharacter = message.type === 'ai' ? character : undefined;
  const resolvedStyle = effectiveCharacter
    ? resolveCharacterBubbleStyle({ bubbleStyle: effectiveCharacter.bubbleStyle, bubbleStyleId: effectiveCharacter.bubbleStyleId, customStyles: customBubbleStyles })
    : null;
  const bubblePreview = resolvedStyle ? buildBubblePreview(resolvedStyle, isUser) : null;
  const avatar = effectiveCharacter?.avatar;
  const wrapperJustify = isUser ? 'flex-end' : 'flex-start';

  return (
    <>
      <Box data-message-id={message.id} data-message-type={message.type} sx={{ display: 'flex', justifyContent: wrapperJustify, px: 2, py: 0.75, gap: 1.25, alignItems: 'flex-end' }}>
        {!isUser ? (
          <Box onClick={handleAvatarClick} sx={{ cursor: message.type === 'ai' && !pending ? 'pointer' : 'default', flexShrink: 0 }}>
            {avatar && isImageAvatar(avatar) ? (
              <Avatar src={avatar} alt={message.senderName} sx={{ width: 38, height: 38 }} />
            ) : (
              <Avatar sx={{ width: 38, height: 38, bgcolor: resolvedStyle?.backgroundColor || 'primary.main' }}>{message.senderName.slice(0, 1)}</Avatar>
            )}
          </Box>
        ) : null}

        <Box sx={{ maxWidth: 'min(78%, 720px)', minWidth: 0, display: 'grid', gap: 0.35 }}>
          <Tooltip title={formatTimestamp(message.timestamp)} placement="top" arrow>
            <Typography variant="caption" sx={{ color: 'text.secondary', px: 0.5, width: 'fit-content' }}>
              {message.senderName}
            </Typography>
          </Tooltip>
          <Box
            {...bubbleHandlers}
            sx={{
              px: 1.4,
              py: 1,
              borderRadius: bubblePreview?.borderRadius || '18px',
              bgcolor: isUser ? 'linear-gradient(135deg, #7dd3fc 0%, #38bdf8 100%)' : (bubblePreview?.background || '#ffffff'),
              color: isUser ? '#0f172a' : (resolvedStyle?.textColor || '#1f2937'),
              border: bubblePreview?.border || '1px solid rgba(15, 23, 42, 0.08)',
              boxShadow: bubblePreview?.boxShadow || '0 8px 24px rgba(15, 23, 42, 0.08)',
            }}
          >
            {pending && !message.content ? renderPendingTypingDots() : renderMessageContent(message)}
          </Box>
        </Box>
      </Box>

      <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{message.senderName}</DialogTitle>
        <DialogContent>{renderMessageContent(message)}</DialogContent>
      </Dialog>

      <Menu
        open={Boolean(menuPosition)}
        onClose={() => setMenuPosition(null)}
        anchorReference="anchorPosition"
        anchorPosition={menuPosition ? { top: menuPosition.mouseY, left: menuPosition.mouseX } : undefined}
      >
        <MenuItem onClick={handleCopy}>复制</MenuItem>
        {onAnalyze ? <MenuItem onClick={handleAnalyze}>AI分析</MenuItem> : null}
        {canDelete ? <MenuItem onClick={handleDelete}>删除</MenuItem> : null}
      </Menu>
    </>
  );
}
