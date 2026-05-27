import { Box } from '@mui/material';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { storageKey } from '../../constants/brand';
import { PaneLayoutProvider } from './PaneLayoutContext';
import { LayoutHeaderActionsContext } from './AppLayoutContext';
import GlassHeader, { GLASS_HEADER_HEIGHT } from './GlassHeader';
import { useAutoHideHeader } from '../../hooks/useAutoHideHeader';
import { DETAIL_COLLAPSED_CHANGE_EVENT, DETAIL_COLLAPSED_STORAGE_KEY, readDetailCollapsedState, writeDetailCollapsedState } from './masterDetailState';
import { motion, transition } from '../../styles/motion';

const MIN_MASTER_WIDTH = 320;
const DEFAULT_MASTER_WIDTH = 430;
const MAX_MASTER_WIDTH = 720;
const MIN_DETAIL_WIDTH = 240;
const DIVIDER_WIDTH = 12;
const DIVIDER_LAYOUT_WIDTH = 1;
const MASTER_WIDTH_STORAGE_KEY = storageKey('master-detail-master-width');

function clampMasterWidth(value: number, containerWidth?: number | null) {
  if (!Number.isFinite(value)) return DEFAULT_MASTER_WIDTH;
  const baseWidth = containerWidth || (typeof window === 'undefined' ? 0 : window.innerWidth);
  const detailAwareMax = baseWidth > 0 ? Math.max(MIN_MASTER_WIDTH, baseWidth - DIVIDER_LAYOUT_WIDTH - MIN_DETAIL_WIDTH) : MAX_MASTER_WIDTH;
  const viewportMax = typeof window === 'undefined'
    ? MAX_MASTER_WIDTH
    : Math.max(MIN_MASTER_WIDTH, Math.min(MAX_MASTER_WIDTH, detailAwareMax));
  return Math.min(viewportMax, Math.max(MIN_MASTER_WIDTH, Math.round(value)));
}

function getInitialMasterWidth() {
  if (typeof localStorage === 'undefined') return DEFAULT_MASTER_WIDTH;
  const stored = Number(localStorage.getItem(MASTER_WIDTH_STORAGE_KEY));
  return clampMasterWidth(stored || DEFAULT_MASTER_WIDTH);
}

function PaneShell({ role, title, children }: { role: 'master' | 'detail'; title: ReactNode | null; children: ReactNode }) {
  const [headerTitle, setHeaderTitleState] = useState<ReactNode | null>(null);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const resolvedTitle = headerTitle ?? title;
  const showHeader = resolvedTitle != null || headerActions != null;
  const autoHide = useAutoHideHeader(!showHeader);

  const contextValue = useMemo(() => ({
    setHeaderActions,
    setHeaderTitle: (nextTitle: ReactNode | null) => setHeaderTitleState(nextTitle),
    setHeaderBackAction: () => undefined,
    setHideMobileBottomNav: () => undefined,
  }), []);

  return (
    <LayoutHeaderActionsContext.Provider value={contextValue}>
      <PaneLayoutProvider role={role}>
        <Box
          sx={{
            height: '100%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            overflow: 'hidden',
            '--app-floating-tab-top': '10px',
          }}
        >
          {showHeader ? (
            <Box
              sx={{
                flexShrink: 0,
                height: autoHide.hidden ? 0 : GLASS_HEADER_HEIGHT,
                overflow: 'hidden',
                transition: 'height 260ms cubic-bezier(0.2, 0, 0, 1)',
              }}
            >
              <GlassHeader title={resolvedTitle} actions={headerActions} hidden={autoHide.hidden} overlay={false} zIndex={1} />
            </Box>
          ) : null}
          <Box
            onScroll={(event) => autoHide.handleScrollTop(event.currentTarget.scrollTop)}
            sx={{ flex: 1, minHeight: 0, overflow: 'auto', scrollbarGutter: 'stable' }}
          >
            {children}
          </Box>
        </Box>
      </PaneLayoutProvider>
    </LayoutHeaderActionsContext.Provider>
  );
}

