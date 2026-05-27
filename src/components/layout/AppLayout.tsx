import React, { type ReactNode } from 'react';
import {
  Box,
  Drawer,
  SwipeableDrawer,
  IconButton,
  useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useResponsive } from '../../hooks/useResponsive';
import { useUIStore } from '../../stores/useUIStore';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { LayoutHeaderActionsContext } from './AppLayoutContext';
import GlassHeader, { GLASS_HEADER_HEIGHT } from './GlassHeader';
import { useAutoHideHeader } from '../../hooks/useAutoHideHeader';
import { DETAIL_COLLAPSED_CHANGE_EVENT, DETAIL_COLLAPSED_STORAGE_KEY, readDetailCollapsedState } from './masterDetailState';
import { motion } from '../../styles/motion';

const routeMeta = [
  { match: (pathname: string) => pathname === '/', titleKey: 'nav.home' },
  { match: (pathname: string) => pathname === '/chats' || pathname.startsWith('/chats/'), titleKey: 'nav.chats' },
  { match: (pathname: string) => pathname.startsWith('/characters'), titleKey: 'nav.characters' },
  { match: (pathname: string) => pathname.startsWith('/letters'), titleKey: 'nav.letters' },
  { match: (pathname: string) => pathname.startsWith('/intro'), titleKey: 'nav.intro' },
  { match: (pathname: string) => pathname.startsWith('/models'), titleKey: 'nav.models' },
  { match: (pathname: string) => pathname.startsWith('/settings'), titleKey: 'nav.settings' },
];

function getRouteMeta(pathname: string) {
  return routeMeta.find((item) => item.match(pathname)) ?? routeMeta[0];
}

function isMasterDetailPath(pathname: string) {
  return pathname === '/chats'
    || pathname === '/characters'
    || /^\/chats\/(create|[^/]+|[^/]+\/edit)$/.test(pathname)
    || pathname === '/direct/create'
    || /^\/characters\/(create|[^/]+\/edit)$/.test(pathname);
}

const SIDEBAR_WIDTH = 280;
const SIDEBAR_COLLAPSED_WIDTH = 72;

