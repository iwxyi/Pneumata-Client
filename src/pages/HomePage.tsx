import { useEffect } from 'react';
import { Box, Typography, Button, Divider, IconButton, Chip } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ChatIcon from '@mui/icons-material/Chat';
import PersonIcon from '@mui/icons-material/Person';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';

function buildStatGridSx() {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 148px), 176px))',
    gap: { xs: 1, sm: 1.25 },
    mt: 1,
    px: { xs: 0.25, sm: 0.5 },
    alignItems: 'stretch',
    justifyContent: 'start',
  };
}

function buildStatCellSx() {
  return {
    minWidth: 0,
    display: 'flex',
    justifyContent: 'stretch',
  };
}

function buildStatCardSx() {
  return {
    width: '100%',
    maxWidth: 176,
    minWidth: 0,
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: (theme: Theme) => theme.palette.mode === 'light' ? '0 16px 36px rgba(15,23,42,0.08)' : '0 18px 42px rgba(0,0,0,0.34)',
      borderColor: 'primary.main',
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(135deg, rgba(255,255,255,0.18), transparent 42%)',
      pointerEvents: 'none',
    },
  };
}

function buildStatContentSx() {
  return {
    width: '100%',
    textAlign: 'center',
    py: { xs: 1.6, sm: 1.95 },
    px: { xs: 1.1, sm: 1.5 },
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: { xs: 0.45, sm: 0.6 },
    minHeight: { xs: 94, sm: 108 },
    overflow: 'visible',
  };
}

function buildCreateButtonSx() {
  return {
    position: 'absolute',
    right: 4,
    bottom: 4,
    zIndex: 1,
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

function buildStatLabelSx() {
  return {
    width: '100%',
    lineHeight: 1.25,
    textAlign: 'center',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    minHeight: { xs: '2.3em', sm: '2.5em' },
    color: 'text.secondary',
    fontSize: { xs: '0.76rem', sm: '0.84rem' },
  };
}

function buildStatValueSx() {
  return {
    fontWeight: 700,
    lineHeight: 1,
    fontSize: { xs: '1.08rem', sm: '1.28rem' },
  };
}

function buildStatIconSx(color: string) {
  return {
    color,
    fontSize: { xs: '0.95rem', sm: '1.1rem' },
    lineHeight: 1,
  };
}

function buildHeroCardSx() {
  return {
    position: 'relative',
    overflow: 'hidden',
    borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.08)' : 'rgba(226, 232, 240, 0.12)',
    background: (theme: Theme) => theme.palette.mode === 'light'
      ? 'radial-gradient(circle at 12% 10%, rgba(43,92,255,0.12), transparent 32%), radial-gradient(circle at 88% 0%, rgba(229,192,123,0.20), transparent 30%), rgba(255,255,255,0.76)'
      : 'radial-gradient(circle at 14% 8%, rgba(43,92,255,0.26), transparent 34%), radial-gradient(circle at 86% 0%, rgba(229,192,123,0.12), transparent 30%), rgba(15,17,25,0.82)',
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      backgroundImage: 'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
      backgroundSize: '36px 36px',
      maskImage: 'linear-gradient(90deg, black, transparent 78%)',
      pointerEvents: 'none',
    },
  };
}

function buildPulseSx() {
  return {
    width: 9,
    height: 9,
    borderRadius: '50%',
    bgcolor: '#2B5CFF',
    boxShadow: '0 0 0 6px rgba(43,92,255,0.12)',
    flex: '0 0 auto',
  };
}

