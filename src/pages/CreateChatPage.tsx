import { useState, useEffect } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import {
  Box, Typography, TextField, Button, IconButton,
  Checkbox, Avatar, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Divider,
  FormControlLabel, Switch, Snackbar, Alert,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { formatExpertiseList } from '../utils/expertise';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { ChatStyle } from '../types/chat';
import { CHAT_STYLE_OPTIONS, MIN_MEMBERS, MAX_MEMBERS } from '../constants/defaults';

export default function CreateChatPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const { chats, addChat, updateChat, deleteChat, loadChats } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const { chatDraftDefaults, setChatDraftDefaults, loadSettings } = useSettingsStore();
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const editingChat = id ? chats.find((chat) => chat.id === id) : null;

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [style, setStyle] = useState<ChatStyle>('free');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [topicSeed, setTopicSeed] = useState('');
  const [showRoleActions, setShowRoleActions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    loadChats();
    loadCharacters();
    loadSettings();
  }, [loadCharacters, loadChats, loadSettings]);

  useEffect(() => {
    if (editingChat) {
      setName(editingChat.name || '');
      setTopic(editingChat.topic || '');
      setStyle(editingChat.style);
      setSelectedMembers(editingChat.memberIds || []);
      setTopicSeed(editingChat.topicSeed || '');
      setShowRoleActions(editingChat.showRoleActions ?? true);
      return;
    }

    setStyle(chatDraftDefaults.style);
    setShowRoleActions(chatDraftDefaults.showRoleActions);
  }, [chatDraftDefaults.showRoleActions, chatDraftDefaults.style, editingChat]);

  useEffect(() => {
    setHeaderTitle(editingChat ? t('chat.edit') : t('chat.create'));
    setHeaderBackAction(() => () => navigate(-1));
    setHeaderActions(
      <Box sx={{ display: 'flex', gap: 1 }}>
        {editingChat ? (
          <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => setDeleteConfirmOpen(true)}>
            {t('common.delete')}
          </Button>
        ) : null}
      </Box>
    );

    return () => {
      setHeaderActions(null);
      setHeaderTitle(null);
      setHeaderBackAction(null);
    };
  }, [editingChat, navigate, setHeaderActions, setHeaderBackAction, setHeaderTitle, t]);

  const toggleMember = (memberId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((m) => m !== memberId)
        : prev.length < MAX_MEMBERS
          ? [...prev, memberId]
          : prev
    );
  };

  const canCreate = name.trim().length > 0 && selectedMembers.length >= MIN_MEMBERS;
  const createError = !name.trim()
    ? (i18n.language.startsWith('zh') ? '请填写群聊名称' : 'Please enter a chat name')
    : selectedMembers.length < MIN_MEMBERS
      ? (i18n.language.startsWith('zh') ? `请至少选择${MIN_MEMBERS}个AI成员` : `Please select at least ${MIN_MEMBERS} AI members`)
      : '';

  const customCharacters = characters.filter((char) => !char.isPreset);
  const presetCharacters = characters.filter((char) => char.isPreset);
  const selectedCharacters = characters.filter((char) => selectedMembers.includes(char.id));
  const hasCustomCharacters = customCharacters.length > 0;
  const hasPresetCharacters = presetCharacters.length > 0;

  const getStyleLabel = (styleValue: ChatStyle) => t(`chat.style${styleValue.charAt(0).toUpperCase() + styleValue.slice(1)}`);
  const getMemberSecondary = (char: typeof characters[number]) => {
    const expertise = formatExpertiseList(char.expertise.slice(0, 2), i18n.language).join(' · ');
    return expertise || t('common.noData');
  };

  const selectedSummary = selectedCharacters.slice(0, 4);

  const handleCreate = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (!canCreate) {
        setSnackbar({ open: true, message: createError || t('common.error'), severity: 'error' });
        return;
      }

      if (editingChat) {
        await updateChat(editingChat.id, {
          name: name.trim(),
          topic: topic.trim(),
          style,
          memberIds: selectedMembers,
          speed: 1,
          allowIntervention: true,
          showRoleActions,
          topicSeed: topicSeed.trim(),
        });
        setChatDraftDefaults({ style, showRoleActions });
        navigate(`/chats/${editingChat.id}`);
        return;
      }

      const chat = await addChat({
        name: name.trim(),
        topic: topic.trim(),
        style,
        memberIds: selectedMembers,
        speed: 1,
        isActive: false,
        allowIntervention: true,
        showRoleActions,
        topicSeed: topicSeed.trim(),
      });
      setChatDraftDefaults({ style, showRoleActions });
      navigate(`/chats/${chat.id}`);
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 18, sm: 14, md: 10 }, maxWidth: 860, mx: 'auto' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <TextField label={t('chat.name')} placeholder={t('chat.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} required fullWidth />
        <TextField label={t('chat.topic')} placeholder={t('chat.topicPlaceholder')} value={topic} onChange={(e) => setTopic(e.target.value)} fullWidth multiline rows={2} />

        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>{t('chat.style')}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {CHAT_STYLE_OPTIONS.map((opt) => (
              <Button key={opt.value} variant={style === opt.value ? 'contained' : 'outlined'} onClick={() => setStyle(opt.value)} sx={{ borderRadius: 999 }}>
                {getStyleLabel(opt.value)}
              </Button>
            ))}
          </Box>
        </Box>

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('chat.selectMembers')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('chat.membersHint')} ({selectedMembers.length}/{MAX_MEMBERS})</Typography>
            </Box>
            <IconButton color="primary" onClick={() => setMemberDialogOpen(true)}><AddIcon /></IconButton>
          </Box>

          {selectedCharacters.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {selectedSummary.map((char) => (
                <Chip key={char.id} avatar={<Avatar sx={{ bgcolor: 'primary.light' }}>{char.avatar}</Avatar>} label={char.name} onDelete={() => toggleMember(char.id)} />
              ))}
              {selectedCharacters.length > selectedSummary.length ? <Chip label={`+${selectedCharacters.length - selectedSummary.length}`} variant="outlined" /> : null}
            </Box>
          ) : (
            <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, color: 'text.secondary' }}>未选择AI角色</Box>
          )}
        </Box>

        <TextField label={t('chat.topicSeed')} placeholder={t('chat.topicSeedPlaceholder')} value={topicSeed} onChange={(e) => setTopicSeed(e.target.value)} fullWidth multiline rows={2} />

        <FormControlLabel control={<Switch checked={showRoleActions} onChange={(e) => setShowRoleActions(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '显示角色动作' : 'Show role actions'} />

        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!canCreate || saving}
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
          {saving ? t('common.loading') : editingChat ? t('common.save') : '开始群聊'}
        </Button>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>

      <Dialog open={memberDialogOpen} onClose={() => setMemberDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('chat.selectMembers')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {hasCustomCharacters ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                {customCharacters.map((char) => (
                  <Box
                    key={char.id}
                    onClick={() => toggleMember(char.id)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, borderRadius: 3, border: 1,
                      borderColor: selectedMembers.includes(char.id) ? 'primary.main' : 'divider',
                      bgcolor: selectedMembers.includes(char.id) ? 'primary.light' : 'background.paper',
                      cursor: 'pointer', transition: 'all 0.18s ease', '&:hover': { boxShadow: 1, borderColor: 'primary.main' },
                    }}
                  >
                    <Checkbox checked={selectedMembers.includes(char.id)} size="small" />
                    <Avatar sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>{char.avatar}</Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{char.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{getMemberSecondary(char)}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : null}

            {hasCustomCharacters && hasPresetCharacters ? <Divider /> : null}

            {hasPresetCharacters ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                {presetCharacters.map((char) => (
                  <Box
                    key={char.id}
                    onClick={() => toggleMember(char.id)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, borderRadius: 3, border: 1,
                      borderColor: selectedMembers.includes(char.id) ? 'primary.main' : 'divider',
                      bgcolor: selectedMembers.includes(char.id) ? 'primary.light' : 'background.paper',
                      cursor: 'pointer', transition: 'all 0.18s ease', '&:hover': { boxShadow: 1, borderColor: 'primary.main' },
                    }}
                  >
                    <Checkbox checked={selectedMembers.includes(char.id)} size="small" />
                    <Avatar sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>{char.avatar}</Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{char.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{getMemberSecondary(char)}</Typography>
                    </Box>
                    <Chip label="Preset" size="small" variant="outlined" />
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setMemberDialogOpen(false)}>{t('common.confirm')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('chat.delete')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{t('chat.deleteConfirm')}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!editingChat) return;
              await deleteChat(editingChat.id);
              setDeleteConfirmOpen(false);
              navigate('/chats');
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
