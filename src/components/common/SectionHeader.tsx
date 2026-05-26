import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  dense?: boolean;
}

export default function SectionHeader({ title, subtitle, action, dense = false }: SectionHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: dense ? 'center' : 'flex-start', justifyContent: 'space-between', gap: 1, mb: dense ? 0.9 : 1.15 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 780, letterSpacing: 0 }}>{title}</Typography>
        {subtitle ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, opacity: 0.82 }}>{subtitle}</Typography> : null}
      </Box>
      {action}
    </Box>
  );
}
