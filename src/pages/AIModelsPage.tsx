import { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button,
  FormControl, InputLabel, Select, MenuItem,
  Snackbar, Alert, IconButton, InputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff, Add as AddIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { useSettingsStore } from '../stores/useSettingsStore';
import { testConnection } from '../services/aiClient';

export default function AIModelsPage() {
  const { t, i18n } = useTranslation();
  const { setHeaderActions } = useLayoutHeaderActions();
  const settings = useSettingsStore();
  const providerDefaults: Record<string, { baseUrl: string; model: string }> = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-haiku-20240307' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    custom: { baseUrl: '', model: '' },
  };
  const [showKey, setShowKey] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    setHeaderActions(null);
    return () => setHeaderActions(null);
  }, [setHeaderActions]);

  const handleTestConnection = async (profileId: string) => {
    const profile = settings.aiProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setTestingId(profileId);
    const success = await testConnection(profile);
    setTestingId(null);
    setSnackbar({
      open: true,
      message: success ? t('settings.connectionSuccess') : t('settings.connectionFailed'),
      severity: success ? 'success' : 'error',
    });
  };

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, width: '100%', maxWidth: 960, mx: 'auto' }}>
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('settings.apiConfig')}
          </Typography>

          {settings.aiProfiles.map((profile, index) => (
            <Card key={profile.id} variant="outlined" sx={{ bgcolor: 'background.default' }}>
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    label={i18n.language.startsWith('zh') ? '模型名称' : 'Profile name'}
                    value={profile.name}
                    onChange={(e) => settings.updateAIProfile(profile.id, { name: e.target.value })}
                    size="small"
                    fullWidth
                  />
                  {index > 0 && (
                    <Button color="error" onClick={() => settings.removeAIProfile(profile.id)}>
                      {t('common.delete')}
                    </Button>
                  )}
                </Box>

                <FormControl fullWidth size="small">
                  <InputLabel>{t('settings.provider')}</InputLabel>
                  <Select
                    value={profile.provider}
                    label={t('settings.provider')}
                    onChange={(e) => {
                      const provider = e.target.value as any;
                      settings.updateAIProfile(profile.id, { provider, ...providerDefaults[provider] });
                    }}
                  >
                    <MenuItem value="openai">OpenAI</MenuItem>
                    <MenuItem value="deepseek">DeepSeek</MenuItem>
                    <MenuItem value="anthropic">Anthropic</MenuItem>
                    <MenuItem value="custom">Custom</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  label={t('settings.apiKey')}
                  placeholder={t('settings.apiKeyPlaceholder')}
                  value={profile.apiKey}
                  onChange={(e) => settings.updateAIProfile(profile.id, { apiKey: e.target.value })}
                  type={showKey ? 'text' : 'password'}
                  size="small"
                  fullWidth
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setShowKey(!showKey)}>
                            {showKey ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />

                <TextField
                  label={t('settings.baseUrl')}
                  placeholder={profile.provider === 'custom' ? 'https://example.com/v1' : providerDefaults[profile.provider].baseUrl}
                  value={profile.baseUrl}
                  onChange={(e) => settings.updateAIProfile(profile.id, { baseUrl: e.target.value })}
                  size="small"
                  fullWidth
                />

                <TextField
                  label={t('settings.model')}
                  value={profile.model}
                  onChange={(e) => settings.updateAIProfile(profile.id, { model: e.target.value })}
                  size="small"
                  fullWidth
                />

                <Button
                  variant="outlined"
                  onClick={() => handleTestConnection(profile.id)}
                  disabled={testingId === profile.id || !profile.apiKey}
                >
                  {testingId === profile.id ? t('common.loading') : t('settings.testConnection')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Button
        variant="contained"
        startIcon={<AddIcon />}
        onClick={() => settings.addAIProfile()}
        sx={{
          position: 'fixed',
          right: { xs: 20, sm: 28, md: 36 },
          bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', sm: 32, md: 36 },
          zIndex: 1300,
          minHeight: 56,
          px: 2.25,
          borderRadius: 18,
          boxShadow: '0 10px 24px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.16)',
        }}
      >
        {i18n.language.startsWith('zh') ? '添加模型' : 'Add model'}
      </Button>
    </Box>
  );
}
