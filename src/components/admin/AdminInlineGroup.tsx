import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

type AdminInlineGroupProps = {
  children: ReactNode;
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  gap?: number;
  sx?: SxProps<Theme>;
};

export default function AdminInlineGroup({
  children,
  alignItems = 'center',
  gap = 1,
  sx,
}: AdminInlineGroupProps) {
  const sxList = Array.isArray(sx) ? sx : [sx];
  return (
    <Box
      sx={[
        {
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems,
          justifyContent: 'flex-start',
          gap,
          '& > .MuiAlert-root': {
            flex: '0 1 auto',
            width: 'auto',
            maxWidth: '100%',
          },
          '& > .MuiButton-root, & > .MuiChip-root': {
            flex: '0 0 auto',
          },
        },
        ...sxList,
      ]}
    >
      {children}
    </Box>
  );
}
