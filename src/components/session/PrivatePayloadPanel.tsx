import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';

interface PrivatePayloadPanelProps {
  payloads: Array<{ key: string; title: string; text: string }>;
}

export default function PrivatePayloadPanel({ payloads }: PrivatePayloadPanelProps) {
  if (!payloads.length) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>私有信息</Typography>
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
      </CardContent>
    </Card>
  );
}
