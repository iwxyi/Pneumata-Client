import { Fab, useMediaQuery } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { motion, transition } from '../../styles/motion';

const springOut = 'linear(0, 0.012 1.3%, 0.05 2.7%, 0.189 5.8%, 0.415 9.4%, 0.974 18.4%, 1.116 22.6%, 1.17 26.3%, 1.152 30.7%, 1.067 38.1%, 1.017 44.3%, 0.996 50.6%, 0.993 57.1%, 1.003 73.7%, 1)';
const settleOut = 'linear(0, 0.012 1.5%, 0.048 3%, 0.154 6.3%, 0.353 10.4%, 0.756 18.6%, 0.954 24.6%, 1.03 31.4%, 1.016 39.6%, 0.998 53.6%, 1)';

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
          transition: transition(['width', 'min-width', 'box-shadow', 'transform'], 460, settleOut),
          '&:hover, &:focus-visible': canHover ? {
            width: expandedWidth,
            minWidth: expandedWidth,
            transform: 'translateY(-1px) scale(1.018)',
            transitionTimingFunction: springOut,
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
            transform: canHover ? 'translateX(-4px)' : 'translateX(0)',
            transition: `opacity 170ms ease 80ms, transform 440ms ${settleOut}`,
          },
          '&:hover .ExpandableFab-label, &:focus-visible .ExpandableFab-label': canHover ? {
            opacity: 1,
            transform: 'translateX(0)',
            transitionTimingFunction: `ease, ${springOut}`,
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
