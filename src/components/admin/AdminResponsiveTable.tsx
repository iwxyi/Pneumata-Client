import { Paper, TableContainer } from '@mui/material';
import type { ReactNode } from 'react';

export default function AdminResponsiveTable({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <div style={{ minWidth }}>
          {children}
        </div>
      </TableContainer>
    </Paper>
  );
}
