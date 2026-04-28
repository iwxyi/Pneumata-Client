import { Box, Drawer, SwipeableDrawer, Typography, ListItemButton, ListItemIcon } from '@mui/material';
import { Menu as MenuIcon, ArrowBack as ArrowBackIcon, Home as HomeIcon, Chat as ChatIcon, Person as PersonIcon, Settings as SettingsIcon, SmartToy as ModelsIcon } from '@mui/icons-material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import React, { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useResponsive } from '../../hooks/useResponsive';
import { useUIStore } from '../../stores/useUIStore';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

const routeMeta = [
  { match: (pathname: string) => pathname === '/', titleKey: 'nav.home', icon: HomeIcon },
  { match: (pathname: string) => pathname === '/chats' || pathname.startsWith('/chats/'), titleKey: 'nav.chats', icon: ChatIcon },
  { match: (pathname: string) => pathname.startsWith('/characters'), titleKey: 'nav.characters', icon: PersonIcon },
  { match: (pathname: string) => pathname.startsWith('/models'), titleKey: 'nav.models', icon: ModelsIcon },
  { match: (pathname: string) => pathname.startsWith('/settings'), titleKey: 'nav.settings', icon: SettingsIcon },
];

function getRouteMeta(pathname: string) {
  return routeMeta.find((item) => item.match(pathname)) ?? routeMeta[0];
}

function isChatDetailRoute(pathname: string) {
  return /^\/chats\/[^/]+$/.test(pathname);
}

const SIDEBAR_WIDTH = 280;
const SIDEBAR_COLLAPSED_WIDTH = 72;
export const FLOATING_HEADER_OFFSET = { xs: 0, sm: 0, md: 0 };

const LayoutHeaderActionsContext = createContext<{
  setHeaderActions: (actions: ReactNode) => void;
  setHeaderTitle: (title: ReactNode | null) => void;
  setHeaderBackAction: (action: (() => void) | null) => void;
  setHideMobileBottomNav: (hidden: boolean) => void;
} | null>(null);

export function useLayoutHeaderActions() {
  const context = useContext(LayoutHeaderActionsContext);
  if (!context) {
    throw new Error('useLayoutHeaderActions must be used within AppLayout');
  }
  return context;
}

export default function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile, isTablet, isDesktop } = useResponsive();
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const shouldShowMenuButton = isMobile || isTablet;
  const currentRoute = getRouteMeta(location.pathname);
  const chatDetailRoute = isChatDetailRoute(location.pathname);
  const currentTitle = t(currentRoute.titleKey);
  const [headerActions, setHeaderActions] = React.useState<ReactNode>(null);
  const [headerTitle, setHeaderTitle] = React.useState<ReactNode | null>(null);
  const [headerBackAction, setHeaderBackAction] = React.useState<(() => void) | null>(null);
  const [hideMobileBottomNav, setHideMobileBottomNav] = React.useState(false);

  return (
    <LayoutHeaderActionsContext.Provider value={{ setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav }}>
      <Box sx={{ display: 'flex', height: '100dvh', minHeight: '100dvh', overflow: 'hidden' }}>
      {/* Desktop: permanent sidebar */}
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

      {/* Tablet: temporary drawer */}
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

      {/* Mobile: swipeable drawer */}
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

      {/* Main content area */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100dvh',
          pb: isMobile && !hideMobileBottomNav ? '56px' : 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {shouldShowMenuButton && (
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
              <ListItemButton
                onClick={headerBackAction ?? (() => setSidebarOpen(true))}
                sx={{
                  borderRadius: 3,
                  minHeight: 48,
                  px: 1.5,
                  flex: '0 0 auto',
                  color: 'text.primary',
                }}
              >
                <ListItemIcon sx={{ minWidth: 0, mr: 0 }}>
                  {headerBackAction ? <ArrowBackIcon /> : <MenuIcon />}
                </ListItemIcon>
              </ListItemButton>
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
                  {headerTitle ?? currentTitle}
                </Typography>
              </ListItemButton>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
              {headerActions}
            </Box>
          </Box>
        )}
        {!shouldShowMenuButton && (headerActions || headerBackAction || headerTitle) ? (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 3, pt: 1, gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              {headerBackAction ? (
                <ListItemButton
                  onClick={headerBackAction}
                  sx={{
                    borderRadius: 3,
                    minHeight: 48,
                    px: 1.5,
                    flex: '0 0 auto',
                    color: 'text.primary',
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 0, mr: 0 }}>
                    <ArrowBackIcon />
                  </ListItemIcon>
                </ListItemButton>
              ) : null}
              {headerTitle ? (
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {headerTitle}
                </Typography>
              ) : null}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              {headerActions}
            </Box>
          </Box>
        ) : null}

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: chatDetailRoute ? 'hidden' : 'auto',
            overscrollBehaviorY: 'contain',
            WebkitOverflowScrolling: 'touch',
            pt: FLOATING_HEADER_OFFSET,
          }}
        >
          <Outlet />
        </Box>
      </Box>

      {/* Mobile: bottom navigation */}
      {isMobile && !hideMobileBottomNav ? <BottomNav /> : null}
      </Box>
    </LayoutHeaderActionsContext.Provider>
  );
}
