import { Box, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  subtitleTooltip?: string;
  action?: ReactNode;
  dense?: boolean;
  sx?: SxProps<Theme>;
}

export default function SectionHeader({ title, subtitle, subtitleTooltip, action, dense = false, sx }: SectionHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: dense ? 'center' : 'flex-start', justifyContent: 'space-between', gap: 1.25, mb: dense ? 0.9 : 1.25, ...sx }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 820, letterSpacing: 0, lineHeight: 1.22 }}>{title}</Typography>
        {subtitle ? (
          subtitleTooltip ? (
            <Tooltip title={subtitleTooltip} arrow placement="top-start">
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.45, opacity: 0.78, lineHeight: 1.65, cursor: 'help', width: 'fit-content' }}>{subtitle}</Typography>
            </Tooltip>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.45, opacity: 0.78, lineHeight: 1.65 }}>{subtitle}</Typography>
          )
        ) : null}
      </Box>
      {action}
    </Box>
  );
}
