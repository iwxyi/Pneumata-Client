import { Box, Chip, Stack, Typography } from '@mui/material';
import SurfaceCard from '../common/SurfaceCard';
import SectionHeader from '../common/SectionHeader';

interface PrivatePayloadPanelProps {
  payloads: Array<{ key: string; title: string; text: string }>;
}

export default function PrivatePayloadPanel({ payloads }: PrivatePayloadPanelProps) {
  if (!payloads.length) return null;

  return (
    <SurfaceCard>
      <SectionHeader title="私有信息" dense />
      <Stack spacing={1}>
        {payloads.map((payload) => (
          <Box key={payload.key} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{payload.title}</Typography>
              <Chip size="small" label="private" variant="outlined" />
            </Box>
            <Typography variant="caption" color="text.secondary">{payload.text}</Typography>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}
