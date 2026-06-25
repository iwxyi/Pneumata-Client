import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type MouseEvent } from 'react';
import {
  Box, Typography, TextField, Button,
  FormControl, InputLabel, Select, MenuItem,
  Alert, IconButton, InputAdornment, Autocomplete, Checkbox, Tooltip, FormControlLabel, Divider,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudSyncIcon from '@mui/icons-material/CloudSyncOutlined';
import VpnKeyIcon from '@mui/icons-material/VpnKeyOutlined';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { isLikelyBrowserCorsError, listAvailableModels, testConnection } from '../services/aiClient';
import { api } from '../services/api';
import type { AIModelImageCapabilities, AIModelInputCapabilities, AIModelType, AIProvider } from '../types/settings';
import { normalizeImageCapabilities, normalizeInputCapabilities, inferTextInputCapabilities, buildTextInputCapabilityPatch, getInputCapabilityLockState, getAttachmentUiCapabilitySummary, getInputCapabilityBadge, getInputCapabilityWarning, shouldShowInputCapabilityWarning } from '../types/settings';
import { normalizeCharacterModelProfileIds } from '../types/character';
import ConfirmDialog from '../components/common/ConfirmDialog';
import PageSection from '../components/common/PageSection';
import SurfaceCard from '../components/common/SurfaceCard';
import AppSnackbar from '../components/common/AppSnackbar';
import ExpandableFab from '../components/common/ExpandableFab';
import { getPopularModels, getProviderCatalogEntry, getProviderDefaults, getProvidersForType, inferImageCapabilities } from '../constants/aiModelCatalog';
import { motion, transition } from '../styles/motion';

type AiBalanceView =
  | { status: 'idle' | 'loading' }
  | { status: 'guest' | 'unassigned' | 'error' }
  | { status: 'ready'; points: number };

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

function extractConnectionErrorMessage(error: unknown) {
  if (!error) return '';
  const raw = error instanceof Error ? error.message : String(error);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as {
      error?: string | { message?: string };
      detail?: string;
      message?: string;
    };
    const upstreamDetail = parsed.detail ? JSON.parse(parsed.detail) as { message?: string } : null;
    const errorMessage = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    return upstreamDetail?.message || errorMessage || parsed.message || raw;
  } catch {
    return raw;
  }
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

const OFFICIAL_MODEL_GROUP_ORDER = [
  'gpt-5',
  'o',
  'gpt-4.5',
  'gpt-4.1',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-4-vision',
  'gpt-4',
  'gpt-3.5',
  'embedding',
  'image',
  'other',
] as const;

function getOfficialModelGroupKey(model: string) {
  const normalized = model.trim().toLowerCase();
  if (/^gpt-5(?:[.-]|$)/.test(normalized)) return 'gpt-5';
  if (/^o\d/.test(normalized)) return 'o';
  if (/^gpt-4\.5(?:[.-]|$)/.test(normalized)) return 'gpt-4.5';
  if (/^gpt-4\.1(?:[.-]|$)/.test(normalized)) return 'gpt-4.1';
  if (/^gpt-4o(?:[.-]|$)/.test(normalized)) return 'gpt-4o';
  if (/^gpt-4-turbo/.test(normalized)) return 'gpt-4-turbo';
  if (/^gpt-4.*vision/.test(normalized)) return 'gpt-4-vision';
  if (/^gpt-4(?:[.-]|$)/.test(normalized)) return 'gpt-4';
  if (/^gpt-3\.5/.test(normalized)) return 'gpt-3.5';
  if (normalized.includes('embedding')) return 'embedding';
  if (normalized.includes('image') || normalized.includes('dall-e')) return 'image';
  return 'other';
}

function getOfficialModelGroupLabel(model: string, isZh: boolean) {
  const key = getOfficialModelGroupKey(model);
  if (isZh) {
    const labels: Record<(typeof OFFICIAL_MODEL_GROUP_ORDER)[number], string> = {
      'gpt-5': 'GPT-5 系列',
      o: 'o 推理系列',
      'gpt-4.5': 'GPT-4.5 系列',
      'gpt-4.1': 'GPT-4.1 系列',
      'gpt-4o': 'GPT-4o 系列',
      'gpt-4-turbo': 'GPT-4 Turbo 系列',
      'gpt-4-vision': 'GPT-4 视觉系列',
      'gpt-4': 'GPT-4 系列',
      'gpt-3.5': 'GPT-3.5 系列',
      embedding: 'Embedding 模型',
      image: '图像模型',
      other: '其他模型',
    };
    return labels[key];
  }
  const labels: Record<(typeof OFFICIAL_MODEL_GROUP_ORDER)[number], string> = {
    'gpt-5': 'GPT-5',
    o: 'o reasoning',
    'gpt-4.5': 'GPT-4.5',
    'gpt-4.1': 'GPT-4.1',
    'gpt-4o': 'GPT-4o',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'gpt-4-vision': 'GPT-4 Vision',
    'gpt-4': 'GPT-4',
    'gpt-3.5': 'GPT-3.5',
    embedding: 'Embeddings',
    image: 'Images',
    other: 'Other models',
  };
  return labels[key];
}

function compareOfficialModels(left: string, right: string) {
  const leftGroup = getOfficialModelGroupKey(left);
  const rightGroup = getOfficialModelGroupKey(right);
  const leftGroupIndex = OFFICIAL_MODEL_GROUP_ORDER.indexOf(leftGroup);
  const rightGroupIndex = OFFICIAL_MODEL_GROUP_ORDER.indexOf(rightGroup);
  if (leftGroupIndex !== rightGroupIndex) return leftGroupIndex - rightGroupIndex;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function resolveAiBalanceView(balance: Record<string, unknown> | null, loading: boolean): AiBalanceView {
  if (loading) return { status: 'loading' };
  if (!balance) return { status: 'idle' };
  const raw = balance.availableBalance ?? balance.available_balance;
  if (typeof raw === 'number' && Number.isFinite(raw)) return { status: 'ready', points: raw };
  return { status: 'unassigned' };
}

function getAiBalanceLabel(view: AiBalanceView, zh: boolean) {
  if (view.status === 'loading') return zh ? '点数刷新中' : 'Refreshing points';
  if (view.status === 'ready') return `${view.points}P`;
  if (view.status === 'guest') return zh ? '登录后查看点数' : 'Sign in to view points';
  if (view.status === 'unassigned') return zh ? '未分配点数' : 'No points assigned';
  if (view.status === 'error') return zh ? '登录后查看点数' : 'Sign in to view points';
  return zh ? '登录后查看点数' : 'Sign in to view points';
}

function isOfficialProviderKey(provider: string) {
  return provider === 'official' || provider === 'official-deepseek' || provider === 'official-gpt';
}

function resolveOfficialBackendProvider(provider: string) {
  return provider === 'official-deepseek' ? 'deepseek' : 'api2d';
}

function resolveSelectableProviderKey(provider: string, type: AIModelType) {
  const providerOptions = getProvidersForType(type);
  const catalogProvider = getProviderCatalogEntry(provider as AIProvider);
  return providerOptions.find((item) => item.key === provider)?.key
    || providerOptions.find((item) => item.key === catalogProvider.key)?.key
    || providerOptions[0]?.key
    || catalogProvider.key;
}

export default function AIModelsPage() {
  const { t, i18n } = useTranslation();
  const { setHeaderActions, setHeaderTitle, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const settings = useSettingsStore();
  const characters = useCharacterStore((state) => state.characters);
  const characterLoading = useCharacterStore((state) => state.isLoading);
  const loadCharacters = useCharacterStore((state) => state.loadCharacters);
  const markCharactersWarm = useCharacterStore((state) => state.markCharactersWarm);
  const prefetchCharacters = useCharacterStore((state) => state.prefetchCharacters);
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const [showKey, setShowKey] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [applyingKeyId, setApplyingKeyId] = useState<string | null>(null);
  const [confirmAssignProfileId, setConfirmAssignProfileId] = useState<string | null>(null);
  const [remoteModelOptions, setRemoteModelOptions] = useState<Record<string, string[]>>({});
  const [fetchedModelKeys, setFetchedModelKeys] = useState<Record<string, string>>({});
  const [fetchingModelIds, setFetchingModelIds] = useState<Record<string, boolean>>({});
  const [fetchModelFailedIds, setFetchModelFailedIds] = useState<Record<string, boolean>>({});
  const [openModelDropdownIds, setOpenModelDropdownIds] = useState<Record<string, boolean>>({});
  const [aiBalances, setAiBalances] = useState<Record<string, Record<string, unknown> | null>>({});
  const [aiBalanceLoadingIds, setAiBalanceLoadingIds] = useState<Record<string, boolean>>({});
  const [aiBalanceStatuses, setAiBalanceStatuses] = useState<Record<string, 'idle' | 'guest' | 'unassigned' | 'error'>>({});
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
  const inputCapabilityLabels: Array<{ key: keyof Pick<AIModelInputCapabilities, 'imageInput' | 'multiImageInput'>; label: string; tooltip: string }> = i18n.language.startsWith('zh')
    ? [
        { key: 'imageInput', label: '图片输入', tooltip: '允许在聊天输入框选择图片并发送给文本模型。' },
        { key: 'multiImageInput', label: '多图输入', tooltip: '允许一次选择并发送多张图片。' },
      ]
    : [
        { key: 'imageInput', label: 'Image input', tooltip: 'Allow selecting images in chat and sending them to the text model.' },
        { key: 'multiImageInput', label: 'Multi-image input', tooltip: 'Allow selecting and sending multiple images at once.' },
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
      ...(profile?.type === 'text' ? { inputCapabilities: inferTextInputCapabilities(profile.provider, value) } : {}),
    });
  }, [settings]);

  const refreshAiBalance = useCallback(async (providerKey: string) => {
    const backendProvider = resolveOfficialBackendProvider(providerKey);
    setAiBalanceLoadingIds((prev) => ({ ...prev, [providerKey]: true }));
    try {
      const balance = await api.getAiBalance(backendProvider);
      setAiBalances((prev) => ({ ...prev, [providerKey]: balance }));
      const raw = balance.availableBalance ?? balance.available_balance;
      setAiBalanceStatuses((prev) => ({ ...prev, [providerKey]: typeof raw === 'number' && Number.isFinite(raw) ? 'idle' : 'unassigned' }));
    } catch {
      setAiBalances((prev) => ({ ...prev, [providerKey]: null }));
      setAiBalanceStatuses((prev) => ({ ...prev, [providerKey]: 'guest' }));
    } finally {
      setAiBalanceLoadingIds((prev) => {
        const next = { ...prev };
        delete next[providerKey];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const providers = Array.from(new Set(settings.aiProfiles.filter((profile) => isOfficialProviderKey(profile.provider)).map((profile) => profile.provider)));
    providers.forEach((provider) => void refreshAiBalance(provider));
  }, [refreshAiBalance, settings.aiProfiles]);

  useEffect(() => {
    if (characters.length === 0 && !characterLoading) {
      markCharactersWarm();
      void prefetchCharacters();
    }
  }, [characters.length, characterLoading, markCharactersWarm, prefetchCharacters]);

  const handleTestConnection = async (profileId: string) => {
    const profile = settings.aiProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setTestingId(profileId);
    try {
      const result = await testConnection(profile);
      const corsBlocked = isLikelyBrowserCorsError(result.error);
      const shouldSave = result.success || corsBlocked;
      if (shouldSave) {
        await settings.syncCurrentSettingsToServer();
      }
      const corsHint = i18n.language.startsWith('zh')
        ? '浏览器直连被目标站跨域策略拦截，配置已保存，实际使用建议走服务端代理。'
        : 'Browser-direct request was blocked by the target CORS policy. Config saved; production use should go through your server proxy.';
      const successMessage = i18n.language.startsWith('zh')
        ? '连接测试成功，配置已保存'
        : 'Connection test succeeded. Config saved.';
      const errorMessage = extractConnectionErrorMessage(result.error);
      const message = result.success
        ? successMessage
        : corsBlocked
          ? corsHint
          : errorMessage || t('settings.connectionFailed');
      setSnackbar({
        open: true,
        message,
        severity: shouldSave ? 'success' : 'error',
      });
    } catch (error) {
      setSnackbar({
        open: true,
        message: error instanceof Error
          ? error.message
          : (i18n.language.startsWith('zh') ? '保存配置失败' : 'Failed to save config'),
        severity: 'error',
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleApplyOfficialKey = async (profileId: string, providerKey: string) => {
    const backendProvider = resolveOfficialBackendProvider(providerKey);
    setApplyingKeyId(profileId);
    try {
      const result = await api.assignAiProviderKey(backendProvider);
      const balance = result.balance && typeof result.balance === 'object'
        ? result.balance as Record<string, unknown>
        : null;
      if (balance) {
        const raw = balance.availableBalance ?? balance.available_balance;
        setAiBalances((prev) => ({ ...prev, [providerKey]: balance }));
        setAiBalanceStatuses((prev) => ({ ...prev, [providerKey]: typeof raw === 'number' && Number.isFinite(raw) ? 'idle' : 'unassigned' }));
      } else {
        await refreshAiBalance(providerKey);
      }
      await settings.syncCurrentSettingsToServer();
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? 'Key 已申请并分配额度' : 'Key created and quota assigned',
        severity: 'success',
      });
    } catch (error) {
      setSnackbar({
        open: true,
        message: error instanceof Error
          ? error.message
          : (i18n.language.startsWith('zh') ? '申请 Key 失败' : 'Failed to request key'),
        severity: 'error',
      });
    } finally {
      setApplyingKeyId(null);
    }
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
    if (!isOfficialProviderKey(profile.provider) && !profile.apiKey) {
      setRemoteModelOptions((prev) => ({ ...prev, [profileId]: [] }));
      return false;
    }

    const fetchKey = `${profile.provider}__${profile.type || 'text'}__${profile.baseUrl}__${profile.apiKey || 'account'}`;
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
      if (isOfficialProviderKey(profile.provider)) {
        options.sort(compareOfficialModels);
      }
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
    // Keep model discovery manual to avoid browser-side CORS noise on third-party endpoints.
  }, []);

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
                    const selectedProviderKey = resolveSelectableProviderKey(profile.provider, activeType);
                    const selectedProvider = providerOptions.find((item) => item.key === selectedProviderKey) || getProviderCatalogEntry(selectedProviderKey);
                    const providerDefaults = getProviderDefaults(selectedProvider.key, activeType);
                    const usesOfficialProxy = isOfficialProviderKey(selectedProvider.key);
                    const fetchedModels = remoteModelOptions[profile.id] || [];
                    const popularModels = usesOfficialProxy && fetchedModels.length > 0 ? [] : getPopularModels(selectedProvider.key, activeType);
                    const remoteModels = fetchedModels.filter((item) => !popularModels.includes(item));
                    const fetchingModels = Boolean(fetchingModelIds[profile.id]);
                    const balanceView = usesOfficialProxy
                      ? (aiBalanceStatuses[selectedProvider.key] === 'guest' || aiBalanceStatuses[selectedProvider.key] === 'error'
                        ? { status: aiBalanceStatuses[selectedProvider.key] } as AiBalanceView
                        : resolveAiBalanceView(aiBalances[selectedProvider.key] || null, Boolean(aiBalanceLoadingIds[selectedProvider.key])))
                      : null;
                    const requiresApi2dKeyApplication = selectedProvider.key === 'official-gpt' && balanceView?.status === 'unassigned';
                    const checkingApi2dKey = selectedProvider.key === 'official-gpt' && (balanceView?.status === 'idle' || balanceView?.status === 'loading');
                    const modelOptions = [
                      ...popularModels.map((value) => ({
                        value,
                        group: usesOfficialProxy ? getOfficialModelGroupLabel(value, i18n.language.startsWith('zh')) : groupedModelLabels.popular,
                      })),
                      ...remoteModels.map((value) => ({
                        value,
                        group: usesOfficialProxy ? getOfficialModelGroupLabel(value, i18n.language.startsWith('zh')) : groupedModelLabels.remote,
                      })),
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
                            const nextProvider = resolveSelectableProviderKey(profile.provider, type);
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
                              inputCapabilities: type === 'text' ? inferTextInputCapabilities(nextProvider, nextDefaults.model) : undefined,
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
                          inputCapabilities: activeType === 'text' ? inferTextInputCapabilities(provider, nextDefaults.model) : profile.inputCapabilities,
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
                    placeholder={usesOfficialProxy
                      ? (i18n.language.startsWith('zh') ? '使用当前登录账号，无需填写密钥' : 'Uses your signed-in account; no key required')
                      : t('settings.apiKeyPlaceholder')}
                    value={usesOfficialProxy ? '' : (showKey ? maskSecret(profile.apiKey) : profile.apiKey)}
                    onChange={(e) => {
                      if (!usesOfficialProxy) settings.updateAIProfile(profile.id, { apiKey: e.target.value });
                    }}
                    type={showKey ? 'text' : 'password'}
                    size="small"
                    fullWidth
                    disabled={usesOfficialProxy}
                    helperText={usesOfficialProxy
                      ? (i18n.language.startsWith('zh') ? '官方服务商会通过后台账号权益获取中转 Key。' : 'Official provider uses your account entitlement through the backend proxy.')
                      : undefined}
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
                    placeholder={usesOfficialProxy ? '/api/ai' : (selectedProvider.key === 'custom' ? 'https://example.com/v1' : providerDefaults.baseUrl)}
                    value={profile.baseUrl}
                    onChange={(e) => {
                      if (usesOfficialProxy) return;
                      setFetchModelFailedIds((prev) => {
                        const next = { ...prev };
                        delete next[profile.id];
                        return next;
                      });
                      settings.updateAIProfile(profile.id, { baseUrl: e.target.value });
                    }}
                    size="small"
                    fullWidth
                    disabled={usesOfficialProxy}
                    helperText={usesOfficialProxy
                      ? (i18n.language.startsWith('zh') ? '请求固定发送到本程序后台中转。' : 'Requests are routed through this app backend.')
                      : undefined}
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
                          ...(activeType === 'text' ? { inputCapabilities: inferTextInputCapabilities(profile.provider, nextModel) } : {}),
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

                  {activeType === 'text' ? (
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
                        {i18n.language.startsWith('zh') ? '输入能力' : 'Input capabilities'}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="caption" color="text.secondary">
                          {getAttachmentUiCapabilitySummary(profile, i18n.language.startsWith('zh') ? 'zh' : 'en')}
                        </Typography>
                        <Typography variant="caption" color={getInputCapabilityBadge(profile, i18n.language.startsWith('zh') ? 'zh' : 'en') === (i18n.language.startsWith('zh') ? '第三方推断' : '3rd-party inferred') ? 'warning.main' : 'text.secondary'}>
                          {getInputCapabilityBadge(profile, i18n.language.startsWith('zh') ? 'zh' : 'en')}
                        </Typography>
                      </Box>
                      {shouldShowInputCapabilityWarning(profile) ? (
                        <Alert severity="warning" sx={{ py: 0 }}>
                          {getInputCapabilityWarning(profile, i18n.language.startsWith('zh') ? 'zh' : 'en')}
                        </Alert>
                      ) : null}
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {inputCapabilityLabels.map((item) => {
                          const capabilities = normalizeInputCapabilities(profile.inputCapabilities);
                          const locks = getInputCapabilityLockState(profile);
                          const disabled = item.key === 'imageInput'
                            ? locks.imageInput
                            : item.key === 'multiImageInput'
                              ? locks.multiImageInput || !capabilities.imageInput
                              : false;
                          return (
                            <Tooltip key={item.key} title={disabled ? (i18n.language.startsWith('zh') ? '当前模型未识别到该输入能力，不能手动开启。' : 'This model was not identified as supporting this input capability, so it cannot be enabled manually.') : item.tooltip}>
                              <FormControlLabel
                                sx={{ mr: 1, ml: 0, opacity: disabled ? 0.58 : 1 }}
                                control={(
                                  <Checkbox
                                    checked={Boolean(capabilities[item.key])}
                                    disabled={disabled}
                                    onChange={(e) => {
                                      const nextCapabilities = buildTextInputCapabilityPatch(profile.provider, profile.model, capabilities, {
                                        [item.key]: e.target.checked,
                                      });
                                      settings.updateAIProfile(profile.id, { inputCapabilities: nextCapabilities });
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
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    {checkingApi2dKey ? (
                      <Button
                        variant="outlined"
                        startIcon={<VpnKeyIcon />}
                        disabled
                      >
                        {i18n.language.startsWith('zh') ? '检查 Key' : 'Checking key'}
                      </Button>
                    ) : requiresApi2dKeyApplication ? (
                      <Button
                        variant="outlined"
                        startIcon={<VpnKeyIcon />}
                        onClick={() => handleApplyOfficialKey(profile.id, selectedProvider.key)}
                        disabled={applyingKeyId === profile.id}
                      >
                        {applyingKeyId === profile.id ? t('common.loading') : (i18n.language.startsWith('zh') ? '申请 Key' : 'Request key')}
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        startIcon={<CloudSyncIcon />}
                        onClick={() => handleTestConnection(profile.id)}
                        disabled={testingId === profile.id || (!usesOfficialProxy && !profile.apiKey)}
                      >
                        {testingId === profile.id ? t('common.loading') : (i18n.language.startsWith('zh') ? '测试并保存' : 'Test & save')}
                      </Button>
                    )}
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
                    <Box sx={{ flex: 1 }} />
                    {balanceView ? (
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => void refreshAiBalance(selectedProvider.key)}
                        disabled={Boolean(aiBalanceLoadingIds[selectedProvider.key])}
                        sx={{ minHeight: 30, px: 1, color: 'text.secondary', flexShrink: 0 }}
                      >
                        {getAiBalanceLabel(balanceView, i18n.language.startsWith('zh'))}
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

      <AppSnackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        severity={snackbar.severity}
        message={snackbar.message}
      />

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

      <ExpandableFab
        icon={<AddIcon />}
        label={i18n.language.startsWith('zh') ? '添加模型' : 'Add model'}
        ariaLabel={i18n.language.startsWith('zh') ? '添加模型' : 'Add model'}
        onClick={() => settings.addAIProfile()}
        sx={{
          position: 'fixed',
          right: { xs: 20, sm: 28, md: 36 },
          bottom: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 88px)', sm: 32, md: 36 },
        }}
      />
    </Box>
  );
}
