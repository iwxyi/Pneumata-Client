import { memo } from 'react';
import { Card, CardContent, CardActionArea, Box, Typography, Avatar, AvatarGroup, Chip } from '@mui/material';
import { isImageAvatar } from '../../utils/avatar';
import DirectIcon from '@mui/icons-material/ChatBubbleOutlined';
import GroupIcon from '@mui/icons-material/Groups';
import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import { formatRelativeTime } from '../../utils/format';
import { useTranslation } from 'react-i18next';
import { buildCompanionshipStatusSignature } from '../../services/companionshipProjection';
import { buildInteractiveSurfaceSx, buildSelectionRailSx } from '../../styles/interaction';
import { buildChatSubtitle } from './chatCardSubtitle';

interface ChatCardProps {
  chat: GroupChat;
  characters: AICharacter[];
  onClick: () => void;
  onPrefetch?: () => void;
  selected?: boolean;
}

function isPreviewableMessage(message: Message | null | undefined): message is Message {
  return Boolean(message && !message.isDeleted && message.type !== 'system' && message.type !== 'event');
}

function latestByTimestamp(messages: Array<Message | null | undefined>) {
  return messages
    .filter(isPreviewableMessage)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
}

function ChatCard({ chat, characters, onClick, onPrefetch, selected = false }: ChatCardProps) {
  const { t } = useTranslation();
  const resolvedLatestMessage = latestByTimestamp([chat.latestMessage]) || null;
  const members = characters.filter((c) => chat.memberIds.includes(c.id));
  const isDirect = chat.type === 'direct' || chat.type === 'ai_direct';
  const directKnownMessages = latestByTimestamp([chat.latestMessage])
    ? [chat.latestMessage as Message]
    : [];
  const companionshipStatus = chat.type === 'direct' && members[0]
    ? buildCompanionshipStatusSignature({ chat, character: members[0], messages: directKnownMessages })
    : null;
  const companionshipPreview = companionshipStatus?.unsentDraft || companionshipStatus?.offlineTrace || companionshipStatus?.text || '';
  const subtitle = buildChatSubtitle(chat, members, resolvedLatestMessage, companionshipPreview);

  return (
    <Card
      variant="outlined"
      sx={{
        ...buildInteractiveSurfaceSx({ selected }),
        height: '100%',
        overflow: 'hidden',
        '&::before': {
          ...buildSelectionRailSx(selected || !isDirect, isDirect ? 2 : 3),
          opacity: selected ? 0.9 : isDirect ? 0.22 : 0.30,
        },
      }}
    >
      <CardActionArea
        onClick={onClick}
        onPointerEnter={onPrefetch}
        onFocus={onPrefetch}
        onPointerDown={onPrefetch}
        sx={{
          height: '100%',
        }}
      >
        <CardContent sx={{ p: { xs: 1.75, sm: 2 }, position: 'relative', zIndex: 1, '&:last-child': { pb: { xs: 1.75, sm: 2 } } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                {isDirect ? <DirectIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> : <GroupIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 760, letterSpacing: 0 }}>
                  {chat.type === 'group' ? `${chat.name} (${chat.memberIds.length})` : chat.name}
                </Typography>
              </Box>
              {subtitle ? (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.35 }}>
                  {subtitle}
                </Typography>
              ) : null}
            </Box>
            {chat.deletedAt == null ? (
              <Chip
                label={chat.isActive ? t('chat.active') : t('chat.paused')}
                size="small"
                color={chat.isActive ? 'success' : 'default'}
                variant="outlined"
                sx={{ ml: 1, flexShrink: 0, bgcolor: chat.isActive ? 'rgba(46, 125, 50, 0.08)' : 'transparent' }}
              />
            ) : null}
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {isDirect ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {members[0] ? <Avatar src={isImageAvatar(members[0].avatar) ? members[0].avatar : undefined} sx={{ width: 28, height: 28, fontSize: '0.85rem', bgcolor: 'primary.light' }}>{isImageAvatar(members[0].avatar) ? undefined : members[0].avatar}</Avatar> : null}
                <Typography variant="caption" color="text.secondary">{chat.type === 'ai_direct' ? 'AI私聊' : '单聊'}</Typography>
              </Box>
            ) : (
              <AvatarGroup max={5} sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: '0.85rem' } }}>
                {members.map((m) => (
                  <Avatar key={m.id} src={isImageAvatar(m.avatar) ? m.avatar : undefined} sx={{ bgcolor: 'primary.light' }}>
                    {isImageAvatar(m.avatar) ? undefined : m.avatar}
                  </Avatar>
                ))}
              </AvatarGroup>
            )}
            <Typography variant="caption" color="text.disabled">
              {formatRelativeTime(chat.lastMessageAt)}
            </Typography>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default memo(ChatCard, (prev, next) => (
  prev.chat === next.chat
  && prev.characters === next.characters
  && prev.selected === next.selected
  && prev.onPrefetch === next.onPrefetch
));
