import { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button,
  FormControl, InputLabel, Select, MenuItem,
  Snackbar, Alert, IconButton, InputAdornment, Autocomplete, Chip, Checkbox, Tooltip, FormControlLabel,
} from '@mui/material';
import { Visibility, VisibilityOff, Add as AddIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { listAvailableModels, testConnection } from '../services/aiClient';
import type { AIModelType } from '../types/settings';
import { normalizeCharacterModelProfileIds } from '../types/character';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { getPopularModels, getProviderCatalogEntry, getProviderDefaults, getProvidersForType } from '../constants/aiModelCatalog';

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
    settings.updateAIProfile(profileId, { model: value });
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

  const fetchAvailableModels = async (profileId: string, silent = false) => {
    const profile = settings.aiProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    if (!profile.apiKey) {
      setRemoteModelOptions((prev) => ({ ...prev, [profileId]: [] }));
      return;
    }

    const fetchKey = `${profile.provider}__${profile.type || 'text'}__${profile.baseUrl}__${profile.apiKey}`;
    if (fetchedModelKeys[profileId] === fetchKey) return;

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
    } catch (error) {
      setFetchedModelKeys((prev) => {
        const next = { ...prev };
        delete next[profileId];
        return next;
      });
      if (!silent) {
        setSnackbar({
          open: true,
          message: error instanceof Error
            ? error.message
            : (i18n.language.startsWith('zh') ? '拉取模型列表失败' : 'Failed to load models'),
          severity: 'error',
        });
      }
    } finally {
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
    <Box sx={{ flex: 1, overflow: 'auto', p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, width: '100%', maxWidth: 960, mx: 'auto' }}>
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('settings.apiConfig')}
            </Typography>
            <Chip
              size="small"
              color={saveStatusMeta.color}
              variant={saveStatusMeta.color === 'default' ? 'outlined' : 'filled'}
              label={saveStatusMeta.label}
            />
          </Box>
          {settings.syncStatus === 'error' && settings.syncError ? (
            <Alert severity="error" variant="outlined">
              {settings.syncError}
            </Alert>
          ) : null}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                xl: 'repeat(2, minmax(0, 1fr))',
              },
              gap: 2,
            }}
          >
            {settings.aiProfiles.map((profile, index) => (
              <Card key={profile.id} variant="outlined" sx={{ bgcolor: 'background.default' }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(() => {
                    const activeType = profile.type || 'text';
                    const providerOptions = getProvidersForType(activeType);
                    const selectedProvider = providerOptions.find((item) => item.key === profile.provider) || providerOptions[0] || getProviderCatalogEntry(profile.provider);
                    const providerDefaults = getProviderDefaults(selectedProvider.key, activeType);
                    const popularModels = getPopularModels(selectedProvider.key, activeType);
                    const remoteModels = (remoteModelOptions[profile.id] || []).filter((item) => !popularModels.includes(item));
                    const modelOptions = [
                      ...popularModels.map((value) => ({ value, group: groupedModelLabels.popular })),
                      ...remoteModels.map((value) => ({ value, group: groupedModelLabels.remote })),
                    ];
                    return (
                      <>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                      label={i18n.language.startsWith('zh') ? '模型名称' : 'Profile name'}
                      value={profile.name}
                      onChange={(e) => settings.updateAIProfile(profile.id, { name: e.target.value })}
                      size="small"
                      fullWidth
                    />
                    {index > 0 && (
                      <Button color="error" onClick={() => settings.removeAIProfile(profile.id)}>
                        {t('common.delete')}
                      </Button>
                    )}
                  </Box>

                  <FormControl fullWidth size="small">
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{i18n.language.startsWith('zh') ? '类型' : 'Type'}</InputLabel>
                        <Select
                          value={profile.type || 'text'}
                          label={i18n.language.startsWith('zh') ? '类型' : 'Type'}
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
                            settings.updateAIProfile(profile.id, {
                              type,
                              provider: nextProvider,
                              baseUrl: nextDefaults.baseUrl,
                              model: nextDefaults.model,
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
                    </Box>
                  </FormControl>

                  <FormControl fullWidth size="small">
                    <InputLabel>{t('settings.provider')}</InputLabel>
                    <Select
                      value={selectedProvider.key}
                      label={t('settings.provider')}
                      onChange={(e) => {
                        const provider = e.target.value as typeof selectedProvider.key;
                        const nextDefaults = getProviderDefaults(provider, activeType);
                        setFetchedModelKeys((prev) => {
                          const next = { ...prev };
                          delete next[profile.id];
                          return next;
                        });
                        setRemoteModelOptions((prev) => ({ ...prev, [profile.id]: [] }));
                        settings.updateAIProfile(profile.id, { provider, baseUrl: nextDefaults.baseUrl, model: nextDefaults.model });
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
                    value={profile.apiKey}
                    onChange={(e) => settings.updateAIProfile(profile.id, { apiKey: e.target.value })}
                    type={showKey ? 'text' : 'password'}
                    size="small"
                    fullWidth
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
                    }}
                  />

                  <TextField
                    label={t('settings.baseUrl')}
                    placeholder={selectedProvider.key === 'custom' ? 'https://example.com/v1' : providerDefaults.baseUrl}
                    value={profile.baseUrl}
                    onChange={(e) => settings.updateAIProfile(profile.id, { baseUrl: e.target.value })}
                    size="small"
                    fullWidth
                  />

                  <Autocomplete
                    freeSolo
                    options={modelOptions}
                    groupBy={(option) => option.group}
                    getOptionLabel={(option) => typeof option === 'string' ? option : option.value}
                    isOptionEqualToValue={(option, value) => {
                      const optionValue = typeof option === 'string' ? option : option.value;
                      const selectedValue = typeof value === 'string' ? value : value.value;
                      return optionValue === selectedValue;
                    }}
                    value={profile.model}
                    onChange={(_event, value) => settings.updateAIProfile(profile.id, {
                      model: typeof value === 'string' ? value : (value?.value || ''),
                    })}
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
                      />
                    )}
                  />

                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      onClick={() => handleTestConnection(profile.id)}
                      disabled={testingId === profile.id || !profile.apiKey}
                    >
                      {testingId === profile.id ? t('common.loading') : t('settings.testConnection')}
                    </Button>
                    <Button
                      variant="outlined"
                    onClick={() => setConfirmAssignProfileId(profile.id)}
                    disabled={assigningId === profile.id}
                  >
                    {assigningId === profile.id
                        ? t('common.loading')
                        : (i18n.language.startsWith('zh') ? '为所有角色配置' : 'Assign To All Characters')}
                  </Button>
                  </Box>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            ))}
          </Box>
        </CardContent>
      </Card>

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
