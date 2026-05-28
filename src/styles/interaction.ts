import type { Theme } from '@mui/material/styles';
import { motion, transition } from './motion';

interface InteractiveSurfaceOptions {
  selected?: boolean;
  radius?: number;
  blur?: number;
}

export function buildInteractiveSurfaceSx({ selected = false, radius = 1, blur = 14 }: InteractiveSurfaceOptions = {}) {
  return {
    position: 'relative',
    borderRadius: radius,
    border: '1px solid',
    borderColor: selected
      ? 'primary.main'
      : (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
    bgcolor: (theme: Theme) => {
      if (selected) return theme.palette.mode === 'light' ? 'rgba(49,90,156,0.085)' : 'rgba(120,156,220,0.12)';
      return theme.palette.mode === 'light' ? 'rgba(255,255,255,0.76)' : 'rgba(18,20,28,0.78)';
    },
    boxShadow: selected
      ? (theme: Theme) => theme.palette.mode === 'light'
        ? '0 0 0 1px rgba(49,90,156,0.20) inset, 0 14px 34px rgba(49,90,156,0.10)'
        : '0 0 0 1px rgba(120,156,220,0.22) inset, 0 18px 42px rgba(0,0,0,0.30)'
      : 'none',
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    transition: transition(['box-shadow', 'border-color', 'background-color', 'transform'], motion.durations.base, motion.softOut),
    '&:hover': {
      borderColor: 'primary.main',
      bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.90)' : 'rgba(24,27,38,0.88)',
      boxShadow: (theme: Theme) => theme.palette.mode === 'light'
        ? '0 0 0 1px rgba(49,90,156,0.10) inset, 0 14px 34px rgba(15,23,42,0.075)'
        : '0 0 0 1px rgba(120,156,220,0.13) inset, 0 18px 42px rgba(0,0,0,0.28)',
    },
    '&:active': {
      transform: 'scale(0.996)',
      transitionTimingFunction: motion.press,
      transitionDuration: `${motion.durations.instant}ms`,
    },
    '& .MuiCardActionArea-focusHighlight': {
      display: 'none',
    },
  };
}

export function buildSelectionRailSx(selected: boolean, width = 3) {
  return {
    content: '""',
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width,
    bgcolor: 'primary.main',
    opacity: selected ? 0.9 : 0,
    pointerEvents: 'none',
    transition: transition(['opacity', 'width'], motion.durations.base, motion.softOut),
  };
}

export function buildListGridSx() {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr',
    '@container (min-width: 560px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@container (min-width: 900px)': {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    },
    gap: 1.5,
    alignItems: 'stretch',
  };
}

export function buildFloatingActionSx() {
  return {
    zIndex: 1300,
    minHeight: 56,
    px: 2.25,
    borderRadius: 999,
    boxShadow: (theme: Theme) => theme.palette.mode === 'light'
      ? '0 16px 34px rgba(15,23,42,0.18)'
      : '0 18px 42px rgba(0,0,0,0.40)',
  };
}

export const compactPillChipSx = {
  height: 22,
  borderRadius: 999,
  fontSize: 11,
  '& .MuiChip-label': {
    px: 1,
  },
};

export const microPillChipSx = {
  height: 20,
  borderRadius: 999,
  fontSize: 11,
  '& .MuiChip-label': {
    px: 0.85,
  },
};
