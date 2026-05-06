import { Stack } from '@mui/material';
import type { ReactNode } from 'react';

interface PageSectionProps {
  children: ReactNode;
  spacing?: number;
}

export default function PageSection({ children, spacing = 2 }: PageSectionProps) {
  return <Stack spacing={spacing}>{children}</Stack>;
}
