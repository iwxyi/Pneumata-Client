import { Alert, Box, Button, LinearProgress, Stack } from '@mui/material';

export function getAdminErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return '请求失败，请稍后重试';
}

export default function AdminRequestState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  return (
    <Stack spacing={1}>
      <Box sx={{ height: 4, borderRadius: 999, overflow: 'hidden' }}>
        {loading ? <LinearProgress sx={{ height: '100%' }} /> : null}
      </Box>
      {error ? (
        <Alert
          severity="error"
          action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>重试</Button> : undefined}
        >
          {error}
        </Alert>
      ) : null}
    </Stack>
  );
}
