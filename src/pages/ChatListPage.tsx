import { useEffect, useMemo, useState } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import { Box, TextField, Button, InputAdornment, Tabs, Tab, Stack } from '@mui/material';
import { Add as AddIcon, Search as SearchIcon } from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import ConfirmDialog from '../components/common/ConfirmDialog';

export default function ChatListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const { chats, loadChats, deleteChat } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const [search, setSearch] = useState('');
  const initialTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const parsed = Number(tabParam);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2 ? parsed : 0;
  }, [location.search]);
  const [tab, setTab] = useState(initialTab);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadChats();
    loadCharacters();
  }, []);

  useEffect(() => {
    setHeaderBackAction(null);
    setHeaderActions(null);

    return () => {
      setHeaderActions(null);
      setHeaderBackAction(null);
    };
  }, [setHeaderActions, setHeaderBackAction]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (String(tab) === params.get('tab')) return;
    params.set('tab', String(tab));
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, navigate, tab]);
  const filteredChats = chats.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.topic.toLowerCase().includes(search.toLowerCase())
  );
  const groupedChats = filteredChats.filter((chat) => chat.type === 'group');
  const userDirectChats = filteredChats.filter((chat) => chat.type === 'direct');
  const privateChats = filteredChats.filter((chat) => chat.type === 'ai_direct');
  const visibleChats = tab === 0 ? groupedChats : tab === 1 ? userDirectChats : privateChats;
  const emptyMessage = tab === 0 ? t('chat.empty') : tab === 1 ? '还没有单聊' : '还没有 AI私聊';
  const createPath = tab === 0 ? '/chats/create' : '/direct/create';
  const createLabel = tab === 0 ? t('chat.create') : '创建单聊';
  const showDirectCreate = tab !== 2;

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 } }}>
      {/* Search */}
      <TextField
        fullWidth
        size="small"
        placeholder={t('chat.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
          }
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
      />

      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label={`聊天 (${groupedChats.length})`} />
        <Tab label={`单聊 (${userDirectChats.length})`} />
        <Tab label={`AI私聊 (${privateChats.length})`} />
      </Tabs>

      {visibleChats.length === 0 ? (
        <EmptyState
          icon={tab === 0 ? '💬' : tab === 1 ? '🫖' : '🤫'}
          message={emptyMessage}
          action={
            showDirectCreate ? (
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" onClick={() => navigate('/chats/create')}>
                  {t('chat.create')}
                </Button>
                <Button variant="outlined" onClick={() => navigate('/direct/create')}>
                  创建单聊
                </Button>
              </Stack>
            ) : undefined
          }
        />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              xl: 'repeat(3, minmax(0, 1fr))',
            },
            gap: 1.5,
          }}
        >
          {visibleChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={chat}
              characters={characters}
              onClick={() => navigate(`/chats/${chat.id}?fromTab=${tab}`)}
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

      {tab !== 2 ? (
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate(createPath)}
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
          {createLabel}
        </Button>
      ) : null}
    </Box>
  );
}
