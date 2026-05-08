import { Card, CardContent, CardActionArea, Box, Typography, Avatar, AvatarGroup, Chip } from '@mui/material';
import { isImageAvatar } from '../../utils/avatar';
import DirectIcon from '@mui/icons-material/ChatBubbleOutlined';
import GroupIcon from '@mui/icons-material/Groups';
import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import { formatRelativeTime } from '../../utils/format';
import { useTranslation } from 'react-i18next';

interface ChatCardProps {
  chat: GroupChat;
  characters: AICharacter[];
  onClick: () => void;
  onPrefetch?: () => void;
}

function cleanRelationshipPreview(text: string) {
  return text
    .replace(/^[^\s]+→/, '')
    .replace(/^[^↔]+↔[^：:]+[：:]/, '')
    .trim();
}

function buildRelationshipPreview(members: AICharacter[]) {
  return members
    .flatMap((member) => member.relationships
      .filter((relation) => Boolean(relation.note?.trim()))
      .slice(0, 1)
      .map((relation) => {
        const preview = cleanRelationshipPreview(relation.note || '');
        return preview ? `${member.name}：${preview}` : '';
      }))
    .find(Boolean) || '';
}

function clipPreview(text: string, max = 72) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildChatSubtitle(chat: GroupChat, members: AICharacter[]) {
  const relationshipPreview = buildRelationshipPreview(members);
  const memorySummary = (chat.layeredMemories || []).slice(-2).map((item) => item.text).join(' / ');
  return clipPreview(relationshipPreview || memorySummary || chat.worldState?.recentEvent || chat.topic || '');
}

export default function ChatCard({ chat, characters, onClick, onPrefetch }: ChatCardProps) {
  const { t } = useTranslation();
  const members = characters.filter((c) => chat.memberIds.includes(c.id));
  const isDirect = chat.type === 'direct' || chat.type === 'ai_direct';
  const subtitle = buildChatSubtitle(chat, members);

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
      <CardActionArea onClick={onClick} onPointerEnter={onPrefetch} onFocus={onPrefetch} onPointerDown={onPrefetch}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                {isDirect ? <DirectIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> : <GroupIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                  {chat.type === 'group' ? `${chat.name} (${chat.memberIds.length})` : chat.name}
                </Typography>
              </Box>
              {subtitle ? (
                <Typography variant="caption" color="text.secondary" noWrap>
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
                sx={{ ml: 1, flexShrink: 0 }}
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
