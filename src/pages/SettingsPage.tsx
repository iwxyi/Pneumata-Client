import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Divider,
  ToggleButtonGroup, ToggleButton,
  Snackbar, Alert,
} from '@mui/material';
import { Download as BackupIcon, Upload as RestoreIcon, Delete as ClearIcon, Logout as LogoutIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../stores/useSettingsStore';
import { api } from '../services/api';
import { useAuthStore } from '../stores/useAuthStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import ConfirmDialog from '../components/common/ConfirmDialog';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettingsStore();
  const [clearConfirm, setClearConfirm] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const handleBackup = async () => {
    try {
      const [characters, chats] = await Promise.all([
        api.getCharacters(),
        api.getChats(),
      ]);
      const allMessages = await Promise.all(
        chats.map((c: { id: string }) => api.getMessages(c.id))
      );
      const data = {
        characters,
        chats,
        messages: allMessages.flat(),
        settings: {
          api: { ...settings.api, apiKey: '' },
          aiProfiles: settings.aiProfiles.map((profile) => ({ ...profile, apiKey: '' })),
          theme: settings.theme,
          themeColor: settings.themeColor,
          language: settings.language,
          defaultSpeed: settings.defaultSpeed,
        },
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mirageTea-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setSnackbar({ open: true, message: t('settings.backupSuccess'), severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' });
    }
  };

  const handleRestore = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.characters) {
          for (const c of data.characters) {
            if (!c.isPreset) {
              await api.createCharacter(c);
            }
          }
        }
        if (data.chats) {
          for (const chat of data.chats) {
            const created = await api.createChat(chat);
            if (data.messages) {
              const chatMessages = data.messages.filter((m: { chatId: string }) => m.chatId === chat.id);
              for (const msg of chatMessages) {
                await api.createMessage((created as { id: string }).id, msg);
              }
            }
          }
        }
        await useCharacterStore.getState().loadCharacters();
        await useChatStore.getState().loadChats();
        setSnackbar({ open: true, message: t('settings.restoreSuccess'), severity: 'success' });
      } catch {
        setSnackbar({ open: true, message: t('common.error'), severity: 'error' });
      }
    };
    input.click();
  };

  const handleClearAll = async () => {
    try {
      const chats = await api.getChats();
      for (const chat of chats) {
        await api.deleteChat((chat as { id: string }).id);
      }
      const chars = await api.getCharacters();
      for (const char of chars) {
        if (!(char as { isPreset: boolean }).isPreset) {
          await api.deleteCharacter((char as { id: string }).id);
        }
      }
      settings.resetSettings();
      await useCharacterStore.getState().loadCharacters();
      await useChatStore.getState().loadChats();
      setClearConfirm(false);
      setSnackbar({ open: true, message: t('common.success'), severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' });
    }
  };

  const handleLanguageChange = (lang: 'zh' | 'en') => {
    settings.setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, width: '100%', maxWidth: 960, mx: 'auto' }}>
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {i18n.language.startsWith('zh') ? 'AI模型' : 'AI Models'}
          </Typography>

          <Button variant="outlined" onClick={() => navigate('/models')} sx={{ justifyContent: 'flex-start' }}>
            {i18n.language.startsWith('zh') ? '管理AI模型列表' : 'Manage AI model list'}
          </Button>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('settings.appearance')}
          </Typography>

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>
              {t('settings.theme')}
            </Typography>
            <ToggleButtonGroup
              value={settings.theme}
              exclusive
              onChange={(_, v) => v && settings.setTheme(v)}
              size="small"
              sx={{ alignItems: 'center', justifyContent: 'flex-start', overflow: 'visible' }}
            >
              <ToggleButton value="light">{t('settings.themeLight')}</ToggleButton>
              <ToggleButton value="dark">{t('settings.themeDark')}</ToggleButton>
              <ToggleButton value="system">{t('settings.themeSystem')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>
              {t('settings.language')}
            </Typography>
            <ToggleButtonGroup
              value={settings.language}
              exclusive
              onChange={(_, v) => v && handleLanguageChange(v)}
              size="small"
              sx={{ alignItems: 'center', justifyContent: 'flex-start', overflow: 'visible' }}
            >
              <ToggleButton value="zh">中文</ToggleButton>
              <ToggleButton value="en">English</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('settings.dataManagement')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button startIcon={<BackupIcon />} variant="outlined" onClick={handleBackup}>
              {t('settings.backup')}
            </Button>
            <Button startIcon={<RestoreIcon />} variant="outlined" onClick={handleRestore}>
              {t('settings.restore')}
            </Button>
            <Button startIcon={<ClearIcon />} variant="outlined" color="error" onClick={() => setClearConfirm(true)}>
              {t('settings.clearAll')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
            {t('settings.about')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('app.fullName')} (MirageTea) v1.0.0
          </Typography>
          <Typography variant="caption" color="text.disabled">
            AI Group Chat Simulation Platform
          </Typography>
        </CardContent>
      </Card>

      <Button
        fullWidth
        variant="outlined"
        color="error"
        startIcon={<LogoutIcon />}
        onClick={() => {
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }}
        sx={{ mb: 3 }}
      >
        退出登录
      </Button>

      <ConfirmDialog
        open={clearConfirm}
        title={t('settings.clearAll')}
        message={t('settings.clearAllConfirm')}
        onConfirm={handleClearAll}
        onCancel={() => setClearConfirm(false)}
        destructive
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
