import { Box, ButtonBase } from '@mui/material';
import type { ReactNode } from 'react';
import type { Theme } from '@mui/material/styles';
import { motion, transition } from '../../styles/motion';

type FloatingSegmentedTab<T extends string | number> = {
  value: T;
  label: ReactNode;
};

export type FloatingSegmentedTabsProps<T extends string | number> = {
  value: T;
  items: FloatingSegmentedTab<T>[];
  onChange: (value: T) => void;
  equalWidth?: boolean;
  comfortable?: boolean;
};

export function buildFloatingTabContainerSx() {
  return {
    position: 'sticky',
    top: 'var(--app-floating-tab-top, 12px)',
    zIndex: 8,
    mb: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 1,
    transition: `top ${motion.durations.slow}ms ${motion.emphasized}`,
  } as const;
}

export function buildFloatingTabGroupSx() {
  return {
    display: 'inline-flex',
    maxWidth: '100%',
    borderRadius: { xs: '14px', sm: '15px' },
    p: { xs: 0.45, sm: 0.5 },
    bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.68)' : 'rgba(16,18,26,0.62)',
    border: '1px solid',
    borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.075)' : 'rgba(226,232,240,0.095)',
    backdropFilter: 'blur(22px) saturate(1.05)',
    WebkitBackdropFilter: 'blur(22px) saturate(1.05)',
    boxShadow: (theme: Theme) => theme.palette.mode === 'light'
      ? '0 14px 34px rgba(15,23,42,0.075), 0 1px 0 rgba(255,255,255,0.86) inset'
      : '0 18px 38px rgba(0,0,0,0.30), 0 1px 0 rgba(255,255,255,0.055) inset',
    overflowX: 'auto',
    overscrollBehaviorX: 'contain',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
  } as const;
}

export default function FloatingSegmentedTabs<T extends string | number>({ value, items, onChange, equalWidth = true, comfortable = true }: FloatingSegmentedTabsProps<T>) {
  return (
    <Box sx={buildFloatingTabGroupSx()}>
      <Box
        sx={{
          display: 'flex',
          gap: comfortable ? { xs: 0.25, sm: 0.4 } : { xs: 0.25, sm: 0.35 },
          minWidth: 0,
        }}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <ButtonBase
              key={String(item.value)}
              onClick={() => onChange(item.value)}
              aria-pressed={selected}
              sx={{
                minHeight: { xs: 36, sm: 38 },
                minWidth: equalWidth
                  ? comfortable ? { xs: 58, sm: 74, md: 88 } : { xs: 58, sm: 68 }
                  : 'max-content',
                flex: equalWidth ? '1 1 auto' : '0 1 auto',
                px: comfortable ? { xs: 1.2, sm: 1.8, md: 2.2 } : { xs: 1.35, sm: 1.75 },
                borderRadius: { xs: '10px', sm: '11px' },
                color: selected ? 'primary.main' : 'text.secondary',
                bgcolor: selected
                  ? (theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.12)' : 'rgba(120,156,220,0.18)'
                  : 'transparent',
                boxShadow: selected
                  ? (theme) => theme.palette.mode === 'light'
                    ? '0 8px 18px rgba(49,90,156,0.12), 0 1px 0 rgba(255,255,255,0.72) inset'
                    : '0 10px 22px rgba(0,0,0,0.24), 0 1px 0 rgba(255,255,255,0.06) inset'
                  : 'none',
                fontWeight: 760,
                fontSize: { xs: '0.8rem', sm: '0.875rem' },
                whiteSpace: 'nowrap',
                opacity: selected ? 1 : 0.78,
                overflow: 'hidden',
                outline: '1px solid transparent',
                transition: transition(['background-color', 'color', 'opacity', 'box-shadow', 'outline-color', 'transform'], motion.durations.base, selected ? motion.gentleSpring : motion.softOut),
                '&:hover': {
                  opacity: 1,
                  bgcolor: selected
                    ? (theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.145)' : 'rgba(120,156,220,0.21)'
                    : (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.045)' : 'rgba(226,232,240,0.07)',
                  outlineColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.045)' : 'rgba(226,232,240,0.06)',
                },
                '&:active': {
                  transform: 'scale(0.982)',
                  transitionTimingFunction: motion.press,
                  transitionDuration: `${motion.durations.instant}ms`,
                  bgcolor: selected
                    ? (theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.16)' : 'rgba(120,156,220,0.24)'
                    : (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.06)' : 'rgba(226,232,240,0.085)',
                },
                '&:focus-visible': {
                  outlineColor: 'primary.main',
                  boxShadow: (theme) => theme.palette.mode === 'light'
                    ? '0 0 0 3px rgba(49,90,156,0.13)'
                    : '0 0 0 3px rgba(120,156,220,0.18)',
                },
                '& .MuiTouchRipple-root': {
                  borderRadius: 'inherit',
                  overflow: 'hidden',
                },
                '& .MuiTouchRipple-child': {
                  borderRadius: 'inherit',
                },
              }}
            >
              <Box component="span" sx={{ display: 'block', minWidth: 0, whiteSpace: 'nowrap' }}>
                {item.label}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
