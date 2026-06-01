import { useEffect } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import WorldCalendarPanel from '../components/calendar/WorldCalendarPanel';

export default function CalendarPage() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const { setHeaderTitle, setHeaderBackAction } = useLayoutHeaderActions();
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get('conversationId');
  const actorId = searchParams.get('actorId');
  const chats = useChatStore((state) => state.chats);
  const loadChats = useChatStore((state) => state.loadChats);
  const updateChat = useChatStore((state) => state.updateChat);
  const characters = useCharacterStore((state) => state.characters);
  const loadCharacters = useCharacterStore((state) => state.loadCharacters);

  useEffect(() => {
    void loadChats();
    void loadCharacters();
  }, [loadCharacters, loadChats]);

  useEffect(() => {
    setHeaderTitle(isZh ? '日历' : 'Calendar');
    setHeaderBackAction(null);
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
    };
  }, [isZh, setHeaderBackAction, setHeaderTitle]);

  return (
    <Box
      sx={{
        px: { xs: 1.5, sm: 2, md: 3 },
        py: { xs: 1, sm: 1.5, md: 2 },
        width: '100%',
        maxWidth: 1240,
        mx: 'auto',
      }}
    >
      <Box
        sx={{
          width: '100%',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(20,24,32,0.74)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: (theme) => theme.palette.mode === 'light'
            ? '0 10px 30px rgba(15,23,42,0.06)'
            : '0 10px 28px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
      >
        <WorldCalendarPanel
          chats={chats}
          characters={characters}
          updateChat={updateChat}
          isZh={isZh}
          conversationId={conversationId}
          actorId={actorId}
          compact={false}
          showHeader={false}
        />
      </Box>
    </Box>
  );
}