function buildGridSx(columns?: { xs: string; sm: string; lg?: string; xl?: string }) {
  return {
    display: 'grid',
    gridTemplateColumns: columns || {
      xs: '1fr',
      sm: 'repeat(2, minmax(0, 1fr))',
      lg: 'repeat(3, minmax(0, 1fr))',
    },
    gap: 1.5,
  };
}

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chats, prefetchChats, markChatsWarm } = useChatStore();
  const { characters, prefetchCharacters, markCharactersWarm } = useCharacterStore();

  useEffect(() => {
    markChatsWarm();
    markCharactersWarm();
    void prefetchChats();
    void prefetchCharacters();
  }, [markCharactersWarm, markChatsWarm, prefetchCharacters, prefetchChats]);

  const recentChats = chats.slice(0, 10);
  const customCharacters = characters.filter((character) => !character.isPreset);
  const totalDirectChats = chats.filter((chat) => chat.type === 'direct' || chat.type === 'ai_direct').length;
  const totalGroupChats = chats.filter((chat) => chat.type === 'group').length;
  const runningChats = chats.filter((chat) => chat.isActive).length;
  const latestEventChat = chats.find((chat) => chat.worldState?.recentEvent);
  const memoryCount = chats.reduce((sum, chat) => sum + (chat.layeredMemories || []).length, 0)
    + customCharacters.reduce((sum, character) => sum + (character.layeredMemories || []).length, 0);
  const worldLine = latestEventChat?.worldState?.recentEvent
    ? `${latestEventChat.name}：${latestEventChat.worldState.recentEvent}`
    : recentChats[0]?.topic || '角色、关系与记忆会在这里留下继续发展的痕迹。';
  const openChatFromHome = (chat: typeof chats[number]) => navigate(`/chats/${chat.id}?fromTab=${chat.type === 'group' ? 0 : chat.type === 'ai_direct' ? 2 : 1}`);
  const recentChatsTitle = '最近会话';
  const recentChatsActionTab = recentChats[0]?.type === 'group' ? 0 : recentChats[0]?.type === 'ai_direct' ? 2 : 1;

  const stats = [
    {
      label: t('home.totalChats'),
      value: totalGroupChats,
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
        <SurfaceCard sx={buildHeroCardSx()} contentSx={{ position: 'relative', zIndex: 1, p: { xs: 2.1, sm: 2.5, md: 3 }, '&:last-child': { pb: { xs: 2.1, sm: 2.5, md: 3 } } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.35fr) minmax(260px, 0.65fr)' }, gap: { xs: 2.25, md: 3 }, alignItems: 'end' }}>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Box sx={buildPulseSx()} />
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 800, letterSpacing: 1.4 }}>WORLD STATE</Typography>
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 860, letterSpacing: 0, lineHeight: { xs: 1.15, sm: 1.08 }, maxWidth: 720 }}>
                有一些角色正在这里继续成为自己。
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25, maxWidth: 760, lineHeight: 1.85, overflowWrap: 'anywhere' }}>
                {worldLine}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 2 }}>
                <Chip size="small" label={`${runningChats} 个现场仍在运行`} variant="outlined" />
                <Chip size="small" label={`${memoryCount} 条记忆痕迹`} variant="outlined" />
                <Chip size="small" label={`${customCharacters.length} 个角色档案`} variant="outlined" />
              </Box>
            </Box>
            <Box sx={{ display: 'grid', gap: 1, p: 1.25, borderRadius: 2.5, border: '1px solid', borderColor: 'rgba(148,163,184,0.18)', bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.045)', backdropFilter: 'blur(12px)' }}>
              {[
                ['群聊现场', totalGroupChats],
                ['私域关系', totalDirectChats],
                ['角色生命', customCharacters.length],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, px: 0.75, py: 0.35 }}>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                  <Typography variant="subtitle2" sx={{ fontWeight: 820 }}>{value}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </SurfaceCard>

        <SurfaceCard>
          <SectionHeader title="工作台概览" subtitle="常用入口保持轻量，角色、群聊和私聊都从这里快速进入。" />
          <Box sx={buildStatGridSx()}>
            {stats.map((stat, index) => (
              <Box key={stat.label} sx={buildStatCellSx()}>
                <SurfaceCard
                  sx={buildStatCardSx()}
                  contentSx={{
                    ...buildStatContentSx(),
                    '& > :not(button)': { width: '100%', display: 'flex', justifyContent: 'center' },
                  }}
                  onClick={stat.onOpen}
                  aria-label={`${stat.label}快捷入口`}
                >
                  <IconButton
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      stat.onCreate();
                    }}
                    aria-label={stat.createLabel}
                    sx={buildCreateButtonSx()}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                  <Box sx={buildStatIconSx(stat.color)}>{stat.icon}</Box>
                  <Typography variant="h5" sx={buildStatValueSx()}>{stat.value}</Typography>
                  <Typography variant="body2" sx={buildStatLabelSx()}>{stat.label}</Typography>
                </SurfaceCard>
              </Box>
            ))}
          </Box>
        </SurfaceCard>

        <Divider />

        <SurfaceCard>
          <SectionHeader title={recentChatsTitle} action={<Button size="small" variant="outlined" onClick={() => navigate(`/chats?tab=${recentChatsActionTab}`)}>查看全部</Button>} />
          {recentChats.length === 0 ? (
            <EmptyState
              icon="🍵"
              message={t('home.noChats')}
              action={<Button variant="outlined" onClick={() => navigate('/chats/create')}>{t('chat.create')}</Button>}
            />
          ) : (
            <Box sx={buildGridSx()}>
              {recentChats.map((chat) => (
                <ChatCard key={chat.id} chat={chat} characters={characters} onClick={() => openChatFromHome(chat)} />
              ))}
            </Box>
          )}
        </SurfaceCard>
      </PageSection>
    </Box>
  );
}
