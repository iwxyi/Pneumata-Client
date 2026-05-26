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
        bottom: 10,
        left: 12,
        right: 12,
        zIndex: 1200,
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.10)' : 'rgba(226,232,240,0.10)',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.76)' : 'rgba(10,10,15,0.78)',
        backdropFilter: 'blur(22px) saturate(1.12)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.12)',
        boxShadow: (theme) => theme.palette.mode === 'light' ? '0 16px 38px rgba(15,23,42,0.12)' : '0 18px 46px rgba(0,0,0,0.38)',
      }}
      elevation={0}
    >
      <BottomNavigation
        value={currentIndex}
        onChange={(_, newValue) => {
          const nextPath = paths[newValue];
          if (nextPath !== location.pathname) navigate(nextPath);
        }}
        showLabels
        sx={{
          height: 58,
          bgcolor: 'transparent',
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            color: 'text.secondary',
            borderRadius: 1,
            mx: 0.35,
            my: 0.55,
          },
          '& .Mui-selected': {
            color: 'primary.main',
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: 11,
            fontWeight: 650,
          },
        }}
      >
        <BottomNavigationAction label={t('nav.home')} icon={<HomeIcon />} />
        <BottomNavigationAction label={t('nav.chats')} icon={<ChatIcon />} />
        <BottomNavigationAction label={t('nav.characters')} icon={<PersonIcon />} />
        <BottomNavigationAction label={t('nav.settings')} icon={<SettingsIcon />} />
      </BottomNavigation>
    </Paper>
  );
}
