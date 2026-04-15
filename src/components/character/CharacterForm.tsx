import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Chip,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Fab,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, Save as SaveIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { AICharacter, PersonalityParams } from '../../types/character';
import { DEFAULT_PERSONALITY } from '../../types/character';
import { generateCharacterProfile } from '../../services/characterGenerator';
import { useSettingsStore } from '../../stores/useSettingsStore';
import PersonalitySliders from './PersonalitySliders';
import { AVATAR_OPTIONS } from '../../constants/presets';

function getGenerateButtonLabel(language: string, generating: boolean) {
  if (generating) {
    return language.startsWith('zh') ? '生成中' : 'Generating';
  }
  return language.startsWith('zh') ? '生成' : 'Generate';
}

function getGenerateError(language: string) {
  return language.startsWith('zh') ? '角色生成失败，请检查 AI 设置后重试' : 'Failed to generate character profile. Check AI settings and try again.';
}

function getGenerateNoKeyError(language: string) {
  return language.startsWith('zh') ? '请先在设置中填写 AI 配置' : 'Configure AI settings first.';
}

function getGenerateAriaLabel(language: string) {
  return language.startsWith('zh') ? '生成角色资料' : 'Generate character profile';
}

function getHelperText(_language: string, error: string | null) {
  return error || '';
}

interface CharacterFormProps {
  initial?: Partial<AICharacter>;
  existingNames?: string[];
  onSave: (data: {
    name: string;
    avatar: string;
    personality: PersonalityParams;
    expertise: string[];
    speakingStyle: string;
    background: string;
    modelProfileId?: string | null;
  }) => void;
  onCancel: () => void;
}

