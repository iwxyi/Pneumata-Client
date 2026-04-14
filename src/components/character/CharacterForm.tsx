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
} from '@mui/material';
import { Close as CloseIcon, ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, Save as SaveIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { AICharacter, PersonalityParams } from '../../types/character';
import { DEFAULT_PERSONALITY } from '../../types/character';
import { generateResponse } from '../../services/aiClient';
import { useSettingsStore } from '../../stores/useSettingsStore';
import PersonalitySliders from './PersonalitySliders';
import { AVATAR_OPTIONS } from '../../constants/presets';

interface GeneratedCharacterProfile {
  avatar?: string;
  personality?: Partial<PersonalityParams>;
  expertise?: string[];
  speakingStyle?: string;
  background?: string;
}

const CHARACTER_GENERATOR_SYSTEM_PROMPT = `You generate structured AI role profiles for a group chat app.
Return strict JSON only, with this shape:
{
  "avatar": "single emoji from common emoji only",
  "personality": {
    "openness": 0-100,
    "extroversion": 0-100,
    "agreeableness": 0-100,
    "neuroticism": 0-100,
    "humor": 0-100,
    "creativity": 0-100,
    "assertiveness": 0-100,
    "empathy": 0-100
  },
  "expertise": ["short domain", "short domain", "short domain", "short domain"],
  "speakingStyle": "1-2 concise sentences",
  "background": "2-4 concise sentences"
}
Rules:
- Infer the profile from the provided name and likely public persona/archetype.
- If the name is fictional, meme-like, or ambiguous, still create a vivid but usable role profile.
- Keep expertise practical for conversation.
- Do not wrap in markdown fences.
- Output valid JSON only.`;

function clampScore(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeGeneratedProfile(raw: GeneratedCharacterProfile) {
  const avatar = typeof raw.avatar === 'string' && raw.avatar.trim() ? raw.avatar.trim() : '🤖';
  const personality = {
    openness: clampScore(raw.personality?.openness, DEFAULT_PERSONALITY.openness),
    extroversion: clampScore(raw.personality?.extroversion, DEFAULT_PERSONALITY.extroversion),
    agreeableness: clampScore(raw.personality?.agreeableness, DEFAULT_PERSONALITY.agreeableness),
    neuroticism: clampScore(raw.personality?.neuroticism, DEFAULT_PERSONALITY.neuroticism),
    humor: clampScore(raw.personality?.humor, DEFAULT_PERSONALITY.humor),
    creativity: clampScore(raw.personality?.creativity, DEFAULT_PERSONALITY.creativity),
    assertiveness: clampScore(raw.personality?.assertiveness, DEFAULT_PERSONALITY.assertiveness),
    empathy: clampScore(raw.personality?.empathy, DEFAULT_PERSONALITY.empathy),
  };

  const expertise = Array.isArray(raw.expertise)
    ? raw.expertise
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    avatar: AVATAR_OPTIONS.includes(avatar) ? avatar : '🤖',
    personality,
    expertise,
    speakingStyle: typeof raw.speakingStyle === 'string' ? raw.speakingStyle.trim() : '',
    background: typeof raw.background === 'string' ? raw.background.trim() : '',
  };
}

function parseGeneratedProfile(content: string) {
  const trimmed = content.trim();
  const json = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  return normalizeGeneratedProfile(JSON.parse(json) as GeneratedCharacterProfile);
}

function buildGeneratePrompt(name: string, language: 'zh' | 'en') {
  if (language === 'zh') {
    return `请基于名字“${name}”生成一个适合多人群聊讨论的 AI 角色档案。输出字段必须完整，语气自然，专业领域用简洁短语。`;
  }
  return `Generate a complete AI character profile for the name "${name}" for a multi-person group chat app. Keep the fields concise and usable.`;
}

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

function getHelperText(language: string, error: string | null) {
  if (error) return error;
  return language.startsWith('zh') ? '输入名字后可自动生成头像、性格、专业领域与背景。' : 'Enter a name to auto-generate avatar, personality, expertise, and background.';
}

interface CharacterFormProps {
  initial?: Partial<AICharacter>;
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

export default function CharacterForm({ initial, onSave, onCancel }: CharacterFormProps) {
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
      const response = await generateResponse(
        selectedProfile,
        CHARACTER_GENERATOR_SYSTEM_PROMPT,
        [{ role: 'user', content: buildGeneratePrompt(name.trim(), i18n.language.startsWith('zh') ? 'zh' : 'en') }]
      );
      const generated = parseGeneratedProfile(response);
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
    if (!name.trim()) return;
    onSave({ name: name.trim(), avatar, personality, expertise, speakingStyle, background, modelProfileId });
  };

  const generateLabel = getGenerateButtonLabel(i18n.language, generating);
  const helperText = getHelperText(i18n.language, generateError);
  const generateAriaLabel = getGenerateAriaLabel(i18n.language);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, position: 'relative', pb: 10 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -1, mb: -0.5 }}>
        <IconButton onClick={onCancel} size="small" aria-label={i18n.language.startsWith('zh') ? '关闭' : 'Close'}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      {/* Name */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
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

      <FormControl fullWidth size="small">
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

      {/* Avatar Selection */}
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>
          {t('character.avatar')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {AVATAR_OPTIONS.map((emoji) => (
            <Box
              key={emoji}
              onClick={() => setAvatar(emoji)}
              sx={{
                width: 40,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.3rem',
                borderRadius: 2,
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
      </Box>

      {/* Personality Sliders */}
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

      {/* Expertise */}
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>
          {t('character.expertise')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField
            size="small"
            placeholder={t('character.expertisePlaceholder')}
            value={expertiseInput}
            onChange={(e) => setExpertiseInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addExpertise();
              }
            }}
            fullWidth
          />
          <Button variant="outlined" onClick={addExpertise} size="small">
            +
          </Button>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {expertise.map((exp) => (
            <Chip
              key={exp}
              label={exp}
              onDelete={() => setExpertise(expertise.filter((e) => e !== exp))}
              size="small"
            />
          ))}
        </Box>
      </Box>

      {/* Speaking Style */}
      <TextField
        label={t('character.speakingStyle')}
        placeholder={t('character.speakingStylePlaceholder')}
        value={speakingStyle}
        onChange={(e) => setSpeakingStyle(e.target.value)}
        multiline
        rows={2}
        fullWidth
      />

      {/* Background */}
      <TextField
        label={t('character.background')}
        placeholder={t('character.backgroundPlaceholder')}
        value={background}
        onChange={(e) => setBackground(e.target.value)}
        multiline
        rows={3}
        fullWidth
      />

      <Fab
        color="primary"
        variant="extended"
        onClick={handleSubmit}
        disabled={!name.trim()}
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
