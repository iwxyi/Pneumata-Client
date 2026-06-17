import { Box, CircularProgress, Typography } from '@mui/material';

interface LoadingStateProps {
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

export default function LoadingState({ title, subtitle, compact = false }: LoadingStateProps) {
  return (
    <Box
      sx={{
        width: '100%',
        display: 'grid',
        justifyItems: 'center',
        alignContent: 'start',
        textAlign: 'center',
        pt: compact ? 1.5 : { xs: 4, sm: 6 },
        px: 2,
        gap: 1,
      }}
    >
      <CircularProgress color="primary" size={compact ? 22 : 28} thickness={4} />
      {title ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      ) : null}
      {subtitle ? <Typography variant="caption" color="text.disabled">{subtitle}</Typography> : null}
    </Box>
  );
}
