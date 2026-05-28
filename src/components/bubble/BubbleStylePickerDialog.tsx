import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_BUBBLE_STYLES, DEFAULT_AI_BUBBLE_STYLE_ID } from '../../constants/bubbleStyles';
import type { BubbleShadowLevel, BubbleStyleDefinition, BubbleStyleFormValues } from '../../types/bubbleStyle';
import { DEFAULT_BUBBLE_STYLE_FORM } from '../../types/bubbleStyle';
import { buildBubblePreview, createCharacterBubbleStyleId, resolveCharacterBubbleStyle, toBubbleStyleFormValues } from '../../utils/bubbleStyle';
import FloatingSegmentedTabs from '../common/FloatingSegmentedTabs';

function buildBubbleOptionCardSx(selected: boolean) {
  return {
    borderColor: selected ? 'primary.main' : (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
    cursor: 'pointer',
    bgcolor: selected
      ? (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.10)' : 'rgba(120,156,220,0.14)'
      : (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.045)',
    backdropFilter: 'blur(16px) saturate(1.08)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
    boxShadow: selected
      ? (theme: Theme) => theme.palette.mode === 'light' ? '0 0 0 1px rgba(49,90,156,0.10) inset' : '0 0 0 1px rgba(120,156,220,0.12) inset'
      : 'none',
    transition: 'border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
    '&:hover': {
      borderColor: 'primary.main',
      bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.075)',
    },
  };
}

function buildBubblePanelCardSx() {
  return {
    borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
    cursor: 'default',
    bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.045)',
    backdropFilter: 'blur(16px) saturate(1.08)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
    boxShadow: 'none',
  };
}

