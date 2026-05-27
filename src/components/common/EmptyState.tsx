import { Box, Typography } from '@mui/material';
import { motion, transition } from '../../styles/motion';

interface EmptyStateProps {
  icon?: string;
  message: string;
  action?: React.ReactNode;
  variant?: 'card' | 'plain';
}

export default function EmptyState({ icon = '📭', message, action, variant = 'card' }: EmptyStateProps) {
  if (variant === 'plain') {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: { xs: 7, sm: 9 },
          px: 3,
          textAlign: 'center',
          color: 'text.disabled',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 500, letterSpacing: 0 }}>
          {message}
        </Typography>
        {action ? <Box sx={{ mt: 2 }}>{action}</Box> : null}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        px: 3,
        textAlign: 'center',
        borderRadius: 3,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="h2" sx={{ mb: 2, transition: transition(['transform'], motion.durations.base, motion.gentleSpring), '&:hover': { transform: 'scale(1.04)' } }}>
        {icon}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 360 }}>
        {message}
      </Typography>
      {action}
    </Box>
  );
}