export default function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isMobile, isTablet, isDesktop } = useResponsive();
  const isThreeColumn = useMediaQuery('(min-width:1280px)');
  const [detailCollapsed, setDetailCollapsed] = React.useState(readDetailCollapsedState);
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const shouldShowMenuButton = isMobile || isTablet;
  const currentRoute = getRouteMeta(location.pathname);
  const currentTitle = t(currentRoute.titleKey);
  const [headerActions, setHeaderActions] = React.useState<ReactNode>(null);
  const [headerTitle, setHeaderTitle] = React.useState<ReactNode | null>(null);
  const [headerBackAction, setHeaderBackAction] = React.useState<(() => void) | null>(null);
  const [hideMobileBottomNav, setHideMobileBottomNav] = React.useState(false);
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const effectiveHeaderTitle = headerTitle ?? currentTitle;
  const mainPaddingBottom = 0;
  const isChatDetailRoute = /^\/chats\/[^/]+$/.test(location.pathname) && location.pathname !== '/chats/create';
  const supportsMasterDetail = isMasterDetailPath(location.pathname);
  const isMasterDetailRoute = supportsMasterDetail && isThreeColumn && !detailCollapsed;
  const showMobileTopBar = shouldShowMenuButton && !isMasterDetailRoute && !isChatDetailRoute;
  const showDesktopTopBar = !shouldShowMenuButton && !isMasterDetailRoute && !isChatDetailRoute;
  const headerOffset = isChatDetailRoute && !isMasterDetailRoute ? 0 : showMobileTopBar ? 65 : showDesktopTopBar ? 49 : 0;
  const { hidden: headerHidden, reset: resetHeaderHidden, handleScrollTop: handleHeaderScrollTop } = useAutoHideHeader(isChatDetailRoute || isMasterDetailRoute || sidebarOpen);
  const effectiveHeaderHidden = headerHidden;
  const floatingTabTopOffset = effectiveHeaderHidden
    ? 10
    : (showMobileTopBar || showDesktopTopBar) ? GLASS_HEADER_HEIGHT + 12 : 10;
  const handleHeaderLeadingAction = () => {
    if (headerBackAction) {
      headerBackAction();
      return;
    }
    setSidebarOpen(true);
  };

  React.useEffect(() => {
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

  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = 0;
    resetHeaderHidden();
  }, [location.pathname, resetHeaderHidden]);

  const handleMainScroll = (event: React.UIEvent<HTMLDivElement>) => {
    handleHeaderScrollTop(event.currentTarget.scrollTop);
  };

  const mobileHeader = (
    <GlassHeader
      title={effectiveHeaderTitle}
      hidden={effectiveHeaderHidden}
      zIndex={sidebarOpen ? 1099 : 1199}
      leading={
        <IconButton
          onClick={handleHeaderLeadingAction}
          sx={{
            borderRadius: 3,
            flex: '0 0 auto',
            color: 'text.primary',
          }}
        >
          {headerBackAction ? <ArrowBackIcon /> : <MenuIcon />}
        </IconButton>
      }
      actions={headerActions}
    />
  );

  const desktopHeader = (
    <GlassHeader
      title={effectiveHeaderTitle}
      hidden={effectiveHeaderHidden}
      leading={headerBackAction ? (
          <IconButton
            onClick={headerBackAction}
            sx={{
              borderRadius: 3,
              flex: '0 0 auto',
              color: 'text.primary',
            }}
          >
            <ArrowBackIcon />
          </IconButton>
        ) : null}
      actions={headerActions}
    />
  );

  return (
    <LayoutHeaderActionsContext.Provider value={{ setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav }}>
    <Box sx={{ display: 'flex', height: '100dvh', minHeight: '100dvh', overflow: 'hidden' }}>
        {isDesktop && (
          <Box
            sx={{
              width: sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
              flexShrink: 0,
              transition: `width 320ms ${motion.emphasized}`,
            }}
          >
            <Sidebar collapsed={!sidebarOpen} />
          </Box>
        )}

        {isTablet && (
          <Drawer
            variant="temporary"
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            sx={{
              '& .MuiDrawer-paper': {
                width: SIDEBAR_WIDTH,
                borderRadius: 0,
              },
            }}
          >
            <Sidebar collapsed={false} />
          </Drawer>
        )}

        {isMobile && (
          <SwipeableDrawer
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onOpen={() => setSidebarOpen(true)}
            sx={{
              '& .MuiDrawer-paper': {
                width: SIDEBAR_WIDTH,
                borderRadius: 0,
              },
            }}
          >
            <Sidebar collapsed={false} />
          </SwipeableDrawer>
        )}

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100dvh',
            pb: mainPaddingBottom,
            position: 'relative',
            overflow: 'hidden',
            bgcolor: 'background.default',
            backgroundImage: 'none',
          }}
        >
          {showMobileTopBar ? mobileHeader : null}
          {showDesktopTopBar ? desktopHeader : null}

          <Box
            ref={scrollContainerRef}
            onScroll={handleMainScroll}
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: isChatDetailRoute || isMasterDetailRoute ? 'hidden' : 'auto',
              scrollbarGutter: isChatDetailRoute || isMasterDetailRoute ? 'auto' : 'stable',
              '--app-floating-tab-top': `${floatingTabTopOffset}px`,
            }}
          >
            {headerOffset ? <Box aria-hidden sx={{ height: `${headerOffset}px`, flexShrink: 0, pointerEvents: 'none' }} /> : null}
            <Box
              sx={isChatDetailRoute || isMasterDetailRoute
                ? { flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }
                : { flex: '0 0 auto' }}
            >
              <Outlet />
            </Box>
          </Box>

          {isMobile && !hideMobileBottomNav ? (
            <BottomNav />
          ) : null}
        </Box>
      </Box>
    </LayoutHeaderActionsContext.Provider>
  );
}
