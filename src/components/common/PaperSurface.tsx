import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export type PaperSurfaceVariant = 'lined';

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
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}
