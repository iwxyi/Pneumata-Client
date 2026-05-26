import React, { type ReactNode } from 'react';
import {
  Box,
  Drawer,
  SwipeableDrawer,
  Typography,
  ListItemButton,
  IconButton,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
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

function buildTopBarGlassSx(isFloating = false) {
  return {
    position: isFloating ? 'sticky' : 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1198,
    bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(245,245,247,0.68)' : 'rgba(10,10,15,0.42)',
    backdropFilter: (theme: Theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
    WebkitBackdropFilter: (theme: Theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
    borderBottom: '1px solid',
    borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(226,232,240,0.055)',
    boxShadow: (theme: Theme) => theme.palette.mode === 'light'
      ? '0 1px 0 rgba(255,255,255,0.34) inset, 0 8px 18px rgba(15,23,42,0.010)'
      : '0 1px 0 rgba(255,255,255,0.05) inset, 0 10px 22px rgba(0,0,0,0.10)',
    transition: 'background-color 180ms ease, backdrop-filter 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -36,
      height: 36,
      pointerEvents: 'none',
      backdropFilter: (theme: Theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(18px) saturate(0.92) brightness(0.84)',
      WebkitBackdropFilter: (theme: Theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(18px) saturate(0.92) brightness(0.84)',
      maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.72), rgba(0,0,0,0.22) 58%, transparent)',
      WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.72), rgba(0,0,0,0.22) 58%, transparent)',
      background: (theme: Theme) => theme.palette.mode === 'light'
        ? 'linear-gradient(rgba(245,245,247,0.18), rgba(245,245,247,0))'
        : 'linear-gradient(rgba(10,10,15,0.12), rgba(10,10,15,0))',
    },
  };
}

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
  const mainPaddingBottom = 0;
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
        ...buildTopBarGlassSx(false),
        zIndex: sidebarOpen ? 1099 : 1199,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        px: 2,
        py: 1,
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
    <Box sx={{ ...buildTopBarGlassSx(false), display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 3, py: 1, gap: 2 }}>
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
            bgcolor: 'background.default',
            backgroundImage: 'none',
          }}
        >
          {showMobileTopBar ? mobileHeader : null}
          {showDesktopTopBar ? desktopHeader : null}

          <Box sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            pt: location.pathname.startsWith('/chats/') ? 0 : showMobileTopBar ? '65px' : showDesktopTopBar ? '49px' : 0,
          }}>
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
