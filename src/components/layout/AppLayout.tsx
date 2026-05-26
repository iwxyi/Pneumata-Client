import React, { type ReactNode } from 'react';
import {
  Box,
  Drawer,
  SwipeableDrawer,
  Typography,
  ListItemButton,
  IconButton,
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

const SIDEBAR_WIDTH = 280;
const SIDEBAR_COLLAPSED_WIDTH = 72;

export default function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isMobile, isTablet, isDesktop } = useResponsive();
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const shouldShowMenuButton = isMobile || isTablet;
  const currentRoute = getRouteMeta(location.pathname);
  const currentTitle = t(currentRoute.titleKey);
  const [headerActions, setHeaderActions] = React.useState<ReactNode>(null);
  const [headerTitle, setHeaderTitle] = React.useState<ReactNode | null>(null);
  const [headerBackAction, setHeaderBackAction] = React.useState<(() => void) | null>(null);
  const [hideMobileBottomNav, setHideMobileBottomNav] = React.useState(false);
  const effectiveHeaderTitle = headerTitle ?? currentTitle;
  const showMobileTopBar = shouldShowMenuButton;
  const showDesktopTopBar = !shouldShowMenuButton;
  const mainPaddingBottom = isMobile && !hideMobileBottomNav ? '56px' : 0;
  const handleHeaderLeadingAction = () => {
    if (headerBackAction) {
      headerBackAction();
      return;
    }
    setSidebarOpen(true);
  };

  const mobileHeader = (
    <Box
      sx={{
        position: 'relative',
        top: 'auto',
        zIndex: sidebarOpen ? 1099 : 1199,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        px: 2,
        py: 1,
        bgcolor: (theme) => theme.palette.mode === 'light' ? '#f5f5f5' : '#121212',
        backdropFilter: 'blur(12px)',
        borderBottom: 1,
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
        transition: 'background-color 180ms ease, backdrop-filter 180ms ease, border-color 180ms ease',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
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
        <ListItemButton
          disabled
          sx={{
            borderRadius: 3,
            minHeight: 48,
            px: 1.5,
            maxWidth: 'calc(100vw - 220px)',
            color: 'text.primary',
            opacity: 1,
            '&.Mui-disabled': {
              opacity: 1,
              color: 'text.primary',
            },
          }}
        >
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {effectiveHeaderTitle}
          </Typography>
        </ListItemButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
        {headerActions}
      </Box>
    </Box>
  );

  const desktopHeader = (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 3, pt: 1, gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {headerBackAction ? (
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
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {effectiveHeaderTitle}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        {headerActions}
      </Box>
    </Box>
  );

  return (
    <LayoutHeaderActionsContext.Provider value={{ setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav }}>
    <Box sx={{ display: 'flex', height: '100dvh', minHeight: '100dvh', overflow: 'hidden' }}>
        {isDesktop && (
          <Box
            sx={{
              width: sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
              flexShrink: 0,
              transition: 'width 0.3s ease',
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
          }}
        >
          {showMobileTopBar ? mobileHeader : null}
          {showDesktopTopBar ? desktopHeader : null}

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Outlet />
          </Box>

          {isMobile && !hideMobileBottomNav ? (
            <BottomNav />
          ) : null}
        </Box>
      </Box>
    </LayoutHeaderActionsContext.Provider>
  );
}
