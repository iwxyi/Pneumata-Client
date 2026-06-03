import { Fab, useMediaQuery } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { motion, transition } from '../../styles/motion';

const fabSpring = 'cubic-bezier(0.12, 1.48, 0.24, 1)';
const fabSettle = 'cubic-bezier(0.22, 1, 0.36, 1)';
const fabLabelSpring = 'cubic-bezier(0.1, 1.54, 0.22, 1)';

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
            animation: 'ExpandableFab-jelly-shell 680ms cubic-bezier(0.18, 1.18, 0.28, 1)',
            transition: [
              transition(['width', 'min-width'], 640, fabSpring),
              transition(['box-shadow'], 440, fabSpring),
            ].join(', '),
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 20px 42px rgba(15,23,42,0.22)'
              : '0 22px 52px rgba(0,0,0,0.46)',
          } : undefined,
          '@keyframes ExpandableFab-jelly-shell': {
            '0%': { borderRadius: 999 },
            '38%': { borderRadius: 24 },
            '62%': { borderRadius: 34 },
            '100%': { borderRadius: 999 },
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
            transform: 'translateX(-2px) scaleX(1.16) scaleY(0.9)',
            transitionDuration: '620ms',
            transitionTimingFunction: fabSpring,
          } : undefined,
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
            transition: `opacity 220ms ease 120ms, transform 680ms ${fabLabelSpring} 80ms`,
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
