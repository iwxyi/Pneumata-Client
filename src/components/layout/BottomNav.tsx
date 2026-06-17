import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AnimatedNavIcon, { type AnimatedNavIconKind } from './AnimatedNavIcon';

const pathToIndex: Record<string, number> = {
  '/': 0,
  '/chats': 1,
  '/characters': 2,
  '/settings': 3,
};

const mobileItems: Array<{ path: string; labelKey: string; iconKind: AnimatedNavIconKind }> = [
  { path: '/', labelKey: 'nav.home', iconKind: 'home' },
  { path: '/chats', labelKey: 'nav.chats', iconKind: 'chats' },
  { path: '/characters', labelKey: 'nav.characters', iconKind: 'characters' },
  { path: '/settings', labelKey: 'nav.settings', iconKind: 'settings' },
];

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

  return (
    <Paper
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1200,
        px: 1.5,
        pt: 1,
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
        borderRadius: 0,
        overflow: 'hidden',
        borderTop: '1px solid',
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(245,245,247,0.70)' : 'rgba(10,10,15,0.42)',
        backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        boxShadow: (theme) => theme.palette.mode === 'light'
          ? '0 -10px 24px rgba(15,23,42,0.035), 0 1px 0 rgba(255,255,255,0.54) inset'
          : '0 -12px 30px rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.08) inset',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          right: 0,
          top: -42,
          height: 42,
          pointerEvents: 'none',
          backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(20px) saturate(0.92) brightness(0.84)',
          WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(20px) saturate(0.92) brightness(0.84)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,0.68), rgba(0,0,0,0.20) 62%, transparent)',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0.68), rgba(0,0,0,0.20) 62%, transparent)',
          background: (theme) => theme.palette.mode === 'light'
            ? 'linear-gradient(rgba(245,245,247,0), rgba(245,245,247,0.18))'
            : 'linear-gradient(rgba(10,10,15,0), rgba(10,10,15,0.12))',
        },
      }}
      elevation={0}
    >
      <BottomNavigation
        value={currentIndex}
        onChange={(_, newValue) => {
          const nextPath = mobileItems[newValue]?.path;
          if (nextPath !== location.pathname) navigate(nextPath);
        }}
        showLabels
        sx={{
          height: 62,
          bgcolor: 'transparent',
          borderRadius: 1.5,
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            color: 'text.secondary',
            borderRadius: 1,
            mx: 0.35,
            my: 0.55,
            transition: 'color 220ms ease, background-color 220ms ease',
            '&:hover': {
              bgcolor: 'rgba(148,163,184,0.08)',
            },
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
        {mobileItems.map((item, index) => (
          <BottomNavigationAction
            key={item.path}
            className="PneumataNavButton"
            label={t(item.labelKey)}
            icon={<AnimatedNavIcon kind={item.iconKind} active={currentIndex === index} />}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
