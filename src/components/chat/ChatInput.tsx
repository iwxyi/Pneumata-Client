import { useState } from 'react';
import { Box, TextField, IconButton, Chip } from '@mui/material';
import { Send as SendIcon, Close as CloseIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ChatInputProps {
  mode: 'guide' | 'speakAs';
  characterName?: string;
  onSend: (content: string) => void;
  onClose?: () => void;
}

export default function ChatInput({ mode, characterName, onSend, onClose }: ChatInputProps) {
  const [text, setText] = useState('');
  const { t } = useTranslation();

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const placeholder =
    mode === 'guide'
      ? t('controls.topicGuidePlaceholder')
      : t('controls.speakAsPlaceholder', { name: characterName });

  return (
    <Box
      sx={{
        position: 'fixed',
        left: { xs: 0, md: 'auto' },
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1,
        p: 2,
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        zIndex: 1100,
      }}
    >
      {mode === 'speakAs' && onClose ? (
        <Chip
          label={characterName}
          onDelete={onClose}
          deleteIcon={<CloseIcon fontSize="small" />}
          size="small"
          color="primary"
          variant="outlined"
          sx={{ flexShrink: 0 }}
        />
      ) : null}
      <TextField
        fullWidth
        multiline
        maxRows={4}
        size="small"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 3,
          },
        }}
      />
      <IconButton
        color="primary"
        onClick={handleSend}
        disabled={!text.trim()}
        sx={{ flexShrink: 0 }}
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
}
