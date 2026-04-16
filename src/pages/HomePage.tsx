import { useEffect } from 'react';
import { Box, Typography, Card, CardContent, Button, Divider, IconButton, CardActionArea } from '@mui/material';
import { Add as AddIcon, Chat as ChatIcon, Person as PersonIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';

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

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2.5, sm: 3, md: 3.5 }, pt: { xs: 1, sm: 1, md: 3 } }}>
      {/* Stats */}
      <Box sx={{ display: 'flex', gap: { xs: 1.25, sm: 1.5 }, mb: 4, px: { xs: 0.5, sm: 0.75 }, alignItems: 'stretch', justifyContent: 'flex-start', flexWrap: 'nowrap' }}>
        {[
          {
            label: t('home.totalChats'),
            value: chats.filter((chat) => chat.type === 'group').length,
            icon: <ChatIcon />,
            color: '#6750A4',
            onOpen: () => navigate('/chats'),
            onCreate: () => navigate('/chats/create'),
            createLabel: t('chat.create'),
          },
          {
            label: '单聊数量',
            value: totalDirectChats,
            icon: <ChatIcon />,
            color: '#4E7E6B',
            onOpen: () => navigate('/chats'),
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
        ].map((stat) => (
          <Card
            key={stat.label}
            variant="outlined"
            sx={{
              width: { xs: 'calc(50% - 6px)', sm: 220 },
              flex: '0 0 auto',
              borderRadius: 2,
              bgcolor: 'background.paper',
              overflow: 'visible',
              transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: 2,
                borderColor: 'primary.main',
              },
            }}
          >
            <CardActionArea onClick={stat.onOpen} sx={{ borderRadius: 2 }}>
              <CardContent
                sx={{
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
                }}
              >
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    stat.onCreate();
                  }}
                  aria-label={stat.createLabel}
                  sx={{
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
                  }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
                <Box sx={{ color: stat.color, fontSize: '1.3rem', lineHeight: 1 }}>{stat.icon}</Box>
                <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1 }}>
                  {stat.value}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                  {stat.label}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>

      <Divider sx={{ mb: 3 }} />

      {recentDirectChats.length > 0 ? (
        <>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
            最近单聊
          </Typography>
          <Box sx={{ px: { xs: 0.5, sm: 0.75 }, mb: 4 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
              {recentDirectChats.map((chat) => (
                <ChatCard key={chat.id} chat={chat} characters={characters} onClick={() => navigate(`/chats/${chat.id}`)} />
              ))}
            </Box>
          </Box>
        </>
      ) : null}

      <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
        {t('home.recentChats')}
      </Typography>

      <Box sx={{ px: { xs: 0.5, sm: 0.75 } }}>
      {recentChats.length === 0 ? (
        <EmptyState
          icon="🍵"
          message={t('home.noChats')}
          action={
            <Button variant="outlined" onClick={() => navigate('/chats/create')}>
              {t('chat.create')}
            </Button>
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
          {recentChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={chat}
              characters={characters}
              onClick={() => navigate(`/chats/${chat.id}`)}
            />
          ))}
        </Box>
      )}
      </Box>
    </Box>
  );
}
