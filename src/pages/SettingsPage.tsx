import { useState } from 'react';
import {
  Box, Typography, Button, Chip,
  ToggleButtonGroup, ToggleButton,
  Snackbar, Alert, FormControlLabel, Switch,
} from '@mui/material';
import BackupIcon from '@mui/icons-material/Download';
import RestoreIcon from '@mui/icons-material/Upload';
import ClearIcon from '@mui/icons-material/Delete';
import LogoutIcon from '@mui/icons-material/Logout';
import SyncIcon from '@mui/icons-material/Sync';
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
import { PAPER_SURFACE_VARIANTS, type PaperSurfaceVariant } from '../types/artifactAppearance';
import { migrateLegacyBrandStorageKeys } from '../constants/brand';

function buildPageSx() {
  return { p: { xs: 2.5, sm: 3, md: 3.5 }, pt: { xs: 1, sm: 1, md: 3 }, width: '100%', maxWidth: 960, mx: 'auto' };
}

function buildToggleGroupSx() {
  return { alignItems: 'center', justifyContent: 'flex-start', overflow: 'visible', flexWrap: 'wrap' as const, gap: 0.5 };
}

function buildPaperPickerSx() {
  return {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
    gap: 1,
    alignItems: 'stretch',
  };
}

function buildPaperToggleSx() {
  return {
    display: 'grid',
    gap: 0.75,
    justifyItems: 'stretch',
    alignContent: 'start',
    minHeight: 128,
    px: 1,
    py: 1,
    borderRadius: 2,
    textTransform: 'none',
    whiteSpace: 'normal',
    '&.Mui-selected': {
      boxShadow: '0 0 0 1px rgba(103, 80, 164, 0.45)',
    },
  };
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
  return [language.startsWith('zh') ? '调试' : 'Debug', language.startsWith('zh') ? '运行态证据' : 'Runtime evidence'];
}

function buildDataChips(language: string) {
  return [language.startsWith('zh') ? '备份 / 恢复' : 'Backup / Restore', language.startsWith('zh') ? '回收站' : 'Recycle Bin'];
}

function getPaperVariantLabel(variant: PaperSurfaceVariant, language: string) {
  const zh: Record<PaperSurfaceVariant, string> = {
    lined: '横线纸',
    plain: '素纸',
    letter: '信纸',
    night: '夜色',
  };
  const en: Record<PaperSurfaceVariant, string> = {
    lined: 'Lined',
    plain: 'Plain',
    letter: 'Letter',
    night: 'Night',
  };
  return language.startsWith('zh') ? zh[variant] : en[variant];
}

