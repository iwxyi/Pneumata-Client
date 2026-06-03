import { Fab, useMediaQuery } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { motion, transition } from '../../styles/motion';

const fabSpring = 'linear(0, 0.009 1%, 0.038 2.2%, 0.146 4.8%, 0.319 8%, 0.558 12.1%, 0.893 18%, 1.102 23.1%, 1.182 28.2%, 1.168 33.1%, 1.087 42.4%, 1.019 53.2%, 0.988 65.1%, 0.998 80.2%, 1)';
const fabSettle = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface ExpandableFabProps {
  icon: ReactNode;
  label: ReactNode;
  ariaLabel: string;
  onClick: () => void;
  color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  disabled?: boolean;
  sx?: SxProps<Theme>;
  expandedWidth?: number;
}

export default function ExpandableFab({ icon, label, ariaLabel, onClick, color = 'primary', disabled = false, sx, expandedWidth = 132 }: ExpandableFabProps) {
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');

  return (
    <Fab
      color={color}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      sx={[
        {
          zIndex: 1300,
          width: canHover ? 56 : expandedWidth,
          minWidth: canHover ? 56 : expandedWidth,
          maxWidth: canHover ? expandedWidth + 12 : expandedWidth,
          height: 56,
          minHeight: 56,
          p: 0,
          overflow: 'hidden',
          justifyContent: 'flex-start',
          borderRadius: '999px',
          boxShadow: (theme) => theme.palette.mode === 'light'
            ? '0 16px 34px rgba(15,23,42,0.18)'
            : '0 18px 42px rgba(0,0,0,0.40)',
          transformOrigin: 'right center',
          transition: [
            transition(['width', 'min-width'], 420, fabSettle),
            transition(['box-shadow'], 320, fabSettle),
          ].join(', '),
          '&:hover, &:focus-visible': canHover ? {
            width: expandedWidth,
            minWidth: expandedWidth,
            borderRadius: '999px',
            transition: [
              transition(['width', 'min-width'], 760, fabSpring),
              transition(['box-shadow'], 500, fabSpring),
            ].join(', '),
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 20px 42px rgba(15,23,42,0.22)'
              : '0 22px 52px rgba(0,0,0,0.46)',
          } : undefined,
          '&:active': {
            transform: 'translateY(1px) scale(0.985)',
            transitionTimingFunction: motion.press,
            transitionDuration: `${motion.durations.instant}ms`,
          },
          '& .ExpandableFab-icon': {
            width: 56,
            minWidth: 56,
            height: 56,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transform: 'translateX(0) scale(1)',
            transition: transition(['transform'], 360, fabSettle),
          },
          '& .ExpandableFab-label': {
            minWidth: 0,
            width: expandedWidth - 68,
            pr: 2,
            ml: -0.25,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            opacity: canHover ? 0 : 1,
            transform: canHover ? 'translate3d(8px, 0, 0)' : 'translate3d(0, 0, 0)',
            transformOrigin: 'left center',
            transition: `opacity 150ms ease, transform 300ms ${fabSettle}`,
          },
          '&:hover .ExpandableFab-label, &:focus-visible .ExpandableFab-label': canHover ? {
            opacity: 1,
            transform: 'translate3d(0, 0, 0)',
            transition: `opacity 220ms ease 120ms, transform 420ms ${fabSettle} 80ms`,
          } : undefined,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <span
        aria-hidden
        className="ExpandableFab-icon"
      >
        {icon}
      </span>
      <span
        className="ExpandableFab-label"
      >
        {label}
      </span>
    </Fab>
  );
}
