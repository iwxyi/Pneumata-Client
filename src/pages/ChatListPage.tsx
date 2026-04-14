import { useEffect, useState } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { Box, Typography, TextField, Button, IconButton, InputAdornment } from '@mui/material';
import { Add as AddIcon, Search as SearchIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import ConfirmDialog from '../components/common/ConfirmDialog';

export default function ChatListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setHeaderActions } = useLayoutHeaderActions();
  const { chats, loadChats, deleteChat } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadChats();
    loadCharacters();
  }, []);

  useEffect(() => {
    setHeaderActions(
      <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/chats/create')}>
        {t('chat.create')}
      </Button>
    );

    return () => setHeaderActions(null);
  }, [navigate, setHeaderActions, t]);

  const filteredChats = chats.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.topic.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 } }}>
      {/* Search */}
      <TextField
        fullWidth
        size="small"
        placeholder={t('chat.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
      />

      {/* Chat List */}
      {filteredChats.length === 0 ? (
        <EmptyState
          icon="💬"
          message={t('chat.empty')}
          action={
            <Button variant="outlined" onClick={() => navigate('/chats/create')}>
              {t('chat.create')}
            </Button>
          }
        />
      ) : (
        <Box sx={{ maxWidth: 600 }}>
          {filteredChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={chat}
              characters={characters}
              onClick={() => navigate(`/chats/${chat.id}`)}
            />
          ))}
        </Box>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteId)}
        title={t('chat.delete')}
        message={t('chat.deleteConfirm')}
        onConfirm={() => {
          if (deleteId) deleteChat(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
        destructive
      />
    </Box>
  );
}
