import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import ChatIcon from '@mui/icons-material/Chat';
import PersonIcon from '@mui/icons-material/Person';
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const pathToIndex: Record<string, number> = {
  '/': 0,
  '/chats': 1,
  '/characters': 2,
  '/settings': 3,
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

  const paths = ['/', '/chats', '/characters', '/settings'];

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
        onChange={(_, newValue) => {
          const nextPath = paths[newValue];
          if (nextPath !== location.pathname) navigate(nextPath);
        }}
        showLabels
      >
        <BottomNavigationAction label={t('nav.home')} icon={<HomeIcon />} />
        <BottomNavigationAction label={t('nav.chats')} icon={<ChatIcon />} />
        <BottomNavigationAction label={t('nav.characters')} icon={<PersonIcon />} />
        <BottomNavigationAction label={t('nav.settings')} icon={<SettingsIcon />} />
      </BottomNavigation>
    </Paper>
  );
}
