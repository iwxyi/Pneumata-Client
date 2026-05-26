import { useEffect, useMemo, useState } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { Box, TextField, Button, InputAdornment, Tabs, Tab, Stack, IconButton, Tooltip, Collapse } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import ConfirmDialog from '../components/common/ConfirmDialog';

function buildChatTabsSx() {
  return {
    minHeight: 40,
    borderBottom: '1px solid',
    borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
    '& .MuiTabs-indicator': {
      height: 2,
      borderRadius: 999,
      backgroundColor: 'primary.main',
    },
    '& .MuiTabs-flexContainer': { gap: { xs: 0.25, sm: 1 } },
    '& .MuiTab-root': {
      minHeight: 40,
      minWidth: 0,
      px: { xs: 0.75, sm: 1.5 },
      fontWeight: 720,
      fontSize: { xs: '0.83rem', sm: '0.9rem' },
      letterSpacing: 0,
      color: 'text.secondary',
      whiteSpace: 'nowrap',
      transition: 'color 180ms ease, opacity 180ms ease',
      opacity: 0.78,
    },
    '& .MuiTab-root.Mui-selected': {
      color: 'text.primary',
      opacity: 1,
    },
  };
}

export default function ChatListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const { chats, deleteChat, prefetchChats, markChatsWarm } = useChatStore();
  const { characters, prefetchCharacters, markCharactersWarm } = useCharacterStore();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const initialTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const parsed = Number(tabParam);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2 ? parsed : 0;
  }, [location.search]);
  const [tab, setTab] = useState(initialTab);
  const [deleteId, setDeleteId] = useState<string | null>(null);


  useEffect(() => {
    setHeaderBackAction(null);
    setHeaderActions(
      <Tooltip title={searchOpen ? '收起搜索' : t('chat.search')}>
        <IconButton
          aria-label={searchOpen ? '收起搜索' : t('chat.search')}
          color={searchOpen ? 'primary' : 'default'}
          onClick={() => {
            setSearchOpen((open) => {
              if (open) setSearch('');
              return !open;
            });
          }}
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1,
            border: '1px solid',
            borderColor: (theme) => searchOpen
              ? theme.palette.primary.main
              : 'transparent',
            bgcolor: (theme) => searchOpen
              ? theme.palette.mode === 'light' ? 'rgba(49,90,156,0.10)' : 'rgba(120,156,220,0.14)'
              : 'transparent',
            transition: 'background-color 180ms ease, border-color 180ms ease, color 180ms ease',
            '&:hover': {
              borderColor: (theme) => searchOpen
                ? theme.palette.primary.main
                : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
              bgcolor: (theme) => searchOpen
                ? theme.palette.mode === 'light' ? 'rgba(49,90,156,0.12)' : 'rgba(120,156,220,0.16)'
                : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(226,232,240,0.06)',
            },
          }}
        >
          {searchOpen ? <CloseIcon fontSize="small" /> : <SearchIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    );

    return () => {
      setHeaderActions(null);
      setHeaderBackAction(null);
    };
  }, [searchOpen, setHeaderActions, setHeaderBackAction, t]);

  useEffect(() => {
    markChatsWarm();
    markCharactersWarm();
    void prefetchChats();
    void prefetchCharacters();
  }, [markCharactersWarm, markChatsWarm, prefetchCharacters, prefetchChats]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (String(tab) === params.get('tab')) return;
    params.set('tab', String(tab));
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, navigate, tab]);
  const filteredChats = chats.filter((c) => {
    const summary = (c.layeredMemories || []).slice(-3).map((item) => item.text).join(' ').toLowerCase();
    const recentEvent = (c.worldState?.recentEvent || '').toLowerCase();
    const query = search.toLowerCase();
    return c.name.toLowerCase().includes(query) || c.topic.toLowerCase().includes(query) || recentEvent.includes(query) || summary.includes(query);
  });
  const groupedChats = filteredChats.filter((chat) => chat.type === 'group');
  const userDirectChats = filteredChats.filter((chat) => chat.type === 'direct');
  const privateChats = filteredChats.filter((chat) => chat.type === 'ai_direct');
  const visibleChats = tab === 0 ? groupedChats : tab === 1 ? userDirectChats : privateChats;
  const emptyMessage = tab === 0 ? t('chat.noGroups') : tab === 1 ? '还没有单聊' : '还没有 AI私聊';
  const createPath = tab === 0 ? '/chats/create' : '/direct/create';
  const createLabel = tab === 0 ? t('chat.create') : '创建单聊';
  const showDirectCreate = tab !== 2;

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 96px)', sm: 12 } }}>
      <Stack spacing={1.25} sx={{ mb: 2 }}>
        <Collapse in={searchOpen} timeout={220} unmountOnExit>
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
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 1,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.07)',
                backdropFilter: 'blur(18px) saturate(1.12)',
                WebkitBackdropFilter: 'blur(18px) saturate(1.12)',
                boxShadow: (theme) => theme.palette.mode === 'light'
                  ? '0 10px 26px rgba(15,23,42,0.055)'
                  : '0 14px 30px rgba(0,0,0,0.22)',
              },
            }}
          />
        </Collapse>

        <Box sx={{ px: { xs: 0, sm: 0.25 } }}>
          <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="fullWidth" sx={buildChatTabsSx()}>
            <Tab label={`群聊 ${groupedChats.length}`} />
            <Tab label={`单聊 ${userDirectChats.length}`} />
            <Tab label={`AI私聊 ${privateChats.length}`} />
          </Tabs>
        </Box>
      </Stack>

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
              lg: 'repeat(3, minmax(0, 1fr))',
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
            borderRadius: 999,
            boxShadow: (theme) => theme.palette.mode === 'light'
              ? '0 16px 34px rgba(15,23,42,0.18)'
              : '0 18px 42px rgba(0,0,0,0.40)',
          }}
        >
          {createLabel}
        </Button>
      ) : null}
    </Box>
  );
}
