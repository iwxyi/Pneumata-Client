import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type MouseEvent } from 'react';
import {
  Box, Typography, TextField, Button,
  FormControl, InputLabel, Select, MenuItem,
  Snackbar, Alert, IconButton, InputAdornment, Autocomplete, Checkbox, Tooltip, FormControlLabel, Divider,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudSyncIcon from '@mui/icons-material/CloudSyncOutlined';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { listAvailableModels, testConnection } from '../services/aiClient';
import type { AIModelImageCapabilities, AIModelType } from '../types/settings';
import { normalizeImageCapabilities } from '../types/settings';
import { normalizeCharacterModelProfileIds } from '../types/character';
import ConfirmDialog from '../components/common/ConfirmDialog';
import PageSection from '../components/common/PageSection';
import SurfaceCard from '../components/common/SurfaceCard';
import { getPopularModels, getProviderCatalogEntry, getProviderDefaults, getProvidersForType, inferImageCapabilities } from '../constants/aiModelCatalog';
import { motion, transition } from '../styles/motion';

function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 8) {
    const visibleCount = Math.min(4, Math.max(1, Math.ceil(value.length / 2)));
    return `${value.slice(0, visibleCount)}${'•'.repeat(Math.max(0, value.length - visibleCount))}`;
  }
  return `${value.slice(0, 4)}${'•'.repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
}

function blockSecretCopy(event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  event.preventDefault();
}

function blockSecretDrag(event: DragEvent<HTMLInputElement | HTMLTextAreaElement>) {
  event.preventDefault();
}

function blockSecretContextMenu(event: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) {
  event.preventDefault();
}

function fieldSx() {
  return {
    '& .MuiOutlinedInput-root': {
      borderRadius: 1,
      bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.045)',
      transition: transition(['background-color', 'border-color', 'box-shadow'], motion.durations.fast, motion.softOut),
      '&:hover': {
        bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.065)',
      },
      '&.Mui-focused': {
        boxShadow: (theme: Theme) => theme.palette.mode === 'light'
          ? '0 0 0 3px rgba(49,90,156,0.10)'
          : '0 0 0 3px rgba(120,156,220,0.12)',
      },
    },
  };
}

function modelCardSx() {
  return {
    position: 'relative',
    overflow: 'hidden',
    transition: transition(['border-color', 'box-shadow'], motion.durations.base, motion.softOut),
    '&:hover': {
      borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.28)' : 'rgba(120,156,220,0.28)',
      boxShadow: (theme: Theme) => theme.palette.mode === 'light'
        ? '0 1px 2px rgba(15,23,42,0.03), 0 18px 52px rgba(15,23,42,0.06)'
        : '0 1px 0 rgba(255,255,255,0.035) inset, 0 20px 56px rgba(0,0,0,0.30)',
    },
  };
}

function solidPopupPaperSx() {
  return {
    bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? '#fff' : '#171923',
    backgroundImage: 'none',
    border: '1px solid',
    borderColor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.10)' : 'rgba(226,232,240,0.12)',
    boxShadow: (theme: Theme) => theme.palette.mode === 'light'
      ? '0 18px 42px rgba(15,23,42,0.16)'
      : '0 20px 48px rgba(0,0,0,0.48)',
    backdropFilter: 'none',
    WebkitBackdropFilter: 'none',
    '& .MuiAutocomplete-groupLabel': {
      py: 0.25,
      lineHeight: 1.6,
      fontSize: 12,
    },
    '& .MuiAutocomplete-groupUl': {
      py: 0,
    },
  };
}

export default function AIModelsPage() {
  const { t, i18n } = useTranslation();
  const { setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const settings = useSettingsStore();
  const characters = useCharacterStore((state) => state.characters);
  const characterLoading = useCharacterStore((state) => state.isLoading);
  const loadCharacters = useCharacterStore((state) => state.loadCharacters);
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const [showKey, setShowKey] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [confirmAssignProfileId, setConfirmAssignProfileId] = useState<string | null>(null);
  const [remoteModelOptions, setRemoteModelOptions] = useState<Record<string, string[]>>({});
  const [fetchedModelKeys, setFetchedModelKeys] = useState<Record<string, string>>({});
  const [fetchingModelIds, setFetchingModelIds] = useState<Record<string, boolean>>({});
  const [fetchModelFailedIds, setFetchModelFailedIds] = useState<Record<string, boolean>>({});
  const [openModelDropdownIds, setOpenModelDropdownIds] = useState<Record<string, boolean>>({});
  const modelInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const fetchingModelKeysRef = useRef<Record<string, string>>({});
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const saveStatusMeta = (() => {
    if (settings.syncStatus === 'saving') {
      return {
        label: i18n.language.startsWith('zh') ? '保存中' : 'Saving',
        color: 'warning' as const,
      };
    }
    if (settings.syncStatus === 'saved') {
      return {
        label: i18n.language.startsWith('zh') ? '已保存' : 'Saved',
        color: 'success' as const,
      };
    }
    if (settings.syncStatus === 'error') {
      return {
        label: i18n.language.startsWith('zh') ? '保存失败' : 'Save failed',
        color: 'error' as const,
      };
    }
    return {
      label: i18n.language.startsWith('zh') ? '自动保存' : 'Auto save',
      color: 'default' as const,
    };
  })();
  const modelTypeLabels: Record<AIModelType, string> = {
    text: i18n.language.startsWith('zh') ? '文本' : 'Text',
    image: i18n.language.startsWith('zh') ? '图片' : 'Image',
    audio: i18n.language.startsWith('zh') ? '语音' : 'Audio',
    document: i18n.language.startsWith('zh') ? '文档' : 'Document',
  };
  const imageCapabilityLabels: Array<{ key: keyof AIModelImageCapabilities; label: string; tooltip: string }> = i18n.language.startsWith('zh')
    ? [
        { key: 'referenceImage', label: '参考图', tooltip: '模型接口支持把图片作为参考输入，而不是只在提示词里描述形象。' },
        { key: 'multiReferenceImage', label: '多参考图', tooltip: '模型接口支持一次传入多张参考图。' },
        { key: 'seed', label: 'Seed', tooltip: '模型接口支持传入 seed 或等价的随机种子参数。' },
        { key: 'negativePrompt', label: '避免内容', tooltip: '模型接口支持单独的 negative prompt 参数。' },
      ]
    : [
        { key: 'referenceImage', label: 'Reference image', tooltip: 'The image API accepts an image as reference input, not only text prompt descriptions.' },
        { key: 'multiReferenceImage', label: 'Multiple refs', tooltip: 'The image API accepts multiple reference images in one request.' },
        { key: 'seed', label: 'Seed', tooltip: 'The image API accepts a seed or equivalent randomness control parameter.' },
        { key: 'negativePrompt', label: 'Negative prompt', tooltip: 'The image API supports a separate negative prompt parameter.' },
      ];
  const groupedModelLabels = {
    popular: i18n.language.startsWith('zh') ? '推荐模型' : 'Recommended models',
    remote: i18n.language.startsWith('zh') ? '远程可用模型' : 'Available from provider',
  } as const;

  useEffect(() => {
    setHeaderTitle(t('nav.models'));
    setHeaderBackAction(null);
    setHideMobileBottomNav(false);
    setHeaderActions(null);
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
      setHeaderActions(null);
    };
  }, [setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav, t]);

  const handleModelInputChange = useCallback((profileId: string, value: string) => {
    const profile = settings.aiProfiles.find((item) => item.id === profileId);
    settings.updateAIProfile(profileId, {
      model: value,
      ...(profile?.type === 'image' ? { imageCapabilities: inferImageCapabilities(profile.provider, value) } : {}),
    });
  }, [settings]);

  useEffect(() => {
    if (characters.length === 0 && !characterLoading) {
      void loadCharacters();
    }
  }, [characters.length, characterLoading, loadCharacters]);

  const handleTestConnection = async (profileId: string) => {
    const profile = settings.aiProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setTestingId(profileId);
    const success = await testConnection(profile);
    setTestingId(null);
    setSnackbar({
      open: true,
      message: success ? t('settings.connectionSuccess') : t('settings.connectionFailed'),
      severity: success ? 'success' : 'error',
    });
  };

  const handleAssignToAllRoles = async (profileId: string) => {
    const profile = settings.aiProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    if (characters.length === 0 && !characterLoading) {
      await loadCharacters();
    }
    const latestCharacters = useCharacterStore.getState().characters;
    const editableCharacters = latestCharacters.filter((character) => !character.isPreset && character.deletedAt == null);
    if (!editableCharacters.length) {
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '还没有可编辑角色，请先创建至少一个角色' : 'No editable characters yet. Create at least one custom character first.',
        severity: 'error',
      });
      return;
    }

    setAssigningId(profileId);
    try {
      await Promise.all(editableCharacters.map((character) => {
        const modelProfileIds = normalizeCharacterModelProfileIds(character.modelProfileIds, character.modelProfileId || null);
        const nextModelProfileIds = {
          ...modelProfileIds,
          [profile.type || 'text']: profile.id,
        };
        return updateCharacter(character.id, {
          modelProfileId: nextModelProfileIds.text || null,
          modelProfileIds: nextModelProfileIds,
        });
      }));
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh')
          ? `已为 ${editableCharacters.length} 个角色配置${modelTypeLabels[profile.type || 'text']}模型`
          : `Assigned ${modelTypeLabels[profile.type || 'text']} model to ${editableCharacters.length} characters`,
        severity: 'success',
      });
    } catch {
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '批量配置角色模型失败' : 'Failed to assign model to characters',
        severity: 'error',
      });
    } finally {
      setAssigningId(null);
    }
  };

  const fetchAvailableModels = async (profileId: string, silent = false, force = false) => {
    const profile = settings.aiProfiles.find((item) => item.id === profileId);
    if (!profile) return false;
    if (!profile.apiKey) {
      setRemoteModelOptions((prev) => ({ ...prev, [profileId]: [] }));
      return false;
    }

    const fetchKey = `${profile.provider}__${profile.type || 'text'}__${profile.baseUrl}__${profile.apiKey}`;
    if (!force && fetchedModelKeys[profileId] === fetchKey) return true;
    if (fetchingModelKeysRef.current[profileId] === fetchKey) return false;

    fetchingModelKeysRef.current[profileId] = fetchKey;
    setFetchingModelIds((prev) => ({ ...prev, [profileId]: true }));
    setFetchModelFailedIds((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    try {
      const models = await listAvailableModels(profile);
      const options = Array.from(new Set(models.map((item) => item.id).filter(Boolean)));
      setRemoteModelOptions((prev) => ({ ...prev, [profileId]: options }));
      setFetchedModelKeys((prev) => ({ ...prev, [profileId]: fetchKey }));
      if (!silent) {
        setSnackbar({
          open: true,
          message: i18n.language.startsWith('zh')
            ? `已拉取 ${options.length} 个模型`
            : `Loaded ${options.length} models`,
          severity: 'success',
        });
      }
      return true;
    } catch (error) {
      setRemoteModelOptions((prev) => ({ ...prev, [profileId]: [] }));
      setFetchedModelKeys((prev) => ({ ...prev, [profileId]: fetchKey }));
      if (!silent) {
        setFetchModelFailedIds((prev) => ({ ...prev, [profileId]: true }));
      }
      if (!silent) {
        setSnackbar({
          open: true,
          message: error instanceof Error
            ? error.message
            : (i18n.language.startsWith('zh') ? '拉取模型列表失败' : 'Failed to load models'),
          severity: 'error',
        });
      }
      return false;
    } finally {
      delete fetchingModelKeysRef.current[profileId];
      setFetchingModelIds((prev) => {
        const next = { ...prev };
        delete next[profileId];
        return next;
      });
    }
  };

  const handleFetchModels = async (profileId: string) => {
    const success = await fetchAvailableModels(profileId, false, true);
    if (success) {
      modelInputRefs.current[profileId]?.focus();
      requestAnimationFrame(() => {
        setOpenModelDropdownIds((prev) => ({ ...prev, [profileId]: true }));
      });
    }
  };

  useEffect(() => {
    settings.aiProfiles.forEach((profile) => {
      const fetchKey = `${profile.provider}__${profile.type || 'text'}__${profile.baseUrl}__${profile.apiKey}`;
      if (!profile.apiKey || fetchedModelKeys[profile.id] === fetchKey) return;
      void fetchAvailableModels(profile.id, true);
    });
  }, [settings.aiProfiles, fetchedModelKeys]);

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, width: '100%', maxWidth: 1180, mx: 'auto' }}>
      <PageSection spacing={2}>
      {settings.syncStatus === 'error' && settings.syncError ? (
        <Alert severity="error" variant="outlined">
          {settings.syncError}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, min(100%, 560px))',
            md: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(3, minmax(0, 1fr))',
          },
          justifyContent: 'center',
          gap: 2,
        }}
      >
            {settings.aiProfiles.map((profile, index) => (
              <SurfaceCard key={profile.id} sx={modelCardSx()} contentSx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                  {(() => {
                    const activeType = profile.type || 'text';
                    const providerOptions = getProvidersForType(activeType);
                    const selectedProvider = providerOptions.find((item) => item.key === profile.provider) || providerOptions[0] || getProviderCatalogEntry(profile.provider);
                    const providerDefaults = getProviderDefaults(selectedProvider.key, activeType);
                    const popularModels = getPopularModels(selectedProvider.key, activeType);
                    const remoteModels = (remoteModelOptions[profile.id] || []).filter((item) => !popularModels.includes(item));
                    const fetchingModels = Boolean(fetchingModelIds[profile.id]);
                    const modelOptions = [
                      ...popularModels.map((value) => ({ value, group: groupedModelLabels.popular })),
                      ...remoteModels.map((value) => ({ value, group: groupedModelLabels.remote })),
                    ];
                    return (
                      <>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      label={i18n.language.startsWith('zh') ? '模型名称' : 'Profile name'}
                      value={profile.name}
                      onChange={(e) => settings.updateAIProfile(profile.id, { name: e.target.value })}
                      size="small"
                      fullWidth
                      sx={fieldSx()}
                    />
                  </Box>
                  <Divider />

                  <FormControl fullWidth size="small">
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <FormControl fullWidth size="small" sx={fieldSx()}>
                        <InputLabel>{i18n.language.startsWith('zh') ? '类型' : 'Type'}</InputLabel>
                        <Select
                          value={profile.type || 'text'}
                          label={i18n.language.startsWith('zh') ? '类型' : 'Type'}
                          MenuProps={{ slotProps: { paper: { sx: solidPopupPaperSx() } } }}
                          onChange={(e) => {
                            const type = e.target.value as AIModelType;
                            const compatibleProviders = getProvidersForType(type);
                            const nextProvider = compatibleProviders.find((item) => item.key === profile.provider)?.key || compatibleProviders[0]?.key || profile.provider;
                            const nextDefaults = getProviderDefaults(nextProvider, type);
                            setFetchedModelKeys((prev) => {
                              const next = { ...prev };
                              delete next[profile.id];
                              return next;
                            });
                            setRemoteModelOptions((prev) => ({ ...prev, [profile.id]: [] }));
                            setFetchModelFailedIds((prev) => {
                              const next = { ...prev };
                              delete next[profile.id];
                              return next;
                            });
                            settings.updateAIProfile(profile.id, {
                              type,
                              provider: nextProvider,
                              baseUrl: nextDefaults.baseUrl,
                              model: nextDefaults.model,
                              imageCapabilities: type === 'image' ? inferImageCapabilities(nextProvider, nextDefaults.model) : undefined,
                            });
                          }}
                        >
                          <MenuItem value="text">{modelTypeLabels.text}</MenuItem>
                          <MenuItem value="image">{modelTypeLabels.image}</MenuItem>
                          <MenuItem value="audio">{modelTypeLabels.audio}</MenuItem>
                          <MenuItem value="document">{modelTypeLabels.document}</MenuItem>
                        </Select>
                      </FormControl>
                      <Tooltip title={i18n.language.startsWith('zh') ? '设为该类型默认的模型' : 'Set as the default model for this type'}>
                        <FormControlLabel
                          sx={{ mr: 0, ml: 0, whiteSpace: 'nowrap' }}
                          control={(
                            <Checkbox
                              checked={Boolean(profile.isDefault)}
                              onChange={(e) => settings.updateAIProfile(profile.id, { isDefault: e.target.checked })}
                            />
                          )}
                          label={i18n.language.startsWith('zh') ? '默认' : 'Default'}
                        />
                      </Tooltip>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setConfirmAssignProfileId(profile.id)}
                        disabled={assigningId === profile.id}
                        sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        {assigningId === profile.id
                          ? t('common.loading')
                          : (i18n.language.startsWith('zh') ? '应用到角色' : 'Apply to roles')}
                      </Button>
                    </Box>
                  </FormControl>

                  <FormControl fullWidth size="small" sx={fieldSx()}>
                    <InputLabel>{t('settings.provider')}</InputLabel>
                    <Select
                      value={selectedProvider.key}
                      label={t('settings.provider')}
                      MenuProps={{ slotProps: { paper: { sx: solidPopupPaperSx() } } }}
                      onChange={(e) => {
                        const provider = e.target.value as typeof selectedProvider.key;
                        const nextDefaults = getProviderDefaults(provider, activeType);
                        setFetchedModelKeys((prev) => {
                          const next = { ...prev };
                          delete next[profile.id];
                          return next;
                        });
                        setRemoteModelOptions((prev) => ({ ...prev, [profile.id]: [] }));
                        setFetchModelFailedIds((prev) => {
                          const next = { ...prev };
                          delete next[profile.id];
                          return next;
                        });
                        settings.updateAIProfile(profile.id, {
                          provider,
                          baseUrl: nextDefaults.baseUrl,
                          model: nextDefaults.model,
                          imageCapabilities: activeType === 'image' ? inferImageCapabilities(provider, nextDefaults.model) : profile.imageCapabilities,
                        });
                      }}
                    >
                      {providerOptions.map((option) => (
                        <MenuItem key={option.key} value={option.key}>{option.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    label={t('settings.apiKey')}
                    placeholder={t('settings.apiKeyPlaceholder')}
                    value={showKey ? maskSecret(profile.apiKey) : profile.apiKey}
                    onChange={(e) => settings.updateAIProfile(profile.id, { apiKey: e.target.value })}
                    type={showKey ? 'text' : 'password'}
                    size="small"
                    fullWidth
                    sx={fieldSx()}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton size="small" onClick={() => setShowKey(!showKey)}>
                              {showKey ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                      htmlInput: {
                        readOnly: showKey,
                        onCopy: blockSecretCopy,
                        onCut: blockSecretCopy,
                        onDragStart: blockSecretDrag,
                        onContextMenu: blockSecretContextMenu,
                        autoComplete: 'off',
                        spellCheck: false,
                        style: {
                          userSelect: 'none',
                          WebkitUserSelect: 'none',
                        },
                      },
                    }}
                  />

                  <TextField
                    label={t('settings.baseUrl')}
                    placeholder={selectedProvider.key === 'custom' ? 'https://example.com/v1' : providerDefaults.baseUrl}
                    value={profile.baseUrl}
                    onChange={(e) => {
                      setFetchModelFailedIds((prev) => {
                        const next = { ...prev };
                        delete next[profile.id];
                        return next;
                      });
                      settings.updateAIProfile(profile.id, { baseUrl: e.target.value });
                    }}
                    size="small"
                    fullWidth
                    sx={fieldSx()}
                  />

                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <Autocomplete
                      freeSolo
                      options={modelOptions}
                      open={Boolean(openModelDropdownIds[profile.id])}
                      onOpen={() => setOpenModelDropdownIds((prev) => ({ ...prev, [profile.id]: true }))}
                      onClose={() => setOpenModelDropdownIds((prev) => {
                        const next = { ...prev };
                        delete next[profile.id];
                        return next;
                      })}
                      slotProps={{
                        paper: {
                          sx: solidPopupPaperSx(),
                        },
                      }}
                      groupBy={(option) => option.group}
                      getOptionLabel={(option) => typeof option === 'string' ? option : option.value}
                      isOptionEqualToValue={(option, value) => {
                        const optionValue = typeof option === 'string' ? option : option.value;
                        const selectedValue = typeof value === 'string' ? value : value.value;
                        return optionValue === selectedValue;
                      }}
                      value={profile.model}
                      onChange={(_event, value) => {
                        const nextModel = typeof value === 'string' ? value : (value?.value || '');
                        settings.updateAIProfile(profile.id, {
                          model: nextModel,
                          ...(activeType === 'image' ? { imageCapabilities: inferImageCapabilities(profile.provider, nextModel) } : {}),
                        });
                      }}
                      onInputChange={(_event, value, reason) => {
                        if (reason === 'input' || reason === 'clear') {
                          handleModelInputChange(profile.id, value);
                        }
                      }}
                      renderOption={(props, option) => (
                        <Box component="li" {...props}>
                          {option.value}
                        </Box>
                      )}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('settings.model')}
                          placeholder={modelOptions[0]?.value || (i18n.language.startsWith('zh') ? '可手动输入模型名' : 'Enter any model name')}
                          size="small"
                          fullWidth
                          inputRef={(node) => {
                            modelInputRefs.current[profile.id] = node;
                          }}
                          onBlur={() => {
                            setOpenModelDropdownIds((prev) => {
                              const next = { ...prev };
                              delete next[profile.id];
                              return next;
                            });
                          }}
                          sx={fieldSx()}
                        />
                      )}
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                    <Button
                      variant="outlined"
                      onClick={() => handleFetchModels(profile.id)}
                      disabled={fetchingModels || !profile.apiKey}
                      sx={{ minWidth: 64, height: 40, px: 1.5, flexShrink: 0 }}
                    >
                      {fetchingModels
                        ? (i18n.language.startsWith('zh') ? '获取中' : 'Loading')
                        : fetchModelFailedIds[profile.id]
                          ? (i18n.language.startsWith('zh') ? '失败' : 'Failed')
                          : (i18n.language.startsWith('zh') ? '获取' : 'Fetch')}
                    </Button>
                  </Box>

                  {activeType === 'image' ? (
                    <Box sx={{
                      display: 'grid',
                      gap: 1,
                      p: 1.25,
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: (theme) => theme.palette.mode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(226,232,240,0.10)',
                      bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(248,250,252,0.58)' : 'rgba(255,255,255,0.045)',
                    }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {i18n.language.startsWith('zh') ? '图片能力' : 'Image capabilities'}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          {imageCapabilityLabels.map((item) => {
                            const capabilities = normalizeImageCapabilities(profile.imageCapabilities);
                            return (
                              <Tooltip key={item.key} title={item.tooltip}>
                                <FormControlLabel
                                  sx={{ mr: 1, ml: 0 }}
                                  control={(
                                    <Checkbox
                                      checked={Boolean(capabilities[item.key])}
                                      onChange={(e) => {
                                        const nextCapabilities = normalizeImageCapabilities({
                                          ...capabilities,
                                          [item.key]: e.target.checked,
                                        });
                                        if (item.key === 'referenceImage' && !e.target.checked) {
                                          nextCapabilities.multiReferenceImage = false;
                                        }
                                        if (item.key === 'multiReferenceImage' && e.target.checked) {
                                          nextCapabilities.referenceImage = true;
                                        }
                                        settings.updateAIProfile(profile.id, { imageCapabilities: nextCapabilities });
                                      }}
                                    />
                                  )}
                                  label={item.label}
                                />
                              </Tooltip>
                            );
                          })}
                        </Box>
                    </Box>
                  ) : null}

                  <Divider />
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      startIcon={<CloudSyncIcon />}
                      onClick={() => handleTestConnection(profile.id)}
                      disabled={testingId === profile.id || !profile.apiKey}
                    >
                      {testingId === profile.id ? t('common.loading') : t('settings.testConnection')}
                    </Button>
                    {index > 0 ? (
                      <Button
                        color="error"
                        variant="outlined"
                        startIcon={<DeleteIcon />}
                        onClick={() => settings.removeAIProfile(profile.id)}
                      >
                        {t('common.delete')}
                      </Button>
                    ) : null}
                  </Box>
                      </>
                    );
                  })()}
              </SurfaceCard>
            ))}
          </Box>
      </PageSection>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      <ConfirmDialog
        open={Boolean(confirmAssignProfileId)}
        title={i18n.language.startsWith('zh') ? '确认批量配置角色模型' : 'Confirm Bulk Character Model Update'}
        message={i18n.language.startsWith('zh')
          ? '这会将所有可编辑角色对应类型的模型统一改为当前模型。此操作影响范围较大，请确认继续。'
          : 'This will update the matching model type for all editable characters to the selected model. This affects many characters.'}
        onConfirm={async () => {
          if (!confirmAssignProfileId) return;
          const targetId = confirmAssignProfileId;
          setConfirmAssignProfileId(null);
          await handleAssignToAllRoles(targetId);
        }}
        onCancel={() => setConfirmAssignProfileId(null)}
        destructive
      />

      <Button
        variant="contained"
        startIcon={<AddIcon />}
        onClick={() => settings.addAIProfile()}
        sx={{
          position: 'fixed',
          right: { xs: 20, sm: 28, md: 36 },
          bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', sm: 32, md: 36 },
          zIndex: 1300,
          minHeight: 56,
          px: 2.25,
          borderRadius: 18,
          boxShadow: '0 10px 24px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.16)',
        }}
      >
        {i18n.language.startsWith('zh') ? '添加模型' : 'Add model'}
      </Button>
    </Box>
  );
}
