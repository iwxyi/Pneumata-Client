import { Box, Typography } from '@mui/material';

interface EmptyStateProps {
  icon?: string;
  message: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon = '📭', message, action }: EmptyStateProps) {
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
        borderRadius: 7,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="h2" sx={{ mb: 2, transition: 'transform 180ms ease', '&:hover': { transform: 'scale(1.04)' } }}>
        {icon}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 360 }}>
        {message}
      </Typography>
      {action}
    </Box>
  );
}
