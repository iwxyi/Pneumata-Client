import { Box, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import type { Message } from '../../types/message';
import { getNarrativeParagraphBlocks } from './messageBubblePresentation';
import { NarrativeParagraphContent, PendingTypingDots } from './ChatMessageContent';

export interface NarrativeStoryChoiceOption {
  label: string;
  value: string;
}

interface NarrativeMessageItemProps {
  message: Message;
  pending?: boolean;
  storyChoiceOptions?: NarrativeStoryChoiceOption[];
  onChooseStoryChoice?: (value: string) => void;
}

function StoryChoicePanel({ options, onChoose }: { options: NarrativeStoryChoiceOption[]; onChoose: (value: string) => void }) {
  if (!options.length) return null;
  return (
    <Stack spacing={0.75} sx={{ mt: 1.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, fontWeight: 700 }}>
        选择接下来的剧情走向
      </Typography>
      {options.map((option) => (
        <Box
          key={option.value}
          component="button"
          type="button"
          onClick={() => onChoose(option.value)}
          sx={(theme) => ({
            width: '100%',
            border: `1px solid ${theme.palette.mode === 'light' ? 'rgba(148,163,184,0.32)' : 'rgba(226,232,240,0.16)'}`,
            borderRadius: 3,
            px: { xs: 1.5, sm: 1.75 },
            py: { xs: 1, sm: 1.1 },
            bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.88)' : 'rgba(15,23,42,0.82)',
            color: 'text.primary',
            textAlign: 'left',
            font: 'inherit',
            cursor: 'pointer',
            boxShadow: theme.palette.mode === 'light'
              ? '0 12px 34px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,0.88)'
              : '0 14px 36px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)',
            backdropFilter: 'blur(18px) saturate(1.25)',
            transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, background-color 140ms ease',
            '&:hover': {
              transform: 'translateY(-1px)',
              borderColor: theme.palette.mode === 'light' ? 'rgba(99,102,241,0.38)' : 'rgba(129,140,248,0.44)',
              bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.96)' : 'rgba(30,41,59,0.9)',
              boxShadow: theme.palette.mode === 'light'
                ? '0 16px 42px rgba(79,70,229,0.14), inset 0 1px 0 rgba(255,255,255,0.96)'
                : '0 18px 44px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.10)',
            },
            '&:active': { transform: 'translateY(0) scale(0.992)' },
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
          })}
        >
          <Typography variant="body2" sx={{ fontSize: { xs: 14, sm: 14.5 }, fontWeight: 400, lineHeight: 1.7, letterSpacing: 0 }}>{option.label}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

export default function NarrativeMessageItem({ message, pending = false, storyChoiceOptions = [], onChooseStoryChoice }: NarrativeMessageItemProps) {
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
          {onChooseStoryChoice ? <StoryChoicePanel options={storyChoiceOptions} onChoose={onChooseStoryChoice} /> : null}
        </Box>
      </Box>
      <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{message.senderName}</DialogTitle>
        <DialogContent>{blocks.length ? <NarrativeParagraphContent blocks={blocks} /> : null}</DialogContent>
      </Dialog>
    </>
  );
}
