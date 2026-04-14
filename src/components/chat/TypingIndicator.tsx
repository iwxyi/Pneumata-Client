import { Box, Avatar, Typography, keyframes } from '@mui/material';

const bounce = keyframes`
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
`;

interface TypingIndicatorProps {
  characterName: string;
  avatar: string;
}

export default function TypingIndicator({ characterName, avatar }: TypingIndicatorProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 2, mb: 1.5 }}>
      <Avatar
        sx={{
          width: 36,
          height: 36,
          fontSize: '1.2rem',
          bgcolor: 'primary.light',
          flexShrink: 0,
          mt: 0.5,
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
            display: 'flex',
            gap: 0.5,
            px: 2,
            py: 1.5,
            bgcolor: 'surface.main',
            borderRadius: '16px 16px 16px 4px',
          }}
        >
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
      </Box>
    </Box>
  );
}
