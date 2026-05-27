import { Box, Skeleton } from '@mui/material';
import { buildListGridSx } from '../../styles/interaction';

interface ListSkeletonGridProps {
  count?: number;
}

export default function ListSkeletonGrid({ count = 6 }: ListSkeletonGridProps) {
  return (
    <Box sx={buildListGridSx()}>
      {Array.from({ length: count }).map((_, index) => (
        <Box
          key={index}
          sx={{
            p: 2,
            minHeight: 132,
            borderRadius: 1,
            border: '1px solid',
            borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.55)' : 'rgba(18,20,28,0.55)',
          }}
        >
          <Skeleton variant="text" width="58%" height={26} />
          <Skeleton variant="text" width="82%" height={20} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
            <Skeleton variant="circular" width={30} height={30} />
            <Skeleton variant="circular" width={30} height={30} />
            <Box sx={{ flex: 1 }} />
            <Skeleton variant="text" width={54} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
