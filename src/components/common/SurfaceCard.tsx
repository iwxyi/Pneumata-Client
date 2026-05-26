import { Card, CardContent, type CardProps, type CardContentProps } from '@mui/material';
import type { ReactNode } from 'react';

interface SurfaceCardProps extends Omit<CardProps, 'children'> {
  children: ReactNode;
  contentSx?: CardContentProps['sx'];
}

export default function SurfaceCard({ children, contentSx, sx, ...cardProps }: SurfaceCardProps) {
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 3,
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.08)' : 'rgba(226, 232, 240, 0.10)',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.74)' : 'rgba(18, 20, 28, 0.72)',
        boxShadow: (theme) => theme.palette.mode === 'light'
          ? '0 1px 2px rgba(15, 23, 42, 0.03), 0 18px 48px rgba(15, 23, 42, 0.055)'
          : '0 1px 0 rgba(255,255,255,0.03) inset, 0 18px 48px rgba(0,0,0,0.26)',
        backdropFilter: 'blur(18px) saturate(1.12)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.12)',
        ...sx,
      }}
      {...cardProps}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, ...contentSx }}>
        {children}
      </CardContent>
    </Card>
  );
}
