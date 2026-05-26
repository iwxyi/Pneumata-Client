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
  Badge,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import ChatIcon from '@mui/icons-material/Chat';
import PersonIcon from '@mui/icons-material/Person';
import SettingsIcon from '@mui/icons-material/Settings';
import ModelsIcon from '@mui/icons-material/SmartToy';
import AccountIcon from '@mui/icons-material/AccountCircle';
import MailIcon from '@mui/icons-material/Mail';
import IntroIcon from '@mui/icons-material/AutoAwesome';
import CollapseIcon from '@mui/icons-material/ChevronLeft';
import ExpandIcon from '@mui/icons-material/ChevronRight';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useResponsive } from '../../hooks/useResponsive';
import { useUIStore } from '../../stores/useUIStore';
import { useCharacterArtifactStore } from '../../stores/useCharacterArtifactStore';

interface SidebarProps {
  collapsed: boolean;
}

const navItems = [
  { path: '/', icon: <HomeIcon />, labelKey: 'nav.home' },
  { path: '/chats', icon: <ChatIcon />, labelKey: 'nav.chats' },
  { path: '/characters', icon: <PersonIcon />, labelKey: 'nav.characters' },
  { path: '/models', icon: <ModelsIcon />, labelKey: 'nav.models' },
  { path: '/letters', icon: <MailIcon />, labelKey: 'nav.letters' },
  { path: '/intro', icon: <IntroIcon />, labelKey: 'nav.intro' },
  { path: '/account', icon: <AccountIcon />, labelKey: 'nav.account' },
  { path: '/settings', icon: <SettingsIcon />, labelKey: 'nav.settings' },
];

export default function Sidebar({ collapsed }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { isDesktop } = useResponsive();
  const { toggleSidebar, setSidebarOpen } = useUIStore();
  const unreadLetterCount = useCharacterArtifactStore((state) => state.unreadLetterCount);

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
                {item.path === '/letters' ? <Badge badgeContent={unreadLetterCount} color="error" max={99}>{item.icon}</Badge> : item.icon}
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
