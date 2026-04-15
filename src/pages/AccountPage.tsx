import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, Card, CardContent, Snackbar, Alert, TextField, Typography, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { useAuthStore } from '../stores/useAuthStore';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useMessageStore } from '../stores/useMessageStore';

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
  const { user, updateProfile } = useAuthStore();
  const chatStore = useChatStore();
  const characterStore = useCharacterStore();
  const settingsStore = useSettingsStore();
  const messageStore = useMessageStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [avatar, setAvatar] = useState(user?.avatar || '🍵');
  const [saving, setSaving] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    setNickname(user?.nickname || '');
    setAvatar(user?.avatar || '🍵');
  }, [user]);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ nickname: nickname.trim(), avatar: avatar.trim() || '🍵' });
      setSnackbar({ open: true, message: t('common.success'), severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const isImageAvatar = avatar.startsWith('data:image/') || avatar.startsWith('http');

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 12, sm: 8 }, maxWidth: 860, mx: 'auto' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {i18n.language.startsWith('zh') ? '账号信息' : 'Account info'}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                src={isImageAvatar ? avatar : undefined}
                onClick={() => setAvatarDialogOpen(true)}
                sx={{ width: 56, height: 56, fontSize: '1.6rem', cursor: 'pointer' }}
              >
                {isImageAvatar ? undefined : avatar}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>{user?.nickname || '-'}</Typography>
                <Typography variant="body2" color="text.secondary">{user?.phone || '-'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {i18n.language.startsWith('zh') ? '点击头像查看大图并上传新头像' : 'Tap the avatar to preview and upload a new one'}
                </Typography>
              </Box>
            </Box>

            <TextField
              label={i18n.language.startsWith('zh') ? '昵称' : 'Nickname'}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              fullWidth
            />

            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarFileChange} />

            <Button variant="contained" onClick={handleSave} disabled={saving || processingAvatar || !nickname.trim()}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {i18n.language.startsWith('zh') ? '云同步情况' : 'Cloud sync status'}
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
          </CardContent>
        </Card>
      </Box>

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
            onClick={() => {
              setAvatarDialogOpen(false);
              fileInputRef.current?.click();
            }}
            disabled={processingAvatar || saving}
          >
            {processingAvatar ? t('common.loading') : (i18n.language.startsWith('zh') ? '上传新头像' : 'Upload new avatar')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
