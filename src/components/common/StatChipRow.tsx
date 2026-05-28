import { Box, Chip } from '@mui/material';
import { compactPillChipSx } from '../../styles/interaction';

interface StatChipRowProps {
  items: string[];
}

export default function StatChipRow({ items }: StatChipRowProps) {
  if (!items.length) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
      {items.map((item) => <Chip key={item} size="small" label={item} variant="outlined" sx={compactPillChipSx} />)}
    </Box>
  );
}
