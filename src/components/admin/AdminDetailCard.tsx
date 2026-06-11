import { Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export default function AdminDetailCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2.5 }}>
      <Stack spacing={1.25}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{title}</Typography>
        {children}
      </Stack>
    </Paper>
  );
}