export default function MasterDetailLayout({
  master,
  detail,
  masterTitle,
  detailTitle,
  fallback = 'detail',
}: {
  master: ReactNode;
  detail: ReactNode;
  masterTitle: ReactNode;
  detailTitle: ReactNode | null;
  fallback?: 'master' | 'detail';
}) {
  const isThreeColumn = useMediaQuery('(min-width:1280px)');
  const [masterWidth, setMasterWidth] = useState(getInitialMasterWidth);
  const [detailCollapsed, setDetailCollapsed] = useState(readDetailCollapsedState);
  const [resizing, setResizing] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; containerWidth: number } | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const updateWidth = () => setContainerWidth(Math.round(element.getBoundingClientRect().width));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncDetailCollapsed = () => setDetailCollapsed(readDetailCollapsedState());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === DETAIL_COLLAPSED_STORAGE_KEY) syncDetailCollapsed();
    };
    window.addEventListener(DETAIL_COLLAPSED_CHANGE_EVENT, syncDetailCollapsed);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(DETAIL_COLLAPSED_CHANGE_EVENT, syncDetailCollapsed);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const finishResize = useCallback(() => {
    resizeRef.current = null;
    setResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const state = resizeRef.current;
    if (!state) return;
    const availableWidth = Math.max(MIN_MASTER_WIDTH, state.containerWidth - DIVIDER_LAYOUT_WIDTH);
    const rawWidth = Math.max(MIN_MASTER_WIDTH, Math.min(availableWidth, state.startWidth + event.clientX - state.startX));
    const nextDetailWidth = availableWidth - rawWidth;
    if (nextDetailWidth < MIN_DETAIL_WIDTH) {
      setDetailCollapsed(true);
      writeDetailCollapsedState(true);
      return;
    }
    const nextWidth = clampMasterWidth(rawWidth, state.containerWidth);
    setDetailCollapsed(false);
    setMasterWidth(nextWidth);
    localStorage.setItem(MASTER_WIDTH_STORAGE_KEY, String(nextWidth));
    writeDetailCollapsedState(false);
  }, []);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const width = containerWidth || rootRef.current?.getBoundingClientRect().width || window.innerWidth;
    const startWidth = detailCollapsed ? Math.max(MIN_MASTER_WIDTH, width - DIVIDER_LAYOUT_WIDTH) : masterWidth;
    resizeRef.current = { startX: event.clientX, startWidth, containerWidth: width };
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', () => {
      finishResize();
      window.removeEventListener('pointermove', handleResizeMove);
    }, { once: true });
  }, [containerWidth, detailCollapsed, finishResize, handleResizeMove, masterWidth]);

  const openDefaultDetail = useCallback(() => {
    const width = containerWidth || rootRef.current?.getBoundingClientRect().width || window.innerWidth;
    const nextWidth = clampMasterWidth(DEFAULT_MASTER_WIDTH, width);
    setMasterWidth(nextWidth);
    setDetailCollapsed(false);
    localStorage.setItem(MASTER_WIDTH_STORAGE_KEY, String(nextWidth));
    writeDetailCollapsedState(false);
  }, [containerWidth]);

  useEffect(() => () => finishResize(), [finishResize]);

  if (!isThreeColumn) return <>{fallback === 'master' ? master : detail}</>;

  const divider = (
    <Box
      onDoubleClick={openDefaultDetail}
      aria-label={detailCollapsed ? '拖动展开右侧列' : '拖动调整列宽'}
      sx={{
        width: DIVIDER_LAYOUT_WIDTH,
        flex: `0 0 ${DIVIDER_LAYOUT_WIDTH}px`,
        alignSelf: 'stretch',
        cursor: 'col-resize',
        zIndex: 2,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        position: 'relative',
        touchAction: 'none',
        bgcolor: 'transparent',
      }}
    >
      <Box
        onPointerDown={startResize}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          height: 'auto',
          width: DIVIDER_WIDTH,
          transform: 'translateX(-50%)',
          bgcolor: 'transparent !important',
          backgroundColor: 'transparent !important',
          cursor: 'col-resize',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          outline: 'none',
          '&:active, &:focus': {
            bgcolor: 'transparent !important',
            backgroundColor: 'transparent !important',
            outline: 'none',
          },
          '&:hover + .master-detail-divider-line': {
            bgcolor: 'primary.main',
            opacity: 1,
          },
        }}
      />
      <Box
        className="master-detail-divider-line"
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          height: 'auto',
          width: 1,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          bgcolor: (theme) => resizing
            ? theme.palette.primary.main
            : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.13)' : 'rgba(226,232,240,0.16)',
          opacity: resizing ? 1 : 0.72,
          transition: transition(['background-color', 'opacity'], 220, motion.softOut),
        }}
      />
    </Box>
  );

  return (
    <Box
      ref={rootRef}
      sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        overflow: detailCollapsed ? 'visible' : 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Box
        sx={{
          width: detailCollapsed ? 'auto' : masterWidth,
          flex: detailCollapsed ? '1 1 auto' : `0 0 ${masterWidth}px`,
          minWidth: MIN_MASTER_WIDTH,
          maxWidth: detailCollapsed ? 'none' : MAX_MASTER_WIDTH,
          minHeight: 0,
          height: '100%',
          overflow: detailCollapsed ? 'visible' : 'auto',
          scrollbarGutter: 'stable',
          bgcolor: detailCollapsed
            ? 'background.default'
            : (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.025)',
        }}
      >
        {detailCollapsed
          ? (fallback === 'master' ? master : detail)
          : <PaneShell role="master" title={masterTitle}>{master}</PaneShell>}
      </Box>
      {divider}
      {!detailCollapsed ? (
        <Box sx={{ flex: 1, minWidth: MIN_DETAIL_WIDTH, minHeight: 0, overflow: 'hidden' }}>
          <PaneShell role="detail" title={detailTitle}>{detail}</PaneShell>
        </Box>
      ) : null}
    </Box>
  );
}
