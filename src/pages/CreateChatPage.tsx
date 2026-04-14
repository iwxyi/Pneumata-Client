import { useState, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Stepper, Step, StepLabel,
  ToggleButton, ToggleButtonGroup, Slider, Switch, FormControlLabel,
  Checkbox, Avatar, Chip, Grid,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import type { ChatStyle } from '../types/chat';
import { CHAT_STYLE_OPTIONS, MIN_MEMBERS, MAX_MEMBERS, SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../constants/defaults';

const steps = ['chat.stepBasic', 'chat.stepStyle', 'chat.stepMembers', 'chat.stepAdvanced'];

export default function CreateChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addChat } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const [activeStep, setActiveStep] = useState(0);

  // Form state
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [style, setStyle] = useState<ChatStyle>('free');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [topicSeed, setTopicSeed] = useState('');
  const [speed, setSpeed] = useState(1.0);
  const [allowIntervention, setAllowIntervention] = useState(true);

  useEffect(() => {
    loadCharacters();
  }, []);

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) =>
      prev.includes(id)
        ? prev.filter((m) => m !== id)
        : prev.length < MAX_MEMBERS
          ? [...prev, id]
          : prev
    );
  };

  const canProceed = () => {
    switch (activeStep) {
      case 0: return name.trim().length > 0;
      case 1: return true;
      case 2: return selectedMembers.length >= MIN_MEMBERS;
      case 3: return true;
      default: return false;
    }
  };

  const handleCreate = async () => {
    const chat = await addChat({
      name: name.trim(),
      topic: topic.trim(),
      style,
      memberIds: selectedMembers,
      speed,
      isActive: false,
      allowIntervention,
      topicSeed: topicSeed.trim(),
    });
    navigate(`/chats/${chat.id}`);
  };

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 3, maxWidth: 700, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {t('chat.createTitle')}
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{t(label)}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Step 1: Basic Info */}
      {activeStep === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <TextField
            label={t('chat.name')}
            placeholder={t('chat.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label={t('chat.topic')}
            placeholder={t('chat.topicPlaceholder')}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Box>
      )}

      {/* Step 2: Style */}
      {activeStep === 1 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            {t('chat.style')}
          </Typography>
          <Grid container spacing={2}>
            {CHAT_STYLE_OPTIONS.map((opt) => (
              <Grid size={{ xs: 6 }} key={opt.value}>
                <Box
                  onClick={() => setStyle(opt.value)}
                  sx={{
                    p: 3,
                    borderRadius: 3,
                    border: 2,
                    borderColor: style === opt.value ? 'primary.main' : 'divider',
                    bgcolor: style === opt.value ? 'primary.light' : 'background.paper',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                    '&:hover': { borderColor: 'primary.light' },
                  }}
                >
                  <Typography variant="h4" sx={{ mb: 1 }}>{opt.icon}</Typography>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {t(`chat.style${opt.value.charAt(0).toUpperCase() + opt.value.slice(1)}`)}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* Step 3: Members */}
      {activeStep === 2 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            {t('chat.selectMembers')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            {t('chat.membersHint')} ({selectedMembers.length}/{MAX_MEMBERS})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {characters.map((char) => (
              <Box
                key={char.id}
                onClick={() => toggleMember(char.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  p: 1.5,
                  borderRadius: 2,
                  border: 2,
                  borderColor: selectedMembers.includes(char.id) ? 'primary.main' : 'divider',
                  bgcolor: selectedMembers.includes(char.id) ? 'primary.light' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Checkbox checked={selectedMembers.includes(char.id)} size="small" />
                <Avatar sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>
                  {char.avatar}
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{char.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {char.expertise.slice(0, 3).join(', ')}
                  </Typography>
                </Box>
                {char.isPreset && <Chip label="Preset" size="small" variant="outlined" />}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Step 4: Advanced */}
      {activeStep === 3 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <TextField
            label={t('chat.topicSeed')}
            placeholder={t('chat.topicSeedPlaceholder')}
            value={topicSeed}
            onChange={(e) => setTopicSeed(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
          <Box>
            <Typography variant="body2" fontWeight={500} gutterBottom>
              {t('chat.speed')}: {speed}x
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="caption">{t('chat.speedSlow')}</Typography>
              <Slider
                value={speed}
                onChange={(_, v) => setSpeed(v as number)}
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                size="small"
              />
              <Typography variant="caption">{t('chat.speedFast')}</Typography>
            </Box>
          </Box>
          <FormControlLabel
            control={
              <Switch checked={allowIntervention} onChange={(e) => setAllowIntervention(e.target.checked)} />
            }
            label={t('chat.allowIntervention')}
          />
        </Box>
      )}

      {/* Navigation Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
        <Button
          onClick={() => (activeStep === 0 ? navigate(-1) : setActiveStep((s) => s - 1))}
        >
          {activeStep === 0 ? t('common.cancel') : t('chat.back')}
        </Button>
        {activeStep < steps.length - 1 ? (
          <Button
            variant="contained"
            onClick={() => setActiveStep((s) => s + 1)}
            disabled={!canProceed()}
          >
            {t('chat.next')}
          </Button>
        ) : (
          <Button variant="contained" onClick={handleCreate} disabled={!canProceed()}>
            🍵 {t('chat.startTeaParty')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
