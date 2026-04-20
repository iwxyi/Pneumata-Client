import { useEffect, useMemo, useState } from 'react';
import { Box, Tabs, Tab, Typography, Button, Card, CardContent, Checkbox, Stack, Fab, Snackbar, Alert } from '@mui/material';
import { DeleteSweep as DeleteSweepIcon, RestoreFromTrash as RestoreFromTrashIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/common/EmptyState';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';

export default function RecycleBinPage() {
  const { i18n } = useTranslation();
  const [tab, setTab] = useState(0);
  const [deletedCharacters, setDeletedCharacters] = useState<AICharacter[]>([]);
  const [deletedChats, setDeletedChats] = useState<GroupChat[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmMode, setConfirmMode] = useState<'restore' | 'purge' | 'empty' | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const { loadProjectedDeletedCharacters, restoreCharacters, purgeCharacters, emptyDeletedCharacters, loadProjectedCharacters } = useCharacterStore();
  const { loadProjectedDeletedChats, restoreChats, purgeChats, emptyDeletedChats, loadProjectedChats } = useChatStore();

  const reload = async () => {
    const [characters, chats] = await Promise.all([loadProjectedDeletedCharacters(), loadProjectedDeletedChats()]);
    setDeletedCharacters(characters);
    setDeletedChats(chats);
  };

  useEffect(() => {
    void reload();
  }, []);

  const visibleItems = useMemo(() => {
    if (tab === 0) return deletedCharacters.map((item) => ({ id: item.id, type: 'character' as const, title: item.name, subtitle: item.group || '角色', deletedAt: item.deletedAt || 0 }));
    if (tab === 1) return deletedChats.filter((item) => item.type === 'group').map((item) => ({ id: item.id, type: 'chat' as const, title: item.name, subtitle: '群聊', deletedAt: item.deletedAt || 0 }));
    if (tab === 2) return deletedChats.filter((item) => item.type === 'direct').map((item) => ({ id: item.id, type: 'chat' as const, title: item.name, subtitle: '单聊', deletedAt: item.deletedAt || 0 }));
    return deletedChats.filter((item) => item.type === 'ai_direct').map((item) => ({ id: item.id, type: 'chat' as const, title: item.name, subtitle: 'AI私聊', deletedAt: item.deletedAt || 0 }));
  }, [deletedCharacters, deletedChats, tab]);

  const toggleSelection = (id: string) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);

  const handleRestore = async () => {
    const ids = selectedIds;
    if (tab === 0) {
      await restoreCharacters(ids);
      await loadProjectedCharacters();
    } else {
      await restoreChats(ids);
      await loadProjectedChats();
    }
    setSelectedIds([]);
    setConfirmMode(null);
    await reload();
    setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已恢复' : 'Restored', severity: 'success' });
  };

  const handlePurge = async () => {
    const ids = selectedIds;
    if (tab === 0) {
      await purgeCharacters(ids);
      await loadProjectedCharacters();
    } else {
      await purgeChats(ids);
      await loadProjectedChats();
    }
    setSelectedIds([]);
    setConfirmMode(null);
    await reload();
    setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已彻底删除' : 'Permanently deleted', severity: 'success' });
  };

  const handleEmpty = async () => {
    await Promise.all([emptyDeletedCharacters(), emptyDeletedChats()]);
    setSelectedIds([]);
    setConfirmMode(null);
    await Promise.all([loadProjectedCharacters(), loadProjectedChats()]);
    await reload();
    setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '回收站已清空' : 'Recycle bin emptied', severity: 'success' });
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 } }}>
      <Tabs value={tab} onChange={(_, value) => { setTab(value); setSelectedIds([]); }} sx={{ mb: 2 }}>
        <Tab label={`角色 (${deletedCharacters.length})`} />
        <Tab label={`群聊 (${deletedChats.filter((item) => item.type === 'group').length})`} />
        <Tab label={`单聊 (${deletedChats.filter((item) => item.type === 'direct').length})`} />
        <Tab label={`AI私聊 (${deletedChats.filter((item) => item.type === 'ai_direct').length})`} />
      </Tabs>

      {selectedIds.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button variant="outlined" startIcon={<RestoreFromTrashIcon />} onClick={() => setConfirmMode('restore')}>恢复</Button>
          <Button color="error" variant="outlined" startIcon={<DeleteSweepIcon />} onClick={() => setConfirmMode('purge')}>彻底删除</Button>
        </Stack>
      ) : null}

      {visibleItems.length === 0 ? (
        <EmptyState icon="🗑️" message={i18n.language.startsWith('zh') ? '回收站是空的' : 'Recycle bin is empty'} />
      ) : (
        <Stack spacing={1.5}>
          {visibleItems.map((item) => (
            <Card key={item.id} variant="outlined">
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Checkbox checked={selectedIds.includes(item.id)} onChange={() => toggleSelection(item.id)} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>{item.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{item.subtitle}</Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">{item.deletedAt ? new Date(item.deletedAt).toLocaleString() : ''}</Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Fab color="error" variant="extended" onClick={() => setConfirmMode('empty')} sx={{ position: 'fixed', right: { xs: 20, sm: 28, md: 36 }, bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', sm: 32, md: 36 }, zIndex: 1300 }}>
        清空回收站
      </Fab>

      <ConfirmDialog
        open={confirmMode === 'restore'}
        title="恢复"
        message={i18n.language.startsWith('zh') ? `确认恢复 ${selectedIds.length} 项吗？` : `Restore ${selectedIds.length} items?`}
        onConfirm={() => void handleRestore()}
        onCancel={() => setConfirmMode(null)}
      />
      <ConfirmDialog
        open={confirmMode === 'purge'}
        title="彻底删除"
        message={i18n.language.startsWith('zh') ? `确认彻底删除 ${selectedIds.length} 项吗？该操作不可恢复。` : `Permanently delete ${selectedIds.length} items? This cannot be undone.`}
        onConfirm={() => void handlePurge()}
        onCancel={() => setConfirmMode(null)}
        destructive
      />
      <ConfirmDialog
        open={confirmMode === 'empty'}
        title="清空回收站"
        message={i18n.language.startsWith('zh') ? '确认彻底删除回收站中的所有角色和聊天吗？' : 'Permanently delete everything in the recycle bin?'}
        onConfirm={() => void handleEmpty()}
        onCancel={() => setConfirmMode(null)}
        destructive
      />
      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