function styleToFormValues(style?: BubbleStyleDefinition): BubbleStyleFormValues {
  if (!style) return DEFAULT_BUBBLE_STYLE_FORM;
  return toBubbleStyleFormValues(style);
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

function renderAvatarPreview(avatar: string, isImageAvatar: boolean, size: number) {
  return (
    <Box sx={{ width: size, height: size, borderRadius: '50%', bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
      {isImageAvatar
        ? <Box component="img" src={avatar} alt="avatar" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : avatar}
    </Box>
  );
}

interface BubbleStylePickerDialogProps {
  open: boolean;
  title: string;
  valueStyleId?: string | null;
  valueStyle?: BubbleStyleDefinition | null;
  customStyles: BubbleStyleDefinition[];
  allCharacters?: Array<{ group?: string | null; bubbleStyleId?: string | null }>;
  avatar?: string;
  isImageAvatar?: boolean;
  previewText: string;
  inlineError?: string | null;
  generateLabel?: string;
  generateDisabled?: boolean;
  onGenerateStyle?: () => Promise<BubbleStyleDefinition | null | undefined>;
  onClose: () => void;
  onConfirm: (styleId: string, style: BubbleStyleDefinition) => void;
  onCustomStylesChange: (styles: BubbleStyleDefinition[]) => void;
}

export default function BubbleStylePickerDialog({
  open,
  title,
  valueStyleId,
  valueStyle,
  customStyles,
  allCharacters = [],
  avatar = '',
  isImageAvatar = false,
  previewText,
  inlineError,
  generateLabel,
  generateDisabled = false,
  onGenerateStyle,
  onClose,
  onConfirm,
  onCustomStylesChange,
}: BubbleStylePickerDialogProps) {
  const { i18n } = useTranslation();
  const [draftStyleId, setDraftStyleId] = useState(valueStyleId || DEFAULT_AI_BUBBLE_STYLE_ID);
  const [draftStyle, setDraftStyle] = useState<BubbleStyleDefinition>(() => ({ ...resolveCharacterBubbleStyle({ bubbleStyle: valueStyle, bubbleStyleId: valueStyleId, customStyles }) }));
  const [tab, setTab] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [form, setForm] = useState<BubbleStyleFormValues>(DEFAULT_BUBBLE_STYLE_FORM);
  const [generating, setGenerating] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoScrollRef = useRef(false);

  const labels = i18n.language.startsWith('zh')
    ? { confirm: '确定', cancel: '取消', auto: '自动', random: '随机', custom: '自定义', allPresets: '全部预设', rounded: '圆润', border: '边框', gradient: '渐变', dark: '深色', saveStyle: '保存样式', newStyle: '新建', noCustom: '暂无自定义气泡样式', edit: '编辑样式', create: '新建样式', delete: '删除', styleName: '样式名称', background: '背景色', text: '文字色', borderColor: '边框色', gradientFrom: '渐变起点', gradientTo: '渐变终点', shadow: '阴影', radius: '圆角', borderWidth: '边框宽度', borderStyle: '边框样式' }
    : { confirm: 'Confirm', cancel: 'Cancel', auto: 'Auto', random: 'Random', custom: 'Custom', allPresets: 'All presets', rounded: 'Rounded', border: 'Borders', gradient: 'Gradient', dark: 'Dark', saveStyle: 'Save style', newStyle: 'New', noCustom: 'No custom bubble styles yet', edit: 'Edit style', create: 'New style', delete: 'Delete', styleName: 'Style name', background: 'Background', text: 'Text color', borderColor: 'Border color', gradientFrom: 'Gradient from', gradientTo: 'Gradient to', shadow: 'Shadow', radius: 'Radius', borderWidth: 'Border width', borderStyle: 'Border style' };

  const roundedStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.radius >= 22);
  const borderedStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.borderWidth >= 2 || style.borderStyle !== 'solid');
  const gradientStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.gradientFrom && style.gradientTo);
  const darkStyles = BUILT_IN_BUBBLE_STYLES.filter((style) => style.textColor.toLowerCase().includes('f') || style.backgroundColor.startsWith('#1') || style.backgroundColor.startsWith('#0') || style.backgroundColor.startsWith('rgba'));
  const builtInTabs = [BUILT_IN_BUBBLE_STYLES, roundedStyles, borderedStyles, gradientStyles, darkStyles];
  const currentStyles = tab === 0 ? customStyles : (builtInTabs[tab - 1] || BUILT_IN_BUBBLE_STYLES);
  const allStyles = useMemo(() => [...customStyles, ...BUILT_IN_BUBBLE_STYLES], [customStyles]);
  const selectedStyle = resolveCharacterBubbleStyle({ bubbleStyle: draftStyle, bubbleStyleId: draftStyleId, customStyles });
  const selectedPreview = buildBubblePreview(selectedStyle);
  const isEditingCustomStyle = customStyles.some((style) => style.id === editingStyleId);

  useEffect(() => {
    if (!open) return;
    const nextId = valueStyleId || DEFAULT_AI_BUBBLE_STYLE_ID;
    setDraftStyleId(nextId);
    setDraftStyle({ ...resolveCharacterBubbleStyle({ bubbleStyle: valueStyle, bubbleStyleId: nextId, customStyles }) });
    setTab(customStyles.length > 0 ? 0 : 1);
  }, [open, valueStyle, valueStyleId, customStyles]);

  useEffect(() => {
    if (!open || !autoScrollRef.current) return;
    const target = cardRefs.current[draftStyleId];
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      autoScrollRef.current = false;
    });
  }, [draftStyleId, open, tab]);

  const jumpToStyle = (styleId: string, autoScroll = false) => {
    autoScrollRef.current = autoScroll;
    setDraftStyleId(styleId);
    setDraftStyle({ ...resolveCharacterBubbleStyle({ bubbleStyleId: styleId, customStyles }) });
  };

  const pickLeastUsedStyle = () => {
    const usage = new Map<string, number>();
    allStyles.forEach((style) => usage.set(style.id, 0));
    allCharacters.forEach((character) => {
      const id = character.bubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID;
      usage.set(id, (usage.get(id) || 0) + 1);
    });
    const sorted = [...allStyles].sort((a, b) => {
      const countDiff = (usage.get(a.id) || 0) - (usage.get(b.id) || 0);
      return countDiff !== 0 ? countDiff : a.name.localeCompare(b.name);
    });
    if (sorted[0]) jumpToStyle(sorted[0].id, true);
  };

  const pickRandomStyle = () => {
    if (!allStyles.length) return;
    jumpToStyle(allStyles[Math.floor(Math.random() * allStyles.length)]?.id || DEFAULT_AI_BUBBLE_STYLE_ID, true);
  };

  const openEditor = (style?: BubbleStyleDefinition) => {
    const base = style || selectedStyle;
    setEditingStyleId(style?.id || draftStyleId || null);
    setForm(styleToFormValues(base));
    setEditorOpen(true);
  };

  const saveStyle = () => {
    if (!form.name.trim()) return;
    const id = isEditingCustomStyle ? editingStyleId! : createCharacterBubbleStyleId();
    const nextStyle = formValuesToStyle(form, id);
    const nextCustomStyles = isEditingCustomStyle
      ? customStyles.map((style) => (style.id === id ? nextStyle : style))
      : [...customStyles, nextStyle];
    onCustomStylesChange(nextCustomStyles);
    setDraftStyleId(id);
    setDraftStyle(nextStyle);
    setEditorOpen(false);
  };

  const deleteCustomStyle = () => {
    if (!editingStyleId || !isEditingCustomStyle) return;
    onCustomStylesChange(customStyles.filter((style) => style.id !== editingStyleId));
    if (draftStyleId === editingStyleId) jumpToStyle(DEFAULT_AI_BUBBLE_STYLE_ID);
    setEditorOpen(false);
  };

  const handleGenerate = async () => {
    if (!onGenerateStyle || generateDisabled || generating) return;
    setGenerating(true);
    try {
      const generated = await onGenerateStyle();
      if (!generated) return;
      const nextStyle = { ...generated, id: generated.id || createCharacterBubbleStyleId() };
      setDraftStyleId(nextStyle.id);
      setDraftStyle(nextStyle);
      setForm(styleToFormValues(nextStyle));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box component="span">{title}</Box>
          {onGenerateStyle ? (
            <Button variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={handleGenerate} disabled={generateDisabled || generating} sx={{ whiteSpace: 'nowrap' }}>
              {generateLabel || (i18n.language.startsWith('zh') ? 'AI生成' : 'AI generate')}
            </Button>
          ) : null}
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: { xs: '68vh', sm: '72vh' }, maxHeight: '72vh', overflow: 'hidden', bgcolor: 'transparent' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flex: '1 1 auto', minHeight: 0, overflow: 'hidden', px: 3, pt: 1.5, pb: 2 }}>
            <Card variant="outlined" sx={{ ...buildBubbleOptionCardSx(false), cursor: 'default', flex: '0 0 auto', '&:hover': { borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)', bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.045)' } }}>
              <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.15, minWidth: 0 }}>
                  {renderAvatarPreview(avatar, isImageAvatar, 42)}
                  <Box sx={{ px: 1.5, py: 1, border: selectedPreview.border, borderRadius: selectedPreview.borderRadius, boxShadow: selectedPreview.boxShadow, color: selectedPreview.color, background: selectedPreview.background, flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, opacity: 0.9 }}>{selectedStyle.name}</Typography>
                    <Typography variant="body2" noWrap>{previewText}</Typography>
                  </Box>
                  <IconButton size="small" onClick={() => openEditor(selectedStyle)} aria-label={i18n.language.startsWith('zh') ? '编辑气泡样式' : 'Edit bubble style'} sx={{ flexShrink: 0 }}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Box>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ ...buildBubblePanelCardSx(), flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
              <CardContent sx={{ p: 1.5, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0, '&:last-child': { pb: 1.5 } }}>
                {inlineError ? <Typography variant="caption" color="error">{inlineError}</Typography> : null}
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <FloatingSegmentedTabs
                    value={tab}
                    onChange={setTab}
                    equalWidth={false}
                    items={[
                      { value: 0, label: labels.custom },
                      { value: 1, label: labels.allPresets },
                      { value: 2, label: labels.rounded },
                      { value: 3, label: labels.border },
                      { value: 4, label: labels.gradient },
                      { value: 5, label: labels.dark },
                    ]}
                  />
                </Box>
                <Divider sx={{ borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)' }} />
                <Box sx={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 0, pr: 0.5 }}>
                  {currentStyles.length > 0 ? (
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25 }}>
                      {currentStyles.map((style) => {
                        const preview = buildBubblePreview(resolveCharacterBubbleStyle({ bubbleStyleId: style.id, customStyles }));
                        return (
                          <Card key={style.id} ref={(node) => { cardRefs.current[style.id] = node; }} variant="outlined" sx={buildBubbleOptionCardSx(draftStyleId === style.id)} onClick={() => jumpToStyle(style.id)}>
                            <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                                <Typography variant="subtitle2">{style.name}</Typography>
                                {tab === 0 ? <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEditor(style); }}><EditIcon fontSize="small" /></IconButton> : null}
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                {renderAvatarPreview(avatar, isImageAvatar, 30)}
                                <Box sx={{ px: 1.5, py: 1, border: preview.border, borderRadius: preview.borderRadius, boxShadow: preview.boxShadow, color: preview.color, background: preview.background, flex: 1, minWidth: 0 }}>
                                  <Typography variant="body2">{previewText}</Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </Box>
                  ) : (
                    <Box sx={{ minHeight: 120, display: 'grid', placeItems: 'center', color: 'text.secondary', textAlign: 'center' }}>
                      <Typography variant="body2">{labels.noCustom}</Typography>
                    </Box>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-start', pt: 0 }}>
                  <Button size="small" onClick={pickLeastUsedStyle} sx={{ minWidth: 0, px: 0.85 }}>{labels.auto}</Button>
                  <Button size="small" onClick={pickRandomStyle} sx={{ minWidth: 0, px: 0.85 }}>{labels.random}</Button>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => openEditor(selectedStyle)} sx={{ minWidth: 0, px: 0.85, '& .MuiButton-startIcon': { mr: 0.35 } }}>{labels.newStyle}</Button>
                </Box>
              </CardContent>
            </Card>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', borderTop: 1, borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)', bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.025)' }}>
          <Button onClick={onClose}>{labels.cancel}</Button>
          <Button variant="contained" onClick={() => onConfirm(draftStyleId, { ...selectedStyle, id: draftStyleId })}>{labels.confirm}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingStyleId ? labels.edit : labels.create}</DialogTitle>
        <DialogContent sx={{ bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.03)' }}>
          <Box sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
            <TextField label={labels.styleName} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} fullWidth />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25 }}>
              <TextField label={labels.background} value={form.backgroundColor} onChange={(e) => setForm((prev) => ({ ...prev, backgroundColor: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={form.backgroundColor} onChange={(e) => setForm((prev) => ({ ...prev, backgroundColor: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <TextField label={labels.text} value={form.textColor} onChange={(e) => setForm((prev) => ({ ...prev, textColor: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={form.textColor} onChange={(e) => setForm((prev) => ({ ...prev, textColor: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <TextField label={labels.borderColor} value={form.borderColor} onChange={(e) => setForm((prev) => ({ ...prev, borderColor: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={form.borderColor} onChange={(e) => setForm((prev) => ({ ...prev, borderColor: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25 }}>
              <TextField label={labels.gradientFrom} value={form.gradientFrom} onChange={(e) => setForm((prev) => ({ ...prev, gradientFrom: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={form.gradientFrom || '#ffffff'} onChange={(e) => setForm((prev) => ({ ...prev, gradientFrom: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <TextField label={labels.gradientTo} value={form.gradientTo} onChange={(e) => setForm((prev) => ({ ...prev, gradientTo: e.target.value }))} fullWidth slotProps={{ input: { startAdornment: <Box component="label" sx={{ width: 28, height: 28, borderRadius: 1.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider', mr: 1, cursor: 'pointer', flexShrink: 0, display: 'inline-flex' }}><Box component="input" type="color" value={form.gradientTo || '#ffffff'} onChange={(e) => setForm((prev) => ({ ...prev, gradientTo: e.target.value }))} sx={{ width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }} /></Box> } }} />
              <FormControl fullWidth><InputLabel>{labels.shadow}</InputLabel><Select value={form.shadow} label={labels.shadow} onChange={(e) => setForm((prev) => ({ ...prev, shadow: e.target.value as BubbleShadowLevel }))}><MenuItem value="none">none</MenuItem><MenuItem value="soft">soft</MenuItem><MenuItem value="medium">medium</MenuItem><MenuItem value="strong">strong</MenuItem></Select></FormControl>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.25 }}>
              <TextField type="number" label={labels.radius} value={form.radius} onChange={(e) => setForm((prev) => ({ ...prev, radius: Number(e.target.value) || 0 }))} fullWidth />
              <TextField type="number" label={labels.borderWidth} value={form.borderWidth} onChange={(e) => setForm((prev) => ({ ...prev, borderWidth: Number(e.target.value) || 0 }))} fullWidth />
              <FormControl fullWidth><InputLabel>{labels.borderStyle}</InputLabel><Select value={form.borderStyle} label={labels.borderStyle} onChange={(e) => setForm((prev) => ({ ...prev, borderStyle: e.target.value as BubbleStyleDefinition['borderStyle'] }))}><MenuItem value="solid">solid</MenuItem><MenuItem value="dashed">dashed</MenuItem><MenuItem value="dotted">dotted</MenuItem></Select></FormControl>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              {renderAvatarPreview(avatar, isImageAvatar, 30)}
              <Box sx={{ px: 1.5, py: 1, border: buildBubblePreview(formValuesToStyle(form, editingStyleId || 'preview')).border, borderRadius: buildBubblePreview(formValuesToStyle(form, editingStyleId || 'preview')).borderRadius, boxShadow: buildBubblePreview(formValuesToStyle(form, editingStyleId || 'preview')).boxShadow, color: buildBubblePreview(formValuesToStyle(form, editingStyleId || 'preview')).color, background: buildBubblePreview(formValuesToStyle(form, editingStyleId || 'preview')).background, flex: 1 }}>
                <Typography variant="body2">{previewText}</Typography>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', borderTop: 1, borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)', bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.025)' }}>
          <Box>{isEditingCustomStyle ? <Button color="error" onClick={deleteCustomStyle}>{labels.delete}</Button> : null}</Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button onClick={() => setEditorOpen(false)}>{labels.cancel}</Button>
            <Button variant="contained" onClick={saveStyle} disabled={!form.name.trim()}>{labels.saveStyle}</Button>
          </Box>
        </DialogActions>
      </Dialog>
    </>
  );
}
