import { Card, CardContent, CardActionArea, Box, Typography, Avatar, AvatarGroup, Chip } from '@mui/material';
import { isImageAvatar } from '../../utils/avatar';
import DirectIcon from '@mui/icons-material/ChatBubbleOutlined';
import GroupIcon from '@mui/icons-material/Groups';
import type { GroupChat } from '../../types/chat';
import type { AICharacter } from '../../types/character';
import type { Message } from '../../types/message';
import { formatRelativeTime } from '../../utils/format';
import { useTranslation } from 'react-i18next';
import { useMessageStore } from '../../stores/useMessageStore';
import { sanitizeUserFacingText } from '../../services/displayTextSanitizer';

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

function buildLatestMessagePreview(message: Message | null, members: AICharacter[]) {
  if (!message || message.isDeleted || message.type === 'system' || message.type === 'event') return '';
  const senderName = message.type === 'user'
    ? '你'
    : message.type === 'god'
      ? 'God Mode'
      : members.find((member) => member.id === message.senderId)?.name || message.senderName || '未知';
  return clipPreview(sanitizeUserFacingText(`${senderName}：${message.content}`, members));
}

function buildChatSubtitle(chat: GroupChat, members: AICharacter[], latestMessage: Message | null) {
  const latestMessagePreview = buildLatestMessagePreview(latestMessage, members);
  const relationshipPreview = buildRelationshipPreview(members);
  const memorySummary = sanitizeUserFacingText((chat.layeredMemories || []).slice(-2).map((item) => item.text).join(' / '), members);
  const recentEvent = sanitizeUserFacingText(chat.worldState?.recentEvent || '', members);
  return latestMessagePreview || clipPreview(sanitizeUserFacingText(relationshipPreview || memorySummary || recentEvent || chat.topic || '', members));
}

function isPreviewableMessage(message: Message | null | undefined): message is Message {
  return Boolean(message && !message.isDeleted && message.type !== 'system' && message.type !== 'event');
}

function latestByTimestamp(messages: Array<Message | null | undefined>) {
  return messages
    .filter(isPreviewableMessage)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
}

export default function ChatCard({ chat, characters, onClick, onPrefetch }: ChatCardProps) {
  const { t } = useTranslation();
  const messages = useMessageStore((state) => state.messages);
  const messageWindowsByChatId = useMessageStore((state) => state.messageWindowsByChatId);

  const allKnownMessages = [...messages, ...(messageWindowsByChatId[chat.id]?.messages || [])];
  const latestKnownMessage = latestByTimestamp(allKnownMessages.filter((message) => message.chatId === chat.id));
  const resolvedLatestMessage = latestByTimestamp([chat.latestMessage, latestKnownMessage]) || null;
  const members = characters.filter((c) => chat.memberIds.includes(c.id));
  const isDirect = chat.type === 'direct' || chat.type === 'ai_direct';
  const subtitle = buildChatSubtitle(chat, members, resolvedLatestMessage);

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        borderRadius: 1,
        position: 'relative',
        overflow: 'hidden',
        bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.76)' : 'rgba(18,20,28,0.78)',
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
        backdropFilter: 'blur(14px)',
        transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: isDirect ? 2 : 3,
          bgcolor: 'primary.main',
          opacity: isDirect ? 0.32 : 0.42,
          pointerEvents: 'none',
        },
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: (theme) => theme.palette.mode === 'light' ? '0 18px 40px rgba(15,23,42,0.09)' : '0 18px 42px rgba(0,0,0,0.34)',
          borderColor: 'primary.main',
        },
      }}
    >
      <CardActionArea onClick={onClick} onPointerEnter={onPrefetch} onFocus={onPrefetch} onPointerDown={onPrefetch}>
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
