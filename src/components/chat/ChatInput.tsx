import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, TextField, IconButton, Chip, CircularProgress, Tooltip } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/useUIStore';

interface ChatInputProps {
  mode: 'guide' | 'speakAs' | 'memberSpeak';
  characterName?: string;
  onSend: (content: string) => void | Promise<void>;
  onClose?: () => void;
  placeholderOverride?: string;
  sendingLabel?: string;
  onSendError?: (message: string) => void;
  onOpenPanel?: () => void;
}

function getMobilePanelTravelDistance() {
  if (typeof window === 'undefined') return 640;
  return Math.max(320, window.innerHeight * 0.8);
}

const PANEL_OFFSET_VAR = '--pneumata-right-panel-offset';
const PANEL_BACKDROP_OPACITY_VAR = '--pneumata-right-panel-backdrop-opacity';
const PANEL_BACKDROP_MAX_OPACITY = 0.34;
const PANEL_GESTURE_SETTLE_MS = 370;

function setPanelGestureCss(offset: number) {
  if (typeof document === 'undefined') return;
  const travelDistance = getMobilePanelTravelDistance();
  const progress = 1 - Math.min(1, Math.max(0, offset) / travelDistance);
  document.documentElement.style.setProperty(PANEL_OFFSET_VAR, `${Math.max(0, offset)}px`);
  document.documentElement.style.setProperty(PANEL_BACKDROP_OPACITY_VAR, String(PANEL_BACKDROP_MAX_OPACITY * progress));
}

function clearPanelGestureCss() {
  if (typeof document === 'undefined') return;
  document.documentElement.style.removeProperty(PANEL_OFFSET_VAR);
  document.documentElement.style.removeProperty(PANEL_BACKDROP_OPACITY_VAR);
}

