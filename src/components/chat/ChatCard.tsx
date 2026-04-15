import { Card, CardContent, CardActionArea, Box, Typography, Avatar, AvatarGroup, Chip } from '@mui/material';
import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import { formatRelativeTime } from '../../utils/format';
import { useTranslation } from 'react-i18next';

interface ChatCardProps {
  chat: GroupChat;
  characters: AICharacter[];
  onClick: () => void;
}

export default function ChatCard({ chat, characters, onClick }: ChatCardProps) {
  const { t } = useTranslation();
  const members = characters.filter((c) => chat.memberIds.includes(c.id));

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        borderRadius: 2,
        bgcolor: 'background.paper',
        transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: 2,
          borderColor: 'primary.main',
        },
      }}
    >
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={600} noWrap>
                {chat.name}
              </Typography>
              {chat.topic && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {chat.topic}
                </Typography>
              )}
            </Box>
            <Chip
              label={chat.isActive ? t('chat.active') : t('chat.paused')}
              size="small"
              color={chat.isActive ? 'success' : 'default'}
              variant="outlined"
              sx={{ ml: 1, flexShrink: 0 }}
            />
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <AvatarGroup max={5} sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: '0.85rem' } }}>
              {members.map((m) => (
                <Avatar key={m.id} sx={{ bgcolor: 'primary.light' }}>
                  {m.avatar}
                </Avatar>
              ))}
            </AvatarGroup>
            <Typography variant="caption" color="text.disabled">
              {formatRelativeTime(chat.lastMessageAt)}
            </Typography>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