export default function CharacterForm({ initial, existingNames = [], onSave, onCancel }: CharacterFormProps) {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore();
  const [name, setName] = useState(initial?.name || '');
  const [avatar, setAvatar] = useState(initial?.avatar || '🤖');
  const [personality, setPersonality] = useState<PersonalityParams>(
    initial?.personality || DEFAULT_PERSONALITY
  );
  const [expertise, setExpertise] = useState<string[]>(initial?.expertise || []);
  const [expertiseInput, setExpertiseInput] = useState('');
  const [speakingStyle, setSpeakingStyle] = useState(initial?.speakingStyle || '');
  const [background, setBackground] = useState(initial?.background || '');
  const [modelProfileId, setModelProfileId] = useState<string>(initial?.modelProfileId || 'default');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [personalityExpanded, setPersonalityExpanded] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const addExpertise = () => {
    if (expertiseInput.trim() && !expertise.includes(expertiseInput.trim())) {
      setExpertise([...expertise, expertiseInput.trim()]);
      setExpertiseInput('');
    }
  };

  const handleGenerate = async () => {
    if (!name.trim() || generating) return;
    const selectedProfile = settings.aiProfiles.find((profile) => profile.id === modelProfileId) || settings.aiProfiles[0];
    if (!selectedProfile?.apiKey || !selectedProfile?.model) {
      setGenerateError(getGenerateNoKeyError(i18n.language));
      return;
    }

    setGenerating(true);
    setGenerateError(null);

    try {
      const generated = await generateCharacterProfile(
        selectedProfile,
        name.trim(),
        i18n.language.startsWith('zh') ? 'zh' : 'en'
      );
      setAvatar(generated.avatar);
      setPersonality(generated.personality);
      setExpertise(generated.expertise);
      setSpeakingStyle(generated.speakingStyle);
      setBackground(generated.background);
    } catch {
      setGenerateError(getGenerateError(i18n.language));
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = () => {
    const normalizedName = name.trim();
    if (!normalizedName || generating) return;
    const isSameAsInitial = initial?.name?.trim().toLowerCase() === normalizedName.toLowerCase();
    const duplicated = !isSameAsInitial && existingNames.some((item) => item.trim().toLowerCase() === normalizedName.toLowerCase());
    if (duplicated) {
      setGenerateError(i18n.language.startsWith('zh') ? '已存在同名角色' : 'A character with the same name already exists');
      return;
    }
    onSave({ name: normalizedName, avatar, personality, expertise, speakingStyle, background, modelProfileId });
  };

  const generateLabel = getGenerateButtonLabel(i18n.language, generating);
  const helperText = getHelperText(i18n.language, generateError);
  const generateAriaLabel = getGenerateAriaLabel(i18n.language);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, position: 'relative', pb: 10 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr)' }, gap: 1.25, alignItems: 'start' }}>
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
          <Box
            onClick={() => setAvatarPickerOpen(true)}
            sx={{
              width: 56,
              height: 56,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              borderRadius: 3,
              cursor: 'pointer',
              border: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              boxShadow: 1,
              transition: 'transform 160ms ease, box-shadow 160ms ease',
              '&:hover': { transform: 'translateY(-1px)', boxShadow: 2 },
            }}
          >
            {avatar}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
            <TextField
              label={t('character.name')}
              placeholder={t('character.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText={helperText}
              error={Boolean(generateError)}
              required
              fullWidth
            />
            <Button
              variant="outlined"
              onClick={handleGenerate}
              aria-label={generateAriaLabel}
              sx={{ minWidth: 88, height: 56, whiteSpace: 'nowrap' }}
              disabled={!name.trim() || generating}
            >
              {generateLabel}
            </Button>
          </Box>
        </Box>
      </Box>

      <Box sx={{ width: { xs: '100%', md: '72%' } }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
          {t('character.expertise')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {expertise.map((exp) => (
            <Chip
              key={exp}
              label={exp}
              onDelete={() => setExpertise(expertise.filter((e) => e !== exp))}
              size="small"
            />
          ))}
          <Chip
            label={
              <TextField
                variant="standard"
                placeholder={expertise.length === 0 ? t('character.expertisePlaceholder') : ''}
                value={expertiseInput}
                onChange={(e) => setExpertiseInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addExpertise();
                  }
                }}
                InputProps={{ disableUnderline: true }}
                sx={{
                  width: expertiseInput ? `${Math.max(4, expertiseInput.length + 1)}ch` : '4em',
                  minWidth: '4em',
                  maxWidth: 160,
                  '& .MuiInputBase-root': { fontSize: 13 },
                  '& .MuiInputBase-input': { py: 0, px: 0, width: '100%' },
                }}
              />
            }
            size="small"
            variant="outlined"
            sx={{
              width: 'fit-content',
              maxWidth: 148,
              '& .MuiChip-label': { px: 0.75, py: 0.25 },
            }}
          />
        </Box>
      </Box>

      <Dialog open={avatarPickerOpen} onClose={() => setAvatarPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('character.avatar')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 1 }}>
            {AVATAR_OPTIONS.map((emoji) => (
              <Box
                key={emoji}
                onClick={() => {
                  setAvatar(emoji);
                  setAvatarPickerOpen(false);
                }}
                sx={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.35rem',
                  borderRadius: 2.5,
                  cursor: 'pointer',
                  border: 2,
                  borderColor: avatar === emoji ? 'primary.main' : 'transparent',
                  bgcolor: avatar === emoji ? 'primary.light' : 'action.hover',
                  '&:hover': { bgcolor: 'action.selected' },
                }}
              >
                {emoji}
              </Box>
            ))}
          </Box>
        </DialogContent>
      </Dialog>

      <Box>
        <Box
          onClick={() => setPersonalityExpanded((prev) => !prev)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            mb: personalityExpanded ? 0.75 : 0,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {t('character.personality')}
          </Typography>
          <IconButton size="small">
            {personalityExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
        <Collapse in={personalityExpanded}>
          <PersonalitySliders values={personality} onChange={setPersonality} />
        </Collapse>
      </Box>

      <TextField
        label={t('character.speakingStyle')}
        placeholder={t('character.speakingStylePlaceholder')}
        value={speakingStyle}
        onChange={(e) => setSpeakingStyle(e.target.value)}
        multiline
        rows={2}
        fullWidth
      />

      <TextField
        label={t('character.background')}
        placeholder={t('character.backgroundPlaceholder')}
        value={background}
        onChange={(e) => setBackground(e.target.value)}
        multiline
        rows={3}
        fullWidth
      />

      <FormControl size="small" sx={{ width: { xs: '100%', md: 220 } }}>
        <InputLabel>{i18n.language.startsWith('zh') ? 'AI 模型' : 'AI model'}</InputLabel>
        <Select
          value={modelProfileId}
          label={i18n.language.startsWith('zh') ? 'AI 模型' : 'AI model'}
          onChange={(e) => setModelProfileId(e.target.value)}
        >
          {settings.aiProfiles.map((profile) => (
            <MenuItem key={profile.id} value={profile.id}>
              {profile.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Fab
        color="primary"
        variant="extended"
        onClick={handleSubmit}
        disabled={!name.trim() || generating}
        aria-label={t('character.save')}
        sx={{
          position: 'fixed',
          right: { xs: 24, sm: 32, md: 36 },
          bottom: { xs: 24, sm: 32, md: 36 },
          zIndex: 1300,
          minHeight: 56,
          px: 2.25,
          gap: 1,
          borderRadius: 18,
          boxShadow: '0 10px 24px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.16)',
          '&:hover': {
            boxShadow: '0 14px 32px rgba(0,0,0,0.26), 0 6px 12px rgba(0,0,0,0.18)',
            transform: 'translateY(-1px)',
          },
          '&:active': {
            boxShadow: '0 6px 14px rgba(0,0,0,0.18)',
            transform: 'translateY(0)',
          },
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        }}
      >
        <SaveIcon fontSize="small" />
        {t('character.save')}
      </Fab>
    </Box>
  );
}
