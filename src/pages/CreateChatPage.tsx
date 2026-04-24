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
import { useMessageStore } from '../stores/useMessageStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { getPreferredAIProfile } from '../types/settings';
import type { ChatStyle, RuntimeEvolutionIntensity } from '../types/chat';
import { DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, DEFAULT_CONVERSATION_DRAMA_RULES, DEFAULT_CONVERSATION_GOVERNANCE, DEFAULT_CONVERSATION_WORLD_STATE, DEFAULT_OPEN_CHAT_MODE_CONFIG, DEFAULT_OPEN_CHAT_MODE_STATE } from '../types/chat';
import { generateChatDraftSuggestion } from '../services/chatDraftGenerator';
import { api as apiClient } from '../services/api';
import { CHAT_STYLE_OPTIONS, MIN_MEMBERS, MAX_MEMBERS } from '../constants/defaults';
import ChatRuntimePanel from '../components/chat/ChatRuntimePanel';
import HotTopicDialog from '../components/createChat/HotTopicDialog';
import { useHotTopicDialog } from '../components/createChat/useHotTopicDialog';
import { isImageAvatar } from '../utils/avatar';

export default function CreateChatPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const { chats, addChat, updateChat, deleteChat, loadChats } = useChatStore();
  const { characters, loadCharacters } = useCharacterStore();
  const clearChatMessagesLocal = useMessageStore((state) => state.clearChatMessagesLocal);
  const addMessage = useMessageStore((state) => state.addMessage);
  const { chatDraftDefaults, aiProfiles, api, setChatDraftDefaults, loadSettings } = useSettingsStore();
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearMessagesConfirmOpen, setClearMessagesConfirmOpen] = useState(false);
  const [clearMemoryConfirmOpen, setClearMemoryConfirmOpen] = useState(false);
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

  const seedOpeningTopicMessage = useCallback(async (chatId: string, topicText?: string | null) => {
    const openingTopic = (topicText || '').trim();
    if (!openingTopic) return;
    await addMessage({
      chatId,
      type: 'god',
      senderId: 'user',
      senderName: 'User',
      content: openingTopic,
      emotion: 0,
    });
  }, [addMessage]);

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
    if (selectedMembers.length <= MAX_MEMBERS) return;
    setSelectedMembers((prev) => prev.slice(0, MAX_MEMBERS));
  }, [selectedMembers]);

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
    const profile = getPreferredAIProfile(aiProfiles, 'text') || api;
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

      const appliedName = !name.trim() && suggestion.suggestedName;
      const appliedTopic = !topic.trim() && suggestion.suggestedTopic;
      const appliedStyle = style === chatDraftDefaults.style && suggestion.suggestedStyle;
      const appliedRoleActions = showRoleActions === chatDraftDefaults.showRoleActions && suggestion.suggestedShowRoleActions !== undefined;

      if (appliedName) setName(suggestion.suggestedName!);
      if (appliedTopic) setTopic(suggestion.suggestedTopic!);
      if (appliedStyle) setStyle(suggestion.suggestedStyle!);
      if (appliedRoleActions) setShowRoleActions(suggestion.suggestedShowRoleActions!);
      if (!appliedName && !appliedTopic && !appliedStyle && !appliedRoleActions) {
        throw new Error(i18n.language.startsWith('zh') ? 'AI 没有返回可用建议' : 'AI did not return usable suggestions');
      }
      if (!selectedMembers.length && suggestion.suggestedMemberIds?.length && suggestion.suggestedMemberIds.length < MIN_MEMBERS) {
        throw new Error(i18n.language.startsWith('zh') ? 'AI 没有返回可用建议' : 'AI did not return usable suggestions');
      }
      if (!selectedMembers.length && suggestion.suggestedMemberIds?.length && suggestion.suggestedMemberIds.length < MIN_MEMBERS) {
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

  const handleClearMessages = useCallback(async () => {
    if (!editingChat) return;
    try {
      await apiClient.clearChatMessages(editingChat.id);
      clearChatMessagesLocal(editingChat.id);
      await seedOpeningTopicMessage(editingChat.id, editingChat.topic);
      setClearMessagesConfirmOpen(false);
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '已清理聊天记录' : 'Chat messages cleared',
        severity: 'success',
      });
    } catch (error) {
      showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '清理聊天记录失败' : 'Failed to clear chat messages'));
    }
  }, [clearChatMessagesLocal, editingChat, i18n.language, seedOpeningTopicMessage]);

  const handleClearMemory = useCallback(async () => {
    if (!editingChat) return;
    try {
      await updateChat(editingChat.id, {
        isActive: false,
        modeState: {
          ...DEFAULT_OPEN_CHAT_MODE_STATE,
        },
        runtimeNotes: [],
        runtimeArtifacts: [],
        layeredMemories: [],
        runtimeTimeline: [],
        worldState: {
          ...editingChat.worldState,
          phase: DEFAULT_CONVERSATION_WORLD_STATE.phase,
          recentEvent: '',
          conflictAxes: [],
        },
      });
      setClearMemoryConfirmOpen(false);
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? '已清理聊天记忆' : 'Chat memory cleared',
        severity: 'success',
      });
    } catch (error) {
      showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '清理聊天记忆失败' : 'Failed to clear chat memory'));
    }
  }, [editingChat, i18n.language, updateChat]);

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
  const openClearMessagesDialog = () => {
    setClearMessagesConfirmOpen(true);
  };
  const closeClearMessagesDialog = () => {
    setClearMessagesConfirmOpen(false);
  };
  const openClearMemoryDialog = () => {
    setClearMemoryConfirmOpen(true);
  };
  const closeClearMemoryDialog = () => {
    setClearMemoryConfirmOpen(false);
  };
  const { hotDialogProps, openHotDialog } = useHotTopicDialog({
    language: i18n.language,
    apiConfig: api,
    aiProfiles,
    autoGenerateCharacterAvatar: useSettingsStore.getState().autoGenerateCharacterAvatar,
    characters,
    name,
    topic,
    setName,
    setTopic,
    setStyle,
    setSelectedMembers,
    maxMembers: MAX_MEMBERS,
    onError: showError,
    setSnackbar,
  });
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
  const handleClearMessagesAction = () => {
    void handleClearMessages();
  };
  const handleClearMemoryAction = () => {
    void handleClearMemory();
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
  const clearMessagesTitle = i18n.language.startsWith('zh') ? '清理聊天记录' : 'Clear chat messages';
  const clearMessagesConfirm = i18n.language.startsWith('zh') ? '这会永久删除当前群聊的全部消息记录，但保留关系、情绪、记忆和运行态。此操作无法撤销。' : 'This permanently deletes all chat messages while keeping relationships, emotions, memories, and runtime state. This action cannot be undone.';
  const clearMessagesLabel = i18n.language.startsWith('zh') ? '清理聊天记录' : 'Clear chat messages';
  const clearMemoryTitle = i18n.language.startsWith('zh') ? '清理聊天记忆' : 'Clear chat memory';
  const clearMemoryConfirm = i18n.language.startsWith('zh') ? '这会清除当前群聊自身的运行态、事件、会话级记忆与摘要，但保留聊天记录，以及角色自身的成长与记忆。此操作无法撤销。' : 'This clears session-level runtime state, events, and chat memory for this chat while keeping message history and character growth. This action cannot be undone.';
  const clearMemoryLabel = i18n.language.startsWith('zh') ? '清理聊天记忆' : 'Clear chat memory';
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
          runtimeEvolutionIntensity,
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
      await seedOpeningTopicMessage(chat.id, topic);
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
          <Tab label={i18n.language.startsWith('zh') ? '管理' : 'Management'} />
          <Tab label={i18n.language.startsWith('zh') ? '运行态' : 'Runtime'} />
          <Tab label={i18n.language.startsWith('zh') ? '导演控制' : 'Director'} />
        </Tabs>

        {configTab === 0 ? (
          <Stack spacing={2}>
            <Card variant="outlined"><CardContent><TextField label={t('chat.name')} placeholder={t('chat.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} required fullWidth slotProps={{ input: { endAdornment: (<InputAdornment position="end"><IconButton color="primary" onClick={openHotDialog} edge="end" aria-label={i18n.language.startsWith('zh') ? '打开热点灵感' : 'Open topic inspiration'}><HotIcon /></IconButton></InputAdornment>) } }} /></CardContent></Card>
            <Card variant="outlined"><CardContent><TextField label={t('chat.topic')} placeholder={topicPlaceholder} value={topic} onChange={(e) => setTopic(e.target.value)} fullWidth multiline rows={2} /></CardContent></Card>
            <Card variant="outlined"><CardContent><Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}><Box><Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('chat.selectMembers')}</Typography><Typography variant="caption" color="text.secondary">{t('chat.membersHint')} ({selectedMembers.length}/{MAX_MEMBERS})</Typography></Box><IconButton color="primary" onClick={() => setMemberDialogOpen(true)}><AddIcon /></IconButton></Box>{selectedCharacters.length > 0 ? (<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{selectedCharacters.map((char) => (<Chip key={char.id} avatar={<Avatar src={isImageAvatar(char.avatar) ? char.avatar : undefined} sx={{ bgcolor: 'primary.light' }}>{isImageAvatar(char.avatar) ? undefined : char.avatar}</Avatar>} label={char.name} onDelete={() => toggleMember(char.id)} />))}</Box>) : (<Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, color: 'text.secondary' }}>{memberSummaryEmptyLabel}</Box>)}</CardContent></Card>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('chat.style')}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{CHAT_STYLE_OPTIONS.map((opt) => (<Button key={opt.value} variant={style === opt.value ? 'contained' : 'outlined'} onClick={() => setStyle(opt.value)} sx={{ borderRadius: 999 }}>{getStyleLabel(opt.value)}</Button>))}</Box></CardContent></Card>
            <Card variant="outlined"><CardContent><FormControlLabel control={<Switch checked={showRoleActions} onChange={(e) => setShowRoleActions(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '显示角色动作' : 'Show role actions'} /></CardContent></Card>
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
            <FormControlLabel control={<Switch checked={autoModeration} onChange={(e) => setAutoModeration(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '自动管理' : 'Auto moderation'} />
            <FormControlLabel control={<Switch checked={allowMute} onChange={(e) => setAllowMute(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许禁言' : 'Allow mute'} />
            <FormControlLabel control={<Switch checked={allowPrivateThreads} onChange={(e) => setAllowPrivateThreads(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许拉私聊' : 'Allow private threads'} />
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  {i18n.language.startsWith('zh') ? '戏剧规则' : 'Drama'}
                </Typography>
                <Box sx={{ display: 'grid', gap: 1 }}>
                  <FormControlLabel control={<Switch checked={allowCliques} onChange={(e) => setAllowCliques(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许小团体' : 'Allow cliques'} />
                  <FormControlLabel control={<Switch checked={allowMockery} onChange={(e) => setAllowMockery(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '允许公开嘲讽' : 'Allow mockery'} />
                </Box>
              </CardContent>
            </Card>
            {editingChat ? (
              <Card variant="outlined" sx={{ borderColor: 'error.light', bgcolor: 'rgba(211, 47, 47, 0.04)' }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: 'error.main' }}>
                    {i18n.language.startsWith('zh') ? '危险操作' : 'Danger zone'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {i18n.language.startsWith('zh') ? '可分别清理消息记录或会话级记忆，不删除群聊本身。' : 'You can clear messages or session memory separately without deleting the chat itself.'}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button color="error" variant="outlined" onClick={openClearMessagesDialog}>
                      {clearMessagesLabel}
                    </Button>
                    <Button color="error" variant="outlined" onClick={openClearMemoryDialog}>
                      {clearMemoryLabel}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ) : null}
          </Box>
        ) : null}

        {configTab === 3 ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{i18n.language.startsWith('zh') ? '变化强度' : 'Evolution intensity'}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}><Button variant={runtimeEvolutionIntensity === 'slow' ? 'contained' : 'outlined'} onClick={() => setRuntimeEvolutionIntensity('slow')} sx={{ borderRadius: 999 }}>{i18n.language.startsWith('zh') ? '慢' : 'Slow'}</Button><Button variant={runtimeEvolutionIntensity === 'balanced' ? 'contained' : 'outlined'} onClick={() => setRuntimeEvolutionIntensity('balanced')} sx={{ borderRadius: 999 }}>{i18n.language.startsWith('zh') ? '平衡' : 'Balanced'}</Button><Button variant={runtimeEvolutionIntensity === 'fast' ? 'contained' : 'outlined'} onClick={() => setRuntimeEvolutionIntensity('fast')} sx={{ borderRadius: 999 }}>{i18n.language.startsWith('zh') ? '快' : 'Fast'}</Button></Box><Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{i18n.language.startsWith('zh') ? '控制关系、情绪和人格漂移是快速显现，还是多轮对话后慢慢沉淀。' : 'Controls how quickly relationships, emotions, and drift become visible.'}</Typography></CardContent></Card>
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
                    <Avatar src={isImageAvatar(char.avatar) ? char.avatar : undefined} sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>{isImageAvatar(char.avatar) ? undefined : char.avatar}</Avatar>
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
                    <Avatar src={isImageAvatar(char.avatar) ? char.avatar : undefined} sx={{ width: 36, height: 36, fontSize: '1.1rem', bgcolor: 'primary.light' }}>{isImageAvatar(char.avatar) ? undefined : char.avatar}</Avatar>
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

      <Dialog open={clearMessagesConfirmOpen} onClose={closeClearMessagesDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{clearMessagesTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{clearMessagesConfirm}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeClearMessagesDialog}>{cancelLabel}</Button>
          <Button color="error" variant="contained" onClick={handleClearMessagesAction}>
            {clearMessagesLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={clearMemoryConfirmOpen} onClose={closeClearMemoryDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{clearMemoryTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{clearMemoryConfirm}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeClearMemoryDialog}>{cancelLabel}</Button>
          <Button color="error" variant="contained" onClick={handleClearMemoryAction}>
            {clearMemoryLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <HotTopicDialog
        {...hotDialogProps}
        getStyleLabel={getStyleLabel}
      />
    </Box>
  );
}
