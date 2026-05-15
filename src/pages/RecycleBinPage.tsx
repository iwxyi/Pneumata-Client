import { useEffect, useMemo, useState } from 'react';
import { Box, Tabs, Tab, Typography, Button, Checkbox, Fab, Snackbar, Alert } from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/common/EmptyState';
import ConfirmDialog from '../components/common/ConfirmDialog';
import CharacterCard from '../components/character/CharacterCard';
import ChatCard from '../components/chat/ChatCard';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import type { AICharacter } from '../types/character';
import type { GroupChat } from '../types/chat';
import { resolveCharacterOrDeleted } from '../utils/deletedEntity';

function sortByDeletedAt<T extends { deletedAt?: number | null }>(items: T[]) {
  return [...items].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

function OverlayCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 2, bgcolor: 'background.paper', borderRadius: '50%' }}>
      <Checkbox checked={checked} onChange={onChange} />
    </Box>
  );
}

export default function RecycleBinPage() {
  const { i18n } = useTranslation();
  const characterStore = useCharacterStore();
  const chatStore = useChatStore();
  const { characters, loadProjectedDeletedCharacters, restoreCharacters, purgeCharacters, emptyDeletedCharacters, loadProjectedCharacters } = characterStore;
  const { chats, loadProjectedDeletedChats, restoreChats, purgeChats, emptyDeletedChats, loadProjectedChats } = chatStore;

  const [tab, setTab] = useState(0);
  const [deletedCharacters, setDeletedCharacters] = useState<AICharacter[]>([]);
  const [deletedChats, setDeletedChats] = useState<GroupChat[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmMode, setConfirmMode] = useState<'restore' | 'purge' | 'empty' | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const reload = async () => {
    const [nextDeletedCharacters, nextDeletedChats] = await Promise.all([
      loadProjectedDeletedCharacters(),
      loadProjectedDeletedChats(),
    ]);
    setDeletedCharacters(sortByDeletedAt(nextDeletedCharacters));
    setDeletedChats(sortByDeletedAt(nextDeletedChats));
  };

  useEffect(() => {
    void reload();
  }, []);

  const recycleCharacters = useMemo(() => {
    const map = new Map<string, AICharacter>();
    for (const character of characters) map.set(character.id, character);
    for (const character of deletedCharacters) map.set(character.id, character);
    for (const chat of deletedChats) {
      for (const memberId of chat.memberIds) {
        if (!map.has(memberId)) {
          map.set(memberId, resolveCharacterOrDeleted(Array.from(map.values()), memberId));
        }
      }
    }
    return Array.from(map.values());
  }, [characters, deletedCharacters, deletedChats]);

  const chatCounts = useMemo(() => ({
    group: deletedChats.filter((item) => item.type === 'group').length,
    direct: deletedChats.filter((item) => item.type === 'direct').length,
    aiDirect: deletedChats.filter((item) => item.type === 'ai_direct').length,
  }), [deletedChats]);

  const visibleCharacters = useMemo(() => sortByDeletedAt(deletedCharacters), [deletedCharacters]);
  const visibleChats = useMemo(() => {
    if (tab === 1) return sortByDeletedAt(deletedChats.filter((item) => item.type === 'group'));
    if (tab === 2) return sortByDeletedAt(deletedChats.filter((item) => item.type === 'direct'));
    return sortByDeletedAt(deletedChats.filter((item) => item.type === 'ai_direct'));
  }, [deletedChats, tab]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const removeSelectedFromRecycleState = (ids: string[]) => {
    const removed = new Set(ids);
    setDeletedCharacters((prev) => prev.filter((item) => !removed.has(item.id)));
    setDeletedChats((prev) => prev.filter((item) => !removed.has(item.id)));
    setSelectedIds((prev) => prev.filter((id) => !removed.has(id)));
  };

  const handleRestore = async () => {
    const ids = [...selectedIds];
    if (tab === 0) {
      await restoreCharacters(ids);
      await loadProjectedCharacters();
    } else {
      await restoreChats(ids);
      await loadProjectedChats();
    }
    removeSelectedFromRecycleState(ids);
    setConfirmMode(null);
    setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已恢复' : 'Restored', severity: 'success' });
    void reload();
  };

  const handlePurge = async () => {
    const ids = [...selectedIds];
    if (tab === 0) {
      await purgeCharacters(ids);
      await loadProjectedCharacters();
    } else {
      await purgeChats(ids);
      await loadProjectedChats();
    }
    removeSelectedFromRecycleState(ids);
    setConfirmMode(null);
    setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已彻底删除' : 'Permanently deleted', severity: 'success' });
    void reload();
  };

  const handleEmpty = async () => {
    await Promise.all([emptyDeletedCharacters(), emptyDeletedChats()]);
    await Promise.all([loadProjectedCharacters(), loadProjectedChats()]);
    setDeletedCharacters([]);
    setDeletedChats([]);
    clearSelection();
    setConfirmMode(null);
    setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '回收站已清空' : 'Recycle bin emptied', severity: 'success' });
  };

  const selectedCountLabel = i18n.language.startsWith('zh') ? `已选择 ${selectedIds.length}` : `${selectedIds.length} selected`;
  const showActions = selectedIds.length > 0 && confirmMode == null;
  const emptyMessage = i18n.language.startsWith('zh') ? '回收站是空的' : 'Recycle bin is empty';

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Tabs value={tab} onChange={(_, value) => { setTab(value); clearSelection(); }} sx={{ minWidth: 0, flex: 1 }}>
          <Tab label={`${i18n.language.startsWith('zh') ? '角色' : 'Characters'} (${deletedCharacters.length})`} />
          <Tab label={`${i18n.language.startsWith('zh') ? '群聊' : 'Group chats'} (${chatCounts.group})`} />
          <Tab label={`${i18n.language.startsWith('zh') ? '单聊' : 'Direct chats'} (${chatCounts.direct})`} />
          <Tab label={`${i18n.language.startsWith('zh') ? 'AI私聊' : 'AI direct'} (${chatCounts.aiDirect})`} />
        </Tabs>
        {showActions ? (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">{selectedCountLabel}</Typography>
            <Button variant="outlined" startIcon={<RestoreFromTrashIcon />} onClick={() => setConfirmMode('restore')}>
              {i18n.language.startsWith('zh') ? '恢复' : 'Restore'}
            </Button>
            <Button color="error" variant="outlined" startIcon={<DeleteSweepIcon />} onClick={() => setConfirmMode('purge')}>
              {i18n.language.startsWith('zh') ? '彻底删除' : 'Delete permanently'}
            </Button>
          </Box>
        ) : null}
      </Box>

      {tab === 0 ? (
        visibleCharacters.length === 0 ? (
          <EmptyState icon="🗑️" message={emptyMessage} />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5, alignItems: 'stretch' }}>
            {visibleCharacters.map((character) => (
              <Box key={character.id}>
                <Box sx={{ position: 'relative' }}>
                  <OverlayCheckbox checked={selectedIds.includes(character.id)} onChange={() => toggleSelection(character.id)} />
                  <CharacterCard character={character} onClick={() => toggleSelection(character.id)} />
                </Box>
                <Box sx={{ mt: 0.75, px: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {i18n.language.startsWith('zh') ? '删除时间' : 'Deleted at'}：{character.deletedAt ? new Date(character.deletedAt).toLocaleString() : ''}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        )
      ) : visibleChats.length === 0 ? (
        <EmptyState icon="🗑️" message={emptyMessage} />
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5, alignItems: 'stretch' }}>
          {visibleChats.map((chat) => (
            <Box key={chat.id}>
              <Box sx={{ position: 'relative' }}>
                <OverlayCheckbox checked={selectedIds.includes(chat.id)} onChange={() => toggleSelection(chat.id)} />
                <ChatCard chat={chat} characters={recycleCharacters} onClick={() => toggleSelection(chat.id)} />
              </Box>
              <Box sx={{ mt: 0.75, px: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {i18n.language.startsWith('zh') ? '删除时间' : 'Deleted at'}：{chat.deletedAt ? new Date(chat.deletedAt).toLocaleString() : ''}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Fab color="error" variant="extended" onClick={() => setConfirmMode('empty')} sx={{ position: 'fixed', right: { xs: 20, sm: 28, md: 36 }, bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', sm: 32, md: 36 }, zIndex: 1300 }}>
        {i18n.language.startsWith('zh') ? '清空回收站' : 'Empty recycle bin'}
      </Fab>

      <ConfirmDialog
        open={confirmMode === 'restore'}
        title={i18n.language.startsWith('zh') ? '恢复' : 'Restore'}
        message={i18n.language.startsWith('zh') ? `确认恢复 ${selectedIds.length} 项吗？` : `Restore ${selectedIds.length} items?`}
        onConfirm={() => void handleRestore()}
        onCancel={() => setConfirmMode(null)}
      />
      <ConfirmDialog
        open={confirmMode === 'purge'}
        title={i18n.language.startsWith('zh') ? '彻底删除' : 'Permanently delete'}
        message={i18n.language.startsWith('zh') ? `确认彻底删除 ${selectedIds.length} 项吗？该操作不可恢复。` : `Permanently delete ${selectedIds.length} items? This cannot be undone.`}
        onConfirm={() => void handlePurge()}
        onCancel={() => setConfirmMode(null)}
        destructive
      />
      <ConfirmDialog
        open={confirmMode === 'empty'}
        title={i18n.language.startsWith('zh') ? '清空回收站' : 'Empty recycle bin'}
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
