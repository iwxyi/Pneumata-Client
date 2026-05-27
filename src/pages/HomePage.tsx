import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Typography, Button, Divider, IconButton } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChatIcon from '@mui/icons-material/Chat';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';
import PersonIcon from '@mui/icons-material/Person';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/useAuthStore';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { hasUsableDefaultTextAI } from '../types/settings';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';
import { avatarGenerationQueue, type AvatarGenerationQueueSummary } from '../services/avatarGenerationQueue';
import { motion, transition } from '../styles/motion';

interface HomeOverviewCard {
  label: string;
  value: string | number;
  icon: ReactNode;
  color: string;
  onOpen: () => void | Promise<void>;
  onCreate?: () => void | Promise<void>;
  createLabel?: string;
  attention?: boolean;
}

function buildStatGridSx() {
  return {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'repeat(auto-fit, minmax(104px, 1fr))',
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
    transition: transition(['transform', 'box-shadow', 'border-color'], motion.durations.base, motion.gentleSpring),
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: (theme: Theme) => theme.palette.mode === 'light' ? '0 16px 36px rgba(15,23,42,0.08)' : '0 18px 42px rgba(0,0,0,0.34)',
      borderColor: 'primary.main',
    },
    '&:active': {
      transform: 'translateY(0) scale(0.992)',
      transitionTimingFunction: motion.press,
      transitionDuration: `${motion.durations.instant}ms`,
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

function buildAttentionCardSx() {
  return {
    ...buildStatCardSx(),
    borderColor: (theme: Theme) => `${theme.palette.primary.main}42`,
    bgcolor: (theme: Theme) => theme.palette.mode === 'light'
      ? 'rgba(49,90,156,0.065)'
      : 'rgba(120,156,220,0.095)',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderTop: '1px solid',
      borderColor: (theme: Theme) => `${theme.palette.primary.main}40`,
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
    transition: transition(['transform', 'box-shadow', 'background-color'], motion.durations.base, motion.spring),
    '&:hover': {
      bgcolor: 'primary.dark',
      transform: 'translateY(-1px) scale(1.08)',
      boxShadow: 4,
    },
    '&:active': {
      transform: 'scale(0.93)',
      transitionTimingFunction: motion.press,
      transitionDuration: `${motion.durations.instant}ms`,
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
  const developerMode = useSettingsStore((state) => state.developerMode);
  const authMode = useAuthStore((state) => state.authMode);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [avatarQueueSummary, setAvatarQueueSummary] = useState<AvatarGenerationQueueSummary>(() => avatarGenerationQueue.getSummary());

  useEffect(() => {
    markChatsWarm();
    markCharactersWarm();
    void prefetchChats();
    void prefetchCharacters();
  }, [markCharactersWarm, markChatsWarm, prefetchCharacters, prefetchChats]);

  useEffect(() => avatarGenerationQueue.subscribeSummary(setAvatarQueueSummary), []);

  const recentChats = chats.slice(0, 10);
  const customCharacters = characters.filter((character) => !character.isPreset);
  const totalDirectChats = chats.filter((chat) => chat.type === 'direct' || chat.type === 'ai_direct').length;
  const totalGroupChats = chats.filter((chat) => chat.type === 'group').length;
  const openChatFromHome = (chat: typeof chats[number]) => navigate(`/chats/${chat.id}?fromTab=${chat.type === 'group' ? 0 : chat.type === 'ai_direct' ? 2 : 1}`);
  const recentChatsTitle = '最近会话';
  const recentChatsActionTab = recentChats[0]?.type === 'group' ? 0 : recentChats[0]?.type === 'ai_direct' ? 2 : 1;
  const needsAIModelSetup = !hasUsableDefaultTextAI(aiProfiles);
  const needsLogin = authMode === 'local' || !isLoggedIn;
  const needsOwnCharacter = characters.length > 0 && customCharacters.length === 0;
  const hasActiveAvatarTasks = avatarQueueSummary.active > 0;

  const attentionStats: HomeOverviewCard[] = [
    ...(needsAIModelSetup ? [{
      label: '默认文本模型',
      value: '待设置',
      icon: <SettingsSuggestIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/models'),
      attention: true,
    }] : []),
    ...(needsLogin ? [{
      label: '云同步',
      value: '未登录',
      icon: <CloudOffIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/account'),
      attention: true,
    }] : []),
    ...(developerMode ? [{
      label: '开发者模式',
      value: '已开启',
      icon: <DeveloperModeIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/settings'),
      attention: true,
    }] : []),
    ...(needsOwnCharacter ? [{
      label: '自定义角色',
      value: '暂无',
      icon: <PersonIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/characters'),
      attention: true,
    }] : []),
    ...(hasActiveAvatarTasks ? [{
      label: avatarQueueSummary.running > 0
        ? `头像生成中，队列 ${avatarQueueSummary.queued}`
        : '头像等待生成',
      value: avatarQueueSummary.active,
      icon: <AutoAwesomeIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/characters'),
      attention: true,
    }] : []),
  ];

  const stats: HomeOverviewCard[] = [
    ...attentionStats,
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
          <Box sx={buildStatGridSx()}>
            {stats.map((stat, index) => (
              <Box key={stat.label} sx={buildStatCellSx()}>
                <SurfaceCard
                  sx={stat.attention ? buildAttentionCardSx() : buildStatCardSx()}
                  contentSx={{
                    ...buildStatContentSx(),
                    '& > :not(button)': { width: '100%', display: 'flex', justifyContent: 'center' },
                  }}
                  onClick={stat.onOpen}
                  aria-label={`${stat.label}快捷入口`}
                >
                  {stat.onCreate ? (
                    <IconButton
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        stat.onCreate?.();
                      }}
                      aria-label={stat.createLabel}
                      sx={buildCreateButtonSx()}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  ) : null}
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
