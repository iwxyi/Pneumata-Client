import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { PaperSurfaceVariant } from '../../types/artifactAppearance';

const paperSurfacePresets: Record<PaperSurfaceVariant, SxProps<Theme>> = {
  lined: {
    borderRadius: 2,
    border: '1px solid rgba(180, 150, 90, 0.28)',
    bgcolor: '#fffdf4',
    backgroundImage: 'linear-gradient(rgba(90, 120, 170, 0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(180, 80, 70, 0.18) 1px, transparent 1px)',
    backgroundSize: '100% 30px, 46px 100%',
    backgroundPosition: '0 58px, 54px 0',
    boxShadow: '0 12px 30px rgba(87, 69, 35, 0.12)',
    color: '#2f2a21',
  },
  plain: {
    borderRadius: 2,
    border: '1px solid rgba(190, 176, 138, 0.32)',
    bgcolor: '#fffaf0',
    backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.62), rgba(245,232,198,0.28))',
    boxShadow: '0 12px 30px rgba(87, 69, 35, 0.10)',
    color: '#2f2a21',
  },
  letter: {
    borderRadius: 1.5,
    border: '1px solid rgba(128, 96, 54, 0.24)',
    bgcolor: '#fbf3df',
    backgroundImage: 'linear-gradient(rgba(94, 70, 38, 0.055) 1px, transparent 1px), radial-gradient(circle at 18% 12%, rgba(255,255,255,0.52), transparent 34%), linear-gradient(135deg, rgba(130, 88, 36, 0.10), transparent 42%)',
    backgroundSize: '100% 32px, 100% 100%, 100% 100%',
    backgroundPosition: '0 62px, 0 0, 0 0',
    boxShadow: '0 16px 34px rgba(73, 48, 21, 0.15)',
    color: '#302719',
  },
  night: {
    borderRadius: 2,
    border: '1px solid rgba(139, 164, 203, 0.26)',
    bgcolor: '#202632',
    backgroundImage: 'linear-gradient(rgba(174, 196, 230, 0.10) 1px, transparent 1px), linear-gradient(135deg, rgba(71, 88, 121, 0.42), rgba(32, 38, 50, 0.92))',
    backgroundSize: '100% 30px, 100% 100%',
    backgroundPosition: '0 58px, 0 0',
    boxShadow: '0 14px 32px rgba(13, 18, 29, 0.22)',
    color: '#eef2f8',
    '& .MuiTypography-root': {
      color: 'inherit',
    },
    '& .MuiChip-root': {
      borderColor: 'rgba(238,242,248,0.35)',
      color: '#eef2f8',
    },
  },
};

export default function PaperSurface({
  children,
  variant = 'lined',
  minHeight = 260,
  contentInset = true,
  sx,
}: {
  children: ReactNode;
  variant?: PaperSurfaceVariant;
  minHeight?: number;
  contentInset?: boolean;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      sx={[
        paperSurfacePresets[variant],
        {
          p: { xs: 2, sm: 2.75 },
          minHeight,
          '& .paper-surface-content': {
            pl: contentInset ? { xs: 0, sm: 5 } : 0,
            position: 'relative',
            zIndex: 1,
          },
          '& .paper-surface-muted': {
            color: 'currentColor',
            opacity: 0.62,
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}
