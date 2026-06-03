import { Fab, Tooltip, useMediaQuery } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { motion, transition } from '../../styles/motion';

interface ExpandableFabProps {
  icon: ReactNode;
  label: ReactNode;
  ariaLabel: string;
  onClick: () => void;
  color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function ExpandableFab({ icon, label, ariaLabel, onClick, color = 'primary', disabled = false, sx }: ExpandableFabProps) {
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');

  const button = (
    <Fab
      color={color}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      sx={[
        {
          zIndex: 1300,
          minWidth: canHover ? 56 : 'auto',
          width: canHover ? 56 : 'auto',
          height: 56,
          minHeight: 56,
          px: canHover ? 0 : 2.25,
          overflow: 'hidden',
          justifyContent: 'flex-start',
          borderRadius: 999,
          gap: canHover ? 0 : 1,
          boxShadow: (theme) => theme.palette.mode === 'light'
            ? '0 16px 34px rgba(15,23,42,0.18)'
            : '0 18px 42px rgba(0,0,0,0.40)',
          transition: transition(['width', 'min-width', 'padding', 'gap', 'box-shadow', 'transform'], 420, 'cubic-bezier(0.18, 1.35, 0.22, 1)'),
          '&:hover, &:focus-visible': canHover ? {
            width: 'auto',
            minWidth: 56,
            px: 2.25,
            gap: 1,
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 20px 42px rgba(15,23,42,0.22)'
              : '0 22px 52px rgba(0,0,0,0.46)',
          } : undefined,
          '&:active': {
            transform: 'translateY(1px) scale(0.985)',
            transitionTimingFunction: motion.press,
            transitionDuration: `${motion.durations.instant}ms`,
          },
          '& .ExpandableFab-label': {
            display: 'inline-flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
            maxWidth: canHover ? 0 : 220,
            opacity: canHover ? 0 : 1,
            transform: canHover ? 'translateX(-8px)' : 'translateX(0)',
            transition: 'max-width 420ms cubic-bezier(0.18, 1.35, 0.22, 1), opacity 180ms ease 70ms, transform 360ms cubic-bezier(0.18, 1.35, 0.22, 1)',
          },
          '&:hover .ExpandableFab-label, &:focus-visible .ExpandableFab-label': canHover ? {
            maxWidth: 220,
            opacity: 1,
            transform: 'translateX(0)',
          } : undefined,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <span
        aria-hidden
        style={{
          width: 56,
          minWidth: 56,
          height: 56,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
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

  return canHover ? <Tooltip title={ariaLabel} placement="left">{button}</Tooltip> : button;
}
