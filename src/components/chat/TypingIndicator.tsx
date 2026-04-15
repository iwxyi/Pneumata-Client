import { Box, Avatar, Typography, keyframes } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { buildBubblePreview, resolveBubbleStyle } from '../../utils/bubbleStyle';

const bounce = keyframes`
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
`;

interface TypingIndicatorProps {
  characterName: string;
  avatar: string;
  bubbleStyleId?: string | null;
  content?: string;
}

export default function TypingIndicator({ characterName, avatar, bubbleStyleId, content }: TypingIndicatorProps) {
  const navigate = useNavigate();
  const customBubbleStyles = useSettingsStore((state) => state.customBubbleStyles);
  const bubblePreview = buildBubblePreview(resolveBubbleStyle(bubbleStyleId, customBubbleStyles));

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 2, mb: 1.5 }}>
      <Avatar
        onClick={() => navigate('/characters')}
        sx={{
          width: 36,
          height: 36,
          fontSize: '1.2rem',
          bgcolor: 'transparent',
          border: '1px solid',
          borderColor: 'divider',
          color: 'text.primary',
          flexShrink: 0,
          mt: 0.5,
          cursor: 'pointer',
        }}
      >
        {avatar}
      </Avatar>
      <Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, ml: 1 }}>
          {characterName}
        </Typography>
        <Box
          sx={{
            px: 2,
            py: 1.5,
            bgcolor: bubblePreview.background,
            background: bubblePreview.background,
            color: bubblePreview.color,
            borderRadius: bubblePreview.borderRadius,
            minWidth: 56,
            border: bubblePreview.border,
            boxShadow: bubblePreview.boxShadow,
          }}
        >
          {content ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {content}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {[0, 1, 2].map((i) => (
                <Box
                  key={i}
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: 'text.disabled',
                    animation: `${bounce} 1.4s ease-in-out infinite`,
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
