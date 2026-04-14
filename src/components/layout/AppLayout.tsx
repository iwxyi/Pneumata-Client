import { Box, Drawer, SwipeableDrawer, IconButton, Typography } from '@mui/material';
import { Menu as MenuIcon, Home as HomeIcon, Chat as ChatIcon, Person as PersonIcon, Settings as SettingsIcon, SmartToy as ModelsIcon } from '@mui/icons-material';
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

const SIDEBAR_WIDTH = 280;
const SIDEBAR_COLLAPSED_WIDTH = 72;
export const FLOATING_HEADER_OFFSET = { xs: 0, sm: 0, md: 0 };

const LayoutHeaderActionsContext = createContext<{ setHeaderActions: (actions: ReactNode) => void } | null>(null);

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
  const CurrentIcon = currentRoute.icon;
  const currentTitle = t(currentRoute.titleKey);
  const [headerActions, setHeaderActions] = React.useState<ReactNode>(null);

  return (
    <LayoutHeaderActionsContext.Provider value={{ setHeaderActions }}>
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
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
          height: '100vh',
          pb: isMobile ? '56px' : 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {shouldShowMenuButton && (
          <Box
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: sidebarOpen ? 1099 : 1199,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              px: 3,
              py: 1.5,
              bgcolor: 'background.default',
              backdropFilter: 'blur(12px)',
              borderBottom: 1,
              borderColor: 'divider',
              transition: 'backdrop-filter 180ms ease, border-color 180ms ease',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <IconButton
                onClick={() => setSidebarOpen(true)}
                size="small"
                aria-label="Open navigation"
                sx={{
                  bgcolor: 'background.paper',
                  boxShadow: 1,
                  '&:hover': { bgcolor: 'background.paper', transform: 'scale(1.03)' },
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
              <Box
                onClick={() => navigate('/')}
                role="button"
                aria-label={t('nav.home')}
                sx={{
                  minWidth: 0,
                  maxWidth: 'calc(100vw - 220px)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.5,
                  py: 0.875,
                  borderRadius: 99,
                  bgcolor: 'background.paper',
                  boxShadow: 1,
                  color: 'text.primary',
                  cursor: 'pointer',
                  transition: 'transform 180ms ease, box-shadow 180ms ease',
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    boxShadow: 2,
                  },
                }}
              >
                <CurrentIcon fontSize="small" color="primary" />
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {currentTitle}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
              {headerActions}
            </Box>
          </Box>
        )}
        {!shouldShowMenuButton && headerActions ? (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', px: 3, pt: 3 }}>
            {headerActions}
          </Box>
        ) : null}

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pt: FLOATING_HEADER_OFFSET }}>
          <Outlet />
        </Box>
      </Box>

      {/* Mobile: bottom navigation */}
      {isMobile && <BottomNav />}
      </Box>
    </LayoutHeaderActionsContext.Provider>
  );
}
