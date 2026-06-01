import { Box, Button, Typography } from '@mui/material';
import type { SessionInfoCard } from '../../services/sessionInfoProjection';

interface SessionInfoCardsProps {
  cards: SessionInfoCard[];
  onOpenChat: (chatId: string) => void;
}

export default function SessionInfoCards({ cards, onOpenChat }: SessionInfoCardsProps) {
  if (!cards.length) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {cards.map((card) => (
        <Box key={card.key} sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{card.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>{card.description}</Typography>
          {card.actionLabel && card.actionChatId ? (
            <Button variant="outlined" size="small" sx={{ mt: 1 }} onClick={() => onOpenChat(card.actionChatId as string)}>
              {card.actionLabel}
            </Button>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

