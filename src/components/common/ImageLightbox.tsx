import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';

export interface LightboxImageItem {
  key?: string;
  src: string;
  fullSrc?: string;
  alt?: string;
}

interface ImageLightboxProps {
  open: boolean;
  images: LightboxImageItem[];
  index: number;
  onIndexChange: (index: number) => void;
  resolveImageSrc?: (src: string) => Promise<string | undefined>;
  onReachStart?: () => void | Promise<void>;
  reachStartVersion?: string | number;
  maxReachStartAttempts?: number;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 54;

export default function ImageLightbox({ open, images, index, onIndexChange, resolveImageSrc, onReachStart, reachStartVersion, maxReachStartAttempts = 20, onClose }: ImageLightboxProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const [resolvedActiveSrc, setResolvedActiveSrc] = useState<{ request: string; src: string } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const lastWheelSwitchAtRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const safeIndex = images.length ? Math.min(Math.max(index, 0), images.length - 1) : 0;
  const activeImage = images[safeIndex];
  const activeSrcRequest = activeImage?.fullSrc || activeImage?.src || '';
  const activeSrc = resolvedActiveSrc?.request === activeSrcRequest ? resolvedActiveSrc.src : activeSrcRequest;
  const hasMultiple = images.length > 1;
  const canGoPrev = hasMultiple && safeIndex > 0;
  const canGoNext = hasMultiple && safeIndex < images.length - 1;
  const reachStartTokenRef = useRef<string | null>(null);
  const reachStartAttemptsRef = useRef(0);

  const goPrev = useCallback(() => {
    if (!hasMultiple) return;
    if (!canGoPrev) return;
    onIndexChange(safeIndex - 1);
  }, [canGoPrev, hasMultiple, onIndexChange, safeIndex]);

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    onIndexChange(safeIndex + 1);
  }, [canGoNext, onIndexChange, safeIndex]);

  const handleKeyDown = useCallback((event: KeyboardEvent | React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrev();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
    }
  }, [goNext, goPrev, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => containerRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) {
      reachStartTokenRef.current = null;
      reachStartAttemptsRef.current = 0;
      return;
    }
    if (!activeImage || safeIndex !== 0 || !onReachStart) return;
    if (reachStartAttemptsRef.current >= maxReachStartAttempts) return;
    const token = `${reachStartVersion ?? 'static'}:${images.length}:${activeImage.key || activeImage.fullSrc || activeImage.src}`;
    if (reachStartTokenRef.current === token) return;
    reachStartTokenRef.current = token;
    reachStartAttemptsRef.current += 1;
    void onReachStart?.();
  }, [activeImage, images.length, maxReachStartAttempts, onReachStart, open, reachStartVersion, safeIndex]);

  useEffect(() => {
    if (!open) {
      pointerStartRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !activeSrcRequest || !resolveImageSrc) return undefined;
    let active = true;
    void resolveImageSrc(activeSrcRequest).then((resolved) => {
      if (active && resolved) setResolvedActiveSrc({ request: activeSrcRequest, src: resolved });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activeSrcRequest, open, resolveImageSrc]);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!hasMultiple) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.3) return;
    setDragOffset(Math.max(-120, Math.min(120, deltaX)));
  };

  const finishPointerGesture = (event: React.PointerEvent<HTMLElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    pointerStartRef.current = null;
    const offset = dragOffset;
    setDragOffset(0);
    if (offset <= -SWIPE_THRESHOLD) goNext();
    if (offset >= SWIPE_THRESHOLD) goPrev();
  };

  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (!hasMultiple || Math.abs(event.deltaX) < Math.max(40, Math.abs(event.deltaY) * 1.5)) return;
    const now = Date.now();
    if (now - lastWheelSwitchAtRef.current < 360) return;
    lastWheelSwitchAtRef.current = now;
    if (event.deltaX > 0) goNext();
    if (event.deltaX < 0) goPrev();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen
      slotProps={{
        paper: {
          sx: {
            m: 0,
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            maxHeight: 'none',
            bgcolor: 'rgba(5,7,10,0.94)',
            boxShadow: 'none',
            overflow: 'hidden',
          },
        },
      }}
    >
      <Box
        ref={containerRef}
        tabIndex={-1}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={finishPointerGesture}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        sx={{
          position: 'relative',
          width: '100%',
          height: '100dvh',
          maxWidth: '100%',
          boxSizing: 'border-box',
          display: 'grid',
          placeItems: 'center',
          p: { xs: 1.5, sm: 3 },
          outline: 'none',
          touchAction: hasMultiple ? 'pan-y pinch-zoom' : 'pinch-zoom',
          overflow: 'hidden',
        }}
      >
        <IconButton
          aria-label="关闭图片"
          onClick={onClose}
          sx={{ position: 'absolute', top: { xs: 10, sm: 18 }, right: { xs: 10, sm: 18 }, zIndex: 2, color: 'common.white', bgcolor: 'rgba(255,255,255,0.10)', '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' } }}
        >
          <CloseIcon />
        </IconButton>

        {hasMultiple ? (
          <Box
            component="button"
            type="button"
            aria-label="上一张图片"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              goPrev();
            }}
            sx={{
              position: 'absolute',
              inset: '0 auto 0 0',
              zIndex: 2,
              width: { xs: 68, sm: 112, md: 148 },
              p: 0,
              border: 0,
              bgcolor: 'transparent',
              cursor: canGoPrev ? 'pointer' : 'default',
              opacity: canGoPrev ? 1 : 0.28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              pl: { xs: 1, sm: 2 },
              '&:hover .lightbox-edge-icon': canGoPrev ? { bgcolor: 'rgba(255,255,255,0.20)' } : {},
            }}
          >
            <IconButton
              className="lightbox-edge-icon"
              tabIndex={-1}
              sx={{ color: 'common.white', bgcolor: 'rgba(255,255,255,0.10)', pointerEvents: 'none' }}
            >
              <ChevronLeftIcon />
            </IconButton>
          </Box>
        ) : null}

        {activeImage ? (
          <Box
            component="img"
            src={activeSrc}
            alt={activeImage.alt || ''}
            draggable={false}
            sx={{
              maxWidth: '100%',
              maxHeight: '88vh',
              objectFit: 'contain',
              userSelect: 'none',
              transform: `translateX(${dragOffset}px)`,
              transition: dragOffset ? 'none' : 'transform 160ms ease',
            }}
          />
        ) : null}

        {hasMultiple ? (
          <Box
            component="button"
            type="button"
            aria-label="下一张图片"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              goNext();
            }}
            sx={{
              position: 'absolute',
              inset: '0 0 0 auto',
              zIndex: 2,
              width: { xs: 68, sm: 112, md: 148 },
              p: 0,
              border: 0,
              bgcolor: 'transparent',
              cursor: canGoNext ? 'pointer' : 'default',
              opacity: canGoNext ? 1 : 0.28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              pr: { xs: 1, sm: 2 },
              '&:hover .lightbox-edge-icon': canGoNext ? { bgcolor: 'rgba(255,255,255,0.20)' } : {},
            }}
          >
            <IconButton
              className="lightbox-edge-icon"
              tabIndex={-1}
              sx={{ color: 'common.white', bgcolor: 'rgba(255,255,255,0.10)', pointerEvents: 'none' }}
            >
              <ChevronRightIcon />
            </IconButton>
          </Box>
        ) : null}

        {hasMultiple ? (
          <Typography variant="caption" sx={{ position: 'absolute', bottom: { xs: 14, sm: 20 }, color: 'rgba(255,255,255,0.76)' }}>
            {safeIndex + 1} / {images.length}
          </Typography>
        ) : null}
      </Box>
    </Dialog>
  );
}
