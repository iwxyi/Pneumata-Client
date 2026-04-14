import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import {
  Home as HomeIcon,
  Chat as ChatIcon,
  Person as PersonIcon,
  SmartToy as ModelsIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const pathToIndex: Record<string, number> = {
  '/': 0,
  '/chats': 1,
  '/characters': 2,
  '/models': 3,
  '/settings': 4,
};

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const currentIndex = Object.entries(pathToIndex).reduce((acc, [path, idx]) => {
    if (path === '/') {
      return location.pathname === '/' ? idx : acc;
    }
    return location.pathname.startsWith(path) ? idx : acc;
  }, 0);

  const paths = ['/', '/chats', '/characters', '/models', '/settings'];

  return (
    <Paper
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
      }}
      elevation={3}
    >
      <BottomNavigation
        value={currentIndex}
        onChange={(_, newValue) => navigate(paths[newValue])}
        showLabels
      >
        <BottomNavigationAction label={t('nav.home')} icon={<HomeIcon />} />
        <BottomNavigationAction label={t('nav.chats')} icon={<ChatIcon />} />
        <BottomNavigationAction label={t('nav.characters')} icon={<PersonIcon />} />
        <BottomNavigationAction label={t('nav.models')} icon={<ModelsIcon />} />
        <BottomNavigationAction label={t('nav.settings')} icon={<SettingsIcon />} />
      </BottomNavigation>
    </Paper>
  );
}
