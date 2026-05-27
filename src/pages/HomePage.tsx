import { useEffect } from 'react';
import { Box, Typography, Button, Divider, IconButton } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ChatIcon from '@mui/icons-material/Chat';
import PersonIcon from '@mui/icons-material/Person';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { getPreferredAIProfile } from '../types/settings';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';

function buildStatGridSx() {
  return {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'repeat(3, minmax(0, 1fr))',
      sm: 'repeat(auto-fit, minmax(116px, 142px))',
    },
    columnGap: { xs: 0.75, sm: 1 },
    rowGap: { xs: 1, sm: 1.25 },
    mt: 1,
    px: 0,
    pb: 0.75,
    alignItems: 'stretch',
    justifyContent: { xs: 'stretch', sm: 'start' },
  };
}

function buildStatCellSx() {
  return {
    minWidth: 0,
    display: 'flex',
    justifyContent: 'stretch',
    overflow: 'visible',
  };
}

function buildStatCardSx() {
  return {
    width: '100%',
    maxWidth: { xs: 'none', sm: 142 },
    minWidth: 0,
    position: 'relative',
    overflow: 'visible',
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
      borderTop: '1px solid',
      borderColor: (theme: Theme) => `${theme.palette.primary.main}24`,
      pointerEvents: 'none',
      borderRadius: 'inherit',
    },
  };
}

function buildStatContentSx() {
  return {
    width: '100%',
    textAlign: 'center',
    py: { xs: 1.15, sm: 1.35 },
    px: { xs: 0.55, sm: 0.9 },
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: { xs: 0.35, sm: 0.45 },
    minHeight: { xs: 78, sm: 88 },
    overflow: 'visible',
  };
}

function buildCreateButtonSx() {
  return {
    position: 'absolute',
    right: -6,
    bottom: -6,
    zIndex: 1,
    width: { xs: 28, sm: 30 },
    height: { xs: 28, sm: 30 },
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    boxShadow: (theme: Theme) => theme.palette.mode === 'light'
      ? '0 10px 24px rgba(15,23,42,0.20)'
      : '0 12px 28px rgba(0,0,0,0.42)',
    border: 2,
    borderColor: 'background.default',
    borderRadius: '50%',
    transition: 'transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
    '&:hover': {
      bgcolor: 'primary.dark',
      transform: 'scale(1.08)',
      boxShadow: 4,
    },
    '& .MuiTouchRipple-root': {
      borderRadius: '50%',
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
    minHeight: { xs: '2.2em', sm: '2.3em' },
    color: 'text.secondary',
    fontSize: { xs: '0.7rem', sm: '0.78rem' },
  };
}

function buildStatValueSx() {
  return {
    fontWeight: 700,
    lineHeight: 1,
    fontSize: { xs: '1rem', sm: '1.16rem' },
  };
}

function buildStatIconSx(color: string) {
  return {
    color,
    fontSize: { xs: '0.9rem', sm: '1rem' },
    lineHeight: 1,
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
  const aiProfiles = useSettingsStore((state) => state.aiProfiles);

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
  const openChatFromHome = (chat: typeof chats[number]) => navigate(`/chats/${chat.id}?fromTab=${chat.type === 'group' ? 0 : chat.type === 'ai_direct' ? 2 : 1}`);
  const recentChatsTitle = '最近会话';
  const recentChatsActionTab = recentChats[0]?.type === 'group' ? 0 : recentChats[0]?.type === 'ai_direct' ? 2 : 1;
  const textProfile = getPreferredAIProfile(aiProfiles, 'text');
  const needsAIModelSetup = !textProfile?.apiKey?.trim() || !textProfile?.model?.trim();

  const stats = [
    {
      label: t('home.totalChats'),
      value: totalGroupChats,
      icon: <ChatIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/chats?tab=0'),
      onCreate: () => navigate('/chats/create'),
      createLabel: t('chat.create'),
    },
    {
      label: '单聊数量',
      value: totalDirectChats,
      icon: <ChatIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/chats?tab=1'),
      onCreate: () => navigate('/direct/create'),
      createLabel: '创建单聊',
    },
    {
      label: t('home.totalCharacters'),
      value: customCharacters.length,
      icon: <PersonIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/characters'),
      onCreate: () => navigate('/characters/create'),
      createLabel: t('character.create'),
    },
  ];

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2.5, sm: 3, md: 3.5 }, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 96px)', sm: 3, md: 3.5 } }}>
      <PageSection spacing={3}>
        <SurfaceCard>
          <SectionHeader title="工作台概览" />
          {needsAIModelSetup ? (
            <Box
              role="button"
              tabIndex={0}
              onClick={() => navigate('/models')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate('/models');
                }
              }}
              sx={{
                mt: 0.5,
                mb: 1.5,
                px: { xs: 1.5, sm: 1.75 },
                py: { xs: 1.35, sm: 1.5 },
                display: 'flex',
                alignItems: { xs: 'flex-start', sm: 'center' },
                gap: 1.25,
                borderRadius: 1,
                border: '1px solid',
                borderColor: (theme) => `${theme.palette.primary.main}66`,
                bgcolor: (theme) => theme.palette.mode === 'light'
                  ? 'rgba(49, 90, 156, 0.09)'
                  : 'rgba(120, 156, 220, 0.14)',
                boxShadow: (theme) => theme.palette.mode === 'light'
                  ? '0 14px 34px rgba(49, 90, 156, 0.10)'
                  : '0 18px 40px rgba(0, 0, 0, 0.24)',
                cursor: 'pointer',
                outline: 'none',
                transition: 'border-color 180ms ease, background-color 180ms ease, transform 180ms ease',
                '&:hover, &:focus-visible': {
                  transform: 'translateY(-1px)',
                  borderColor: 'primary.main',
                  bgcolor: (theme) => theme.palette.mode === 'light'
                    ? 'rgba(49, 90, 156, 0.12)'
                    : 'rgba(120, 156, 220, 0.18)',
                },
              }}
            >
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                  color: 'primary.main',
                  bgcolor: (theme) => theme.palette.mode === 'light'
                    ? 'rgba(255,255,255,0.62)'
                    : 'rgba(255,255,255,0.08)',
                  border: '1px solid',
                  borderColor: (theme) => theme.palette.mode === 'light'
                    ? 'rgba(49, 90, 156, 0.18)'
                    : 'rgba(120, 156, 220, 0.22)',
                }}
              >
                <SettingsSuggestIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.35 }}>
                  需要设置 AI 模型
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, lineHeight: 1.55 }}>
                  配置文本模型后，角色回复、群聊调度和内容生成才能正常运行。
                </Typography>
              </Box>
              <Button
                size="small"
                variant="contained"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate('/models');
                }}
                sx={{ flexShrink: 0, display: { xs: 'none', sm: 'inline-flex' } }}
              >
                去设置
              </Button>
            </Box>
          ) : null}
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
