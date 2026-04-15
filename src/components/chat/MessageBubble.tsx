import { useMemo, useRef, useState } from 'react';
import { Box, Typography, Avatar, Dialog, DialogContent, Menu, MenuItem } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import type { Message } from '../../types/message';
import { formatTimestamp } from '../../utils/format';

interface MessageBubbleProps {
  message: Message;
  avatar?: string;
  onDelete?: (id: string) => void;
}

interface MenuPosition {
  mouseX: number;
  mouseY: number;
}

const LONG_PRESS_MOVE_THRESHOLD = 12;

export default function MessageBubble({ message, avatar, onDelete }: MessageBubbleProps) {
  const navigate = useNavigate();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<MenuPosition | null>(null);
  const canDelete = useMemo(() => message.type !== 'system' && Boolean(onDelete), [message.type, onDelete]);

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const openMenuAt = (x: number, y: number) => {
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

  const handleTouchCancel = () => {
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

  const handleAvatarClick = () => {
    if (message.type === 'ai') {
      navigate(`/characters?edit=${message.senderId}`);
    }
  };

  const bubbleHandlers = message.type === 'system'
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
        onTouchCancel: handleTouchCancel,
      };

  if (message.isDeleted) return null;

  if (message.type === 'system') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontStyle: 'italic', px: 2, py: 0.5, bgcolor: 'action.hover', borderRadius: 2 }}
        >
          {message.content}
        </Typography>
      </Box>
    );
  }

  const isUser = message.type === 'user' || message.type === 'god';
  const isGod = message.type === 'god';

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          alignItems: 'flex-start',
          mb: 1.5,
          px: 2,
          gap: 1,
        }}
      >
        {!isUser && (
          <Avatar
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
              cursor: message.type === 'ai' ? 'pointer' : 'default',
            }}
          >
            {isGod ? '👑' : avatar || message.senderName.charAt(0)}
          </Avatar>
        )}

        <Box sx={{ maxWidth: '70%', minWidth: 0 }}>
          {!isUser && (
            <Typography
              variant="caption"
              sx={{
                color: isGod ? 'warning.main' : 'text.secondary',
                fontWeight: 600,
                ml: 1,
              }}
            >
              {isGod ? '👑 God Mode' : message.senderName}
            </Typography>
          )}

          <Box
            {...bubbleHandlers}
            sx={{
              px: 2,
              py: 1,
              borderRadius: isUser ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
              bgcolor: isUser
                ? (theme) => theme.palette.mode === 'light' ? '#95ec69' : '#2f8f46'
                : isGod
                  ? 'transparent'
                  : (theme) => theme.palette.mode === 'light' ? '#ffffff' : '#1f1f1f',
              color: isUser
                ? (theme) => theme.palette.mode === 'light' ? '#111111' : '#f7fff7'
                : isGod
                  ? 'text.primary'
                  : (theme) => theme.palette.mode === 'light' ? '#111111' : '#f5f5f5',
              border: isGod ? '1.5px dashed' : '1px solid',
              borderColor: isGod
                ? 'warning.main'
                : (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
              boxShadow: isGod ? 'none' : (theme) => theme.palette.mode === 'light' ? '0 1px 2px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.35)',
              position: 'relative',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              cursor: 'text',
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' }}>
              {message.content}
            </Typography>
          </Box>

          <Typography
            variant="caption"
            sx={{ color: 'text.disabled', ml: 1, mt: 0.25, display: 'block' }}
          >
            {formatTimestamp(message.timestamp)}
          </Typography>
        </Box>

        {isUser && (
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: 'primary.dark',
              flexShrink: 0,
              mt: 0.5,
            }}
          >
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
        {canDelete ? <MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>删除</MenuItem> : null}
      </Menu>
    </>
  );
}
