import { useState, useEffect, useRef, useCallback } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import {
  Box, Typography, TextField, Button, IconButton,
  Checkbox, Avatar, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Divider,
  FormControlLabel, Switch, Snackbar, Alert, Tabs, Tab, MenuItem, Card, CardContent, Stack, InputAdornment,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, AutoAwesome as AutoAwesomeIcon, LocalFireDepartment as HotIcon } from '@mui/icons-material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { api as backendApi, type TopicAdaptationResult, type TopicItem, type TopicSourceSummary } from '../services/api';
import { generateCharacterProfile } from '../services/characterGenerator';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY } from '../types';
import type { ChatStyle, RuntimeEvolutionIntensity } from '../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE, DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../types/chat';
import { generateChatDraftSuggestion } from '../services/chatDraftGenerator';
import { CHAT_STYLE_OPTIONS, MIN_MEMBERS, MAX_MEMBERS } from '../constants/defaults';
import ChatRuntimePanel from '../components/chat/ChatRuntimePanel';

export default function CreateChatPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const { chats, addChat, updateChat, deleteChat, loadChats } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const { chatDraftDefaults, aiProfiles, api, setChatDraftDefaults, loadSettings } = useSettingsStore();
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [hotDialogOpen, setHotDialogOpen] = useState(false);
  const [hotSources, setHotSources] = useState<TopicSourceSummary[]>([]);
  const [hotSourceTab, setHotSourceTab] = useState(0);
  const [hotTopics, setHotTopics] = useState<TopicItem[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotAdapting, setHotAdapting] = useState(false);
  const [hotCreatingCharacters, setHotCreatingCharacters] = useState(false);
  const [hotSourceNote, setHotSourceNote] = useState('');
  const [selectedHotTopic, setSelectedHotTopic] = useState<TopicItem | null>(null);
  const [hotAdaptation, setHotAdaptation] = useState<TopicAdaptationResult | null>(null);
  const [hotSelectedCharacterNames, setHotSelectedCharacterNames] = useState<string[]>([]);
  const [hotCreatedCharacterNames, setHotCreatedCharacterNames] = useState<string[]>([]);
  const [hotOverwriteName, setHotOverwriteName] = useState(false);
  const [hotOverwriteTopic, setHotOverwriteTopic] = useState(false);
  const [configTab, setConfigTab] = useState(0);

  const editingChat = id ? chats.find((chat) => chat.id === id) : null;

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [style, setStyle] = useState<ChatStyle>('free');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [ownerCharacterId, setOwnerCharacterId] = useState<string>('');
  const [adminCharacterIds, setAdminCharacterIds] = useState<string[]>([]);
  const [mood, setMood] = useState('');
  const [focus, setFocus] = useState('');
  const [recentEvent, setRecentEvent] = useState('');
  const [runtimeNotesText, setRuntimeNotesText] = useState('');
  const [runtimeArtifactsText, setRuntimeArtifactsText] = useState('');
  const [allowCliques, setAllowCliques] = useState(false);
  const [allowMockery, setAllowMockery] = useState(false);
  const [showRoleActions, setShowRoleActions] = useState(true);
  const [runtimeEvolutionIntensity, setRuntimeEvolutionIntensity] = useState<RuntimeEvolutionIntensity>('balanced');
  const [allowSpeakAs, setAllowSpeakAs] = useState(true);
  const [allowDirectorMode, setAllowDirectorMode] = useState(true);
  const [allowEventInjection, setAllowEventInjection] = useState(true);
  const [allowForcedReply, setAllowForcedReply] = useState(true);
  const [autoModeration, setAutoModeration] = useState(false);
  const [allowMute, setAllowMute] = useState(true);
  const [allowPrivateThreads, setAllowPrivateThreads] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiAutofilling, setAiAutofilling] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const memberPressTimerRef = useRef<number | null>(null);

  const showError = (message: string) => {
    setSnackbar({ open: true, message, severity: 'error' });
  };

  const getActionErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
  };

  useEffect(() => {
    loadChats();
    loadCharacters();
    loadSettings();
  }, [loadCharacters, loadChats, loadSettings]);

  useEffect(() => {
    if (id && !editingChat) return;

    if (editingChat) {
      setName(editingChat.name || '');
      setTopic(editingChat.topic || '');
      setStyle(editingChat.style);
      setSelectedMembers(editingChat.memberIds || []);
      setOwnerCharacterId(editingChat.governance.ownerCharacterId || '');
      setAdminCharacterIds(editingChat.governance.adminCharacterIds || []);
      setMood(editingChat.worldState.mood || '');
      setFocus(editingChat.worldState.focus || '');
      setRecentEvent(editingChat.worldState.recentEvent || '');
      setRuntimeNotesText((editingChat.runtimeNotes || []).join('\n'));
      setRuntimeArtifactsText((editingChat.runtimeArtifacts || []).join('\n'));
      setAllowCliques(editingChat.dramaRules.allowCliques);
      setAllowMockery(editingChat.dramaRules.allowMockery);
      setShowRoleActions(editingChat.showRoleActions ?? true);
      setRuntimeEvolutionIntensity(editingChat.runtimeEvolutionIntensity || 'balanced');
      setAllowSpeakAs(editingChat.directorControls.allowSpeakAs);
      setAllowDirectorMode(editingChat.directorControls.allowDirectorMode);
      setAllowEventInjection(editingChat.directorControls.allowEventInjection);
      setAllowForcedReply(editingChat.directorControls.allowForcedReply);
      setAutoModeration(editingChat.governance.autoModeration);
      setAllowMute(editingChat.governance.allowMute);
      setAllowPrivateThreads(editingChat.governance.allowPrivateThreads);
      return;
    }

    setStyle(chatDraftDefaults.style);
    setShowRoleActions(chatDraftDefaults.showRoleActions);
    setRuntimeEvolutionIntensity(chatDraftDefaults.runtimeEvolutionIntensity);
    setOwnerCharacterId('');
    setAdminCharacterIds([]);
    setMood('');
    setFocus('');
    setRecentEvent('');
    setRuntimeNotesText('');
    setRuntimeArtifactsText('');
    setAllowCliques(false);
    setAllowMockery(false);
    setAllowSpeakAs(true);
    setAllowDirectorMode(true);
    setAllowEventInjection(true);
    setAllowForcedReply(true);
    setAutoModeration(false);
    setAllowMute(true);
    setAllowPrivateThreads(true);
  }, [chatDraftDefaults.runtimeEvolutionIntensity, chatDraftDefaults.showRoleActions, chatDraftDefaults.style, editingChat, id]);

  const toggleMember = (memberId: string) => {
    setSelectedMembers((prev) => {
      if (prev.includes(memberId)) return prev.filter((m) => m !== memberId);
      if (prev.length >= MAX_MEMBERS) {
        showError(i18n.language.startsWith('zh') ? `最多只能选择${MAX_MEMBERS}个AI成员` : `You can select up to ${MAX_MEMBERS} AI members`);
        return prev;
      }
      return [...prev, memberId];
    });
  };

  const persistDraft = () => {
    sessionStorage.setItem('miragetea-create-chat-draft', JSON.stringify({
      name,
      topic,
      style,
      selectedMembers,
      ownerCharacterId,
      adminCharacterIds,
      mood,
      focus,
      recentEvent,
      runtimeNotesText,
      runtimeArtifactsText,
      allowCliques,
      allowMockery,
      showRoleActions,
      runtimeEvolutionIntensity,
      allowSpeakAs,
      allowDirectorMode,
      allowEventInjection,
      allowForcedReply,
      autoModeration,
      allowMute,
      allowPrivateThreads,
      configTab,
    }));
  };

  const restoreDraft = () => {
    const raw = sessionStorage.getItem('miragetea-create-chat-draft');
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Record<string, unknown>;
      setName(String(draft.name || ''));
      setTopic(String(draft.topic || ''));
      setStyle((draft.style as ChatStyle) || chatDraftDefaults.style);
      setSelectedMembers(Array.isArray(draft.selectedMembers) ? draft.selectedMembers as string[] : []);
      setOwnerCharacterId(String(draft.ownerCharacterId || ''));
      setAdminCharacterIds(Array.isArray(draft.adminCharacterIds) ? draft.adminCharacterIds as string[] : []);
      setMood(String(draft.mood || ''));
      setFocus(String(draft.focus || ''));
      setRecentEvent(String(draft.recentEvent || ''));
      setRuntimeNotesText(String(draft.runtimeNotesText || ''));
      setRuntimeArtifactsText(String(draft.runtimeArtifactsText || ''));
      setAllowCliques(Boolean(draft.allowCliques));
      setAllowMockery(Boolean(draft.allowMockery));
      setShowRoleActions(Boolean(draft.showRoleActions));
      setRuntimeEvolutionIntensity((draft.runtimeEvolutionIntensity as RuntimeEvolutionIntensity) || chatDraftDefaults.runtimeEvolutionIntensity);
      setAllowSpeakAs(Boolean(draft.allowSpeakAs));
      setAllowDirectorMode(Boolean(draft.allowDirectorMode));
      setAllowEventInjection(Boolean(draft.allowEventInjection));
      setAllowForcedReply(Boolean(draft.allowForcedReply));
      setAutoModeration(Boolean(draft.autoModeration));
      setAllowMute(Boolean(draft.allowMute));
      setAllowPrivateThreads(Boolean(draft.allowPrivateThreads));
      setConfigTab(Number(draft.configTab || 0));
    } finally {
      sessionStorage.removeItem('miragetea-create-chat-draft');
    }
  };

  const openMemberEdit = (characterId: string) => {
    persistDraft();
    navigate(`/characters/${characterId}/edit?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
  };

  const clearMemberPressTimer = () => {
    if (memberPressTimerRef.current !== null) {
      window.clearTimeout(memberPressTimerRef.current);
      memberPressTimerRef.current = null;
    }
  };

  const startMemberLongPress = (characterId: string) => {
    clearMemberPressTimer();
    memberPressTimerRef.current = window.setTimeout(() => {
      openMemberEdit(characterId);
      clearMemberPressTimer();
    }, 450);
  };

  const handleMemberItemContextMenu = (event: React.MouseEvent, characterId: string) => {
    event.preventDefault();
    openMemberEdit(characterId);
  };

  useEffect(() => {
    if (!editingChat && new URLSearchParams(location.search).get('restoreDraft') === '1') {
      restoreDraft();
      navigate(location.pathname, { replace: true });
    }
  }, [editingChat, location.pathname, location.search, navigate]);

  useEffect(() => () => clearMemberPressTimer(), []);

  useEffect(() => {
    const handler = () => clearMemberPressTimer();
    window.addEventListener('pointerup', handler);
    window.addEventListener('pointercancel', handler);
    window.addEventListener('contextmenu', handler);
    window.addEventListener('blur', handler);
    window.addEventListener('mouseup', handler);
    window.addEventListener('touchend', handler);
    window.addEventListener('keydown', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('pointerup', handler);
      window.removeEventListener('pointercancel', handler);
      window.removeEventListener('contextmenu', handler);
      window.removeEventListener('blur', handler);
      window.removeEventListener('mouseup', handler);
      window.removeEventListener('touchend', handler);
      window.removeEventListener('keydown', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, []);

  useEffect(() => {
    if (!editingChat && new URLSearchParams(location.search).get('restoreDraft') !== '1') {
      sessionStorage.removeItem('miragetea-create-chat-draft');
    }
  }, [editingChat, location.search]);

  useEffect(() => {
    if (!hotDialogOpen && hotSources.length === 0) return;
    if (hotSourceTab <= hotSources.length - 1) return;
    setHotSourceTab(Math.max(0, hotSources.length - 1));
  }, [hotSourceTab, hotSources.length, hotDialogOpen]);

  useEffect(() => {
    if (!hotAdaptation) return;
    setHotOverwriteName(Boolean(name.trim() && hotAdaptation.suggestedName && name.trim() !== hotAdaptation.suggestedName.trim()));
    setHotOverwriteTopic(Boolean(topic.trim() && hotAdaptation.suggestedTopic && topic.trim() !== hotAdaptation.suggestedTopic.trim()));
  }, [hotAdaptation, name, topic]);

  useEffect(() => {
    if (selectedMembers.length <= MAX_MEMBERS) return;
    setSelectedMembers((prev) => prev.slice(0, MAX_MEMBERS));
  }, [selectedMembers]);

  useEffect(() => {
    if (!selectedHotTopic) return;
    if (hotTopics.some((item) => item.id === selectedHotTopic.id)) return;
    setSelectedHotTopic(null);
    setHotAdaptation(null);
    setHotSelectedCharacterNames([]);
  }, [hotTopics, selectedHotTopic]);

  useEffect(() => {
    const recommended = hotAdaptation?.recommendedCharacters || [];
    if (!recommended.length) {
      setHotSelectedCharacterNames([]);
      setHotCreatedCharacterNames([]);
      return;
    }
    const recommendedNames = new Set(recommended.map((item) => item.name));
    const existingNames = new Set(characters.map((character) => character.name.trim().toLowerCase()));
    const createdNames = new Set(hotCreatedCharacterNames.map((name) => name.trim().toLowerCase()));
    const selectableNames = recommended
      .map((item) => item.name)
      .filter((itemName) => !existingNames.has(itemName.trim().toLowerCase()) && !createdNames.has(itemName.trim().toLowerCase()));
    setHotSelectedCharacterNames((prev) => {
      const kept = prev.filter((itemName) => recommendedNames.has(itemName));
      return kept.length ? kept : selectableNames;
    });
    setHotCreatedCharacterNames((prev) => prev.filter((createdName) => recommended.some((item) => item.name === createdName)));
  }, [characters, hotAdaptation, hotCreatedCharacterNames]);

  useEffect(() => {
    setHotSelectedCharacterNames((prev) => {
      const recommendedNames = new Set((hotAdaptation?.recommendedCharacters || []).map((item) => item.name));
      const next = prev.filter((itemName) => recommendedNames.has(itemName));
      return next.length === prev.length ? prev : next;
    });
  }, [hotAdaptation]);

  useEffect(() => {
    if (!hotCreatedCharacterNames.length) return;
    setHotSelectedCharacterNames((prev) => Array.from(new Set([...prev, ...hotCreatedCharacterNames])));
  }, [hotCreatedCharacterNames]);

  useEffect(() => {
    if (!characters.length) return;
    setHotCreatedCharacterNames((prev) => prev.filter((createdName) => characters.some((character) => character.name.trim().toLowerCase() === createdName.trim().toLowerCase())));
  }, [characters]);

  const hotCreationInFlightRef = useRef(false);
  const BATCH_GENERATE_GROUP_SIZE = 10;

  const runInBatches = async <T,>(items: T[], batchSize: number, worker: (batch: T[], batchStartIndex: number) => Promise<void>) => {
    for (let start = 0; start < items.length; start += batchSize) {
      await worker(items.slice(start, start + batchSize), start);
    }
  };

  const buildCharacterCreatePayload = async (params: {
    name: string;
    backgroundHint?: string;
    config: typeof api;
  }) => {
    const generated = await generateCharacterProfile(params.config, params.name, i18n.language.startsWith('zh') ? 'zh' : 'en');
    return {
      name: params.name,
      avatar: generated.avatar,
      personality: generated.personality,
      behavior: DEFAULT_CHARACTER_BEHAVIOR,
      expertise: generated.expertise,
      speakingStyle: generated.speakingStyle,
      background: params.backgroundHint || generated.background,
      relationships: [],
      memory: DEFAULT_CHARACTER_MEMORY,
      layeredMemories: [],
      intervention: DEFAULT_CHARACTER_INTERVENTION,
      runtimeTimeline: [],
      modelProfileId: null,
      bubbleStyleId: null,
    };
  };

  const buildRecommendedHotCharacterQueue = () => {
    const recommended = hotAdaptation?.recommendedCharacters || [];
    const existingNames = new Set(characters.map((character) => character.name.trim().toLowerCase()));
    const createdNames = new Set(hotCreatedCharacterNames.map((name) => name.trim().toLowerCase()));
    const selectedNames = new Set(hotSelectedCharacterNames.map((name) => name.trim().toLowerCase()));
    const queuedNames = new Set<string>();
    return recommended.filter((candidate) => {
      const normalizedName = candidate.name.trim().toLowerCase();
      if (!selectedNames.has(normalizedName)) return false;
      if (existingNames.has(normalizedName) || createdNames.has(normalizedName) || queuedNames.has(normalizedName)) return false;
      queuedNames.add(normalizedName);
      return true;
    });
  };

  const markRecommendedHotCharactersCreated = (names: string[]) => {
    if (!names.length) return;
    setHotCreatedCharacterNames((prev) => Array.from(new Set([...prev, ...names])));
  };

  const getHotCharacterCardState = (candidateName: string) => {
    const normalizedName = candidateName.trim().toLowerCase();
    const alreadyExists = characters.some((character) => character.name.trim().toLowerCase() === normalizedName);
    const created = hotCreatedCharacterNames.some((name) => name.trim().toLowerCase() === normalizedName);
    return { alreadyExists, created };
  };

  const createRecommendedHotCharacterBatches = async (params: {
    queue: Array<{ name: string; description: string }>;
    activeConfig: typeof api;
  }) => {
    const createdIds: string[] = [];
    await runInBatches(params.queue, BATCH_GENERATE_GROUP_SIZE, async (batch) => {
      const payloads = await Promise.all(batch.map((candidate) => buildCharacterCreatePayload({
        name: candidate.name,
        backgroundHint: candidate.description,
        config: params.activeConfig,
      })));
      const result = await backendApi.createCharactersBatch(payloads);
      const createdCharacters = (result.characters || []) as Array<{ id: string; name: string }>;
      if (!createdCharacters.length) return;
      createdIds.push(...createdCharacters.map((character) => character.id));
      markRecommendedHotCharactersCreated(createdCharacters.map((character) => character.name));
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? `已创建 ${createdCharacters.length} 个角色` : `${createdCharacters.length} characters created`,
        severity: 'success',
      });
    });
    return createdIds;
  };

  const canCreate = name.trim().length > 0 && selectedMembers.length >= MIN_MEMBERS;
  const createError = !name.trim()
    ? (i18n.language.startsWith('zh') ? '请填写群聊名称' : 'Please enter a chat name')
    : selectedMembers.length < MIN_MEMBERS
      ? (i18n.language.startsWith('zh') ? `请至少选择${MIN_MEMBERS}个AI成员` : `Please select at least ${MIN_MEMBERS} AI members`)
      : '';

  const customCharacters = characters.filter((char) => !char.isPreset);
  const presetCharacters = characters.filter((char) => char.isPreset);
  const selectedCharacters = characters.filter((char) => selectedMembers.includes(char.id));
  const selectedMemorySummary = selectedCharacters.flatMap((char) => (char.layeredMemories || []).slice(-1).map((item) => `${char.name}：${item.text}`)).slice(0, 3).join(' / ');
  const hasCustomCharacters = customCharacters.length > 0;
  const hasPresetCharacters = presetCharacters.length > 0;
  const canAutofill = !editingChat && !aiAutofilling && Boolean(name.trim() || topic.trim() || selectedMembers.length);
  const getStyleLabel = (styleValue: ChatStyle) => t(`chat.style${styleValue.charAt(0).toUpperCase() + styleValue.slice(1)}`);

  const handleAutofill = useCallback(async () => {
    const profile = aiProfiles[0] || api;
    if (!profile?.apiKey || !profile?.model) {
      showError(i18n.language.startsWith('zh') ? '请先配置AI模型' : 'Configure AI model first');
      return;
    }

    setAiAutofilling(true);
    try {
      const suggestion = await generateChatDraftSuggestion({
        config: profile,
        language: i18n.language.startsWith('zh') ? 'zh' : 'en',
        draft: {
          name,
          topic,
          selectedMemberIds: selectedMembers,
          showRoleActions,
        },
        characters,
      });

      const mergedMemberIds = suggestion.suggestedMemberIds?.length
        ? Array.from(new Set([...selectedMembers, ...suggestion.suggestedMemberIds])).slice(0, MAX_MEMBERS)
        : selectedMembers;
      const appliedName = !name.trim() && suggestion.suggestedName;
      const appliedTopic = !topic.trim() && suggestion.suggestedTopic;
      const appliedStyle = !topic.trim() && suggestion.suggestedStyle;
      const appliedRoleActions = !topic.trim() && suggestion.suggestedShowRoleActions !== undefined;
      const appliedMembers = mergedMemberIds.length > selectedMembers.length;

      if (appliedName) setName(suggestion.suggestedName!);
      if (appliedTopic) setTopic(suggestion.suggestedTopic!);
      if (appliedStyle) setStyle(suggestion.suggestedStyle!);
      if (appliedRoleActions) setShowRoleActions(suggestion.suggestedShowRoleActions!);
      if (appliedMembers) setSelectedMembers(mergedMemberIds);
      if (!appliedName && !appliedTopic && !appliedStyle && !appliedRoleActions && !appliedMembers) {
        throw new Error(i18n.language.startsWith('zh') ? 'AI 没有返回可用建议' : 'AI did not return usable suggestions');
      }
      if (!selectedMembers.length && mergedMemberIds.length < MIN_MEMBERS) {
        throw new Error(i18n.language.startsWith('zh') ? 'AI 推荐的成员不足，无法自动补全' : 'Suggested members are insufficient for autofill');
      }

      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已自动补全群聊草稿' : 'Draft autofilled', severity: 'success' });
    } catch (error) {
      showError(getActionErrorMessage(error, t('common.error')));
    } finally {
      setAiAutofilling(false);
    }
  }, [aiProfiles, api, i18n.language, name, topic, selectedMembers, showRoleActions, characters, t]);

  const handleDelete = useCallback(async () => {
    if (!editingChat) return;
    try {
      await deleteChat(editingChat.id);
      setDeleteConfirmOpen(false);
      navigate(-1);
    } catch (error) {
      showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '删除群聊失败' : 'Failed to delete chat'));
    }
  }, [deleteChat, editingChat, i18n.language, navigate]);

  const headerTitle = editingChat ? t('chat.edit') : t('chat.create');
  const autofillLabel = aiAutofilling ? t('common.loading') : (i18n.language.startsWith('zh') ? '自动补全' : 'Auto fill');
  const deleteLabel = t('common.delete');
  const closeMemberDialog = () => {
    setMemberDialogOpen(false);
  };
  const openDeleteDialog = () => {
    setDeleteConfirmOpen(true);
  };
  const closeDeleteDialog = () => {
    setDeleteConfirmOpen(false);
  };
  const loadHotTopics = useCallback(async (sourceId: string) => {
    setHotLoading(true);
    try {
      const result = await backendApi.getTopics(sourceId);
      setHotTopics(result.items || []);
      setHotSourceNote(result.note || '');
    } catch (error) {
      showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '热点加载失败' : 'Failed to load topics'));
      setHotTopics([]);
      setHotSourceNote('');
    } finally {
      setHotLoading(false);
    }
  }, [i18n.language]);

  const openHotDialog = async () => {
    setHotDialogOpen(true);
    setHotAdaptation(null);
    setSelectedHotTopic(null);
    setHotSelectedCharacterNames([]);
    setHotCreatedCharacterNames([]);
    setHotOverwriteName(false);
    setHotOverwriteTopic(false);
    try {
      const result = await backendApi.getTopicSources();
      const sources = result.sources || [];
      setHotSources(sources);
      const firstSourceId = sources[0]?.id || 'ai_ideas';
      setHotSourceTab(0);
      await loadHotTopics(firstSourceId);
    } catch (error) {
      setHotSources([]);
      setHotSourceTab(0);
      await loadHotTopics('ai_ideas');
      showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '热点来源加载失败' : 'Failed to load topic sources'));
    }
  };

  const closeHotDialog = () => {
    setHotDialogOpen(false);
    setHotAdaptation(null);
    setSelectedHotTopic(null);
    setHotSelectedCharacterNames([]);
    setHotCreatedCharacterNames([]);
    setHotOverwriteName(false);
    setHotOverwriteTopic(false);
  };

  const handleHotSourceTabChange = async (_: unknown, value: number) => {
    if (value === hotSourceTab) return;
    setHotSourceTab(value);
    const sourceId = hotSourceTabs[value]?.id || 'ai_ideas';
    await loadHotTopics(sourceId);
  };

  const handleHotTopicSelect = async (topicItem: TopicItem) => {
    const activeConfig = aiProfiles[0] || api;
    if (!activeConfig?.apiKey || !activeConfig?.model) {
      showError(i18n.language.startsWith('zh') ? '请先配置AI模型后再使用热点改编' : 'Configure AI model before using topic adaptation');
      return;
    }
    setSelectedHotTopic(topicItem);
    setHotAdapting(true);
    try {
      const adaptation = await backendApi.adaptTopic({
        topic: { title: topicItem.title, subtitle: topicItem.subtitle, source: topicItem.source },
        characters: characters.map((character) => ({
          id: character.id,
          name: character.name,
          background: character.background,
          expertise: character.expertise,
          speakingStyle: character.speakingStyle,
          isPreset: character.isPreset,
        })),
        language: i18n.language.startsWith('zh') ? 'zh' : 'en',
      });
      setHotCreatedCharacterNames([]);
      setHotAdaptation(adaptation);
    } catch (error) {
      showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '热点改编失败' : 'Failed to adapt topic'));
      setHotAdaptation(null);
      setHotSelectedCharacterNames([]);
    } finally {
      setHotAdapting(false);
    }
  };

  const handleApplyHotTopic = () => {
    if (!hotAdaptation) return;
    if ((!name.trim() || hotOverwriteName) && hotAdaptation.suggestedName) setName(hotAdaptation.suggestedName);
    if ((!topic.trim() || hotOverwriteTopic) && hotAdaptation.suggestedTopic) setTopic(hotAdaptation.suggestedTopic);
    if (hotAdaptation.suggestedStyle) setStyle(hotAdaptation.suggestedStyle);
    if (hotAdaptation.suggestedMemberIds?.length) {
      setSelectedMembers((prev) => Array.from(new Set([...prev, ...hotAdaptation.suggestedMemberIds!])).slice(0, MAX_MEMBERS));
    }
    closeHotDialog();
    setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '已应用热点灵感' : 'Topic inspiration applied', severity: 'success' });
  };

  const handleToggleHotCharacter = (characterName: string) => {
    setHotSelectedCharacterNames((prev) => prev.includes(characterName) ? prev.filter((item) => item !== characterName) : [...prev, characterName]);
  };

  const handleCreateHotCharacters = async () => {
    if (hotCreatingCharacters || hotCreationInFlightRef.current) return;
    const activeConfig = aiProfiles[0] || api;
    if (!activeConfig?.apiKey || !activeConfig?.model || !hotAdaptation?.recommendedCharacters?.length) return;
    const selectedCandidates = buildRecommendedHotCharacterQueue();
    if (!selectedCandidates.length) {
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '没有需要创建的新角色' : 'No new characters needed',
        severity: 'success',
      });
      return;
    }

    hotCreationInFlightRef.current = true;
    setHotCreatingCharacters(true);
    try {
      const createdIds = await createRecommendedHotCharacterBatches({ queue: selectedCandidates, activeConfig });
      if (createdIds.length) {
        setSelectedMembers((prev) => Array.from(new Set([...prev, ...createdIds])).slice(0, MAX_MEMBERS));
      }
    } catch (error) {
      showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '批量创建推荐角色失败' : 'Failed to create suggested characters'));
    } finally {
      hotCreationInFlightRef.current = false;
      setHotCreatingCharacters(false);
    }
  };

  const hotSourceTabs = (hotSources.length
    ? [...hotSources].sort((a, b) => {
        const order = ['ai_ideas', 'weibo', 'zhihu', 'baidu', 'toutiao', 'tieba', 'hupu', '36kr', 'cls', 'ifanr', 'jinritemai', 'sspai', 'github', 'hackernews'];
        const aIndex = order.indexOf(a.id);
        const bIndex = order.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      })
    : [{ id: 'ai_ideas', label: i18n.language.startsWith('zh') ? 'AI灵感' : 'AI ideas', status: 'ok' as const }]);
  const hotSuggestedMembers = hotAdaptation?.suggestedMemberIds?.length
    ? characters.filter((character) => hotAdaptation.suggestedMemberIds?.includes(character.id))
    : [];
  const hotCreateCount = (hotAdaptation?.recommendedCharacters || []).filter((candidate) => {
    const { alreadyExists, created } = getHotCharacterCardState(candidate.name);
    return hotSelectedCharacterNames.includes(candidate.name) && !alreadyExists && !created;
  }).length;
  const hotCanApply = Boolean(hotAdaptation);
  const hotCanCreateCharacters = hotCreateCount > 0;
  const hotStatusLabel = (status: TopicSourceSummary['status'] | TopicItem['status']) => {
    if (status === 'degraded') return i18n.language.startsWith('zh') ? '降级' : 'Degraded';
    if (status === 'unavailable') return i18n.language.startsWith('zh') ? '不可用' : 'Unavailable';
    return '';
  };
  const hotStatusColor = (status: TopicSourceSummary['status'] | TopicItem['status']) => {
    if (status === 'degraded') return 'warning';
    if (status === 'unavailable') return 'error';
    return 'success';
  };
  const hotApplyLabel = hotOverwriteName || hotOverwriteTopic
    ? (i18n.language.startsWith('zh') ? '覆盖并应用' : 'Overwrite and apply')
    : (i18n.language.startsWith('zh') ? '应用到草稿' : 'Apply to draft');
  const hotCreateLabel = hotCreatingCharacters
    ? (i18n.language.startsWith('zh') ? '创建角色中…' : 'Creating characters…')
    : hotCanCreateCharacters
      ? (i18n.language.startsWith('zh') ? `创建 ${hotCreateCount} 个推荐角色` : `Create ${hotCreateCount} suggested characters`)
      : (i18n.language.startsWith('zh') ? '批量创建推荐角色' : 'Create suggested characters');
  const hotCurrentSource = hotSourceTabs[hotSourceTab] || null;
  const hotDialogSourceNote = hotCurrentSource?.note || hotSourceNote;
  const hotCurrentSourceId = hotCurrentSource?.id || 'ai_ideas';
  const hotAllSourcesUnavailable = hotSources.length > 0 && hotSources.every((source) => source.status === 'unavailable');
  const hotDialogHint = hotAllSourcesUnavailable
    ? (i18n.language.startsWith('zh') ? '外部来源当前不可用，仍可使用 AI 灵感 fallback。' : 'External sources are unavailable right now; AI ideas fallback still works.')
    : (i18n.language.startsWith('zh') ? '选择一个热点，让 AI 改编成可直接用于群聊创建的草稿。' : 'Pick a trending topic and let AI adapt it into a usable group-chat draft.');
  const hotSelectionConflictText = [
    hotOverwriteName ? (i18n.language.startsWith('zh') ? '群聊名称将被覆盖' : 'Chat name will be overwritten') : '',
    hotOverwriteTopic ? (i18n.language.startsWith('zh') ? '话题文案将被覆盖' : 'Topic text will be overwritten') : '',
  ].filter(Boolean).join(' · ');
  const hotLoadingText = hotLoading
    ? (i18n.language.startsWith('zh') ? '加载热点中…' : 'Loading topics…')
    : hotAdapting
      ? (i18n.language.startsWith('zh') ? 'AI 改编中…' : 'Adapting with AI…')
      : '';
  const hotEmptyText = hotCurrentSourceId === 'ai_ideas'
    ? (i18n.language.startsWith('zh') ? '当前没有可用灵感，请稍后再试。' : 'No AI ideas are available right now.')
    : (i18n.language.startsWith('zh') ? '当前来源暂无热点。' : 'No topics available for this source.');
  const hotSelectedTopicMeta = selectedHotTopic
    ? [selectedHotTopic.source, selectedHotTopic.heat, selectedHotTopic.subtitle].filter(Boolean).join(' · ')
    : '';
  const closeSnackbar = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };
  const handleTabChange = (_: unknown, value: number) => {
    setConfigTab(value);
  };
  const handleCreateAction = () => {
    void handleCreate();
  };
  const handleAutofillAction = () => {
    void handleAutofill();
  };
  const handleDeleteAction = () => {
    void handleDelete();
  };
  const confirmMemberDialog = () => {
    setMemberDialogOpen(false);
    if (selectedMembers.length < MIN_MEMBERS) {
      showError(i18n.language.startsWith('zh') ? `当前至少需要${MIN_MEMBERS}个AI成员才能开始群聊` : `At least ${MIN_MEMBERS} AI members are required to start the chat`);
    }
  };
  const goBack = () => {
    navigate(-1);
  };

  const selectedMemberGridSx = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
    gap: 1.5,
  } as const;

  const memberOptionSx = (checked: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, borderRadius: 3, border: 1,
    borderColor: checked ? 'primary.main' : 'divider',
    bgcolor: checked ? 'primary.light' : 'background.paper',
    cursor: 'pointer', transition: 'all 0.18s ease', '&:hover': { boxShadow: 1, borderColor: 'primary.main' },
  });

  const memberSummaryEmptyLabel = i18n.language.startsWith('zh') ? '未选择AI角色' : 'No AI members selected';
  const memberDialogConfirmLabel = t('common.confirm');
  const memberDialogMinError = i18n.language.startsWith('zh') ? `当前至少需要${MIN_MEMBERS}个AI成员才能开始群聊` : `At least ${MIN_MEMBERS} AI members are required to start the chat`;
  const startChatLabel = editingChat ? t('common.save') : '开始群聊';
  const runtimePhaseLabel = editingChat?.worldState.phase || 'idle';
  const runtimeMoodLabel = mood || '未设置';
  const runtimeFocusLabel = focus || '未设置';
  const runtimeRecentEventLabel = recentEvent || '暂无';
  const deleteChatTitle = t('chat.delete');
  const deleteChatConfirm = t('chat.deleteConfirm');
  const cancelLabel = t('common.cancel');
  const confirmDeleteLabel = t('common.delete');
  const noOwnerLabel = i18n.language.startsWith('zh') ? '未设置' : 'None';
  const adminNotesValue = adminCharacterIds.length ? adminCharacterIds.map((memberId) => selectedCharacters.find((char) => char.id === memberId)?.name).filter(Boolean).join(', ') : noOwnerLabel;
  const topicPlaceholder = i18n.language.startsWith('zh') ? '创建后由用户发送首条消息启动讨论，可先写简介或目标' : 'After creation the user starts discussion with the first message; use this for description or goal';

  useEffect(() => {
    setHeaderTitle(headerTitle);
    setHeaderBackAction(() => () => navigate(-1));
  }, [headerTitle, navigate, setHeaderBackAction, setHeaderTitle]);

  useEffect(() => {
    setHeaderActions(
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {!editingChat ? (
          <Button variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={handleAutofillAction} disabled={!canAutofill}>
            {autofillLabel}
          </Button>
        ) : null}
        {editingChat ? (
          <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={openDeleteDialog}>
            {deleteLabel}
          </Button>
        ) : null}
      </Box>
    );

    return () => {
      setHeaderActions(null);
    };
  }, [autofillLabel, canAutofill, deleteLabel, editingChat, setHeaderActions]);

  const handleCreate = async () => {
    if (saving) {
      showError(i18n.language.startsWith('zh') ? '正在处理中，请稍候' : 'Already processing, please wait');
      return;
    }

    const validMemberIds = Array.from(new Set(selectedMembers.filter(Boolean)));
    const normalizedOwnerCharacterId = ownerCharacterId && validMemberIds.includes(ownerCharacterId) ? ownerCharacterId : null;
    const normalizedAdminCharacterIds = Array.from(new Set(adminCharacterIds.filter((memberId) => validMemberIds.includes(memberId) && memberId !== normalizedOwnerCharacterId)));

    if (!name.trim()) {
      showError(i18n.language.startsWith('zh') ? '请填写群聊名称' : 'Please enter a chat name');
      return;
    }
    if (validMemberIds.length < MIN_MEMBERS) {
      showError(i18n.language.startsWith('zh') ? `请至少选择${MIN_MEMBERS}个AI成员` : `Please select at least ${MIN_MEMBERS} AI members`);
      return;
    }
    if (selectedMembers.length !== validMemberIds.length) {
      showError(i18n.language.startsWith('zh') ? '部分成员无效，请重新选择后再试' : 'Some selected members are invalid. Please reselect and try again');
      return;
    }
    if (ownerCharacterId && !normalizedOwnerCharacterId) {
      showError(i18n.language.startsWith('zh') ? '群主必须是当前群成员' : 'The owner must be one of the selected members');
      return;
    }
    if (adminCharacterIds.length !== normalizedAdminCharacterIds.length) {
      showError(i18n.language.startsWith('zh') ? '管理员必须来自当前群成员，且不能与群主重复' : 'Admins must be selected members and cannot duplicate the owner');
      return;
    }

    setSaving(true);
    try {
      if (editingChat) {
        await updateChat(editingChat.id, {
          name: name.trim(),
          topic: topic.trim(),
          style,
          memberIds: validMemberIds,
          speed: 1,
          allowIntervention: true,
          showRoleActions,
          topicSeed: '',
          runtimeNotes: runtimeNotesText.split('\n').map((item) => item.trim()).filter(Boolean),
          runtimeArtifacts: runtimeArtifactsText.split('\n').map((item) => item.trim()).filter(Boolean),
          runtimeTimeline: editingChat.runtimeTimeline || [],
          governance: {
            ...DEFAULT_CONVERSATION_GOVERNANCE,
            ownerCharacterId: normalizedOwnerCharacterId,
            adminCharacterIds: normalizedAdminCharacterIds,
            autoModeration,
            allowMute,
            allowPrivateThreads,
          },
          dramaRules: {
            ...DEFAULT_CONVERSATION_DRAMA_RULES,
            allowCliques,
            allowMockery,
          },
          worldState: {
            ...DEFAULT_CONVERSATION_WORLD_STATE,
            mood,
            focus,
            recentEvent,
          },
          directorControls: {
            ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
            allowSpeakAs,
            allowDirectorMode,
            allowEventInjection,
            allowForcedReply,
          },
        });
        setChatDraftDefaults({ style, showRoleActions, runtimeEvolutionIntensity });
        navigate(-1);
        return;
      }

      const chat = await addChat({
        type: 'group',
        mode: 'open_chat',
        modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG,
        modeState: DEFAULT_OPEN_CHAT_MODE_STATE,
        name: name.trim(),
        topic: topic.trim(),
        style,
        runtimeEvolutionIntensity,
        memberIds: validMemberIds,
        speed: 1,
        isActive: false,
        allowIntervention: true,
        showRoleActions,
        topicSeed: '',
        runtimeNotes: runtimeNotesText.split('\n').map((item) => item.trim()).filter(Boolean),
        runtimeArtifacts: runtimeArtifactsText.split('\n').map((item) => item.trim()).filter(Boolean),
        governance: {
          ...DEFAULT_CONVERSATION_GOVERNANCE,
          ownerCharacterId: normalizedOwnerCharacterId,
          adminCharacterIds: normalizedAdminCharacterIds,
          autoModeration,
          allowMute,
          allowPrivateThreads,
        },
        dramaRules: {
          ...DEFAULT_CONVERSATION_DRAMA_RULES,
          allowCliques,
          allowMockery,
        },
        worldState: {
          ...DEFAULT_CONVERSATION_WORLD_STATE,
          mood,
          focus,
          recentEvent,
          conflictAxes: [],
        },
        directorControls: {
          ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
          allowSpeakAs,
          allowDirectorMode,
          allowEventInjection,
          allowForcedReply,
        },
      });
      sessionStorage.removeItem('miragetea-create-chat-draft');
      setChatDraftDefaults({ style, showRoleActions, runtimeEvolutionIntensity });
      navigate(-1);
    } catch (error) {
      showError(getActionErrorMessage(error, editingChat
        ? (i18n.language.startsWith('zh') ? '保存群聊失败' : 'Failed to save chat')
        : (i18n.language.startsWith('zh') ? '创建群聊失败' : 'Failed to create chat')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 18, sm: 14, md: 10 }, maxWidth: 860, mx: 'auto' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Tabs value={configTab} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
          <Tab label={i18n.language.startsWith('zh') ? '设定' : 'Config'} />
          <Tab label={i18n.language.startsWith('zh') ? '治理' : 'Governance'} />
          <Tab label={i18n.language.startsWith('zh') ? '戏剧规则' : 'Drama'} />
          <Tab label={i18n.language.startsWith('zh') ? '运行态' : 'Runtime'} />
          <Tab label={i18n.language.startsWith('zh') ? '导演控制' : 'Director'} />
        </Tabs>

        {configTab === 0 ? (
          <Stack spacing={2}>
            <Card variant="outlined"><CardContent><TextField label={t('chat.name')} placeholder={t('chat.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} required fullWidth slotProps={{ input: { endAdornment: (<InputAdornment position="end"><IconButton color="primary" onClick={openHotDialog} edge="end" aria-label={i18n.language.startsWith('zh') ? '打开热点灵感' : 'Open topic inspiration'}><HotIcon /></IconButton></InputAdornment>) } }} /></CardContent></Card>
            <Card variant="outlined"><CardContent><TextField label={t('chat.topic')} placeholder={topicPlaceholder} value={topic} onChange={(e) => setTopic(e.target.value)} fullWidth multiline rows={2} /></CardContent></Card>
            <Card variant="outlined"><CardContent><Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}><Box><Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('chat.selectMembers')}</Typography><Typography variant="caption" color="text.secondary">{t('chat.membersHint')} ({selectedMembers.length}/{MAX_MEMBERS})</Typography></Box><IconButton color="primary" onClick={() => setMemberDialogOpen(true)}><AddIcon /></IconButton></Box>{selectedCharacters.length > 0 ? (<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{selectedCharacters.map((char) => (<Chip key={char.id} avatar={<Avatar sx={{ bgcolor: 'primary.light' }}>{char.avatar}</Avatar>} label={char.name} onDelete={() => toggleMember(char.id)} />))}</Box>) : (<Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, color: 'text.secondary' }}>{memberSummaryEmptyLabel}</Box>)}</CardContent></Card>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('chat.style')}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{CHAT_STYLE_OPTIONS.map((opt) => (<Button key={opt.value} variant={style === opt.value ? 'contained' : 'outlined'} onClick={() => setStyle(opt.value)} sx={{ borderRadius: 999 }}>{getStyleLabel(opt.value)}</Button>))}</Box></CardContent></Card>
            <Card variant="outlined"><CardContent><FormControlLabel control={<Switch checked={showRoleActions} onChange={(e) => setShowRoleActions(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '显示角色动作' : 'Show role actions'} /></CardContent></Card>
          <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{i18n.language.startsWith('zh') ? '变化强度' : 'Evolution intensity'}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}><Button variant={runtimeEvolutionIntensity === 'slow' ? 'contained' : 'outlined'} onClick={() => setRuntimeEvolutionIntensity('slow')} sx={{ borderRadius: 999 }}>{i18n.language.startsWith('zh') ? '慢' : 'Slow'}</Button><Button variant={runtimeEvolutionIntensity === 'balanced' ? 'contained' : 'outlined'} onClick={() => setRuntimeEvolutionIntensity('balanced')} sx={{ borderRadius: 999 }}>{i18n.language.startsWith('zh') ? '平衡' : 'Balanced'}</Button><Button variant={runtimeEvolutionIntensity === 'fast' ? 'contained' : 'outlined'} onClick={() => setRuntimeEvolutionIntensity('fast')} sx={{ borderRadius: 999 }}>{i18n.language.startsWith('zh') ? '快' : 'Fast'}</Button></Box><Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{i18n.language.startsWith('zh') ? '控制关系、情绪和人格漂移是快速显现，还是多轮对话后慢慢沉淀。' : 'Controls how quickly relationships, emotions, and drift become visible.'}</Typography></CardContent></Card>
          </Stack>
        ) : null}

        {configTab === 3 ? (
          <Stack spacing={2}>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>群聊运行态</Typography><Stack spacing={1}><Typography variant="body2"><strong>阶段：</strong>{runtimePhaseLabel}</Typography><Typography variant="body2"><strong>气氛：</strong>{runtimeMoodLabel}</Typography><Typography variant="body2"><strong>焦点：</strong>{runtimeFocusLabel}</Typography><Typography variant="body2"><strong>最近事件：</strong>{runtimeRecentEventLabel}</Typography><Typography variant="body2"><strong>{i18n.language.startsWith('zh') ? '变化强度' : 'Evolution intensity'}：</strong>{runtimeEvolutionIntensity === 'slow' ? (i18n.language.startsWith('zh') ? '慢' : 'Slow') : runtimeEvolutionIntensity === 'fast' ? (i18n.language.startsWith('zh') ? '快' : 'Fast') : (i18n.language.startsWith('zh') ? '平衡' : 'Balanced')}</Typography></Stack></CardContent></Card>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>长期沉淀记忆</Typography><TextField value={runtimeNotesText} onChange={(e) => setRuntimeNotesText(e.target.value)} multiline rows={5} fullWidth placeholder="每行一条，例如：该群容易因技术路线分裂" /></CardContent></Card>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>成果 / 产物</Typography><TextField value={runtimeArtifactsText} onChange={(e) => setRuntimeArtifactsText(e.target.value)} multiline rows={4} fullWidth placeholder="每行一条，例如：一份共识纪要 / 一张关系图" /></CardContent></Card>
            <ChatRuntimePanel chat={{ ...(editingChat || {}), id: editingChat?.id || 'draft', type: 'group', mode: 'open_chat', modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG, modeState: DEFAULT_OPEN_CHAT_MODE_STATE, name: name || '未命名群聊', topic, style, runtimeEvolutionIntensity, memberIds: selectedMembers, speed: 1, isActive: false, allowIntervention: true, showRoleActions, topicSeed: '', sourceChatId: null, sourceMemberIds: [], runtimeNotes: runtimeNotesText.split('\n').map((item) => item.trim()).filter(Boolean), runtimeArtifacts: runtimeArtifactsText.split('\n').map((item) => item.trim()).filter(Boolean), runtimeTimeline: editingChat?.runtimeTimeline || [], governance: { ...DEFAULT_CONVERSATION_GOVERNANCE, ownerCharacterId: ownerCharacterId || null, adminCharacterIds, autoModeration, allowMute, allowPrivateThreads }, dramaRules: { ...DEFAULT_CONVERSATION_DRAMA_RULES, allowCliques, allowMockery }, worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, mood, focus, recentEvent }, directorControls: { ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, allowSpeakAs, allowDirectorMode, allowEventInjection, allowForcedReply }, createdAt: editingChat?.createdAt || Date.now(), updatedAt: editingChat?.updatedAt || Date.now(), lastMessageAt: editingChat?.lastMessageAt || Date.now() }} members={selectedCharacters} />
          </Stack>
        ) : null}

        {configTab === 1 ? (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField
              select
              label={i18n.language.startsWith('zh') ? '群主' : 'Owner'}
              value={ownerCharacterId}
              onChange={(e) => setOwnerCharacterId(e.target.value)}
              fullWidth
            >
              <MenuItem value="">{noOwnerLabel}</MenuItem>
              {selectedCharacters.map((char) => <MenuItem key={char.id} value={char.id}>{char.name}</MenuItem>)}
            </TextField>
            <TextField
              select
              slotProps={{ select: { multiple: true } }}
              label={i18n.language.startsWith('zh') ? '管理员' : 'Admins'}
              value={adminCharacterIds}
              onChange={(e) => setAdminCharacterIds((typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value).filter(Boolean))}
              fullWidth
            >
              {selectedCharacters.map((char) => <MenuItem key={char.id} value={char.id}>{char.name}</MenuItem>)}
            </TextField>
            <TextField
              label={i18n.language.startsWith('zh') ? '管理员说明' : 'Admin notes'}
              value={adminNotesValue}
              slotProps={{ input: { readOnly: true } }}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary">
              {i18n.language.startsWith('zh') ? '可多选管理员；群主不会重复加入管理员。' : 'You can select multiple admins; the owner is excluded automatically.'}
            </Typography>
            <FormControlLabel control={<Switch checked={autoModeration} onChange={(e) => setAutoModeration(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '自动治理' : 'Auto moderation'} />
            <FormControlLabel control={<Switch checked={allowMute} onChange={(e) => setAllowMute(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许禁言' : 'Allow mute'} />
            <FormControlLabel control={<Switch checked={allowPrivateThreads} onChange={(e) => setAllowPrivateThreads(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许拉私聊' : 'Allow private threads'} />
          </Box>
        ) : null}

        {configTab === 2 ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <FormControlLabel control={<Switch checked={allowCliques} onChange={(e) => setAllowCliques(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许小团体' : 'Allow cliques'} />
            <FormControlLabel control={<Switch checked={allowMockery} onChange={(e) => setAllowMockery(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许公开嘲讽' : 'Allow mockery'} />
          </Box>
        ) : null}

        {configTab === 4 ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <FormControlLabel control={<Switch checked={allowSpeakAs} onChange={(e) => setAllowSpeakAs(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许以角色身份发言' : 'Allow speak as'} />
            <FormControlLabel control={<Switch checked={allowDirectorMode} onChange={(e) => setAllowDirectorMode(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许导演模式' : 'Allow director mode'} />
            <FormControlLabel control={<Switch checked={allowEventInjection} onChange={(e) => setAllowEventInjection(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许事件投放' : 'Allow event injection'} />
            <FormControlLabel control={<Switch checked={allowForcedReply} onChange={(e) => setAllowForcedReply(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许强制指定回复' : 'Allow forced reply'} />
          </Box>
        ) : null}

        <Button
          variant="contained"
          onClick={handleCreateAction}
          disabled={saving}
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
          {saving ? t('common.loading') : startChatLabel}
        </Button>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={closeSnackbar}>
        <Alert severity={snackbar.severity} onClose={closeSnackbar}>{snackbar.message}</Alert>
      </Snackbar>

      <Dialog open={memberDialogOpen} onClose={closeMemberDialog} maxWidth="md" fullWidth>
        <DialogTitle>{t('chat.selectMembers')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {hasCustomCharacters ? (
              <Box sx={selectedMemberGridSx}>
                {customCharacters.map((char) => (
                  <Box
                    key={char.id}
                    onClick={() => toggleMember(char.id)}
                    onPointerDown={() => startMemberLongPress(char.id)}
                    onPointerUp={clearMemberPressTimer}
                    onPointerLeave={clearMemberPressTimer}
                    onPointerCancel={clearMemberPressTimer}
                    onContextMenu={(e) => handleMemberItemContextMenu(e, char.id)}
                    sx={memberOptionSx(selectedMembers.includes(char.id))}
                  >
                    <Checkbox checked={selectedMembers.includes(char.id)} size="small" onClick={(e) => { e.stopPropagation(); toggleMember(char.id); }} />
                    <Avatar sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>{char.avatar}</Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{char.name}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : null}

            {hasCustomCharacters && hasPresetCharacters ? <Divider /> : null}

            {hasPresetCharacters ? (
              <Box sx={selectedMemberGridSx}>
                {presetCharacters.map((char) => (
                  <Box
                    key={char.id}
                    onClick={() => toggleMember(char.id)}
                    sx={memberOptionSx(selectedMembers.includes(char.id))}
                  >
                    <Checkbox checked={selectedMembers.includes(char.id)} size="small" onClick={(e) => { e.stopPropagation(); toggleMember(char.id); }} />
                    <Avatar sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>{char.avatar}</Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{char.name}</Typography>
                    </Box>
                    <Chip label="Preset" size="small" variant="outlined" />
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={confirmMemberDialog}>{memberDialogConfirmLabel}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={closeDeleteDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{deleteChatTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{deleteChatConfirm}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeDeleteDialog}>{cancelLabel}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteAction}
          >
            {confirmDeleteLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={hotDialogOpen} onClose={closeHotDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="h6">{i18n.language.startsWith('zh') ? '热点灵感' : 'Topic inspiration'}</Typography>
          <Box sx={{ minWidth: 120, display: 'flex', justifyContent: 'flex-end' }}>
            {hotLoadingText ? <Typography variant="body2" color="text.secondary">{hotLoadingText}</Typography> : null}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1, minHeight: 520 }}>
            <Tabs value={hotSourceTab} onChange={(event, value) => void handleHotSourceTabChange(event, value)} variant="scrollable" allowScrollButtonsMobile>
              {hotSourceTabs.map((source) => (
                <Tab key={source.id} label={source.label} />
              ))}
            </Tabs>
            {hotCurrentSource?.status === 'unavailable' && hotCurrentSource?.note ? <Alert severity="error">{hotCurrentSource.note}</Alert> : null}
            {hotSelectionConflictText ? <Alert severity="info">{hotSelectionConflictText}</Alert> : null}
            {!hotLoading && hotTopics.length === 0 && hotCurrentSource?.status === 'unavailable' ? (
              <Typography variant="body2" color="text.secondary">{hotCurrentSource?.note || hotEmptyText}</Typography>
            ) : null}
            {!hotLoading ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {hotTopics.map((topicItem) => (
                  <Box
                    key={topicItem.id}
                    onClick={() => void handleHotTopicSelect(topicItem)}
                    sx={{
                      p: 1.5,
                      border: 1,
                      borderRadius: 2,
                      borderColor: selectedHotTopic?.id === topicItem.id ? 'primary.main' : 'divider',
                      bgcolor: selectedHotTopic?.id === topicItem.id ? 'action.selected' : 'background.paper',
                      cursor: 'pointer',
                      '&:hover': { borderColor: 'primary.main', boxShadow: 1 },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body1" sx={{ fontWeight: 600 }}>{topicItem.title}</Typography>
                        {(topicItem.subtitle || topicItem.heat) ? <Typography variant="caption" color="text.secondary">{[topicItem.subtitle, topicItem.heat].filter(Boolean).join(' · ')}</Typography> : null}
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : null}
            {hotAdaptation ? (
              <Stack spacing={1.5}>
                <Divider />
                {hotAdaptation.suggestedName ? (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{i18n.language.startsWith('zh') ? '推荐群聊名称' : 'Suggested chat name'}</Typography>
                    <Typography variant="body2">{hotAdaptation.suggestedName}</Typography>
                  </Box>
                ) : null}
                {hotAdaptation.suggestedTopic ? (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{i18n.language.startsWith('zh') ? '推荐话题' : 'Suggested topic'}</Typography>
                    <Typography variant="body2">{hotAdaptation.suggestedTopic}</Typography>
                  </Box>
                ) : null}
                {hotAdaptation.suggestedStyle ? (
                  <Chip label={`${i18n.language.startsWith('zh') ? '建议风格' : 'Suggested style'}：${getStyleLabel(hotAdaptation.suggestedStyle)}`} size="small" color="primary" variant="outlined" />
                ) : null}
                {hotSuggestedMembers.length ? (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{i18n.language.startsWith('zh') ? '推荐已有成员' : 'Suggested existing members'}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
                      {hotSuggestedMembers.map((character) => (
                        <Chip key={character.id} label={character.name} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </Box>
                ) : null}
                {hotAdaptation.recommendedCharacters?.length ? (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{i18n.language.startsWith('zh') ? '推荐新角色' : 'Suggested new characters'}</Typography>
                    <Stack spacing={1} sx={{ mt: 0.75 }}>
                      {hotAdaptation.recommendedCharacters.map((candidate) => {
                        const { alreadyExists, created } = getHotCharacterCardState(candidate.name);
                        const checked = hotSelectedCharacterNames.includes(candidate.name) || created;
                        return (
                          <Box key={candidate.name} sx={{ p: 1.25, border: 1, borderColor: checked ? 'primary.main' : created ? 'success.main' : 'divider', borderRadius: 2, bgcolor: alreadyExists ? 'action.disabledBackground' : checked ? 'action.selected' : 'background.paper', position: 'relative' }}>
                            {created ? <Chip size="small" color="success" label={i18n.language.startsWith('zh') ? '已创建' : 'Created'} sx={{ position: 'absolute', top: 8, right: 8 }} /> : null}
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <Checkbox checked={checked} disabled={alreadyExists || created || hotCreatingCharacters} onChange={() => handleToggleHotCharacter(candidate.name)} sx={{ mt: -0.5 }} />
                              <Box sx={{ flex: 1, minWidth: 0, pr: created ? 7 : 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>{candidate.name}</Typography>
                                <Typography variant="caption" color="text.secondary">{candidate.description}</Typography>
                                {alreadyExists ? <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>{i18n.language.startsWith('zh') ? '已存在同名角色' : 'Character already exists'}</Typography> : null}
                              </Box>
                            </Box>
                          </Box>
                        );
                      })}
                    </Stack>
                  </Box>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={closeHotDialog}>{cancelLabel}</Button>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={() => void handleCreateHotCharacters()} disabled={hotCreatingCharacters || !hotCanCreateCharacters}>
              {hotCreateLabel}
            </Button>
            <Button variant="contained" onClick={handleApplyHotTopic} disabled={!hotCanApply}>
              {hotApplyLabel}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
