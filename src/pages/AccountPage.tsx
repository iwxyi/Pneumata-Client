import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, Card, CardContent, Alert, TextField, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Switch, FormControlLabel } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useAuthStore } from '../stores/useAuthStore';
import { isImageAvatar as isImageAvatarValue } from '../utils/avatar';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import { scheduleSyncWorkersByPriority } from '../stores/storeSyncScheduler';
import AppSnackbar from '../components/common/AppSnackbar';
import LogoutIcon from '@mui/icons-material/Logout';
import { isCloudSyncEnabled, setCloudSyncEnabled } from '../services/cloudSyncPreference';
import { bootstrapLocalDataToCloud, captureLocalCloudBootstrapSnapshot } from '../services/localToCloudBootstrap';
import { runWithCloudSyncBootstrapLock } from '../services/cloudSyncBootstrapLock';

const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 512;
const AVATAR_OUTPUT_SIZE = 256;
const AVATAR_OUTPUT_QUALITY = 0.82;

function formatSyncTime(value?: number, fallback?: string) {
  if (!value) return fallback || '未同步';
  return new Date(value).toLocaleString();
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function compressAvatar(file: File) {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(image.width, image.height));
  const sourceWidth = Math.max(1, Math.round(image.width * scale));
  const sourceHeight = Math.max(1, Math.round(image.height * scale));

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('无法处理图片');
  sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = AVATAR_OUTPUT_SIZE;
  outputCanvas.height = AVATAR_OUTPUT_SIZE;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('无法处理图片');

  outputContext.fillStyle = '#ffffff';
  outputContext.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);

  const cropSize = Math.min(sourceWidth, sourceHeight);
  const cropX = Math.floor((sourceWidth - cropSize) / 2);
  const cropY = Math.floor((sourceHeight - cropSize) / 2);
  outputContext.drawImage(sourceCanvas, cropX, cropY, cropSize, cropSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);

  return outputCanvas.toDataURL('image/jpeg', AVATAR_OUTPUT_QUALITY);
}

