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
import { motion, transition } from '../../styles/motion';

interface SidebarProps {
  collapsed: boolean;
}

const navItems = [
  { path: '/', icon: <HomeIcon />, labelKey: 'nav.home' },
  { path: '/chats', icon: <ChatIcon />, labelKey: 'nav.chats' },
  { path: '/characters', icon: <PersonIcon />, labelKey: 'nav.characters' },
  { path: '/models', icon: <ModelsIcon />, labelKey: 'nav.models' },
  { path: '/letters', icon: <MailIcon />, labelKey: 'nav.letters' },
  { path: '/account', icon: <AccountIcon />, labelKey: 'nav.account' },
  { path: '/settings', icon: <SettingsIcon />, labelKey: 'nav.settings' },
];

const introNavItem = { path: '/intro', icon: <IntroIcon />, labelKey: 'nav.intro' };

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

  const renderNavItem = (item: typeof navItems[number] | typeof introNavItem) => {
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
          position: 'relative',
          borderRadius: 1,
          mb: 0.65,
          justifyContent: collapsed ? 'center' : 'flex-start',
          px: collapsed ? 1 : 1.35,
          minHeight: 46,
          overflow: 'hidden',
          color: isActive ? 'text.primary' : 'text.secondary',
          border: '1px solid',
          borderColor: isActive ? 'primary.main' : 'transparent',
          bgcolor: isActive ? (theme) => `${theme.palette.primary.main}1A` : 'transparent',
          transition: transition(['transform', 'background-color', 'border-color', 'color'], 220, motion.softOut),
          '&::before': collapsed ? undefined : {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 10,
            bottom: 10,
            width: 3,
            borderRadius: 999,
            bgcolor: isActive ? 'primary.main' : 'transparent',
            transition: transition(['background-color'], 220, motion.softOut),
          },
          '&:hover': {
            transform: 'translateX(3px)',
            bgcolor: isActive ? (theme) => `${theme.palette.primary.main}1F` : 'rgba(148,163,184,0.08)',
            borderColor: isActive ? 'primary.main' : 'rgba(148,163,184,0.10)',
          },
          '&.Mui-selected': {
            bgcolor: (theme) => `${theme.palette.primary.main}1A`,
          },
          '&.Mui-selected:hover': {
            bgcolor: (theme) => `${theme.palette.primary.main}1F`,
          },
        }}
      >
        <ListItemIcon
          sx={{
            minWidth: collapsed ? 0 : 38,
            color: isActive ? 'primary.main' : 'text.secondary',
            transition: transition(['color', 'transform'], 220, motion.spring),
            transform: isActive ? 'scale(1.06)' : 'none',
          }}
        >
          {item.path === '/letters' ? <Badge badgeContent={unreadLetterCount} color="error" max={99}>{item.icon}</Badge> : item.icon}
        </ListItemIcon>
        {!collapsed && (
          <ListItemText
            primary={
              <Typography sx={{ fontSize: 14, fontWeight: isActive ? 760 : 560, letterSpacing: 0 }}>
                {t(item.labelKey)}
              </Typography>
            }
          />
        )}
      </ListItemButton>
    );

    return collapsed ? (
      <Tooltip key={item.path} title={t(item.labelKey)} placement="right">
        {button}
      </Tooltip>
    ) : (
      button
    );
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(10,10,15,0.78)',
        backdropFilter: 'blur(24px) saturate(1.12)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.12)',
        borderRight: 1,
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.09)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          px: collapsed ? 1 : 1.4,
          py: 1.4,
          minHeight: 72,
          gap: 1,
        }}
      >
        {!collapsed && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.15, minWidth: 0 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1,
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 auto',
                color: 'primary.main',
                border: '1px solid',
                borderColor: 'primary.main',
                bgcolor: (theme) => `${theme.palette.primary.main}16`,
                fontWeight: 860,
                fontSize: 17,
              }}
            >
              P
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 840, lineHeight: 1.1, letterSpacing: 0 }}>
                {t('app.name')}
              </Typography>
              <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary', opacity: 0.76, mt: 0.25 }}>
                Living character engine
              </Typography>
            </Box>
          </Box>
        )}
        {collapsed && (
          <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'grid', placeItems: 'center', color: 'primary.main', border: '1px solid', borderColor: 'primary.main', bgcolor: (theme) => `${theme.palette.primary.main}16`, fontWeight: 860 }}>
            P
          </Box>
        )}
        {!collapsed && (
          <IconButton size="small" onClick={toggleSidebar} sx={{ borderRadius: 2, color: 'text.secondary' }}>
            <CollapseIcon />
          </IconButton>
        )}
        {collapsed && (
          <IconButton size="small" onClick={toggleSidebar} sx={{ mt: 1, borderRadius: 2, color: 'text.secondary' }}>
            <ExpandIcon />
          </IconButton>
        )}
      </Box>

      <Divider sx={{ mx: collapsed ? 1.2 : 1.5, borderColor: 'rgba(148,163,184,0.14)' }} />

      <List sx={{ flex: 1, px: collapsed ? 0.65 : 1.1, pt: 1.15 }}>
        {navItems.map(renderNavItem)}
      </List>
      <Box sx={{ px: collapsed ? 0.65 : 1.1, pb: 1.4 }}>
        <Divider sx={{ mb: 1, borderColor: 'rgba(148,163,184,0.14)' }} />
        {renderNavItem(introNavItem)}
      </Box>
    </Box>
  );
}
