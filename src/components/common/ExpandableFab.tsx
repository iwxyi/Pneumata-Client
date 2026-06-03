import { Fab, useMediaQuery } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { motion, transition } from '../../styles/motion';

const fabEnter = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const fabExit = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
const fabLabelEnter = 'cubic-bezier(0.2, 1.22, 0.34, 1)';

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
          maxWidth: expandedWidth,
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
            transition(['width', 'min-width'], 360, fabExit),
            transition(['box-shadow', 'transform'], 260, motion.softInOut),
          ].join(', '),
          '&:hover, &:focus-visible': canHover ? {
            width: expandedWidth,
            minWidth: expandedWidth,
            transform: 'translateY(-2px) scale(1.012)',
            transition: [
              transition(['width', 'min-width'], 620, fabEnter),
              transition(['box-shadow', 'transform'], 460, motion.gentleSpring),
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
            transform: 'translateX(0) rotate(0deg)',
            transition: transition(['transform'], 360, motion.softOut),
          },
          '&:hover .ExpandableFab-icon, &:focus-visible .ExpandableFab-icon': canHover ? {
            transform: 'translateX(-1px) rotate(-5deg)',
            transitionDuration: '520ms',
            transitionTimingFunction: motion.gentleSpring,
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
            transform: canHover ? 'translate3d(6px, 3px, 0) scale(0.96)' : 'translate3d(0, 0, 0) scale(1)',
            transformOrigin: 'left center',
            transition: `opacity 150ms ease, transform 280ms ${fabExit}`,
          },
          '&:hover .ExpandableFab-label, &:focus-visible .ExpandableFab-label': canHover ? {
            opacity: 1,
            transform: 'translate3d(0, 0, 0) scale(1)',
            transition: `opacity 220ms ease 150ms, transform 520ms ${fabLabelEnter} 90ms`,
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
