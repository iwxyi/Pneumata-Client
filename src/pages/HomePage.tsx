import { useEffect } from 'react';
import { Box, Typography, Button, Divider, IconButton, CardActionArea } from '@mui/material';
import { Add as AddIcon, Chat as ChatIcon, Person as PersonIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';
import StatChipRow from '../components/common/StatChipRow';

function buildStatCardSx() {
  return {
    width: { xs: 'calc(50% - 6px)', sm: 220 },
    flex: '0 0 auto',
    overflow: 'visible',
    transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: 2,
      borderColor: 'primary.main',
    },
  };
}

function buildStatContentSx() {
  return {
    textAlign: 'center',
    py: 2.5,
    px: { xs: 3, sm: 3.25 },
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.75,
    minHeight: 124,
    overflow: 'visible',
  };
}

function buildCreateButtonSx() {
  return {
    position: 'absolute',
    right: -10,
    bottom: -10,
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    boxShadow: 3,
    border: 2,
    borderColor: 'background.default',
    transition: 'transform 160ms ease, box-shadow 160ms ease',
    '&:hover': {
      bgcolor: 'primary.dark',
      transform: 'scale(1.08)',
      boxShadow: 4,
    },
  };
}

function buildGridSx(columns?: { xs: string; sm: string; xl?: string }) {
  return {
    display: 'grid',
    gridTemplateColumns: columns || {
      xs: '1fr',
      sm: 'repeat(2, minmax(0, 1fr))',
      xl: 'repeat(3, minmax(0, 1fr))',
    },
    gap: 1.5,
  };
}

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chats, loadChats } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();

  useEffect(() => {
    loadChats();
    loadCharacters();
  }, []);

  const recentChats = chats.filter((chat) => chat.type === 'group').slice(0, 5);
  const recentDirectChats = chats.filter((chat) => chat.type === 'direct' || chat.type === 'ai_direct').slice(0, 4);
  const customCharacters = characters.filter((character) => !character.isPreset);
  const totalDirectChats = chats.filter((chat) => chat.type === 'direct' || chat.type === 'ai_direct').length;

  const stats = [
    {
      label: t('home.totalChats'),
      value: chats.filter((chat) => chat.type === 'group').length,
      icon: <ChatIcon />,
      color: '#6750A4',
      onOpen: () => navigate('/chats?tab=0'),
      onCreate: () => navigate('/chats/create'),
      createLabel: t('chat.create'),
    },
    {
      label: '单聊数量',
      value: totalDirectChats,
      icon: <ChatIcon />,
      color: '#4E7E6B',
      onOpen: () => navigate('/chats?tab=1'),
      onCreate: () => navigate('/direct/create'),
      createLabel: '创建单聊',
    },
    {
      label: t('home.totalCharacters'),
      value: customCharacters.length,
      icon: <PersonIcon />,
      color: '#625B71',
      onOpen: () => navigate('/characters'),
      onCreate: () => navigate('/characters/create'),
      createLabel: t('character.create'),
    },
  ];

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2.5, sm: 3, md: 3.5 }, pt: { xs: 1, sm: 1, md: 3 } }}>
      <PageSection spacing={3}>
        <SurfaceCard>
          <SectionHeader title="工作台概览" />
          <Box sx={{ display: 'flex', gap: { xs: 1.25, sm: 1.5 }, mt: 1, px: { xs: 0.5, sm: 0.75 }, alignItems: 'stretch', justifyContent: 'flex-start', flexWrap: 'nowrap' }}>
            {stats.map((stat) => (
              <SurfaceCard key={stat.label} sx={buildStatCardSx()} contentSx={buildStatContentSx()}>
                <CardActionArea onClick={stat.onOpen} sx={{ borderRadius: 2.5 }}>
                  <Box sx={buildStatContentSx()}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        stat.onCreate();
                      }}
                      aria-label={stat.createLabel}
                      sx={buildCreateButtonSx()}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                    <Box sx={{ color: stat.color, fontSize: '1.3rem', lineHeight: 1 }}>{stat.icon}</Box>
                    <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1 }}>{stat.value}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.3 }}>{stat.label}</Typography>
                  </Box>
                </CardActionArea>
              </SurfaceCard>
            ))}
          </Box>
        </SurfaceCard>

        <Divider />

        {recentDirectChats.length > 0 ? (
          <SurfaceCard>
            <SectionHeader title="最近单聊" action={<Button size="small" variant="outlined" onClick={() => navigate('/chats?tab=1')}>查看全部</Button>} />
            <Box sx={buildGridSx({ xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' })}>
              {recentDirectChats.map((chat) => (
                <ChatCard key={chat.id} chat={chat} characters={characters} onClick={() => navigate(`/chats/${chat.id}?fromTab=1`)} />
              ))}
            </Box>
          </SurfaceCard>
        ) : null}

        <SurfaceCard>
          <SectionHeader title={t('home.recentChats')} action={<Button size="small" variant="outlined" onClick={() => navigate('/chats?tab=0')}>查看全部</Button>} />
          {recentChats.length === 0 ? (
            <EmptyState
              icon="🍵"
              message={t('home.noChats')}
              action={<Button variant="outlined" onClick={() => navigate('/chats/create')}>{t('chat.create')}</Button>}
            />
          ) : (
            <Box sx={buildGridSx()}>
              {recentChats.map((chat) => (
                <ChatCard key={chat.id} chat={chat} characters={characters} onClick={() => navigate(`/chats/${chat.id}?fromTab=0`)} />
              ))}
            </Box>
          )}
        </SurfaceCard>
      </PageSection>
    </Box>
  );
}
