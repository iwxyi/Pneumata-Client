import { useEffect, useMemo, useState } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { Box, TextField, Button, InputAdornment, Stack, IconButton, Tooltip, Collapse } from '@mui/material';
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
import FloatingSegmentedTabs, { buildFloatingTabContainerSx } from '../components/common/FloatingSegmentedTabs';
import { usePaneLayout } from '../components/layout/PaneLayoutContext';
import { readPersistentUiValue, writePersistentUiValue } from '../utils/persistentUiState';
import { motion, transition } from '../styles/motion';

const CHAT_LIST_TAB_KEY = 'chat-list-tab';
const isChatListTab = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2;

export default function ChatListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const pane = usePaneLayout();
  const isMasterPane = pane.role === 'master';
  const { chats, deleteChat, prefetchChats, markChatsWarm } = useChatStore();
  const { characters, prefetchCharacters, markCharactersWarm } = useCharacterStore();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const initialTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const parsed = Number(tabParam);
    return tabParam != null && isChatListTab(parsed) ? parsed : readPersistentUiValue(CHAT_LIST_TAB_KEY, 0, isChatListTab);
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
            transition: transition(['background-color', 'border-color', 'color', 'transform'], motion.durations.base, motion.softOut),
            '&:hover': {
              transform: 'scale(1.03)',
              borderColor: (theme) => searchOpen
                ? theme.palette.primary.main
                : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
              bgcolor: (theme) => searchOpen
                ? theme.palette.mode === 'light' ? 'rgba(49,90,156,0.12)' : 'rgba(120,156,220,0.16)'
                : theme.palette.mode === 'light' ? 'rgba(15,23,42,0.035)' : 'rgba(226,232,240,0.06)',
            },
            '&:active': {
              transform: 'scale(0.94)',
              transitionTimingFunction: motion.press,
              transitionDuration: `${motion.durations.instant}ms`,
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
    writePersistentUiValue(CHAT_LIST_TAB_KEY, tab);
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
    <Box sx={{ position: 'relative', containerType: 'inline-size', p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 96px)', sm: 12 } }}>
      <Stack
        spacing={1.25}
        sx={buildFloatingTabContainerSx()}
      >
        <Collapse in={searchOpen} timeout={220} unmountOnExit sx={{ width: { xs: '100%', sm: 420 }, maxWidth: '100%' }}>
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

        <FloatingSegmentedTabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 0, label: `群聊 ${groupedChats.length}` },
            { value: 1, label: `单聊 ${userDirectChats.length}` },
            { value: 2, label: `AI私聊 ${privateChats.length}` },
          ]}
        />
      </Stack>

      {visibleChats.length === 0 ? (
        <EmptyState
          variant="plain"
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
            gridTemplateColumns: '1fr',
            '@container (min-width: 560px)': {
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            },
            '@container (min-width: 900px)': {
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
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
            position: isMasterPane ? 'absolute' : 'fixed',
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
