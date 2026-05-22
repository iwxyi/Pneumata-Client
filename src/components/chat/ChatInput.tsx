import { useState } from 'react';
import { Box, TextField, IconButton, Chip, Typography, CircularProgress } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

interface ChatInputProps {
  mode: 'guide' | 'speakAs';
  characterName?: string;
  onSend: (content: string) => void | Promise<void>;
  onClose?: () => void;
  placeholderOverride?: string;
  sendingLabel?: string;
  onSendError?: (message: string) => void;
}

export default function ChatInput({ mode, characterName, onSend, onClose, placeholderOverride, sendingLabel, onSendError }: ChatInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { t } = useTranslation();

  const handleSend = async () => {
    const content = text.trim();
    if (!content || isSending) return;
    setIsSending(true);
    try {
      await onSend(content);
      setText('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onSendError?.(message || '发送失败，请稍后重试');
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
        bgcolor: isSending ? 'action.disabledBackground' : 'background.paper',
        flexShrink: 0,
        opacity: isSending ? 0.72 : 1,
        pointerEvents: isSending ? 'none' : 'auto',
        position: 'relative',
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
        disabled={isSending}
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
        {isSending ? <CircularProgress size={22} /> : <SendIcon />}
      </IconButton>
      {isSending ? (
        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', right: 56, bottom: 2 }}>
          {sendingLabel || '等待发送…'}
        </Typography>
      ) : null}
    </Box>
  );
}
