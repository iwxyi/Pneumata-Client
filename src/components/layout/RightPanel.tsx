import { Box, Drawer, IconButton, Typography, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useResponsive } from '../../hooks/useResponsive';
import { useUIStore } from '../../stores/useUIStore';
import { storageKey } from '../../constants/brand';
import PaneResizeDivider from './PaneResizeDivider';

interface RightPanelProps {
  children: React.ReactNode;
  title?: string;
  hideMobileTitle?: boolean;
  titleActions?: React.ReactNode;
  desktopMaxWidth?: number;
  desktopViewportRatio?: number;
}

const DEFAULT_PANEL_WIDTH = 360;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 720;
const PANEL_WIDTH_STORAGE_KEY = storageKey('right-panel-width');
type MobileDragInput = 'pointer' | 'touch';
const MOBILE_BACKDROP_MAX_OPACITY = 0.34;
const MOBILE_SHEET_SETTLE_MS = 360;
const MOBILE_SHEET_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const TEMPORARY_PANEL_VIEWPORT_RATIO = 0.82;
const PANEL_OFFSET_VAR = '--pneumata-right-panel-offset';
const PANEL_BACKDROP_OPACITY_VAR = '--pneumata-right-panel-backdrop-opacity';
// 暂时停用移动端底部抽屉：窄窗口统一使用右侧面板，避免与系统底部手势区域冲突。
// 保留原有手势/底部抽屉实现，后续若需要恢复只需切换此开关。
const USE_MOBILE_BOTTOM_SHEET = false;

function clampPanelWidth(value: number, maxWidth = MAX_PANEL_WIDTH, viewportRatio = 0.48) {
  if (!Number.isFinite(value)) return DEFAULT_PANEL_WIDTH;
  const viewportMax = typeof window === 'undefined' ? maxWidth : Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, Math.floor(window.innerWidth * viewportRatio)));
  return Math.min(viewportMax, Math.max(MIN_PANEL_WIDTH, Math.round(value)));
}

function getInitialPanelWidth(maxWidth = MAX_PANEL_WIDTH, viewportRatio = 0.48) {
  if (typeof localStorage === 'undefined') return DEFAULT_PANEL_WIDTH;
  const stored = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
  return clampPanelWidth(stored || DEFAULT_PANEL_WIDTH, maxWidth, viewportRatio);
}

function getMobileSheetTravelDistance() {
  if (typeof window === 'undefined') return 640;
  return Math.max(320, window.innerHeight * 0.8);
}

function setMobileSheetGestureCss(offset: number) {
  if (typeof document === 'undefined') return;
  const travelDistance = getMobileSheetTravelDistance();
  const progress = 1 - Math.min(1, Math.max(0, offset) / travelDistance);
  document.documentElement.style.setProperty(PANEL_OFFSET_VAR, `${Math.max(0, offset)}px`);
  document.documentElement.style.setProperty(PANEL_BACKDROP_OPACITY_VAR, String(MOBILE_BACKDROP_MAX_OPACITY * progress));
}

function clearMobileSheetGestureCss() {
  if (typeof document === 'undefined') return;
  document.documentElement.style.removeProperty(PANEL_OFFSET_VAR);
  document.documentElement.style.removeProperty(PANEL_BACKDROP_OPACITY_VAR);
}