function buildPaperPreviewSx(variant: PaperSurfaceVariant) {
  const shared = {
    width: '100%',
    aspectRatio: '1.45 / 1',
    minHeight: 74,
    maxHeight: 112,
    borderRadius: 1.25,
    overflow: 'hidden',
    position: 'relative',
    border: '1px solid',
  };
  const variants: Record<PaperSurfaceVariant, object> = {
    lined: {
      ...shared,
      borderColor: 'rgba(180, 150, 90, 0.34)',
      bgcolor: '#fffdf4',
      backgroundImage: 'linear-gradient(rgba(90, 120, 170, 0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(180, 80, 70, 0.24) 1px, transparent 1px)',
      backgroundSize: '100% 12px, 20px 100%',
      backgroundPosition: '0 12px, 18px 0',
    },
    plain: {
      ...shared,
      borderColor: 'rgba(190, 176, 138, 0.42)',
      bgcolor: '#fffaf0',
      backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.75), rgba(245,232,198,0.42))',
    },
    letter: {
      ...shared,
      borderColor: 'rgba(128, 96, 54, 0.34)',
      bgcolor: '#fbf3df',
      backgroundImage: 'linear-gradient(rgba(94, 70, 38, 0.08) 1px, transparent 1px), radial-gradient(circle at 18% 14%, rgba(255,255,255,0.62), transparent 36%), linear-gradient(135deg, rgba(130, 88, 36, 0.14), transparent 46%)',
      backgroundSize: '100% 13px, 100% 100%, 100% 100%',
      backgroundPosition: '0 14px, 0 0, 0 0',
    },
    night: {
      ...shared,
      borderColor: 'rgba(139, 164, 203, 0.42)',
      bgcolor: '#202632',
      backgroundImage: 'linear-gradient(rgba(174, 196, 230, 0.15) 1px, transparent 1px), linear-gradient(135deg, rgba(71, 88, 121, 0.52), rgba(32, 38, 50, 0.95))',
      backgroundSize: '100% 12px, 100% 100%',
      backgroundPosition: '0 12px, 0 0',
    },
  };
  return variants[variant];
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
      a.download = `pneumata-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

  const handleBrandStorageMigration = () => {
    const result = migrateLegacyBrandStorageKeys();
    const message = i18n.language.startsWith('zh')
      ? `迁移完成：搬迁 ${result.moved} 项，删除旧 key ${result.removed} 项，跳过 ${result.skipped} 项。页面即将刷新。`
      : `Migration complete: moved ${result.moved}, removed ${result.removed} old key(s), skipped ${result.skipped}. Reloading.`;
    setSnackbar({ open: true, message, severity: 'success' });
    window.setTimeout(() => window.location.reload(), 800);
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
          <Box sx={buildTopRowSx()}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{i18n.language.startsWith('zh') ? 'AI模型' : 'AI Models'}</Typography>
            </Box>
            <Button variant="outlined" onClick={() => navigate('/models')}>{i18n.language.startsWith('zh') ? '管理' : 'Manage'}</Button>
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
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>{i18n.language.startsWith('zh') ? '信件背景' : 'Letter background'}</Typography>
              <ToggleButtonGroup value={settings.artifactAppearance.paperVariant} exclusive onChange={(_, v) => v && settings.setArtifactAppearance({ paperVariant: v })} size="small" sx={buildPaperPickerSx()}>
                {PAPER_SURFACE_VARIANTS.map((variant) => (
                  <ToggleButton key={variant} value={variant} sx={buildPaperToggleSx()}>
                    <Box sx={buildPaperPreviewSx(variant)} />
                    <Typography variant="caption" sx={{ fontWeight: 650 }}>{getPaperVariantLabel(variant, i18n.language)}</Typography>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard contentSx={buildCardBodySx()}>
          <Box sx={buildSectionBodySx()}>
            <SectionHeader title={i18n.language.startsWith('zh') ? 'AI生成' : 'AI Generation'} subtitle={i18n.language.startsWith('zh') ? '控制角色头像的自动生成与风格倾向' : 'Control automatic avatar generation and style preference'} />
            <Box sx={{ display: 'grid', gap: 1 }}>
              <FormControlLabel control={<Switch checked={settings.avatarGeneration.autoGenerateCharacterAvatar} onChange={(e) => settings.setAutoGenerateCharacterAvatar(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '自动生成角色头像' : 'Auto-generate character avatars'} />
              <FormControlLabel control={<Switch checked={settings.avatarGeneration.preferNonPhotorealAvatar} onChange={(e) => settings.setAvatarGeneration({ preferNonPhotorealAvatar: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '非写实头像' : 'Non-photoreal avatars'} />
              <FormControlLabel control={<Switch checked={settings.developerMode} onChange={(e) => settings.setDeveloperMode(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '开发者模式' : 'Developer mode'} />
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
              <SectionHeader
                title={i18n.language.startsWith('zh') ? '开发者工具' : 'Developer Tools'}
                subtitle={i18n.language.startsWith('zh')
                  ? '这些开关用于排查运行逻辑，会显示事件、证据、分数和调试提示。普通使用可以保持关闭。'
                  : 'These switches expose events, evidence, metrics, and debug hints for runtime inspection. Leave them off for everyday use.'}
              />
              <StatChipRow items={buildDeveloperChips(i18n.language)} />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(220px, 0.45fr) 1fr' }, gap: 1.25, alignItems: 'center', p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
                <Button startIcon={<SyncIcon />} variant="outlined" onClick={handleBrandStorageMigration}>
                  {i18n.language.startsWith('zh') ? '迁移旧本地数据' : 'Migrate old local data'}
                </Button>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  {i18n.language.startsWith('zh')
                    ? '把旧品牌前缀的本地存储和临时草稿一次性搬到 Pneumata 前缀，完成后刷新页面重新加载。'
                    : 'Move old brand-prefixed local storage and session drafts to the Pneumata prefix, then reload.'}
                </Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 1 }}>
                <FormControlLabel control={<Switch checked={settings.developerUI.showRelationshipEvents} onChange={(e) => settings.setDeveloperUI({ showRelationshipEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '提示：角色关系事件' : 'Hint: character relationship events'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showAffectEvents} onChange={(e) => settings.setDeveloperUI({ showAffectEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '提示：情绪与人格漂移事件' : 'Hint: emotion and drift events'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showStateEvents} onChange={(e) => settings.setDeveloperUI({ showStateEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '提示：房间态势事件' : 'Hint: room state events'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showMemoryDistillationEvents} onChange={(e) => settings.setDeveloperUI({ showMemoryDistillationEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '提示：记忆蒸馏事件' : 'Hint: memory distillation events'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showSpeechStyle} onChange={(e) => settings.setDeveloperUI({ showSpeechStyle: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '调试：发言风格面板' : 'Debug: speech style panel'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showAdvancedRuntimePanels} onChange={(e) => settings.setDeveloperUI({ showAdvancedRuntimePanels: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '调试：高级运行面板' : 'Debug: advanced runtime panels'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showMemoryDebug} onChange={(e) => settings.setDeveloperUI({ showMemoryDebug: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '调试：记忆证据与参数' : 'Debug: memory evidence and metrics'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showConflictEvents} onChange={(e) => settings.setDeveloperUI({ showConflictEvents: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '调试：矛盾焦点与发展钩子' : 'Debug: conflict focus and development hooks'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.showWithdrawnMessageContent} onChange={(e) => settings.setDeveloperUI({ showWithdrawnMessageContent: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '交互：悬浮查看撤回原文' : 'Interaction: reveal withdrawn content on hover'} />
                <FormControlLabel control={<Switch checked={settings.developerUI.dramaBoost} onChange={(e) => settings.setDeveloperUI({ dramaBoost: e.target.checked })} />} label={i18n.language.startsWith('zh') ? '实验：增强戏剧冲突' : 'Experimental: boost dramatic conflict'} />
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
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>Pneumata</Typography>
          <Chip size="small" label="v1.0.0" variant="outlined" onClick={() => navigate('/intro')} sx={{ cursor: 'pointer' }} />
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
