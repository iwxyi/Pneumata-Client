import { Box, Typography, Avatar } from '@mui/material';
import type { Message } from '../../types/message';
import { formatTimestamp } from '../../utils/format';

interface MessageBubbleProps {
  message: Message;
  avatar?: string;
}

export default function MessageBubble({ message, avatar }: MessageBubbleProps) {
  if (message.isDeleted) return null;

  if (message.type === 'system') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontStyle: 'italic', px: 2, py: 0.5, bgcolor: 'action.hover', borderRadius: 2 }}
        >
          {message.content}
        </Typography>
      </Box>
    );
  }

  const isUser = message.type === 'user';
  const isGod = message.type === 'god';

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start',
        mb: 1.5,
        px: 2,
        gap: 1,
      }}
    >
      {/* Avatar (left side for AI/God) */}
      {!isUser && (
        <Avatar
          sx={{
            width: 36,
            height: 36,
            fontSize: '1.2rem',
            bgcolor: isGod ? 'warning.light' : 'primary.light',
            flexShrink: 0,
            mt: 0.5,
          }}
        >
          {isGod ? '👑' : avatar || message.senderName.charAt(0)}
        </Avatar>
      )}

      {/* Message content */}
      <Box sx={{ maxWidth: '70%', minWidth: 0 }}>
        {/* Sender name */}
        {!isUser && (
          <Typography
            variant="caption"
            sx={{
              color: isGod ? 'warning.main' : 'text.secondary',
              fontWeight: 600,
              ml: 1,
            }}
          >
            {isGod ? '👑 God Mode' : message.senderName}
          </Typography>
        )}

        {/* Bubble */}
        <Box
          sx={{
            px: 2,
            py: 1,
            borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            bgcolor: isUser
              ? 'primary.main'
              : isGod
                ? 'transparent'
                : 'surface.main',
            color: isUser ? 'primary.contrastText' : 'text.primary',
            border: isGod ? '1.5px dashed' : 'none',
            borderColor: isGod ? 'warning.main' : undefined,
            position: 'relative',
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.content}
          </Typography>
        </Box>

        {/* Timestamp */}
        <Typography
          variant="caption"
          sx={{ color: 'text.disabled', ml: 1, mt: 0.25, display: 'block' }}
        >
          {formatTimestamp(message.timestamp)}
        </Typography>
      </Box>

      {/* Avatar (right side for user) */}
      {isUser && (
        <Avatar
          sx={{
            width: 36,
            height: 36,
            bgcolor: 'primary.dark',
            flexShrink: 0,
            mt: 0.5,
          }}
        >
          U
        </Avatar>
      )}
    </Box>
  );
}
