import { Box, Drawer, SwipeableDrawer, IconButton, Typography, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useCallback, useRef, useState } from 'react';
import { useResponsive } from '../../hooks/useResponsive';
import { useUIStore } from '../../stores/useUIStore';
import { storageKey } from '../../constants/brand';

interface RightPanelProps {
  children: React.ReactNode;
  title?: string;
}

const DEFAULT_PANEL_WIDTH = 360;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 720;
const PANEL_WIDTH_STORAGE_KEY = storageKey('right-panel-width');

function clampPanelWidth(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PANEL_WIDTH;
  const viewportMax = typeof window === 'undefined' ? MAX_PANEL_WIDTH : Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.floor(window.innerWidth * 0.48)));
  return Math.min(viewportMax, Math.max(MIN_PANEL_WIDTH, Math.round(value)));
}

function getInitialPanelWidth() {
  if (typeof localStorage === 'undefined') return DEFAULT_PANEL_WIDTH;
  const stored = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
  return clampPanelWidth(stored || DEFAULT_PANEL_WIDTH);
}

export default function RightPanel({ children, title }: RightPanelProps) {
  const { isMobile, isDesktop } = useResponsive();
  const { rightPanelOpen, setRightPanelOpen } = useUIStore();
  const [panelWidth, setPanelWidth] = useState(getInitialPanelWidth);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const finishResize = useCallback(() => {
    resizeStateRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const state = resizeStateRef.current;
    if (!state) return;
    const nextWidth = clampPanelWidth(state.startWidth + state.startX - event.clientX);
    setPanelWidth(nextWidth);
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(nextWidth));
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = { startX: event.clientX, startWidth: panelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', () => {
      finishResize();
      window.removeEventListener('pointermove', handleResizeMove);
    }, { once: true });
  }, [finishResize, handleResizeMove, panelWidth]);

  const resetPanelWidth = useCallback(() => {
    setPanelWidth(DEFAULT_PANEL_WIDTH);
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(DEFAULT_PANEL_WIDTH));
  }, []);

  // Desktop: permanent panel
  if (isDesktop) {
    return rightPanelOpen ? (
      <Box
        sx={{
          width: panelWidth,
          flexShrink: 0,
          borderLeft: 1,
          borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
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
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧边面板宽度"
          title="拖拽调整宽度，双击恢复默认"
          onPointerDown={startResize}
          onDoubleClick={resetPanelWidth}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 10,
            transform: 'translateX(-5px)',
            cursor: 'col-resize',
            zIndex: 2,
            touchAction: 'none',
            '&::after': {
              content: '""',
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 2,
              transform: 'translateX(-50%)',
              bgcolor: 'transparent',
              transition: 'background-color 120ms ease',
            },
            '&:hover::after': {
              bgcolor: 'primary.main',
            },
          }}
        />
        {title && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.25, py: 1.75 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: 0 }}>
                {title}
              </Typography>
              <IconButton size="small" onClick={() => setRightPanelOpen(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Divider />
          </>
        )}
        <Box sx={{ flex: 1, overflow: 'auto', p: 2.25 }}>{children}</Box>
      </Box>
    ) : null;
  }

  // Mobile: bottom sheet (SwipeableDrawer)
  if (isMobile) {
    return (
      <SwipeableDrawer
        anchor="bottom"
        open={rightPanelOpen}
        onClose={() => setRightPanelOpen(false)}
        onOpen={() => setRightPanelOpen(true)}
        swipeAreaWidth={20}
        sx={{
          '& .MuiDrawer-paper': {
            height: '80vh',
            maxHeight: '80vh',
            borderRadius: '16px 16px 0 0',
            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(13,15,22,0.92)',
            backdropFilter: 'blur(18px)',
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ p: 2.25, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ width: 40, height: 4, bgcolor: 'grey.300', borderRadius: 2, mx: 'auto', mb: 2 }} />
          {title && (
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 800, letterSpacing: 0, mb: 1.25 }}>
              {title}
            </Typography>
          )}
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {children}
          </Box>
        </Box>
      </SwipeableDrawer>
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
          width: DEFAULT_PANEL_WIDTH,
          borderRadius: 0,
        },
      }}
    >
      <Box sx={{ p: 2.25 }}>
        {title && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
                {title}
              </Typography>
              <IconButton size="small" onClick={() => setRightPanelOpen(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Divider sx={{ mb: 2 }} />
          </>
        )}
        {children}
      </Box>
    </Drawer>
  );
}