export default function ChatInput({ mode, characterName, onSend, onClose, placeholderOverride, sendingLabel, onSendError, onOpenPanel }: ChatInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const { t } = useTranslation();
  const { setRightPanelGestureOffset, setRightPanelGestureDragging } = useUIStore();
  const panelHandleDragRef = useRef<{ startY: number; latestY: number; moved: boolean; lastDirection: 'up' | 'down' | null } | null>(null);
  const textInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const panelGestureTimerRef = useRef<number | null>(null);
  const panelGestureRafRef = useRef<number | null>(null);
  const pendingPanelOffsetRef = useRef<number | null>(null);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || isSending) return;
    setIsSending(true);
    setText('');
    window.requestAnimationFrame(() => {
      textInputRef.current?.focus({ preventScroll: true });
    });
    try {
      await onSend(content);
    } catch (error) {
      setText((current) => current || content);
      const message = error instanceof Error ? error.message : String(error);
      onSendError?.(message || '发送失败，请稍后重试');
    } finally {
      setIsSending(false);
      window.requestAnimationFrame(() => {
        textInputRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  useEffect(() => () => {
    if (panelGestureTimerRef.current !== null) {
      window.clearTimeout(panelGestureTimerRef.current);
    }
    if (panelGestureRafRef.current !== null) {
      window.cancelAnimationFrame(panelGestureRafRef.current);
    }
    clearPanelGestureCss();
  }, []);

  const schedulePanelGestureCss = useCallback((offset: number) => {
    pendingPanelOffsetRef.current = offset;
    if (panelGestureRafRef.current !== null) return;
    panelGestureRafRef.current = window.requestAnimationFrame(() => {
      panelGestureRafRef.current = null;
      const nextOffset = pendingPanelOffsetRef.current;
      if (nextOffset !== null) setPanelGestureCss(nextOffset);
    });
  }, []);

  const placeholder = placeholderOverride || (
    mode === 'speakAs'
      ? t('controls.speakAsPlaceholder', { name: characterName })
      : mode === 'memberSpeak'
        ? t('controls.memberSpeakPlaceholder')
        : t('controls.topicGuidePlaceholder')
  );

  const inputHasTextSelection = useCallback(() => {
    const input = textInputRef.current;
    if (!input) return false;
    return input.selectionStart !== null && input.selectionEnd !== null && input.selectionStart !== input.selectionEnd;
  }, []);

  const startPanelHandleDrag = useCallback((clientY: number) => {
    if (!onOpenPanel || inputFocused || inputHasTextSelection()) {
      panelHandleDragRef.current = null;
      return;
    }
    if (panelGestureTimerRef.current !== null) {
      window.clearTimeout(panelGestureTimerRef.current);
      panelGestureTimerRef.current = null;
    }
    if (panelGestureRafRef.current !== null) {
      window.cancelAnimationFrame(panelGestureRafRef.current);
      panelGestureRafRef.current = null;
    }
    pendingPanelOffsetRef.current = null;
    panelHandleDragRef.current = { startY: clientY, latestY: clientY, moved: false, lastDirection: null };
  }, [inputFocused, inputHasTextSelection, onOpenPanel]);

  const updatePanelHandleDrag = useCallback((clientY: number) => {
    const state = panelHandleDragRef.current;
    if (!state) return;
    if (inputHasTextSelection()) {
      panelHandleDragRef.current = null;
      setRightPanelGestureDragging(false);
      setRightPanelGestureOffset(null);
      clearPanelGestureCss();
      return;
    }
    const stepDeltaY = state.latestY - clientY;
    if (Math.abs(stepDeltaY) > 2) {
      state.lastDirection = stepDeltaY > 0 ? 'up' : 'down';
    }
    state.latestY = clientY;
    const deltaY = state.startY - clientY;
    if (deltaY > 6) {
      if (!state.moved) {
        setRightPanelGestureDragging(true);
        setRightPanelGestureOffset(getMobilePanelTravelDistance());
      }
      state.moved = true;
      schedulePanelGestureCss(Math.max(0, getMobilePanelTravelDistance() - deltaY));
    }
  }, [inputHasTextSelection, schedulePanelGestureCss, setRightPanelGestureDragging, setRightPanelGestureOffset]);

  const finishPanelHandleDrag = useCallback(() => {
    const state = panelHandleDragRef.current;
    panelHandleDragRef.current = null;
    if (!state) return;
    const travelDistance = getMobilePanelTravelDistance();
    const deltaY = state.startY - state.latestY;
    const shouldOpen = state.moved && state.lastDirection === 'up';
    if (shouldOpen) {
      setRightPanelGestureDragging(false);
      setRightPanelGestureOffset(0);
      schedulePanelGestureCss(0);
      onOpenPanel?.();
      panelGestureTimerRef.current = window.setTimeout(() => {
        setRightPanelGestureOffset(null);
        clearPanelGestureCss();
        panelGestureTimerRef.current = null;
      }, PANEL_GESTURE_SETTLE_MS);
      return;
    }
    if (state.moved) {
      setRightPanelGestureDragging(false);
      setRightPanelGestureOffset(travelDistance);
      schedulePanelGestureCss(travelDistance);
      panelGestureTimerRef.current = window.setTimeout(() => {
        setRightPanelGestureOffset(null);
        clearPanelGestureCss();
        panelGestureTimerRef.current = null;
      }, PANEL_GESTURE_SETTLE_MS);
    }
  }, [onOpenPanel, schedulePanelGestureCss, setRightPanelGestureDragging, setRightPanelGestureOffset]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        px: { xs: 1.5, sm: 2 },
        pt: 1.25,
        pb: onOpenPanel ? 'calc(env(safe-area-inset-bottom, 0px) + 7px)' : 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        borderTop: '1px solid',
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
        bgcolor: (theme) => {
          if (isSending) return theme.palette.mode === 'light' ? 'rgba(245,245,247,0.70)' : 'rgba(20,22,30,0.42)';
          return theme.palette.mode === 'light' ? 'rgba(245,245,247,0.68)' : 'rgba(13,15,22,0.42)';
        },
        backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        boxShadow: (theme) => theme.palette.mode === 'light'
          ? '0 -10px 24px rgba(15,23,42,0.035), 0 1px 0 rgba(255,255,255,0.58) inset'
          : '0 -12px 30px rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.09) inset',
        flexShrink: 0,
        opacity: 1,
        pointerEvents: 'auto',
        position: 'relative',
        overflow: 'visible',
        isolation: 'isolate',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          right: 0,
          top: -52,
          height: 52,
          pointerEvents: 'none',
          zIndex: 0,
          backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(34px) saturate(0.78) brightness(1.16) contrast(0.70)' : 'blur(24px) saturate(0.88) brightness(0.82)',
          WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(34px) saturate(0.78) brightness(1.16) contrast(0.70)' : 'blur(24px) saturate(0.88) brightness(0.82)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,0.76), rgba(0,0,0,0.24) 64%, transparent)',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0.76), rgba(0,0,0,0.24) 64%, transparent)',
          background: (theme) => theme.palette.mode === 'light'
            ? 'linear-gradient(rgba(245,245,247,0), rgba(245,245,247,0.24))'
            : 'linear-gradient(rgba(10,10,15,0), rgba(10,10,15,0.18))',
        },
        '& > *': {
          position: 'relative',
          zIndex: 1,
        },
      }}
    >
      <Box
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) startPanelHandleDrag(touch.clientY);
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          if (touch) updatePanelHandleDrag(touch.clientY);
        }}
        onTouchEnd={finishPanelHandleDrag}
        onTouchCancel={finishPanelHandleDrag}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch') return;
          startPanelHandleDrag(event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'touch') return;
          updatePanelHandleDrag(event.clientY);
        }}
        onPointerUp={(event) => {
          if (event.pointerType === 'touch') return;
          finishPanelHandleDrag();
        }}
        onPointerCancel={(event) => {
          if (event.pointerType === 'touch') return;
          finishPanelHandleDrag();
        }}
        sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, width: '100%', touchAction: 'pan-y' }}
      >
        {mode === 'speakAs' && onClose ? (
          <Chip
            label={characterName}
            onDelete={onClose}
            deleteIcon={<CloseIcon fontSize="small" />}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ flexShrink: 0 }}
          />
        ) : null}
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          inputRef={textInputRef}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2.5,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.060)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              '& fieldset': {
                borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.09)' : 'rgba(226,232,240,0.11)',
              },
            },
          }}
        />
        <Tooltip title={isSending ? (sendingLabel || '等待角色发言结束') : ''} disableHoverListener={!isSending} arrow>
          <span>
            <IconButton
              color="primary"
              onClick={() => void handleSend()}
              onMouseDown={(event) => event.preventDefault()}
              disabled={!text.trim() || isSending}
              sx={{
                flexShrink: 0,
                width: 42,
                height: 42,
                bgcolor: text.trim() && !isSending ? 'primary.main' : 'action.hover',
                color: text.trim() && !isSending ? 'primary.contrastText' : 'text.disabled',
                boxShadow: text.trim() && !isSending ? '0 10px 24px rgba(15,23,42,0.18)' : 'none',
                '&:hover': {
                  bgcolor: text.trim() && !isSending ? 'primary.dark' : 'action.hover',
                },
              }}
            >
              {isSending ? <CircularProgress size={22} /> : <SendIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {onOpenPanel ? (
        <Box
          role="button"
          aria-label="打开会话面板"
          title="点击或向上拖拽打开会话面板"
          onClick={() => onOpenPanel()}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (touch) startPanelHandleDrag(touch.clientY);
          }}
          onTouchMove={(event) => {
            const touch = event.touches[0];
            if (touch) updatePanelHandleDrag(touch.clientY);
          }}
          onTouchEnd={finishPanelHandleDrag}
          onTouchCancel={finishPanelHandleDrag}
          onPointerDown={(event) => {
            if (event.pointerType === 'touch') return;
            startPanelHandleDrag(event.clientY);
          }}
          onPointerMove={(event) => {
            if (event.pointerType === 'touch') return;
            updatePanelHandleDrag(event.clientY);
          }}
          onPointerUp={(event) => {
            if (event.pointerType === 'touch') return;
            finishPanelHandleDrag();
          }}
          onPointerCancel={(event) => {
            if (event.pointerType === 'touch') return;
            finishPanelHandleDrag();
          }}
          sx={{
            width: '100%',
            height: 18,
            display: 'grid',
            placeItems: 'center',
            mt: 0.2,
            cursor: 'grab',
            touchAction: 'none',
            '&:active': {
              cursor: 'grabbing',
            },
          }}
        >
          <Box
            sx={{
              width: 42,
              height: 4,
              borderRadius: 2,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.22)' : 'rgba(226,232,240,0.28)',
              boxShadow: (theme) => theme.palette.mode === 'light' ? '0 1px 0 rgba(255,255,255,0.70)' : '0 1px 0 rgba(255,255,255,0.08)',
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}
