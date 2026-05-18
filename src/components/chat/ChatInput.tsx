import { useState } from 'react';
import { Box, TextField, IconButton, Chip } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

interface ChatInputProps {
  mode: 'guide' | 'speakAs';
  characterName?: string;
  onSend: (content: string) => void | Promise<void>;
  onClose?: () => void;
  placeholderOverride?: string;
}

export default function ChatInput({ mode, characterName, onSend, onClose, placeholderOverride }: ChatInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { t } = useTranslation();

  const handleSend = async () => {
    const content = text.trim();
    if (!content || isSending) return;
    setIsSending(true);
    setText('');
    try {
      await onSend(content);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const placeholder = placeholderOverride || (
    mode === 'guide'
      ? t('controls.topicGuidePlaceholder')
      : t('controls.speakAsPlaceholder', { name: characterName })
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1,
        p: 2,
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        flexShrink: 0,
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
        onClick={() => void handleSend()}
        disabled={!text.trim() || isSending}
        sx={{ flexShrink: 0 }}
      >
        <SendIcon />
      </IconButton>
    </Box>
  );
}
