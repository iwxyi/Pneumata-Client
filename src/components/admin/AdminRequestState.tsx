import { Alert, Button, LinearProgress, Stack } from '@mui/material';

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
  if (!loading && !error) return null;

  return (
    <Stack spacing={1}>
      {loading ? <LinearProgress sx={{ borderRadius: 999 }} /> : null}
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