export default function AccountPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { setHeaderTitle, setHeaderBackAction, setHeaderActions } = useLayoutHeaderActions();
  const { user, authMode, updateProfile, sendChangePhoneCode, changePhone, logout } = useAuthStore();
  const chatStore = useChatStore();
  const characterStore = useCharacterStore();
  const settingsStore = useSettingsStore();
  const messageStore = useMessageStore();
  const artifactStore = useCharacterArtifactStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [avatar, setAvatar] = useState(user?.avatar || '🍵');
  const [saving, setSaving] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [draftNickname, setDraftNickname] = useState(user?.nickname || '');
  const [savingNickname, setSavingNickname] = useState(false);
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);
  const [phoneCountdown, setPhoneCountdown] = useState(0);
  const [mockPhoneCode, setMockPhoneCode] = useState('');
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [syncingAll, setSyncingAll] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(isCloudSyncEnabled);
  const cloudSyncAvailable = authMode !== 'local' && user?.cloudSyncEntitled !== false;

  useEffect(() => {
    setNickname(user?.nickname || '');
    setDraftNickname(user?.nickname || '');
    setAvatar(user?.avatar || '🍵');
  }, [user]);

  useEffect(() => {
    if (cloudSyncAvailable || !cloudSyncEnabled) return;
    setCloudSyncEnabled(false);
    setCloudSyncEnabledState(false);
  }, [cloudSyncAvailable, cloudSyncEnabled]);

  useEffect(() => {
    if (phoneCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setPhoneCountdown((value) => value - 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phoneCountdown]);

  useEffect(() => {
    setHeaderTitle(t('nav.account'));
    setHeaderBackAction(() => () => navigate(-1));
    setHeaderActions(null);
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHeaderActions(null);
    };
  }, [navigate, setHeaderActions, setHeaderBackAction, setHeaderTitle, t]);

  const latestMessageSync = Object.values(messageStore.messageWindowsByChatId || {}).reduce<number>((latest, item) => {
    return Math.max(latest, item.lastSyncedAt || 0);
  }, 0);

  const handleUploadAll = async () => {
    if (authMode === 'local') {
      navigate('/login');
      return;
    }
    if (!cloudSyncAvailable) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '当前账号暂未开通云同步。' : 'Cloud sync is not available for this account yet.', severity: 'error' });
      return;
    }
    if (!cloudSyncEnabled) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请先开启云同步' : 'Turn on cloud sync first', severity: 'error' });
      return;
    }
    setSyncingAll(true);
    try {
      chatStore.retryFailedOperations();
      characterStore.retryFailedOperations();
      messageStore.retryFailedOperations();
      scheduleSyncWorkersByPriority(0);
      void artifactStore.resumeProcessing();
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已安排后台上传待同步数据' : 'Queued pending uploads in the background', severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setSyncingAll(false);
    }
  };

  const handleDownloadAll = async () => {
    if (authMode === 'local') {
      navigate('/login');
      return;
    }
    if (!cloudSyncAvailable) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '当前账号暂未开通云同步。' : 'Cloud sync is not available for this account yet.', severity: 'error' });
      return;
    }
    if (!cloudSyncEnabled) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请先开启云同步' : 'Turn on cloud sync first', severity: 'error' });
      return;
    }
    setSyncingAll(true);
    try {
      chatStore.markChatsWarm();
      characterStore.markCharactersWarm();
      void chatStore.refreshChatSummaryFromCloud();
      void characterStore.refreshCharacterSummaryFromCloud();
      void settingsStore.loadSettings();
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已安排后台拉取云端摘要' : 'Queued cloud summary refresh in the background', severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setSyncingAll(false);
    }
  };

  const handleLogout = () => {
    logout();
    setSnackbar({
      open: true,
      message: i18n.language.startsWith('zh') ? '已退出登录，当前为离线本地模式' : 'Logged out. You are now in local-only mode.',
      severity: 'success',
    });
  };

  const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_AVATAR_FILE_SIZE) {
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '头像文件不能超过 2MB' : 'Avatar file must be smaller than 2MB',
        severity: 'error',
      });
      event.target.value = '';
      return;
    }

    if (!file.type.startsWith('image/')) {
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '请上传图片文件' : 'Please upload an image file',
        severity: 'error',
      });
      event.target.value = '';
      return;
    }

    setProcessingAvatar(true);
    try {
      const compressed = await compressAvatar(file);
      setAvatar(compressed);
      await handleSaveAvatar(compressed);
    } catch (error) {
      setSnackbar({
        open: true,
        message: error instanceof Error ? error.message : t('common.error'),
        severity: 'error',
      });
    } finally {
      setProcessingAvatar(false);
      event.target.value = '';
    }
  };

  const handleSaveAvatar = async (nextAvatar: string) => {
    setSaving(true);
    try {
      await updateProfile({ avatar: nextAvatar.trim() || '🍵' });
      setSnackbar({ open: true, message: t('common.success'), severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNickname = async () => {
    setSavingNickname(true);
    try {
      await updateProfile({ nickname: draftNickname.trim() });
      setNicknameDialogOpen(false);
      setSnackbar({ open: true, message: t('common.success'), severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setSavingNickname(false);
    }
  };

  const openPhoneDialog = () => {
    setNewPhone(user?.phone || '');
    setPhoneCode('');
    setMockPhoneCode('');
    setPhoneCountdown(0);
    setPhoneDialogOpen(true);
  };

  const openNicknameDialog = () => {
    setDraftNickname(user?.nickname || '');
    setNicknameDialogOpen(true);
  };

  const openAvatarDialog = () => {
    setAvatarDialogOpen(true);
  };

  const handleSelectAvatarFile = () => {
    setAvatarDialogOpen(false);
    fileInputRef.current?.click();
  };

  const rowSx = {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    p: 2,
    borderRadius: 2,
    border: 1,
    borderColor: 'divider',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    '&:hover': { borderColor: 'primary.main', boxShadow: 1 },
  } as const;

  const compactRowSx = {
    display: 'flex',
    alignItems: 'center',
    gap: 1.5,
    minWidth: 0,
    cursor: 'pointer',
    borderRadius: 2,
    transition: 'background-color 0.18s ease, box-shadow 0.18s ease',
    '&:hover': {
      backgroundColor: 'action.hover',
      boxShadow: 1,
    },
  } as const;

  const handleSendPhoneCode = async () => {
    if (!newPhone || newPhone.length < 5) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请输入有效的手机号' : 'Please enter a valid phone number', severity: 'error' });
      return;
    }

    if (newPhone === user?.phone) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '新手机号不能与当前手机号相同' : 'New phone number must be different', severity: 'error' });
      return;
    }

    setSendingPhoneCode(true);
    try {
      const result = await sendChangePhoneCode(newPhone);
      setPhoneCountdown(60);
      if (result.mock && result.code) {
        setMockPhoneCode(result.code);
        setPhoneCode(result.code);
      } else {
        setMockPhoneCode('');
      }
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '验证码已发送' : 'Verification code sent', severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setSendingPhoneCode(false);
    }
  };

  const handleChangePhone = async () => {
    if (!newPhone || !phoneCode) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请输入手机号和验证码' : 'Please enter phone number and code', severity: 'error' });
      return;
    }

    setChangingPhone(true);
    try {
      await changePhone(newPhone, phoneCode);
      setNewPhone('');
      setPhoneCode('');
      setMockPhoneCode('');
      setPhoneCountdown(0);
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '手机号修改成功' : 'Phone number updated', severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setChangingPhone(false);
    }
  };

  const isImageAvatar = isImageAvatarValue(avatar);
  const phoneLabel = i18n.language.startsWith('zh') ? '手机号' : 'Phone';
  const handleCloudSyncToggle = async (enabled: boolean) => {
    if (authMode === 'local') {
      navigate('/login');
      return;
    }
    if (!cloudSyncAvailable) {
      setCloudSyncEnabled(false);
      setCloudSyncEnabledState(false);
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '当前账号暂未开通云同步。' : 'Cloud sync is not available for this account yet.', severity: 'error' });
      return;
    }
    const previousEnabled = cloudSyncEnabled;
    setCloudSyncEnabled(enabled);
    setCloudSyncEnabledState(enabled);
    if (!enabled) {
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '已关闭云同步。后续数据只保存在本设备。' : 'Cloud sync is off. Future data stays on this device.',
        severity: 'success',
      });
      return;
    }

    setSyncingAll(true);
    try {
      const snapshot = await captureLocalCloudBootstrapSnapshot();
      await runWithCloudSyncBootstrapLock(() => bootstrapLocalDataToCloud(snapshot));
      chatStore.markChatsWarm();
      characterStore.markCharactersWarm();
      void chatStore.prefetchChats();
      void characterStore.prefetchCharacters();
      void settingsStore.loadSettings();
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '已开启云同步，并完成本地与云端数据准备。' : 'Cloud sync is on. Local and cloud data are prepared.',
        severity: 'success',
      });
    } catch (error) {
      setCloudSyncEnabled(previousEnabled);
      setCloudSyncEnabledState(previousEnabled);
      setSnackbar({
        open: true,
        message: error instanceof Error ? error.message : t('common.error'),
        severity: 'error',
      });
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 12, sm: 8 }, maxWidth: 860, mx: 'auto' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Card
          variant="outlined"
          sx={{
            overflow: 'hidden',
            borderRadius: 2,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(18,18,18,0.96)' : 'rgba(255,255,255,0.92)',
          }}
        >
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ pt: 1, pb: 0.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {i18n.language.startsWith('zh') ? '账号信息' : 'Account info'}
              </Typography>
              {authMode === 'local' ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  {i18n.language.startsWith('zh') ? '当前处于离线本地模式。所有数据仅保存在当前设备，登录后会自动尝试同步。' : 'You are in local-only mode. Data is stored on this device and will be uploaded automatically after sign-in.'}
                </Typography>
              ) : null}
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ ...rowSx, gap: 2, justifyContent: 'flex-start' }}>
                <Box sx={compactRowSx} onClick={openAvatarDialog}>
                  <Avatar src={isImageAvatar ? avatar : undefined} sx={{ width: 52, height: 52, fontSize: '1.5rem' }}>
                    {isImageAvatar ? undefined : avatar}
                  </Avatar>
                </Box>
                <Box sx={compactRowSx} onClick={openNicknameDialog}>
                  <Typography variant="body1" sx={{ minWidth: 0, fontWeight: 600 }} noWrap>
                    {authMode === 'local' ? (i18n.language.startsWith('zh') ? '本地用户' : 'Local user') : (user?.nickname || '-')}
                  </Typography>
                </Box>
              </Box>

              <Box sx={rowSx} onClick={openPhoneDialog}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {phoneLabel}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {authMode === 'local' ? (i18n.language.startsWith('zh') ? '未登录' : 'Not signed in') : (user?.phone || '-')}
                  </Typography>
                </Box>
              </Box>
            </Box>

            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarFileChange} />

            {authMode === 'local' ? (
              <Button variant="contained" onClick={() => navigate('/login')} sx={{ alignSelf: 'flex-start' }}>
                {i18n.language.startsWith('zh') ? '登录并同步' : 'Sign in & sync'}
              </Button>
            ) : (
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleLogout}
                sx={{ alignSelf: 'flex-start' }}
              >
                {i18n.language.startsWith('zh') ? '退出登录' : 'Log out'}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {i18n.language.startsWith('zh') ? '云同步情况' : 'Cloud sync status'}
              </Typography>
              <Button variant="outlined" size="small" onClick={() => navigate('/account/sync-status')}>
                {i18n.language.startsWith('zh') ? '查看详情' : 'Details'}
              </Button>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={authMode !== 'local' && cloudSyncEnabled}
                  disabled={authMode === 'local' || !cloudSyncAvailable || syncingAll}
                  onChange={(event) => handleCloudSyncToggle(event.target.checked)}
                />
              }
              label={i18n.language.startsWith('zh') ? '开启云同步' : 'Enable cloud sync'}
            />
            <Typography variant="body2" color="text.secondary">
              {authMode === 'local'
                ? (i18n.language.startsWith('zh') ? '登录后才可使用云同步。' : 'Sign in to use cloud sync.')
                : !cloudSyncAvailable
                  ? (i18n.language.startsWith('zh') ? '当前账号暂未开通云同步；本地数据仍可正常使用。' : 'Cloud sync is not available for this account yet; local data remains usable.')
                : cloudSyncEnabled
                  ? (i18n.language.startsWith('zh') ? '当前设备会按需上传和拉取云端数据。' : 'This device uploads and downloads cloud data as needed.')
                  : (i18n.language.startsWith('zh') ? '云同步已关闭，当前设备只读写本地缓存，不会自动访问云端数据接口。' : 'Cloud sync is off. This device uses local cache only and will not automatically call cloud data APIs.')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {i18n.language.startsWith('zh') ? '设置同步' : 'Settings sync'}：{formatSyncTime(settingsStore.lastSyncedAt, i18n.language.startsWith('zh') ? '未同步' : 'Not synced')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {i18n.language.startsWith('zh') ? '群聊同步' : 'Chats sync'}：{formatSyncTime(chatStore.lastSyncedAt, i18n.language.startsWith('zh') ? '未同步' : 'Not synced')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {i18n.language.startsWith('zh') ? '角色同步' : 'Characters sync'}：{formatSyncTime(characterStore.lastSyncedAt, i18n.language.startsWith('zh') ? '未同步' : 'Not synced')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {i18n.language.startsWith('zh') ? '消息缓存刷新' : 'Message cache refresh'}：{formatSyncTime(latestMessageSync, i18n.language.startsWith('zh') ? '未同步' : 'Not synced')}
            </Typography>
            {'pendingOperations' in characterStore || 'pendingOperations' in chatStore ? (
              <Typography variant="body2" color="text.secondary">
                {i18n.language.startsWith('zh') ? '待同步编辑操作' : 'Queued edit sync operations'}：{[((characterStore as { pendingOperations?: unknown[] }).pendingOperations || []).length + ((chatStore as { pendingOperations?: unknown[] }).pendingOperations || []).length]}
              </Typography>
            ) : null}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={handleUploadAll} disabled={syncingAll || (authMode !== 'local' && (!cloudSyncAvailable || !cloudSyncEnabled))}>
                {syncingAll ? (i18n.language.startsWith('zh') ? '同步中' : 'Syncing') : (i18n.language.startsWith('zh') ? '同步待上传' : 'Sync pending uploads')}
              </Button>
              <Button variant="outlined" onClick={handleDownloadAll} disabled={syncingAll || (authMode !== 'local' && (!cloudSyncAvailable || !cloudSyncEnabled))}>
                {syncingAll ? (i18n.language.startsWith('zh') ? '同步中' : 'Syncing') : (i18n.language.startsWith('zh') ? '检查云端更新' : 'Check cloud updates')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Dialog open={nicknameDialogOpen} onClose={() => setNicknameDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{i18n.language.startsWith('zh') ? '修改昵称' : 'Change nickname'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField
              label={i18n.language.startsWith('zh') ? '昵称' : 'Nickname'}
              value={draftNickname}
              onChange={(e) => setDraftNickname(e.target.value)}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setNicknameDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSaveNickname} disabled={savingNickname || !draftNickname.trim()}>
            {savingNickname ? t('common.loading') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={phoneDialogOpen} onClose={() => setPhoneDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{i18n.language.startsWith('zh') ? '修改手机号' : 'Change phone number'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label={phoneLabel}
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              fullWidth
            />
            {mockPhoneCode ? (
              <Alert severity="info">
                {i18n.language.startsWith('zh') ? `开发模式 - 验证码：${mockPhoneCode}` : `Development mode - code: ${mockPhoneCode}`}
              </Alert>
            ) : null}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                label={i18n.language.startsWith('zh') ? '验证码' : 'Verification code'}
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value)}
                fullWidth
              />
              <Button variant="outlined" onClick={handleSendPhoneCode} disabled={sendingPhoneCode || phoneCountdown > 0} sx={{ minWidth: 120 }}>
                {phoneCountdown > 0 ? `${phoneCountdown}s` : (sendingPhoneCode ? t('common.loading') : (i18n.language.startsWith('zh') ? '发送验证码' : 'Send code'))}
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPhoneDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleChangePhone} disabled={changingPhone || !newPhone || !phoneCode}>
            {changingPhone ? t('common.loading') : t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={avatarDialogOpen} onClose={() => setAvatarDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{i18n.language.startsWith('zh') ? '头像预览' : 'Avatar preview'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <Avatar src={isImageAvatar ? avatar : undefined} sx={{ width: 220, height: 220, fontSize: '5rem' }}>
              {isImageAvatar ? undefined : avatar}
            </Avatar>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAvatarDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSelectAvatarFile}
            disabled={processingAvatar || saving}
          >
            {processingAvatar ? t('common.loading') : (i18n.language.startsWith('zh') ? '上传新头像' : 'Upload new avatar')}
          </Button>
        </DialogActions>
      </Dialog>

      <AppSnackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        severity={snackbar.severity}
        message={snackbar.message}
      />
    </Box>
  );
}
