import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  Alert,
  InputAdornment,
  CircularProgress,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import LockIcon from '@mui/icons-material/Lock';
import { useAuthStore } from '../stores/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, sendCode, isLoggedIn, isLoading } = useAuthStore();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [mockCode, setMockCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleSendCode = useCallback(async () => {
    if (!phone || phone.length < 5) {
      setError('请输入有效的手机号');
      return;
    }

    setSendingCode(true);
    setError('');
    try {
      const result = await sendCode(phone);
      setCodeSent(true);
      setCountdown(60);
      if (result.mock && result.code) {
        setMockCode(result.code);
        setCode(result.code); // Auto-fill in dev mode
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送验证码失败');
    } finally {
      setSendingCode(false);
    }
  }, [phone, sendCode]);

  const handleLogin = useCallback(async () => {
    if (!phone || !code) {
      setError('请输入手机号和验证码');
      return;
    }

    setError('');
    try {
      await login(phone, code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    }
  }, [phone, code, login, navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (!codeSent) {
          handleSendCode();
        } else {
          handleLogin();
        }
      }
    },
    [codeSent, handleSendCode, handleLogin]
  );

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: (theme) =>
          theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        p: 2,
      }}
    >
      <Paper
        elevation={8}
        sx={{
          p: 4,
          width: '100%',
          maxWidth: 400,
          borderRadius: 3,
        }}
      >
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h3" sx={{ mb: 1 }}>
            🍵
          </Typography>
          <Typography variant="h5" fontWeight="bold">
            AI Chat Group
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            AI 群聊模拟平台
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {mockCode && (
          <Alert severity="info" sx={{ mb: 2 }}>
            开发模式 - 验证码：{mockCode}
          </Alert>
        )}

        <TextField
          fullWidth
          label="手机号"
          placeholder="请输入手机号"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ mb: 2 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <PhoneIcon />
                </InputAdornment>
              ),
            },
          }}
        />

        {codeSent && (
          <TextField
            fullWidth
            label="验证码"
            placeholder="请输入验证码"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            sx={{ mb: 2 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <LockIcon />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}

        {!codeSent ? (
          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleSendCode}
            disabled={sendingCode || !phone}
            sx={{ py: 1.5, borderRadius: 2 }}
          >
            {sendingCode ? <CircularProgress size={24} /> : '获取验证码'}
          </Button>
        ) : (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              onClick={handleSendCode}
              disabled={countdown > 0 || sendingCode}
              sx={{ minWidth: 120, borderRadius: 2 }}
            >
              {countdown > 0 ? `${countdown}s` : '重新发送'}
            </Button>
            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleLogin}
              disabled={isLoading || !code}
              sx={{ py: 1.5, borderRadius: 2 }}
            >
              {isLoading ? <CircularProgress size={24} /> : '登录'}
            </Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
