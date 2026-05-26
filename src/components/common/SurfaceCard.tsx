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
        borderRadius: 1,
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.08)' : 'rgba(226, 232, 240, 0.10)',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.70)' : 'rgba(18, 20, 28, 0.70)',
        boxShadow: (theme) => theme.palette.mode === 'light'
          ? '0 1px 2px rgba(15, 23, 42, 0.03), 0 18px 52px rgba(15, 23, 42, 0.06)'
          : '0 1px 0 rgba(255,255,255,0.035) inset, 0 20px 56px rgba(0,0,0,0.30)',
        backdropFilter: 'blur(22px) saturate(1.16)',
        WebkitBackdropFilter: 'blur(22px) saturate(1.16)',
        ...sx,
      }}
      {...cardProps}
    >
      <CardContent sx={{ p: { xs: 2, sm: 2.25 }, '&:last-child': { pb: { xs: 2, sm: 2.25 } }, ...contentSx }}>
        {children}
      </CardContent>
    </Card>
  );
}
