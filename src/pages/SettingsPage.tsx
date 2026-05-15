import { useState } from 'react';
import {
  Box, Typography, Button,
  ToggleButtonGroup, ToggleButton,
  Snackbar, Alert, FormControlLabel, Switch,
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
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';
import StatChipRow from '../components/common/StatChipRow';

function buildPageSx() {
  return { p: { xs: 2.5, sm: 3, md: 3.5 }, pt: { xs: 1, sm: 1, md: 3 }, width: '100%', maxWidth: 960, mx: 'auto' };
}

function buildToggleGroupSx() {
  return { alignItems: 'center', justifyContent: 'flex-start', overflow: 'visible', flexWrap: 'wrap' as const, gap: 0.5 };
}

function buildActionGridSx() {
  return { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 };
}

function buildCardBodySx() {
  return { p: { xs: 1.75, sm: 2 }, '&:last-child': { pb: { xs: 1.75, sm: 2 } } };
}

function buildSectionBodySx() {
  return { display: 'flex', flexDirection: 'column', gap: 2.25 };
}

function buildDeveloperBodySx() {
  return { display: 'flex', flexDirection: 'column', gap: 1.5 };
}

function buildTopRowSx() {
  return { display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: 2 };
}

function buildHeaderChips(language: string) {
  return [language.startsWith('zh') ? '偏好设置' : 'Preferences', language.startsWith('zh') ? '多端同步' : 'Cross-device sync'];
}

function buildDeveloperChips(language: string) {
  return [language.startsWith('zh') ? '调试' : 'Debug', language.startsWith('zh') ? '运行态' : 'Runtime'];
}

function buildDataChips(language: string) {
  return [language.startsWith('zh') ? '备份 / 恢复' : 'Backup / Restore', language.startsWith('zh') ? '回收站' : 'Recycle Bin'];
}

function buildAboutChips() {
  return ['v1.0.0'];
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettingsStore();
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
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
      const allMessages = await Promise.all(chats.map((c: { id: string }) => api.getMessages(c.id)));
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
          chatDraftDefaults: settings.chatDraftDefaults,
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
            if (!c.isPreset) await api.createCharacter(c);
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
        await useChatStore.getState().deleteChat((chat as { id: string }).id);
      }
      const chars = await api.getCharacters();
      const customCharacterIds = chars
        .filter((char) => !(char as { isPreset: boolean }).isPreset)
        .map((char) => (char as { id: string }).id);
      if (customCharacterIds.length) {
        await useCharacterStore.getState().deleteCharacters(customCharacterIds);
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
    <Box sx={buildPageSx()}>
      <PageSection spacing={3}>
        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildTopRowSx()}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{i18n.language.startsWith('zh') ? '账号' : 'Account'}</Typography>
              <Typography variant="body2" color="text.secondary">{authMode === 'local' ? (i18n.language.startsWith('zh') ? '离线本地模式 · 未登录' : 'Local-only mode · Not signed in') : `${user?.nickname || '-'} · ${user?.phone || '-'}`}</Typography>
            </Box>
            <Button variant="outlined" onClick={() => navigate('/account')}>{authMode === 'local' ? (i18n.language.startsWith('zh') ? '登录并同步' : 'Sign in & sync') : (i18n.language.startsWith('zh') ? '查看' : 'Open')}</Button>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={i18n.language.startsWith('zh') ? 'AI模型' : 'AI Models'} />
            <Button variant="outlined" onClick={() => navigate('/models')} sx={{ justifyContent: 'flex-start' }}>{i18n.language.startsWith('zh') ? '管理AI模型列表' : 'Manage AI model list'}</Button>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={t('settings.appearance')} />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{t('settings.theme')}</Typography>
              <ToggleButtonGroup value={settings.theme} exclusive onChange={(_, v) => v && settings.setTheme(v)} size="small" sx={buildToggleGroupSx()}>
                <ToggleButton value="light">{t('settings.themeLight')}</ToggleButton>
                <ToggleButton value="dark">{t('settings.themeDark')}</ToggleButton>
                <ToggleButton value="system">{t('settings.themeSystem')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{t('settings.language')}</Typography>
              <ToggleButtonGroup value={settings.language} exclusive onChange={(_, v) => v && handleLanguageChange(v)} size="small" sx={buildToggleGroupSx()}>
                <ToggleButton value="zh">中文</ToggleButton>
                <ToggleButton value="en">English</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ display: 'grid', gap: 1 }}>
              <FormControlLabel control={<Switch checked={settings.developerMode} onChange={(e) => settings.setDeveloperMode(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '开发者模式' : 'Developer mode'} />
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={i18n.language.startsWith('zh') ? 'AI生成' : 'AI Generation'} subtitle={i18n.language.startsWith('zh') ? '控制角色头像的自动生成与风格倾向' : 'Control automatic avatar generation and style preference'} />
            <Box sx={{ display: 'grid', gap: 1 }}>
              <FormControlLabel control={<Switch checked={settings.avatarGeneration.autoGenerateCharacterAvatar} onChange={(e) => settings.setAutoGenerateCharacterAvatar(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '自动生成角色头像' : 'Auto-generate character avatars'} />
              <FormControlLabel control={<Switch checked={settings.avatarGeneration.preferNonPhotorealAvatar} onChange={(e) => settings.setAvatarGeneration({ preferNonPhotorealAvatar: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '非写实头像' : 'Non-photoreal avatars'} />
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={i18n.language.startsWith('zh') ? '群聊默认行为' : 'Chat defaults'} />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '群聊默认变化强度' : 'Default evolution intensity for group chats'}</Typography>
              <ToggleButtonGroup value={settings.chatDraftDefaults.runtimeEvolutionIntensity} exclusive onChange={(_, v) => v && settings.setChatDraftDefaults({ runtimeEvolutionIntensity: v })} size="small" sx={buildToggleGroupSx()}>
                <ToggleButton value="slow">{i18n.language.startsWith('zh') ? '慢' : 'Slow'}</ToggleButton>
                <ToggleButton value="balanced">{i18n.language.startsWith('zh') ? '平衡' : 'Balanced'}</ToggleButton>
                <ToggleButton value="fast">{i18n.language.startsWith('zh') ? '快' : 'Fast'}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>
        </SurfaceCard>

        {settings.developerMode ? (
          <SurfaceCard contentSx={buildCardBodySx()}>
            <Box sx={buildDeveloperBodySx()}>
              <SectionHeader title={i18n.language.startsWith('zh') ? '开发者工具' : 'Developer Tools'} />
              <StatChipRow items={buildDeveloperChips(i18n.language)} />
              <Box sx={{ display: 'grid', gap: 1 }}>
                <FormControlLabel control={<Switch checked={settings.developerUI.showMemoryDebug} onChange={(e) => settings.setDeveloperUI({ showMemoryDebug: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示记忆调试信息' : 'Show memory debug info'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showRelationshipEvents} onChange={(e) => settings.setDeveloperUI({ showRelationshipEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示关系事件提示' : 'Show relationship event hints'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showAffectEvents} onChange={(e) => settings.setDeveloperUI({ showAffectEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示情绪/漂移提示' : 'Show emotion/drift hints'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showConflictEvents} onChange={(e) => settings.setDeveloperUI({ showConflictEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示矛盾点与发展建议' : 'Show conflict focus and next-step hints'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showStateEvents} onChange={(e) => settings.setDeveloperUI({ showStateEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示房间/态势提示' : 'Show room/state hints'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showMemoryDistillationEvents} onChange={(e) => settings.setDeveloperUI({ showMemoryDistillationEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示记忆蒸馏提示' : 'Show memory distillation hints'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showSpeechStyle} onChange={(e) => settings.setDeveloperUI({ showSpeechStyle: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示发言风格' : 'Show speech style'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showAdvancedRuntimePanels} onChange={(e) => settings.setDeveloperUI({ showAdvancedRuntimePanels: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '显示高级运行面板' : 'Show advanced runtime panels'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.dramaBoost} onChange={(e) => settings.setDeveloperUI({ dramaBoost: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '增强戏剧冲突' : 'Boost dramatic conflict'} />
              </Box>
            </Box>
          </SurfaceCard>
        ) : null}

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={t('settings.dataManagement')} />
            <StatChipRow items={buildDataChips(i18n.language)} />
            <Box sx={buildActionGridSx()}>
              <Button startIcon={<BackupIcon />} variant="outlined" onClick={handleBackup}>{t('settings.backup')}</Button>
              <Button startIcon={<RestoreIcon />} variant="outlined" onClick={handleRestore}>{t('settings.restore')}</Button>
              <Button variant="outlined" onClick={() => navigate('/settings/recycle-bin')}>{i18n.language.startsWith('zh') ? '回收站' : 'Recycle Bin'}</Button>
              <Button startIcon={<ClearIcon />} variant="outlined" color="error" onClick={() => setClearConfirm(true)}>{t('settings.clearAll')}</Button>
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <SectionHeader title={t('settings.about')} dense />
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>AI Chat Group</Typography>
          <StatChipRow items={buildAboutChips()} />
        </SurfaceCard>

        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => {
            useAuthStore.getState().logout();
            window.location.href = '/login';
          }}
          sx={{ mb: 1 }}
        >
          {i18n.language.startsWith('zh') ? '退出登录' : 'Log out'}
        </Button>
      </PageSection>

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
