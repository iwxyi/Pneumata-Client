import { Fab, useMediaQuery } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { motion, transition } from '../../styles/motion';

const fabSpring = 'cubic-bezier(0.16, 1.24, 0.28, 1)';
const fabSettle = 'cubic-bezier(0.22, 1, 0.36, 1)';
const fabJelly = 'cubic-bezier(0.18, 1.1, 0.26, 1)';

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
          '--ExpandableFab-expandedWidth': `${expandedWidth}px`,
          width: canHover ? 56 : expandedWidth,
          minWidth: canHover ? 56 : expandedWidth,
          maxWidth: canHover ? expandedWidth + 14 : expandedWidth,
          height: 56,
          minHeight: 56,
          p: 0,
          overflow: 'hidden',
          justifyContent: 'flex-start',
          borderRadius: 999,
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
            animation: `ExpandableFab-jelly-shell 760ms ${fabJelly}`,
            transition: [
              transition(['width', 'min-width'], 620, fabSpring),
              transition(['box-shadow'], 440, fabSpring),
            ].join(', '),
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 20px 42px rgba(15,23,42,0.22)'
              : '0 22px 52px rgba(0,0,0,0.46)',
          } : undefined,
          '@keyframes ExpandableFab-jelly-shell': {
            '0%': {
              width: 56,
              minWidth: 56,
              borderRadius: 999,
            },
            '42%': {
              width: 'calc(var(--ExpandableFab-expandedWidth) + 12px)',
              minWidth: 'calc(var(--ExpandableFab-expandedWidth) + 12px)',
              borderRadius: 22,
            },
            '68%': {
              width: 'calc(var(--ExpandableFab-expandedWidth) + 3px)',
              minWidth: 'calc(var(--ExpandableFab-expandedWidth) + 3px)',
              borderRadius: 36,
            },
            '100%': {
              width: 'var(--ExpandableFab-expandedWidth)',
              minWidth: 'var(--ExpandableFab-expandedWidth)',
              borderRadius: 999,
            },
          },
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
          '&:hover .ExpandableFab-icon, &:focus-visible .ExpandableFab-icon': canHover ? {
            transform: 'translateX(0) scale(1)',
            animation: `ExpandableFab-jelly-icon 720ms ${fabJelly}`,
          } : undefined,
          '@keyframes ExpandableFab-jelly-icon': {
            '0%': { transform: 'translateX(0) scale(1)' },
            '40%': { transform: 'translateX(-3px) scaleX(1.2) scaleY(0.86)' },
            '68%': { transform: 'translateX(1px) scaleX(0.96) scaleY(1.08)' },
            '100%': { transform: 'translateX(0) scale(1)' },
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
            transform: canHover ? 'translate3d(14px, 0, 0) scaleX(0.86) scaleY(1.08)' : 'translate3d(0, 0, 0) scale(1)',
            transformOrigin: 'left center',
            transition: `opacity 150ms ease, transform 300ms ${fabSettle}`,
          },
          '&:hover .ExpandableFab-label, &:focus-visible .ExpandableFab-label': canHover ? {
            opacity: 1,
            transform: 'translate3d(0, 0, 0) scale(1)',
            animation: `ExpandableFab-jelly-label 760ms ${fabJelly} 80ms both`,
            transition: 'opacity 220ms ease 120ms',
          } : undefined,
          '@keyframes ExpandableFab-jelly-label': {
            '0%': { transform: 'translate3d(14px, 0, 0) scaleX(0.86) scaleY(1.08)' },
            '42%': { transform: 'translate3d(-3px, 0, 0) scaleX(1.08) scaleY(0.94)' },
            '68%': { transform: 'translate3d(1px, 0, 0) scaleX(0.98) scaleY(1.03)' },
            '100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          },
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
