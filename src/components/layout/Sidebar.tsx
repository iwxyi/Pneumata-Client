import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  IconButton,
  Divider,
  Tooltip,
} from '@mui/material';
import {
  Home as HomeIcon,
  Chat as ChatIcon,
  Person as PersonIcon,
  Settings as SettingsIcon,
  SmartToy as ModelsIcon,
  AccountCircle as AccountIcon,
  ChevronLeft as CollapseIcon,
  ChevronRight as ExpandIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useResponsive } from '../../hooks/useResponsive';
import { useUIStore } from '../../stores/useUIStore';

interface SidebarProps {
  collapsed: boolean;
}

const navItems = [
  { path: '/', icon: <HomeIcon />, labelKey: 'nav.home' },
  { path: '/chats', icon: <ChatIcon />, labelKey: 'nav.chats' },
  { path: '/characters', icon: <PersonIcon />, labelKey: 'nav.characters' },
  { path: '/models', icon: <ModelsIcon />, labelKey: 'nav.models' },
  { path: '/account', icon: <AccountIcon />, labelKey: 'nav.account' },
  { path: '/settings', icon: <SettingsIcon />, labelKey: 'nav.settings' },
];

export default function Sidebar({ collapsed }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { isDesktop } = useResponsive();
  const { toggleSidebar, setSidebarOpen } = useUIStore();

  const handleNav = (path: string) => {
    navigate(path);
    if (!isDesktop) {
      setSidebarOpen(false);
    }
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
      }}
    >
      {/* Logo / Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          p: 2,
          minHeight: 64,
        }}
      >
        {!collapsed && (
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
            🍵 {t('app.name')}
          </Typography>
        )}
        {collapsed && (
          <Typography variant="h5" sx={{ cursor: 'pointer' }}>
            🍵
          </Typography>
        )}
        {!collapsed && (
          <IconButton size="small" onClick={toggleSidebar}>
            <CollapseIcon />
          </IconButton>
        )}
        {collapsed && (
          <IconButton size="small" onClick={toggleSidebar} sx={{ mt: 1 }}>
            <ExpandIcon />
          </IconButton>
        )}
      </Box>

      <Divider />

      {/* Navigation */}
      <List sx={{ flex: 1, px: collapsed ? 0.5 : 1 }}>
        {navItems.map((item) => {
          const isActive =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);

          const button = (
            <ListItemButton
              key={item.path}
              onClick={() => handleNav(item.path)}
              selected={isActive}
              sx={{
                borderRadius: 3,
                mb: 0.5,
                justifyContent: collapsed ? 'center' : 'flex-start',
                px: collapsed ? 1 : 2,
                minHeight: 48,
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: collapsed ? 0 : 40,
                  color: isActive ? 'primary.main' : 'text.secondary',
                }}
              >
                {item.icon}
              </ListItemIcon>
              {!collapsed && <ListItemText primary={t(item.labelKey)} />}
            </ListItemButton>
          );

          return collapsed ? (
            <Tooltip key={item.path} title={t(item.labelKey)} placement="right">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </List>
    </Box>
  );
}
