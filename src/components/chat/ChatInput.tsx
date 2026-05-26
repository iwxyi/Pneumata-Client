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
        px: { xs: 1.5, sm: 2 },
        pt: 1.25,
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        borderTop: '1px solid',
        borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
        bgcolor: (theme) => {
          if (isSending) return theme.palette.mode === 'light' ? 'rgba(245,245,247,0.70)' : 'rgba(20,22,30,0.42)';
          return theme.palette.mode === 'light' ? 'rgba(245,245,247,0.68)' : 'rgba(13,15,22,0.42)';
        },
        backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(22px) saturate(0.96) brightness(1.015) contrast(0.92)' : 'blur(20px) saturate(0.90) brightness(0.84)',
        boxShadow: (theme) => theme.palette.mode === 'light'
          ? '0 -10px 24px rgba(15,23,42,0.035), 0 1px 0 rgba(255,255,255,0.58) inset'
          : '0 -12px 30px rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.09) inset',
        flexShrink: 0,
        opacity: isSending ? 0.72 : 1,
        pointerEvents: isSending ? 'none' : 'auto',
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          right: 0,
          top: -42,
          height: 42,
          pointerEvents: 'none',
          backdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(20px) saturate(0.92) brightness(0.84)',
          WebkitBackdropFilter: (theme) => theme.palette.mode === 'light' ? 'blur(32px) saturate(0.74) brightness(1.18) contrast(0.66)' : 'blur(20px) saturate(0.92) brightness(0.84)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,0.68), rgba(0,0,0,0.20) 62%, transparent)',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,0.68), rgba(0,0,0,0.20) 62%, transparent)',
          background: (theme) => theme.palette.mode === 'light'
            ? 'linear-gradient(rgba(245,245,247,0), rgba(245,245,247,0.18))'
            : 'linear-gradient(rgba(10,10,15,0), rgba(10,10,15,0.12))',
        },
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
            borderRadius: 2.5,
            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.060)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            '& fieldset': {
              borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.09)' : 'rgba(226,232,240,0.11)',
            },
          },
        }}
      />
      <IconButton
        color="primary"
        onClick={() => void handleSend()}
        disabled={!text.trim() || isSending}
        sx={{
          flexShrink: 0,
          width: 42,
          height: 42,
          bgcolor: text.trim() && !isSending ? 'primary.main' : 'action.hover',
          color: text.trim() && !isSending ? 'primary.contrastText' : 'text.disabled',
          boxShadow: text.trim() && !isSending ? '0 10px 24px rgba(15,23,42,0.18)' : 'none',
          '&:hover': {
            bgcolor: text.trim() && !isSending ? 'primary.dark' : 'action.hover',
          },
        }}
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
