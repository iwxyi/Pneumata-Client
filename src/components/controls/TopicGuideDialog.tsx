import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface TopicGuideDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (topic: string) => void;
}

export default function TopicGuideDialog({ open, onClose, onSubmit }: TopicGuideDialogProps) {
  const [topic, setTopic] = useState('');
  const { t } = useTranslation();

  const handleSubmit = () => {
    if (!topic.trim()) return;
    onSubmit(topic.trim());
    setTopic('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('controls.topicGuide')}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          multiline
          rows={3}
          placeholder={t('controls.topicGuidePlaceholder')}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!topic.trim()}>
          {t('controls.topicGuideSubmit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
