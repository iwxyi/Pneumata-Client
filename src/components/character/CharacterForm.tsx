import { useEffect, useMemo, useRef, useState } from 'react';
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
  Divider,
  Card,
  CardContent,
  Stack,
  DialogActions,
  Tabs,
  Tab,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { AICharacter, PersonalityParams } from '../../types/character';
import type { BubbleShadowLevel, BubbleStyleDefinition, BubbleStyleFormValues } from '../../types/bubbleStyle';
import { DEFAULT_PERSONALITY } from '../../types/character';
import { DEFAULT_BUBBLE_STYLE_FORM } from '../../types/bubbleStyle';
import { generateCharacterProfile } from '../../services/characterGenerator';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useCharacterStore } from '../../stores/useCharacterStore';
import PersonalitySliders from './PersonalitySliders';
import { AVATAR_OPTIONS } from '../../constants/presets';
import { BUILT_IN_BUBBLE_STYLES, DEFAULT_AI_BUBBLE_STYLE_ID } from '../../constants/bubbleStyles';
import { buildBubblePreview, resolveBubbleStyle } from '../../utils/bubbleStyle';

function getGenerateButtonLabel(language: string, generating: boolean) {
  if (generating) return language.startsWith('zh') ? '生成中' : 'Generating';
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
function createStyleId() {
  return `custom-bubble-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function styleToFormValues(style?: BubbleStyleDefinition): BubbleStyleFormValues {
  if (!style) return DEFAULT_BUBBLE_STYLE_FORM;
  return {
    name: style.name,
    backgroundColor: style.backgroundColor,
    textColor: style.textColor,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderStyle: style.borderStyle,
    radius: style.radius,
    shadow: style.shadow,
    gradientFrom: style.gradientFrom || '',
    gradientTo: style.gradientTo || '',
    gradientDirection: style.gradientDirection || '135deg',
  };
}
function formValuesToStyle(form: BubbleStyleFormValues, id: string): BubbleStyleDefinition {
  return {
    id,
    name: form.name.trim(),
    backgroundColor: form.backgroundColor,
    textColor: form.textColor,
    borderColor: form.borderColor,
    borderWidth: form.borderWidth,
    borderStyle: form.borderStyle,
    radius: form.radius,
    shadow: form.shadow,
    gradientFrom: form.gradientFrom || undefined,
    gradientTo: form.gradientTo || undefined,
    gradientDirection: form.gradientFrom && form.gradientTo ? form.gradientDirection : undefined,
    isBuiltIn: false,
  };
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
    bubbleStyleId?: string | null;
  }) => void;
  onCancel: () => void;
}

export default function CharacterForm({ initial, existingNames = [], onSave }: CharacterFormProps) {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore();
  const [name, setName] = useState(initial?.name || '');
  const [avatar, setAvatar] = useState(initial?.avatar || '🤖');
  const [personality, setPersonality] = useState<PersonalityParams>(initial?.personality || DEFAULT_PERSONALITY);
  const [expertise, setExpertise] = useState<string[]>(initial?.expertise || []);
  const [expertiseInput, setExpertiseInput] = useState('');
  const [speakingStyle, setSpeakingStyle] = useState(initial?.speakingStyle || '');
  const [background, setBackground] = useState(initial?.background || '');
  const [modelProfileId, setModelProfileId] = useState<string>(initial?.modelProfileId || 'default');
  const [bubbleStyleId, setBubbleStyleId] = useState<string>(initial?.bubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID);
  const [draftBubbleStyleId, setDraftBubbleStyleId] = useState<string>(initial?.bubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [bubblePickerOpen, setBubblePickerOpen] = useState(false);
  const [bubbleEditorOpen, setBubbleEditorOpen] = useState(false);
  const [editingBubbleStyleId, setEditingBubbleStyleId] = useState<string | null>(null);
  const [bubbleForm, setBubbleForm] = useState<BubbleStyleFormValues>(DEFAULT_BUBBLE_STYLE_FORM);
  const [bubbleTab, setBubbleTab] = useState(0);
  const bubbleCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const characters = useCharacterStore((state) => state.characters);
  const [personalityExpanded, setPersonalityExpanded] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const customBubbleStyles = settings.customBubbleStyles || [];
  const roundedStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.radius >= 22);
  const borderedStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.borderWidth >= 2 || style.borderStyle !== 'solid');
  const gradientStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.gradientFrom && style.gradientTo);
  const darkStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.textColor.toLowerCase().includes('f') || style.backgroundColor.startsWith('#1') || style.backgroundColor.startsWith('#0') || style.backgroundColor.startsWith('rgba'));
  const builtInTabs = [BUILT_IN_BUBBLE_STYLES, roundedStyles, borderedStyles, gradientStyles, darkStyles];
  const currentBuiltInStyles = builtInTabs[bubbleTab] || BUILT_IN_BUBBLE_STYLES;
  const allBubbleStyles = [...customBubbleStyles, ...BUILT_IN_BUBBLE_STYLES];
  const selectedBubbleStyle = resolveBubbleStyle(bubbleStyleId, customBubbleStyles);
  const selectedBubblePreview = buildBubblePreview(selectedBubbleStyle);
  const bubblePreviewText = useMemo(() => (i18n.language.startsWith('zh') ? '这是角色气泡预览' : 'Bubble style preview'), [i18n.language]);

  useEffect(() => {
    if (bubblePickerOpen) {
      setDraftBubbleStyleId(bubbleStyleId);
    }
  }, [bubblePickerOpen, bubbleStyleId]);


  const applyBubbleSelection = () => {
    setBubbleStyleId(draftBubbleStyleId);
    setBubblePickerOpen(false);
  };

  const cancelBubbleSelection = () => {
    setDraftBubbleStyleId(bubbleStyleId);
    setBubblePickerOpen(false);
  };

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
      const generated = await generateCharacterProfile(selectedProfile, name.trim(), i18n.language.startsWith('zh') ? 'zh' : 'en');
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
    onSave({ name: normalizedName, avatar, personality, expertise, speakingStyle, background, modelProfileId, bubbleStyleId });
  };

  const openBubblePicker = () => {
    setDraftBubbleStyleId(bubbleStyleId);
    setBubblePickerOpen(true);
  };

  const shouldAutoScrollBubbleRef = useRef(false);

  useEffect(() => {
    if (!bubblePickerOpen || !shouldAutoScrollBubbleRef.current) return;
    const target = bubbleCardRefs.current[draftBubbleStyleId];
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      shouldAutoScrollBubbleRef.current = false;
    });
  }, [bubblePickerOpen, draftBubbleStyleId, bubbleTab]);

  useEffect(() => {
    if (!bubblePickerOpen) {
      shouldAutoScrollBubbleRef.current = false;
    }
  }, [bubblePickerOpen]);

  const jumpToStyle = (styleIdToUse: string, autoScroll = false) => {
    shouldAutoScrollBubbleRef.current = autoScroll;
    setDraftBubbleStyleId(styleIdToUse);
  };

  const pickLeastUsedStyle = () => {
    const usage = new Map<string, number>();
    allBubbleStyles.forEach((style) => usage.set(style.id, 0));
    characters.forEach((character) => {
      const id = character.bubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID;
      usage.set(id, (usage.get(id) || 0) + 1);
    });
    const sorted = [...allBubbleStyles].sort((a, b) => {
      const countDiff = (usage.get(a.id) || 0) - (usage.get(b.id) || 0);
      return countDiff !== 0 ? countDiff : a.name.localeCompare(b.name);
    });
    if (sorted[0]) jumpToStyle(sorted[0].id, true);
  };

  const pickRandomStyle = () => {
    if (allBubbleStyles.length === 0) return;
    const index = Math.floor(Math.random() * allBubbleStyles.length);
    jumpToStyle(allBubbleStyles[index].id, true);
  };

  const selectBubbleStyle = (styleIdToUse: string) => {
    shouldAutoScrollBubbleRef.current = false;
    setDraftBubbleStyleId(styleIdToUse);
  };

  const isStyleSelected = (styleIdToCheck: string) => draftBubbleStyleId === styleIdToCheck;

  const getPreviewFor = (styleIdToUse: string) => buildBubblePreview(resolveBubbleStyle(styleIdToUse, customBubbleStyles));

  const bubblePickerActionLabel = i18n.language.startsWith('zh') ? { newStyle: '新建样式', use: '使用', confirm: '确定', cancel: '取消', auto: '自动', random: '随机', custom: '自定义', all: '全部', rounded: '圆润', border: '边框', gradient: '渐变', dark: '深色', saveStyle: '保存样式' } : { newStyle: 'New style', use: 'Use', confirm: 'Confirm', cancel: 'Cancel', auto: 'Auto', random: 'Random', custom: 'Custom', all: 'All', rounded: 'Rounded', border: 'Borders', gradient: 'Gradient', dark: 'Dark', saveStyle: 'Save style' };

  const openBubbleEditor = (style?: BubbleStyleDefinition) => {
    setEditingBubbleStyleId(style?.id || null);
    setBubbleForm(styleToFormValues(style));
    setBubbleEditorOpen(true);
  };

  const saveBubbleStyle = () => {
    if (!bubbleForm.name.trim()) return;
    const id = editingBubbleStyleId || createStyleId();
    const nextStyle = formValuesToStyle(bubbleForm, id);
    const nextStyles = editingBubbleStyleId ? customBubbleStyles.map((style) => (style.id === id ? nextStyle : style)) : [nextStyle, ...customBubbleStyles];
    settings.setCustomBubbleStyles(nextStyles);
    setBubbleStyleId(id);
    setDraftBubbleStyleId(id);
    setBubbleEditorOpen(false);
    setBubblePickerOpen(true);
  };

  const deleteBubbleStyle = (styleId: string) => {
    const nextStyles = customBubbleStyles.filter((style) => style.id !== styleId);
    settings.setCustomBubbleStyles(nextStyles);
    if (bubbleStyleId === styleId) setBubbleStyleId(DEFAULT_AI_BUBBLE_STYLE_ID);
    if (draftBubbleStyleId === styleId) setDraftBubbleStyleId(DEFAULT_AI_BUBBLE_STYLE_ID);
  };

  const generateLabel = getGenerateButtonLabel(i18n.language, generating);

  const helperText = getHelperText(i18n.language, generateError);
  const generateAriaLabel = getGenerateAriaLabel(i18n.language);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, position: 'relative', pb: 10 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr)' }, gap: 1.25, alignItems: 'start' }}>
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
          <Stack spacing={1} sx={{ flexShrink: 0 }}>
            <Box onClick={() => setAvatarPickerOpen(true)} sx={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', borderRadius: 3, cursor: 'pointer', border: 1, borderColor: 'divider', bgcolor: 'background.paper', boxShadow: 1, transition: 'transform 160ms ease, box-shadow 160ms ease', '&:hover': { transform: 'translateY(-1px)', boxShadow: 2 } }}>{avatar}</Box>
          </Stack>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
            <TextField label={t('character.name')} placeholder={t('character.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} helperText={helperText} error={Boolean(generateError)} required fullWidth />
            <Button variant="outlined" onClick={handleGenerate} aria-label={generateAriaLabel} sx={{ minWidth: 88, height: 56, whiteSpace: 'nowrap' }} disabled={!name.trim() || generating}>{generateLabel}</Button>
          </Box>
        </Box>
      </Box>

      <Box sx={{ width: { xs: '100%', md: '72%' } }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>{i18n.language.startsWith('zh') ? '气泡样式' : 'Bubble style'}</Typography>
        <Card variant="outlined" sx={{ cursor: 'pointer', borderRadius: 3 }} onClick={openBubblePicker}>
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{avatar}</Box>
              <Box sx={{ px: 1.5, py: 0.875, border: selectedBubblePreview.border, borderRadius: selectedBubblePreview.borderRadius, boxShadow: selectedBubblePreview.boxShadow, color: selectedBubblePreview.color, background: selectedBubblePreview.background, flex: 1, minWidth: 0 }}>
                <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, opacity: 0.9 }}>{selectedBubbleStyle.name}</Typography>
                <Typography variant="body2" noWrap>{bubblePreviewText}</Typography>
              </Box>
              <IconButton size="small"><EditIcon fontSize="small" /></IconButton>
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ width: { xs: '100%', md: '72%' } }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>{t('character.expertise')}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {expertise.map((exp) => <Chip key={exp} label={exp} onDelete={() => setExpertise(expertise.filter((e) => e !== exp))} size="small" />)}
          <Chip
            label={<TextField variant="standard" placeholder={expertise.length === 0 ? t('character.expertisePlaceholder') : ''} value={expertiseInput} onChange={(e) => setExpertiseInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExpertise(); } }} slotProps={{ input: { disableUnderline: true } }} sx={{ width: expertiseInput ? `${Math.max(4, expertiseInput.length + 1)}ch` : '4em', minWidth: '4em', maxWidth: 160, '& .MuiInputBase-root': { fontSize: 13 }, '& .MuiInputBase-input': { py: 0, px: 0, width: '100%' } }} />}
            size="small"
            variant="outlined"
            sx={{ width: 'fit-content', maxWidth: 148, '& .MuiChip-label': { px: 0.75, py: 0.25 } }}
          />
        </Box>
      </Box>

      <Dialog open={avatarPickerOpen} onClose={() => setAvatarPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('character.avatar')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 1 }}>
            {AVATAR_OPTIONS.map((emoji) => (
              <Box key={emoji} onClick={() => { setAvatar(emoji); setAvatarPickerOpen(false); }} sx={{ width: '100%', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.35rem', borderRadius: 2.5, cursor: 'pointer', border: 2, borderColor: avatar === emoji ? 'primary.main' : 'transparent', bgcolor: avatar === emoji ? 'primary.light' : 'action.hover', '&:hover': { bgcolor: 'action.selected' } }}>{emoji}</Box>
            ))}
          </Box>
        </DialogContent>
      </Dialog>

      <Dialog open={bubblePickerOpen} onClose={cancelBubbleSelection} maxWidth="md" fullWidth>
        <DialogTitle>{i18n.language.startsWith('zh') ? '选择气泡样式' : 'Choose bubble style'}</DialogTitle>
        <DialogContent sx={{ p: 0, pt: 1, display: 'flex', flexDirection: 'column', maxHeight: '72vh' }}>
          <Box sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', px: 3, pt: 0, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
              <Button startIcon={<AddIcon />} onClick={() => openBubbleEditor()}>{bubblePickerActionLabel.newStyle}</Button>
              <Button onClick={pickLeastUsedStyle}>{bubblePickerActionLabel.auto}</Button>
              <Button onClick={pickRandomStyle}>{bubblePickerActionLabel.random}</Button>
            </Box>
            <Tabs value={bubbleTab} onChange={(_, value) => setBubbleTab(value)} variant="scrollable" allowScrollButtonsMobile>
              <Tab label={bubblePickerActionLabel.all} />
              <Tab label={bubblePickerActionLabel.rounded} />
              <Tab label={bubblePickerActionLabel.border} />
              <Tab label={bubblePickerActionLabel.gradient} />
              <Tab label={bubblePickerActionLabel.dark} />
            </Tabs>
          </Box>
          <Box sx={{ overflowY: 'auto', px: 3, pb: 2, pt: 2 }}>
            {customBubbleStyles.length > 0 ? <><Typography variant="subtitle2" sx={{ mb: 1 }}>{bubblePickerActionLabel.custom}</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>{customBubbleStyles.map((style) => { const preview = getPreviewFor(style.id); return <Card key={style.id} ref={(node) => { bubbleCardRefs.current[style.id] = node; }} variant="outlined" sx={{ borderColor: isStyleSelected(style.id) ? 'primary.main' : 'divider', cursor: 'pointer' }} onClick={() => jumpToStyle(style.id)}><CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}><Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}><Typography variant="subtitle2">{style.name}</Typography><Box sx={{ display: 'flex', gap: 0.5 }}><Button size="small" onClick={(e) => { e.stopPropagation(); selectBubbleStyle(style.id); }}>{bubblePickerActionLabel.use}</Button><IconButton size="small" onClick={(e) => { e.stopPropagation(); openBubbleEditor(style); }}><EditIcon fontSize="small" /></IconButton><IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deleteBubbleStyle(style.id); }}><DeleteIcon fontSize="small" /></IconButton></Box></Box><Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}><Box sx={{ width: 30, height: 30, borderRadius: '50%', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{avatar}</Box><Box sx={{ px: 1.5, py: 1, border: preview.border, borderRadius: preview.borderRadius, boxShadow: preview.boxShadow, color: preview.color, background: preview.background, flex: 1 }}><Typography variant="body2">{bubblePreviewText}</Typography></Box></Box></CardContent></Card>; })}</Box><Divider sx={{ my: 2.5 }} /></> : null}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>{currentBuiltInStyles.map((style) => { const preview = getPreviewFor(style.id); return <Card key={style.id} ref={(node) => { bubbleCardRefs.current[style.id] = node; }} variant="outlined" sx={{ borderColor: isStyleSelected(style.id) ? 'primary.main' : 'divider', cursor: 'pointer' }} onClick={() => jumpToStyle(style.id)}><CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}><Typography variant="subtitle2">{style.name}</Typography><Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}><Box sx={{ width: 30, height: 30, borderRadius: '50%', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{avatar}</Box><Box sx={{ px: 1.5, py: 1, border: preview.border, borderRadius: preview.borderRadius, boxShadow: preview.boxShadow, color: preview.color, background: preview.background, flex: 1 }}><Typography variant="body2">{bubblePreviewText}</Typography></Box></Box></CardContent></Card>; })}</Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={cancelBubbleSelection}>{bubblePickerActionLabel.cancel}</Button>
          <Button variant="contained" onClick={applyBubbleSelection}>{bubblePickerActionLabel.confirm}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={bubbleEditorOpen} onClose={() => setBubbleEditorOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingBubbleStyleId ? (i18n.language.startsWith('zh') ? '编辑样式' : 'Edit style') : (i18n.language.startsWith('zh') ? '新建样式' : 'New style')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
            <TextField label={i18n.language.startsWith('zh') ? '样式名称' : 'Style name'} value={bubbleForm.name} onChange={(e) => setBubbleForm((prev) => ({ ...prev, name: e.target.value }))} fullWidth />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.25 }}>
              <TextField label={i18n.language.startsWith('zh') ? '背景色' : 'Background'} value={bubbleForm.backgroundColor} onChange={(e) => setBubbleForm((prev) => ({ ...prev, backgroundColor: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={bubbleForm.backgroundColor} onChange={(e) => setBubbleForm((prev) => ({ ...prev, backgroundColor: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <TextField label={i18n.language.startsWith('zh') ? '文字色' : 'Text color'} value={bubbleForm.textColor} onChange={(e) => setBubbleForm((prev) => ({ ...prev, textColor: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={bubbleForm.textColor} onChange={(e) => setBubbleForm((prev) => ({ ...prev, textColor: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <TextField label={i18n.language.startsWith('zh') ? '边框色' : 'Border color'} value={bubbleForm.borderColor} onChange={(e) => setBubbleForm((prev) => ({ ...prev, borderColor: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={bubbleForm.borderColor} onChange={(e) => setBubbleForm((prev) => ({ ...prev, borderColor: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.25 }}>
              <TextField label={i18n.language.startsWith('zh') ? '渐变起点' : 'Gradient from'} value={bubbleForm.gradientFrom} onChange={(e) => setBubbleForm((prev) => ({ ...prev, gradientFrom: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={bubbleForm.gradientFrom || '#ffffff'} onChange={(e) => setBubbleForm((prev) => ({ ...prev, gradientFrom: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <TextField label={i18n.language.startsWith('zh') ? '渐变终点' : 'Gradient to'} value={bubbleForm.gradientTo} onChange={(e) => setBubbleForm((prev) => ({ ...prev, gradientTo: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={bubbleForm.gradientTo || '#ffffff'} onChange={(e) => setBubbleForm((prev) => ({ ...prev, gradientTo: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <FormControl fullWidth><InputLabel>{i18n.language.startsWith('zh') ? '阴影' : 'Shadow'}</InputLabel><Select value={bubbleForm.shadow} label={i18n.language.startsWith('zh') ? '阴影' : 'Shadow'} onChange={(e) => setBubbleForm((prev) => ({ ...prev, shadow: e.target.value as BubbleShadowLevel }))}><MenuItem value="none">none</MenuItem><MenuItem value="soft">soft</MenuItem><MenuItem value="medium">medium</MenuItem><MenuItem value="strong">strong</MenuItem></Select></FormControl>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.25 }}>
              <TextField type="number" label={i18n.language.startsWith('zh') ? '圆角' : 'Radius'} value={bubbleForm.radius} onChange={(e) => setBubbleForm((prev) => ({ ...prev, radius: Number(e.target.value) || 0 }))} fullWidth />
              <TextField type="number" label={i18n.language.startsWith('zh') ? '边框宽度' : 'Border width'} value={bubbleForm.borderWidth} onChange={(e) => setBubbleForm((prev) => ({ ...prev, borderWidth: Number(e.target.value) || 0 }))} fullWidth />
              <FormControl fullWidth><InputLabel>{i18n.language.startsWith('zh') ? '边框样式' : 'Border style'}</InputLabel><Select value={bubbleForm.borderStyle} label={i18n.language.startsWith('zh') ? '边框样式' : 'Border style'} onChange={(e) => setBubbleForm((prev) => ({ ...prev, borderStyle: e.target.value as BubbleStyleDefinition['borderStyle'] }))}><MenuItem value="solid">solid</MenuItem><MenuItem value="dashed">dashed</MenuItem><MenuItem value="dotted">dotted</MenuItem></Select></FormControl>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ width: 30, height: 30, borderRadius: '50%', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{avatar}</Box>
              <Box sx={{ px: 1.5, py: 1, border: buildBubblePreview(formValuesToStyle(bubbleForm, editingBubbleStyleId || 'preview')).border, borderRadius: buildBubblePreview(formValuesToStyle(bubbleForm, editingBubbleStyleId || 'preview')).borderRadius, boxShadow: buildBubblePreview(formValuesToStyle(bubbleForm, editingBubbleStyleId || 'preview')).boxShadow, color: buildBubblePreview(formValuesToStyle(bubbleForm, editingBubbleStyleId || 'preview')).color, background: buildBubblePreview(formValuesToStyle(bubbleForm, editingBubbleStyleId || 'preview')).background, flex: 1 }}>
                <Typography variant="body2">{bubblePreviewText}</Typography>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBubbleEditorOpen(false)}>{i18n.language.startsWith('zh') ? '取消' : 'Cancel'}</Button>
          <Button variant="contained" onClick={saveBubbleStyle} disabled={!bubbleForm.name.trim()}>{bubblePickerActionLabel.saveStyle}</Button>
        </DialogActions>
      </Dialog>

      <Box>
        <Box onClick={() => setPersonalityExpanded((prev) => !prev)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', mb: personalityExpanded ? 0.75 : 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('character.personality')}</Typography>
          <IconButton size="small">{personalityExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
        </Box>
        <Collapse in={personalityExpanded}><PersonalitySliders values={personality} onChange={setPersonality} /></Collapse>
      </Box>

      <TextField label={t('character.speakingStyle')} placeholder={t('character.speakingStylePlaceholder')} value={speakingStyle} onChange={(e) => setSpeakingStyle(e.target.value)} multiline rows={2} fullWidth />
      <TextField label={t('character.background')} placeholder={t('character.backgroundPlaceholder')} value={background} onChange={(e) => setBackground(e.target.value)} multiline rows={3} fullWidth />
      <FormControl size="small" sx={{ width: { xs: '100%', md: 220 } }}>
        <InputLabel>{i18n.language.startsWith('zh') ? 'AI 模型' : 'AI model'}</InputLabel>
        <Select value={modelProfileId} label={i18n.language.startsWith('zh') ? 'AI 模型' : 'AI model'} onChange={(e) => setModelProfileId(e.target.value)}>
          {settings.aiProfiles.map((profile) => <MenuItem key={profile.id} value={profile.id}>{profile.name}</MenuItem>)}
        </Select>
      </FormControl>

      <Fab color="primary" variant="extended" onClick={handleSubmit} disabled={!name.trim() || generating} aria-label={t('character.save')} sx={{ position: 'fixed', right: { xs: 24, sm: 32, md: 36 }, bottom: { xs: 24, sm: 32, md: 36 }, zIndex: 1300, minHeight: 56, px: 2.25, gap: 1, borderRadius: 18, boxShadow: '0 10px 24px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.16)', '&:hover': { boxShadow: '0 14px 32px rgba(0,0,0,0.26), 0 6px 12px rgba(0,0,0,0.18)', transform: 'translateY(-1px)' }, '&:active': { boxShadow: '0 6px 14px rgba(0,0,0,0.18)', transform: 'translateY(0)' }, transition: 'box-shadow 0.2s ease, transform 0.2s ease' }}>
        <SaveIcon fontSize="small" />{t('character.save')}
      </Fab>
    </Box>
  );
}
