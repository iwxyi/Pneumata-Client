import { Box, Dialog, DialogContent, DialogTitle } from '@mui/material';
import { useState } from 'react';
import type { Message } from '../../types/message';
import { getNarrativeParagraphBlocks } from './messageBubblePresentation';
import { NarrativeParagraphContent, PendingTypingDots } from './ChatMessageContent';

export default function NarrativeMessageItem({ message, pending = false }: { message: Message; pending?: boolean }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const blocks = getNarrativeParagraphBlocks(message);

  return (
    <>
      <Box data-message-id={message.id} data-message-type={message.type} sx={{ display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 3 }, py: 1.1, width: '100%' }}>
        <Box
          onDoubleClick={() => setViewerOpen(true)}
          sx={{ width: '100%', maxWidth: 760, px: { xs: 0.5, sm: 1 }, py: 0.5 }}
        >
          {blocks.length ? <NarrativeParagraphContent blocks={blocks} /> : pending ? <PendingTypingDots /> : null}
        </Box>
      </Box>
      <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{message.senderName}</DialogTitle>
        <DialogContent>{blocks.length ? <NarrativeParagraphContent blocks={blocks} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}
