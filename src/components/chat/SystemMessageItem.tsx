import { Box, Typography } from '@mui/material';
import type { Message } from '../../types/message';

export default function SystemMessageItem({ message }: { message: Message }) {
  return (
    <Box data-message-id={message.id} data-message-type="system" sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic', px: 2, py: 0.5, bgcolor: 'action.hover', borderRadius: 2 }}>
        {message.content}
      </Typography>
    </Box>
  );
}
