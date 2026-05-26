import { Stack } from '@mui/material';
import type { ReactNode } from 'react';

interface PageSectionProps {
  children: ReactNode;
  spacing?: number;
  fill?: boolean;
  animate?: boolean;
}

export default function PageSection({ children, spacing = 2, fill = false, animate = true }: PageSectionProps) {
  return (
    <Stack
      spacing={spacing}
      sx={{
        ...(fill ? { flex: 1, minHeight: 0, height: '100%' } : {}),
        ...(animate ? {
          '@keyframes pageSectionIn': {
            from: { opacity: 0, transform: 'translateY(18px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          '& > *': {
            animation: 'pageSectionIn 520ms cubic-bezier(0.22, 1, 0.36, 1) both',
          },
          '& > *:nth-of-type(2)': { animationDelay: '70ms' },
          '& > *:nth-of-type(3)': { animationDelay: '130ms' },
          '& > *:nth-of-type(4)': { animationDelay: '190ms' },
          '@media (prefers-reduced-motion: reduce)': {
            '& > *': {
              animation: 'none',
            },
          },
        } : {}),
      }}
    >
      {children}
    </Stack>
  );
}