export default function RightPanel({ children, title, hideMobileTitle = false, titleActions, desktopMaxWidth = MAX_PANEL_WIDTH, desktopViewportRatio = 0.48 }: RightPanelProps) {
  const { isMobile, isDesktop } = useResponsive();
  const { rightPanelOpen, rightPanelGestureOffset, rightPanelGestureDragging, setRightPanelOpen, setRightPanelGestureOffset, setRightPanelGestureDragging } = useUIStore(useShallow((state) => ({
    rightPanelOpen: state.rightPanelOpen,
    rightPanelGestureOffset: state.rightPanelGestureOffset,
    rightPanelGestureDragging: state.rightPanelGestureDragging,
    setRightPanelOpen: state.setRightPanelOpen,
    setRightPanelGestureOffset: state.setRightPanelGestureOffset,
    setRightPanelGestureDragging: state.setRightPanelGestureDragging,
  })));
  const activePanelMaxWidth = isDesktop ? desktopMaxWidth : MAX_PANEL_WIDTH;
  const activePanelViewportRatio = isDesktop ? desktopViewportRatio : TEMPORARY_PANEL_VIEWPORT_RATIO;
  const [panelWidth, setPanelWidth] = useState(() => getInitialPanelWidth(activePanelMaxWidth, activePanelViewportRatio));
  const [mobileDragOffset, setMobileDragOffset] = useState(0);
  const [mobileDragging, setMobileDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [mobileSheetMounted, setMobileSheetMounted] = useState(rightPanelOpen);
  const mobileGestureActive = rightPanelGestureOffset !== null;
  const effectiveMobileDragOffset = mobileGestureActive ? rightPanelGestureOffset : mobileDragOffset;
  const shouldControlMobileSheetTransform = rightPanelOpen || mobileSheetMounted || mobileGestureActive || mobileDragging;
  const mobileBackdropOpacity = MOBILE_BACKDROP_MAX_OPACITY * (1 - Math.min(1, effectiveMobileDragOffset / getMobileSheetTravelDistance()));
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const mobileDragRef = useRef<{ startY: number; latestY: number; moved: boolean; input: MobileDragInput } | null>(null);
  const mobileDragMovedRef = useRef(false);
  const mobileCloseTimerRef = useRef<number | null>(null);
  const mobileDragCleanupRef = useRef<(() => void) | null>(null);
  const mobileGestureRafRef = useRef<number | null>(null);
  const pendingMobileGestureOffsetRef = useRef<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const cleanupMobileDragListeners = useCallback(() => {
    mobileDragCleanupRef.current?.();
    mobileDragCleanupRef.current = null;
  }, []);

  const cleanupResizeListeners = useCallback(() => {
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, []);

  const scheduleMobileGestureCss = useCallback((offset: number) => {
    pendingMobileGestureOffsetRef.current = offset;
    if (mobileGestureRafRef.current !== null) return;
    mobileGestureRafRef.current = window.requestAnimationFrame(() => {
      mobileGestureRafRef.current = null;
      const nextOffset = pendingMobileGestureOffsetRef.current;
      if (nextOffset !== null) setMobileSheetGestureCss(nextOffset);
    });
  }, []);

  const resetMobileGestureCss = useCallback(() => {
    pendingMobileGestureOffsetRef.current = null;
    if (mobileGestureRafRef.current !== null) {
      window.cancelAnimationFrame(mobileGestureRafRef.current);
      mobileGestureRafRef.current = null;
    }
    clearMobileSheetGestureCss();
  }, []);

  const finishResize = useCallback(() => {
    resizeStateRef.current = null;
    setResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const state = resizeStateRef.current;
    if (!state) return;
    const nextWidth = clampPanelWidth(state.startWidth + state.startX - event.clientX, activePanelMaxWidth, activePanelViewportRatio);
    setPanelWidth(nextWidth);
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(nextWidth));
  }, [activePanelMaxWidth, activePanelViewportRatio]);

  const handleResizeEnd = useCallback(() => {
    cleanupResizeListeners();
    finishResize();
  }, [cleanupResizeListeners, finishResize]);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = { startX: event.clientX, startWidth: panelWidth };
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeEnd);
    window.addEventListener('pointercancel', handleResizeEnd);
    resizeCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handleResizeEnd);
      window.removeEventListener('pointercancel', handleResizeEnd);
    };
  }, [handleResizeEnd, handleResizeMove, panelWidth]);

  const resetPanelWidth = useCallback(() => {
    const nextWidth = clampPanelWidth(DEFAULT_PANEL_WIDTH, activePanelMaxWidth, activePanelViewportRatio);
    setPanelWidth(nextWidth);
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(nextWidth));
  }, [activePanelMaxWidth, activePanelViewportRatio]);

  useEffect(() => {
    setPanelWidth((current) => clampPanelWidth(current, activePanelMaxWidth, activePanelViewportRatio));
  }, [activePanelMaxWidth, activePanelViewportRatio]);

  useEffect(() => () => {
    cleanupMobileDragListeners();
    cleanupResizeListeners();
    resetMobileGestureCss();
    if (mobileCloseTimerRef.current !== null) {
      window.clearTimeout(mobileCloseTimerRef.current);
    }
  }, [cleanupMobileDragListeners, cleanupResizeListeners, resetMobileGestureCss]);

  useEffect(() => {
    if (!rightPanelOpen) {
      if (rightPanelGestureOffset !== null) {
        setMobileSheetMounted(true);
        return;
      }
      if (mobileCloseTimerRef.current === null) {
        mobileDragRef.current = null;
        mobileDragMovedRef.current = false;
        setMobileDragging(false);
        setMobileSheetMounted(false);
      }
      return;
    }
    if (mobileCloseTimerRef.current !== null) {
      window.clearTimeout(mobileCloseTimerRef.current);
      mobileCloseTimerRef.current = null;
    }
    if (rightPanelGestureOffset === null) resetMobileGestureCss();
    mobileDragRef.current = null;
    mobileDragMovedRef.current = false;
    setMobileDragging(false);
    setMobileDragOffset(0);
    setMobileSheetMounted(true);
  }, [resetMobileGestureCss, rightPanelGestureOffset, rightPanelOpen]);

  const closeMobileSheet = useCallback(() => {
    if (mobileCloseTimerRef.current !== null) {
      window.clearTimeout(mobileCloseTimerRef.current);
      mobileCloseTimerRef.current = null;
    }
    mobileDragRef.current = null;
    mobileDragMovedRef.current = false;
    setRightPanelGestureOffset(null);
    setRightPanelGestureDragging(false);
    setMobileDragging(false);
    const travelDistance = getMobileSheetTravelDistance();
    scheduleMobileGestureCss(travelDistance);
    setMobileDragOffset(travelDistance);
    mobileCloseTimerRef.current = window.setTimeout(() => {
      setRightPanelOpen(false);
      setMobileSheetMounted(false);
      mobileCloseTimerRef.current = null;
      resetMobileGestureCss();
    }, MOBILE_SHEET_SETTLE_MS);
  }, [resetMobileGestureCss, scheduleMobileGestureCss, setRightPanelGestureDragging, setRightPanelGestureOffset, setRightPanelOpen]);

  const startMobileDragCloseAt = useCallback((clientY: number, input: MobileDragInput) => {
    if (mobileDragRef.current && mobileDragRef.current.input !== input) return;
    if (mobileCloseTimerRef.current !== null) {
      window.clearTimeout(mobileCloseTimerRef.current);
      mobileCloseTimerRef.current = null;
    }
    mobileDragMovedRef.current = false;
    mobileDragRef.current = { startY: clientY, latestY: clientY, moved: false, input };
    setMobileDragging(true);
    setMobileDragOffset(0);
    scheduleMobileGestureCss(0);
  }, [scheduleMobileGestureCss]);

  const updateMobileDragCloseAt = useCallback((clientY: number, input: MobileDragInput) => {
    const state = mobileDragRef.current;
    if (!state || state.input !== input) return;
    const deltaY = Math.max(0, clientY - state.startY);
    state.latestY = clientY;
    if (deltaY > 4) {
      state.moved = true;
      mobileDragMovedRef.current = true;
    }
    setMobileDragOffset(deltaY);
    scheduleMobileGestureCss(deltaY);
  }, [scheduleMobileGestureCss]);

  const finishMobileDragCloseAt = useCallback((input: MobileDragInput, event?: React.PointerEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    const state = mobileDragRef.current;
    if (!state || state.input !== input) return;
    cleanupMobileDragListeners();
    mobileDragRef.current = null;
    const deltaY = Math.max(0, state.latestY - state.startY);
    mobileDragMovedRef.current = state.moved;
    const closeThreshold = typeof window === 'undefined' ? 96 : Math.min(160, Math.max(72, window.innerHeight * 0.12));
    if (deltaY > closeThreshold) {
      closeMobileSheet();
      return;
    }
    scheduleMobileGestureCss(0);
    setMobileDragging(false);
    setMobileDragOffset(0);
    window.setTimeout(() => {
      mobileDragMovedRef.current = false;
      resetMobileGestureCss();
    }, MOBILE_SHEET_SETTLE_MS);
  }, [cleanupMobileDragListeners, closeMobileSheet, resetMobileGestureCss, scheduleMobileGestureCss]);

  const startMobileDragClose = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    event.preventDefault();
    event.stopPropagation();
    startMobileDragCloseAt(event.clientY, 'pointer');
    cleanupMobileDragListeners();
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      updateMobileDragCloseAt(moveEvent.clientY, 'pointer');
    };
    const handleEnd = (endEvent: PointerEvent) => {
      endEvent.preventDefault();
      cleanupMobileDragListeners();
      finishMobileDragCloseAt('pointer');
    };
    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleEnd, { passive: false });
    window.addEventListener('pointercancel', handleEnd, { passive: false });
    mobileDragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };
  }, [cleanupMobileDragListeners, finishMobileDragCloseAt, startMobileDragCloseAt, updateMobileDragCloseAt]);

  const startMobileTouchDragClose = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();
    startMobileDragCloseAt(touch.clientY, 'touch');
    cleanupMobileDragListeners();
    const handleMove = (moveEvent: TouchEvent) => {
      const nextTouch = moveEvent.touches[0];
      if (!nextTouch) return;
      moveEvent.preventDefault();
      updateMobileDragCloseAt(nextTouch.clientY, 'touch');
    };
    const handleEnd = (endEvent: TouchEvent) => {
      endEvent.preventDefault();
      cleanupMobileDragListeners();
      finishMobileDragCloseAt('touch');
    };
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd, { passive: false });
    window.addEventListener('touchcancel', handleEnd, { passive: false });
    mobileDragCleanupRef.current = () => {
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [cleanupMobileDragListeners, finishMobileDragCloseAt, startMobileDragCloseAt, updateMobileDragCloseAt]);

  const handleMobileHandleClick = useCallback(() => {
    if (mobileDragMovedRef.current) {
      mobileDragMovedRef.current = false;
      return;
    }
    closeMobileSheet();
  }, [closeMobileSheet]);

  // Desktop: permanent panel
  if (isDesktop) {
    return rightPanelOpen ? (
      <>
      <PaneResizeDivider
        resizing={resizing}
        ariaLabel="调整侧边面板宽度"
        onPointerDown={startResize}
        onDoubleClick={resetPanelWidth}
      />
      <Box
        sx={{
          width: panelWidth,
          flexShrink: 0,
          bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(13,15,22,0.78)',
          backdropFilter: 'blur(18px) saturate(1.12)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.12)',
          boxShadow: (theme) => theme.palette.mode === 'light' ? '-18px 0 48px rgba(15,23,42,0.045)' : '-18px 0 52px rgba(0,0,0,0.24)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            backgroundImage: (theme) => theme.palette.mode === 'light'
              ? 'repeating-linear-gradient(0deg, rgba(15,23,42,0.030) 0 1px, transparent 1px 26px), repeating-linear-gradient(90deg, rgba(15,23,42,0.022) 0 1px, transparent 1px 26px)'
              : 'repeating-linear-gradient(0deg, rgba(226,232,240,0.030) 0 1px, transparent 1px 26px), repeating-linear-gradient(90deg, rgba(226,232,240,0.022) 0 1px, transparent 1px 26px)',
          },
          '& > *': {
            position: 'relative',
            zIndex: 1,
          },
        }}
      >
        {title && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.25, py: 1.75 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: 0 }}>
                {title}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                {titleActions}
                <IconButton size="small" onClick={() => setRightPanelOpen(false)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
            <Divider />
          </>
        )}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', p: 2.25, display: 'flex', flexDirection: 'column' }}>
          {children}
        </Box>
      </Box>
      </>
    ) : null;
  }

  // Mobile: bottom sheet. Use a regular Drawer so vertical scrolling inside the
  // panel is not captured as a swipe-to-close gesture.
  if (USE_MOBILE_BOTTOM_SHEET && isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={rightPanelOpen || mobileSheetMounted || mobileGestureActive}
        onClose={closeMobileSheet}
        transitionDuration={{ enter: MOBILE_SHEET_SETTLE_MS, exit: 0 }}
        ModalProps={{
          keepMounted: true,
          disableAutoFocus: true,
          disableEnforceFocus: true,
          disableRestoreFocus: true,
          disableScrollLock: true,
        }}
        slotProps={{
          backdrop: {
            sx: {
              bgcolor: mobileGestureActive
                ? `rgba(0,0,0,var(${PANEL_BACKDROP_OPACITY_VAR}, ${mobileBackdropOpacity}))`
                : mobileDragging
                  ? `rgba(0,0,0,var(${PANEL_BACKDROP_OPACITY_VAR}, ${mobileBackdropOpacity}))`
                  : `rgba(0,0,0,${mobileBackdropOpacity})`,
              transition: mobileDragging || rightPanelGestureDragging ? 'none' : `background-color ${MOBILE_SHEET_SETTLE_MS}ms ${MOBILE_SHEET_EASING}`,
            },
          },
        }}
        sx={{
          '& .MuiDrawer-paper': {
            height: '80vh',
            maxHeight: '80vh',
            borderRadius: '16px 16px 0 0',
            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(13,15,22,0.92)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            boxShadow: (theme) => theme.palette.mode === 'light' ? '0 -18px 44px rgba(15,23,42,0.10)' : '0 -18px 44px rgba(0,0,0,0.32)',
            contain: 'layout paint',
            overflow: 'hidden',
            transform: shouldControlMobileSheetTransform
              ? mobileGestureActive || mobileDragging
                ? `translate3d(0, var(${PANEL_OFFSET_VAR}, ${effectiveMobileDragOffset}px), 0) !important`
                : `translate3d(0, ${effectiveMobileDragOffset}px, 0) !important`
              : undefined,
            transition: shouldControlMobileSheetTransform
              ? mobileDragging || rightPanelGestureDragging
                ? 'none !important'
                : `transform ${MOBILE_SHEET_SETTLE_MS}ms ${MOBILE_SHEET_EASING} !important`
              : undefined,
            willChange: mobileDragging || mobileGestureActive || effectiveMobileDragOffset > 0 ? 'transform' : 'auto',
          },
        }}
      >
        <Box sx={{
          px: 2.25,
          pt: 1,
          pb: 2.25,
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <Box
            onPointerDown={startMobileDragClose}
            onTouchStart={startMobileTouchDragClose}
            onClick={handleMobileHandleClick}
            role="button"
            aria-label="关闭面板"
            title="向下拖拽或点击关闭"
            draggable={false}
            sx={{
              width: '100%',
              height: 22,
              display: 'grid',
              placeItems: 'center',
              mx: 'auto',
              mb: 0.35,
              touchAction: 'none',
              cursor: 'grab',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              '&:active': {
                cursor: 'grabbing',
              },
            }}
          >
            <Box sx={{
              width: 40,
              height: 4,
              borderRadius: 2,
              bgcolor: (theme) => {
                if (mobileDragging) return theme.palette.mode === 'light' ? 'rgba(15,23,42,0.48)' : 'rgba(226,232,240,0.68)';
                return theme.palette.mode === 'light' ? 'rgba(15,23,42,0.22)' : 'rgba(226,232,240,0.30)';
              },
              transform: mobileDragging ? 'scaleX(1.16)' : 'scaleX(1)',
              transition: 'background-color 140ms ease, transform 140ms ease',
            }} />
          </Box>
          {title && (!hideMobileTitle || titleActions) && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: hideMobileTitle ? 'flex-end' : 'space-between', mb: 1.25, minHeight: 34 }}>
              {!hideMobileTitle ? (
                <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {title}
                </Typography>
              ) : null}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                {titleActions}
                <IconButton size="small" onClick={closeMobileSheet} aria-label="关闭面板">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          )}
          <Box sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            '& > *': { flex: 1, minHeight: 0 },
          }}>
            {children}
          </Box>
        </Box>
      </Drawer>
    );
  }

  // Tablet: right drawer
  return (
    <Drawer
      anchor="right"
      variant="temporary"
      open={rightPanelOpen}
      onClose={() => setRightPanelOpen(false)}
      sx={{
        '& .MuiDrawer-paper': {
          width: panelWidth,
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
        },
      }}
    >
      <PaneResizeDivider
        resizing={resizing}
        ariaLabel="调整侧边面板宽度"
        onPointerDown={startResize}
        onDoubleClick={resetPanelWidth}
      />
      <Box sx={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, p: 2.25, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {title && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
                {title}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                {titleActions}
                <IconButton size="small" onClick={() => setRightPanelOpen(false)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
            <Divider sx={{ mb: 2 }} />
          </>
        )}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {children}
        </Box>
      </Box>
    </Drawer>
  );
}
