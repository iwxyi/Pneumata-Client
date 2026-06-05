import { useEffect } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import WorldCalendarPanel from '../components/calendar/WorldCalendarPanel';
import SurfaceCard from '../components/common/SurfaceCard';

export default function CalendarPage() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const { setHeaderTitle, setHeaderBackAction } = useLayoutHeaderActions();
  const [searchParams] = useSearchParams();
  const conversationId = searchParams.get('conversationId');
  const actorId = searchParams.get('actorId');
  const chats = useChatStore((state) => state.chats);
  const markChatsWarm = useChatStore((state) => state.markChatsWarm);
  const prefetchWorldRuntime = useChatStore((state) => state.prefetchWorldRuntime);
  const updateChat = useChatStore((state) => state.updateChat);
  const characters = useCharacterStore((state) => state.characters);
  const markCharactersWarm = useCharacterStore((state) => state.markCharactersWarm);
  const prefetchCharacters = useCharacterStore((state) => state.prefetchCharacters);

  useEffect(() => {
    markChatsWarm();
    markCharactersWarm();
    void prefetchWorldRuntime();
    void prefetchCharacters();
  }, [markCharactersWarm, markChatsWarm, prefetchCharacters, prefetchWorldRuntime]);

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
      <SurfaceCard sx={{ width: '100%', overflow: 'hidden' }} contentSx={{ p: 0, '&:last-child': { pb: 0 } }}>
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
      </SurfaceCard>
    </Box>
  );
}
