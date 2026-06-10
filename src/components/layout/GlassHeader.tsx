import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { motion, transition } from '../../styles/motion';

interface GlassHeaderProps {
  title?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  hidden?: boolean;
  overlay?: boolean;
  safeAreaTop?: boolean;
  zIndex?: number;
}

export const GLASS_HEADER_HEIGHT = 64;

export default function GlassHeader({
  title,
  leading,
  actions,
  hidden = false,
  overlay = true,
  safeAreaTop = false,
  zIndex = 1198,
}: GlassHeaderProps) {
  return (
    <Box
      sx={{
        position: overlay ? 'absolute' : 'relative',
        top: overlay ? 0 : 'auto',
        left: overlay ? 0 : 'auto',
        right: overlay ? 0 : 'auto',
        zIndex,
        minHeight: safeAreaTop ? `calc(${GLASS_HEADER_HEIGHT}px + env(safe-area-inset-top, 0px))` : GLASS_HEADER_HEIGHT,
        pt: safeAreaTop ? 'env(safe-area-inset-top, 0px)' : 0,
        px: { xs: 1.5, sm: 2.5 },
        py: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        transform: hidden ? 'translateY(-100%)' : 'translateY(0)',
        pointerEvents: hidden ? 'none' : 'auto',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(245,245,247,0.68)' : 'rgba(10,10,15,0.42)',
        backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        borderBottom: '1px solid',
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(226,232,240,0.055)',
        boxShadow: (theme) => theme.palette.mode === 'light'
          ? '0 1px 0 rgba(255,255,255,0.34) inset, 0 8px 18px rgba(15,23,42,0.010)'
          : '0 1px 0 rgba(255,255,255,0.05) inset, 0 10px 22px rgba(0,0,0,0.10)',
        transition: [
          `transform 320ms ${motion.emphasized}`,
          transition(['background-color', 'backdrop-filter', 'border-color', 'box-shadow'], 220, motion.standard),
        ].join(', '),
        '&::after': {
          content: '""',
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: -36,
          height: 36,
          pointerEvents: 'none',
          backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(18px) saturate(0.92) brightness(0.84)',
          WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(18px) saturate(0.92) brightness(0.84)',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.72), rgba(0,0,0,0.22) 58%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.72), rgba(0,0,0,0.22) 58%, transparent)',
          background: (theme) => theme.palette.mode === 'light'
            ? 'linear-gradient(rgba(245,245,247,0.18), rgba(245,245,247,0))'
            : 'linear-gradient(rgba(10,10,15,0.12), rgba(10,10,15,0))',
        },
      }}
    >
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75, flex: 1 }}>
        {leading}
        {typeof title === 'string' || typeof title === 'number' ? (
          <Typography
            variant="subtitle1"
            sx={{
              minWidth: 0,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </Typography>
        ) : title != null ? (
          <Box sx={{ minWidth: 0, flex: 1, minHeight: 40, display: 'flex', alignItems: 'center' }}>{title}</Box>
        ) : null}
      </Box>
      {actions ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
          {actions}
        </Box>
      ) : null}
    </Box>
  );
}
