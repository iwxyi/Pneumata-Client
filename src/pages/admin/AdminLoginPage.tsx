import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAuthStore } from '../../stores/useAdminAuthStore';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoggedIn, isLoading } = useAdminAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const nextPath = (() => {
    const from = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
    if (!from?.pathname?.startsWith('/admin')) return '/admin';
    return `${from.pathname}${from.search || ''}${from.hash || ''}`;
  })();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await login(email.trim(), password);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    }
  };

  if (isLoggedIn) {
    return <Navigate to={nextPath} replace />;
  }

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default' }}>
      <Paper component="form" onSubmit={handleSubmit} sx={{ width: '100%', maxWidth: 420, p: 3, borderRadius: 3 }} elevation={4}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>后台登录</Typography>
            <Typography variant="body2" color="text.secondary">使用管理员邮箱和密码登录 /admin</Typography>
          </Box>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <TextField label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading}
          >
            登录后台
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
