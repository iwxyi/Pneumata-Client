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
        borderRadius: 2.5,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
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
