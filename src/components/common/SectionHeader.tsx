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
    <Box sx={{ display: 'flex', alignItems: dense ? 'center' : 'flex-start', justifyContent: 'space-between', gap: 1.25, mb: dense ? 0.9 : 1.25 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 820, letterSpacing: 0, lineHeight: 1.22 }}>{title}</Typography>
        {subtitle ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.45, opacity: 0.78, lineHeight: 1.65 }}>{subtitle}</Typography> : null}
      </Box>
      {action}
    </Box>
  );
}
