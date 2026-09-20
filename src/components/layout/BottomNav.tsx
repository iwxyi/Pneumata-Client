import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AnimatedNavIcon, { type AnimatedNavIconKind } from './AnimatedNavIcon';
import { motion, transition } from '../../styles/motion';

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

type NavPreview = {
  index: number;
  originPath: string;
  originKey: string;
  phase: 'pointer' | 'commit';
};

export default function BottomNav({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [preview, setPreview] = useState<NavPreview | null>(null);
  const navigationRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ index: number; x: number; y: number; pointerId: number } | null>(null);
  const draggedRef = useRef(false);
  const suppressNextChangeRef = useRef(false);

  const currentIndex = Object.entries(pathToIndex).reduce((acc, [path, idx]) => {
    if (path === '/') {
      return location.pathname === '/' ? idx : acc;
    }
    return location.pathname.startsWith(path) ? idx : acc;
  }, 0);
  const isPressPreviewing = preview !== null
    && preview.originPath === location.pathname
    && preview.originKey === location.key;
  const visualIndex = isPressPreviewing && preview !== null ? preview.index : currentIndex;

  useEffect(() => {
    const handleWindowBlur = () => {
      pointerRef.current = null;
      draggedRef.current = false;
      suppressNextChangeRef.current = false;
      setPreview(null);
    };

    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, []);

  const handlePointerDown = (index: number, event: ReactPointerEvent) => {
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerRef.current = {
      index,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    draggedRef.current = false;
    setPreview({
      index,
      originPath: location.pathname,
      originKey: location.key,
      phase: 'pointer',
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent) => {
    const pointer = pointerRef.current;
    if (!pointer) return;

    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (Math.abs(deltaY) > 20 && Math.abs(deltaY) > Math.abs(deltaX)) {
      handlePointerCancel();
      return;
    }

    if (distance > 8) {
      draggedRef.current = true;
    }

    if (!draggedRef.current) return;

    const navigation = navigationRef.current;
    if (!navigation) return;

    const bounds = navigation.getBoundingClientRect();
    const relativeX = Math.max(0, Math.min(bounds.width - 1, event.clientX - bounds.left));
    const nextIndex = Math.max(
      0,
      Math.min(mobileItems.length - 1, Math.floor((relativeX / bounds.width) * mobileItems.length)),
    );
    if (
      preview?.index !== nextIndex
      || preview?.originPath !== location.pathname
      || preview?.originKey !== location.key
      || preview?.phase !== 'pointer'
    ) {
      setPreview({
        index: nextIndex,
        originPath: location.pathname,
        originKey: location.key,
        phase: 'pointer',
      });
    }
  };

  const handlePointerUp = (event: ReactPointerEvent) => {
    const pointer = pointerRef.current;
    if (!pointer) return;

    pointerRef.current = null;
    const releasePointerCapture = () => {
      if (event.currentTarget.hasPointerCapture(pointer.pointerId)) {
        event.currentTarget.releasePointerCapture(pointer.pointerId);
      }
    };
    const commitSelection = (targetIndex: number) => {
      if (targetIndex !== currentIndex) {
        const nextPath = mobileItems[targetIndex]?.path;
        if (nextPath && nextPath !== location.pathname) {
          suppressNextChangeRef.current = true;
          setPreview({
            index: targetIndex,
            originPath: location.pathname,
            originKey: location.key,
            phase: 'commit',
          });
          navigate(nextPath);
          window.setTimeout(() => {
            suppressNextChangeRef.current = false;
          }, 0);
          return;
        }
      }

      setPreview(null);
    };

    if (draggedRef.current) {
      const targetIndex = preview?.originPath === location.pathname ? preview.index : currentIndex;
      draggedRef.current = false;
      releasePointerCapture();
      commitSelection(targetIndex);
      return;
    }

    releasePointerCapture();
    commitSelection(pointer.index);
  };

  const handlePointerCancel = () => {
    pointerRef.current = null;
    draggedRef.current = false;
    suppressNextChangeRef.current = false;
    setPreview(null);
  };

  return (
    <Paper
      sx={{
        position: 'fixed',
        left: compact
          ? 'max(env(safe-area-inset-left, 0px), 32px)'
          : 'max(env(safe-area-inset-left, 0px), 24px)',
        right: compact
          ? 'max(env(safe-area-inset-right, 0px), 32px)'
          : 'max(env(safe-area-inset-right, 0px), 24px)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        zIndex: 1200,
        px: 0.5,
        py: compact ? 0.2 : 0.45,
        borderRadius: '20px',
        overflow: 'hidden',
        border: '1px solid',
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(226,232,240,0.13)',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(248,249,252,0.76)' : 'rgba(19,20,29,0.72)',
        backdropFilter: 'blur(24px) saturate(1.12)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.12)',
        boxShadow: (theme) => theme.palette.mode === 'light'
          ? '0 12px 30px rgba(15,23,42,0.14), 0 1px 0 rgba(255,255,255,0.72) inset'
          : '0 14px 32px rgba(0,0,0,0.30), 0 1px 0 rgba(255,255,255,0.08) inset',
        transform: compact ? 'translateY(5px)' : 'translateY(0)',
        transition: `left 420ms ${motion.gentleSpring}, right 420ms ${motion.gentleSpring}, transform 420ms ${motion.gentleSpring}, border-radius 360ms ${motion.softOut}`,
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          transform: 'none',
          '&::before': { transition: 'none' },
          '& .MuiBottomNavigation-root, & .MuiBottomNavigationAction-root, & .MuiBottomNavigationAction-label, & .PneumataNavIcon': {
            transition: 'none !important',
          },
          '& .MuiBottomNavigation-root::before': {
            transition: 'none !important',
            transform: 'none !important',
          },
          '& .MuiBottomNavigationAction-root, & .PneumataNavIcon': {
            transform: 'none !important',
          },
        },
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          background: (theme) => theme.palette.mode === 'light'
            ? 'linear-gradient(115deg, rgba(255,255,255,0.52), rgba(255,255,255,0) 54%)'
            : 'linear-gradient(115deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 54%)',
        },
      }}
      elevation={0}
    >
      <BottomNavigation
        ref={navigationRef}
        value={visualIndex}
        onChange={(_, newValue) => {
          if (suppressNextChangeRef.current) {
            suppressNextChangeRef.current = false;
            return;
          }
          const nextPath = mobileItems[newValue]?.path;
          if (nextPath !== location.pathname) navigate(nextPath);
        }}
        showLabels
        sx={{
          height: compact ? 44 : 50,
          transition: `height 360ms ${motion.softOut}`,
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
          },
          position: 'relative',
          bgcolor: 'transparent',
          borderRadius: '16px',
          '&::before': {
            content: '""',
            position: 'absolute',
            zIndex: 0,
            top: compact ? 2 : 3,
            bottom: compact ? 2 : 3,
            left: `calc(${visualIndex * 25}% + 0.75%)`,
            width: '23.5%',
            borderRadius: compact ? '11px' : '13px',
            pointerEvents: 'none',
            background: (theme) => theme.palette.mode === 'light'
              ? 'rgba(255,255,255,0.88)'
              : 'rgba(255,255,255,0.10)',
            border: '1px solid',
            borderColor: (theme) => theme.palette.mode === 'light'
              ? 'rgba(15,23,42,0.06)'
              : 'rgba(226,232,240,0.12)',
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 5px 14px rgba(15,23,42,0.09)'
              : '0 5px 16px rgba(0,0,0,0.22)',
            transition: transition(['left', 'transform'], 380, motion.navTrack),
            transform: `${isPressPreviewing ? 'scaleX(0.965)' : 'scaleX(1)'} scaleY(${compact ? 0.94 : 1})`,
            transformOrigin: 'center',
            willChange: 'left',
          },
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            color: 'text.secondary',
            position: 'relative',
            zIndex: 1,
            borderRadius: '12px',
            mx: 0.2,
            my: compact ? 0 : 0.25,
            py: compact ? 0 : 0.25,
            backgroundColor: 'transparent',
            touchAction: 'pan-y',
            transition: transition(['color', 'opacity', 'background-color', 'transform'], 380, motion.softOut),
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
            },
            '@media (hover: hover) and (pointer: fine)': {
              '&:hover:not(.Mui-selected)': {
                color: 'text.primary',
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.055)' : 'rgba(255,255,255,0.075)',
                transform: 'translateY(-1px)',
              },
              '&:hover .PneumataNavIcon': {
                transform: 'translateY(-1px)',
              },
            },
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: -2,
              bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.055)' : 'rgba(255,255,255,0.075)',
            },
            '& .MuiTouchRipple-root': {
              display: 'none',
            },
            '& .PneumataNavIcon': {
              transition: transition(['transform'], motion.durations.navIcon, motion.navTrack),
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'none',
              },
            },
            '&.Mui-selected .PneumataNavIcon': {
              transform: 'translateY(-0.5px)',
            },
          },
          '& .Mui-selected': {
            color: 'primary.main',
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: 10,
            fontWeight: 650,
            lineHeight: 1.15,
            transform: 'none',
            opacity: compact ? 0.72 : 1,
            transition: transition(['color', 'opacity'], 340, motion.softOut),
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
            },
            '&.Mui-selected': {
              fontSize: 10,
              transform: 'none',
              transitionDelay: `${motion.durations.selectedDelay}ms`,
            },
          },
        }}
      >
        {mobileItems.map((item, index) => (
          <BottomNavigationAction
            key={item.path}
            className="PneumataNavButton"
            disableRipple
            label={t(item.labelKey)}
            icon={<AnimatedNavIcon kind={item.iconKind} active={visualIndex === index} size={23} />}
            onPointerDown={(event) => handlePointerDown(index, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
