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
        borderColor: 'rgba(148, 163, 184, 0.18)',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03), 0 8px 24px rgba(15, 23, 42, 0.04)',
        backdropFilter: 'blur(8px)',
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
