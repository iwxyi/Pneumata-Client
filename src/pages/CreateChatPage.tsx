import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  Snackbar, Alert, Tabs, Tab,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { getPreferredAIProfile } from '../types/settings';
import type { ChatStyle, RuntimeEvolutionIntensity } from '../types/chat';
import {
  DEFAULT_CONVERSATION_DIRECTOR_CONTROLS,
  DEFAULT_CONVERSATION_DRAMA_RULES,
  DEFAULT_CONVERSATION_GOVERNANCE,
  DEFAULT_CONVERSATION_WORLD_STATE,
  DEFAULT_OPEN_CHAT_MODE_STATE,
} from '../types/chat';
import { buildGroupChatDraft } from '../services/chatDraftBuilder';
import { api as apiClient } from '../services/api';
import { MIN_MEMBERS, MAX_MEMBERS } from '../constants/defaults';
import DirectorControlsSection from '../components/createChat/DirectorControlsSection';
import ChatConfigSection from '../components/createChat/ChatConfigSection';
import ManagementSection from '../components/createChat/ManagementSection';
import MemberSelectionDialog from '../components/createChat/MemberSelectionDialog';

const HotTopicDialogContainer = lazy(() => import('../components/createChat/HotTopicDialogContainer'));
const RuntimeSeedSection = lazy(() => import('../components/createChat/RuntimeSeedSection'));

export default function CreateChatPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction, setHideMobileBottomNav } = useLayoutHeaderActions();
  const { chats, addChat, updateChat, deleteChat, prefetchChats, markChatsWarm } = useChatStore();
  const { characters, addCharacters, prefetchCharacters, markCharactersWarm } = useCharacterStore();
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
  const [seedMemoryText, setSeedMemoryText] = useState('');
  const [seedArtifactText, setSeedArtifactText] = useState('');
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
  const [hotTopicOpenSignal, setHotTopicOpenSignal] = useState(0);
  const [hotTopicDialogEnabled, setHotTopicDialogEnabled] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const memberPressTimerRef = useRef<number | null>(null);

  const showRuntimeTab = Boolean(editingChat);
  const isZh = i18n.language.startsWith('zh');
  const conversationKind = editingChat?.type || 'group';
  const isGroupConversation = conversationKind === 'group';
  const showManagementTab = !editingChat || isGroupConversation;
  const showDirectorTab = !editingChat || isGroupConversation;
  const runtimeTabIndex = showManagementTab ? 2 : 1;
  const directorTabIndex = showRuntimeTab ? (showManagementTab ? 3 : 2) : 2;
  const conversationNoun = isZh
    ? (conversationKind === 'group' ? '群聊' : conversationKind === 'ai_direct' ? 'AI私聊' : '单聊')
    : (conversationKind === 'group' ? 'group chat' : conversationKind === 'ai_direct' ? 'AI direct chat' : 'direct chat');
  const minRequiredMembers = isGroupConversation ? MIN_MEMBERS : 1;
  const maxAllowedMembers = isGroupConversation ? MAX_MEMBERS : (conversationKind === 'ai_direct' ? 2 : 1);

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
    const { useMessageStore } = await import('../stores/useMessageStore');
    await useMessageStore.getState().addMessage({
      chatId,
      type: 'god',
      senderId: 'user',
      senderName: 'User',
      content: openingTopic,
      emotion: 0,
    });
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    markChatsWarm();
    markCharactersWarm();
    void prefetchChats();
    void prefetchCharacters();
  }, [markCharactersWarm, markChatsWarm, prefetchCharacters, prefetchChats]);

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
      setSeedMemoryText((editingChat.runtimeSeed?.notes || []).join('\n'));
      setSeedArtifactText((editingChat.runtimeSeed?.artifacts || []).join('\n'));
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
    setSeedMemoryText('');
    setSeedArtifactText('');
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
      if (prev.length >= maxAllowedMembers) {
        showError(isZh ? `当前${conversationNoun}最多选择${maxAllowedMembers}个AI角色` : `This ${conversationNoun} supports up to ${maxAllowedMembers} AI role(s)`);
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
      seedMemoryText,
      seedArtifactText,
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
      setSeedMemoryText(String(draft.seedMemoryText || draft.runtimeNotesText || ''));
      setSeedArtifactText(String(draft.seedArtifactText || draft.runtimeArtifactsText || ''));
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
    }
  }, [editingChat, location.search]);

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

  const customCharacters = characters.filter((char) => !char.isPreset);
  const presetCharacters = characters.filter((char) => char.isPreset);
  const selectedCharacters = characters.filter((char) => selectedMembers.includes(char.id));
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
      const { generateChatDraftSuggestion } = await import('../services/chatDraftGenerator');
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
      const { useMessageStore } = await import('../stores/useMessageStore');
      useMessageStore.getState().clearChatMessagesLocal(editingChat.id);
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
  }, [editingChat, i18n.language, seedOpeningTopicMessage]);

  const handleClearMemory = useCallback(async () => {
    if (!editingChat) return;
    try {
      await updateChat(editingChat.id, {
        isActive: false,
        modeState: {
          ...DEFAULT_OPEN_CHAT_MODE_STATE,
        },
        runtimeSeed: { notes: [], artifacts: [] },
        layeredMemories: [],
        runtimeTimeline: [],
        runtimeEventsV2: [],
        relationshipLedger: [],
        growthSnapshots: [],
        roleMemorySummaries: [],
        scenarioMemorySummary: { conversationId: editingChat.id, summary: '' },
        memoryLayerSummary: undefined,
        worldState: {
          ...DEFAULT_CONVERSATION_WORLD_STATE,
          phase: DEFAULT_CONVERSATION_WORLD_STATE.phase,
          recentEvent: '',
          conflictAxes: [],
          structuredRoomState: null,
          conflictState: null,
        },
      });
      await useChatStore.getState().loadChats();
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

  const headerTitle = editingChat ? (isZh ? `编辑${conversationNoun}` : `Edit ${conversationNoun}`) : t('chat.create');
  const autofillLabel = aiAutofilling ? t('common.loading') : (i18n.language.startsWith('zh') ? '自动补全' : 'Auto fill');
  const deleteLabel = t('common.delete');
  const closeMemberDialog = () => {
    setMemberDialogOpen(false);
  };
  const openDeleteDialog = useCallback(() => {
    setDeleteConfirmOpen(true);
  }, []);
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
  const openHotDialog = () => {
    setHotTopicDialogEnabled(true);
    setHotTopicOpenSignal((value) => value + 1);
  };
  const closeSnackbar = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };
  const handleTabChange = (_: unknown, value: number) => {
    setConfigTab(value);
  };
  const handleCreateAction = () => {
    void handleCreate();
  };
  const handleAutofillAction = useCallback(() => {
    void handleAutofill();
  }, [handleAutofill]);
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

  const memberSummaryEmptyLabel = isZh ? '未选择AI角色' : 'No AI roles selected';
  const memberDialogConfirmLabel = t('common.confirm');
  const startChatLabel = editingChat ? t('common.save') : '开始群聊';
  const runtimePhaseLabel = editingChat?.worldState.phase || 'idle';
  const runtimeMoodLabel = mood || '未设置';
  const runtimeFocusLabel = focus || '未设置';
  const runtimeRecentEventLabel = recentEvent || '暂无';
  const deleteChatTitle = t('chat.delete');
  const deleteChatConfirm = t('chat.deleteConfirm');
  const cancelLabel = t('common.cancel');
  const confirmDeleteLabel = t('common.delete');
  const clearMessagesTitle = isZh ? '清理聊天记录' : 'Clear chat messages';
  const clearMessagesConfirm = isZh ? `这会永久删除当前${conversationNoun}的全部消息记录，但保留关系、情绪、记忆和运行态。此操作无法撤销。` : `This permanently deletes all messages in this ${conversationNoun} while keeping relationships, emotions, memories, and runtime state. This action cannot be undone.`;
  const clearMessagesLabel = isZh ? '清理聊天记录' : 'Clear chat messages';
  const clearMemoryTitle = isZh ? '清理会话记忆' : 'Clear session memory';
  const clearMemoryConfirm = isZh ? `这会清除当前${conversationNoun}自身的运行态、事件、会话级记忆与摘要，但保留聊天记录，以及角色自身的成长与记忆。此操作无法撤销。` : `This clears session-level runtime state, events, and memory for this ${conversationNoun} while keeping message history and character growth. This action cannot be undone.`;
  const clearMemoryLabel = isZh ? '清理会话记忆' : 'Clear session memory';
  const noOwnerLabel = isZh ? '未设置' : 'None';
  const adminNotesValue = adminCharacterIds.length ? adminCharacterIds.map((memberId) => selectedCharacters.find((char) => char.id === memberId)?.name).filter(Boolean).join(', ') : noOwnerLabel;
  const topicPlaceholder = i18n.language.startsWith('zh') ? '创建后由用户发送首条消息启动讨论，可先写简介或目标' : 'After creation the user starts discussion with the first message; use this for description or goal';

  useEffect(() => {
    setHeaderTitle(headerTitle);
    setHeaderBackAction(() => () => navigate(-1));
    setHideMobileBottomNav(true);
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
  }, [autofillLabel, canAutofill, deleteLabel, editingChat, handleAutofillAction, headerTitle, navigate, openDeleteDialog, setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav]);

  useEffect(() => {
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHideMobileBottomNav(false);
      setHeaderActions(null);
    };
  }, [setHeaderActions, setHeaderBackAction, setHeaderTitle, setHideMobileBottomNav]);

  useEffect(() => {
    const availableTabs = [0]
      .concat(showManagementTab ? [1] : [])
      .concat(showRuntimeTab ? [runtimeTabIndex] : [])
      .concat(showDirectorTab ? [directorTabIndex] : []);
    if (!availableTabs.includes(configTab)) {
      setConfigTab(availableTabs[0] || 0);
    }
  }, [configTab, directorTabIndex, runtimeTabIndex, showDirectorTab, showManagementTab, showRuntimeTab]);

  const desktopHeaderActions = null;
  void desktopHeaderActions;

  void goBack;
  void t;

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
    if (validMemberIds.length < minRequiredMembers) {
      showError(isZh ? `当前${conversationNoun}至少需要${minRequiredMembers}个AI角色` : `This ${conversationNoun} needs at least ${minRequiredMembers} AI role(s)`);
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
          runtimeSeed: {
            notes: seedMemoryText.split('\n').map((item) => item.trim()).filter(Boolean),
            artifacts: seedArtifactText.split('\n').map((item) => item.trim()).filter(Boolean),
          },
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

      const chat = await addChat(buildGroupChatDraft({
        type: 'group',
        name,
        topic,
        style,
        runtimeEvolutionIntensity,
        memberIds: validMemberIds,
        showRoleActions,
        seedMemoryText,
        seedArtifactText,
        ownerCharacterId: normalizedOwnerCharacterId,
        adminCharacterIds: normalizedAdminCharacterIds,
        autoModeration,
        allowMute,
        allowPrivateThreads,
        allowCliques,
        allowMockery,
        mood,
        focus,
        recentEvent,
        allowSpeakAs,
        allowDirectorMode,
        allowEventInjection,
        allowForcedReply,
      }));
      await seedOpeningTopicMessage(chat.id, topic);
      sessionStorage.removeItem('miragetea-create-chat-draft');
      setChatDraftDefaults({ style, showRoleActions, runtimeEvolutionIntensity });
      navigate(`/chats/${chat.id}`);
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
          <Tab value={0} label={i18n.language.startsWith('zh') ? '设定' : 'Config'} />
          {showManagementTab ? <Tab value={1} label={i18n.language.startsWith('zh') ? '管理' : 'Management'} /> : null}
          {showRuntimeTab ? <Tab value={runtimeTabIndex} label={i18n.language.startsWith('zh') ? '运行态' : 'Runtime'} /> : null}
          {showDirectorTab ? <Tab value={directorTabIndex} label={i18n.language.startsWith('zh') ? '导演控制' : 'Director'} /> : null}
        </Tabs>

        {configTab === 0 ? (
          <ChatConfigSection
            lockMembers={Boolean(editingChat && !isGroupConversation)}
            showMembers={Boolean(!editingChat || isGroupConversation)}
            maxMembers={maxAllowedMembers}
            name={name}
            topic={topic}
            style={style}
            showRoleActions={showRoleActions}
            selectedMembers={selectedMembers}
            selectedCharacters={selectedCharacters}
            language={i18n.language}
            memberSummaryEmptyLabel={memberSummaryEmptyLabel}
            topicPlaceholder={topicPlaceholder}
            getStyleLabel={getStyleLabel}
            onNameChange={setName}
            onTopicChange={setTopic}
            onStyleChange={setStyle}
            onShowRoleActionsChange={setShowRoleActions}
            onOpenMemberDialog={() => setMemberDialogOpen(true)}
            onOpenHotDialog={openHotDialog}
            onToggleMember={toggleMember}
            nameLabel={t('chat.name')}
            namePlaceholder={t('chat.namePlaceholder')}
            topicLabel={t('chat.topic')}
            selectMembersLabel={isGroupConversation ? t('chat.selectMembers') : (isZh ? '选择角色' : 'Select role')}
            membersHintLabel={isGroupConversation ? t('chat.membersHint') : (isZh ? `${conversationNoun}中的AI角色` : `AI roles in this ${conversationNoun}`)}
            styleLabel={t('chat.style')}
            showRoleActionsLabel={i18n.language.startsWith('zh') ? '显示角色动作' : 'Show role actions'}
            openTopicInspirationLabel={i18n.language.startsWith('zh') ? '打开热点灵感' : 'Open topic inspiration'}
          />
        ) : null}

        {showManagementTab && configTab === 1 ? (
          <ManagementSection
            selectedCharacters={selectedCharacters}
            ownerCharacterId={ownerCharacterId}
            adminCharacterIds={adminCharacterIds}
            noOwnerLabel={noOwnerLabel}
            adminNotesValue={adminNotesValue}
            autoModeration={autoModeration}
            allowMute={allowMute}
            allowPrivateThreads={allowPrivateThreads}
            allowCliques={allowCliques}
            allowMockery={allowMockery}
            editingChat={Boolean(editingChat)}
            conversationKind={conversationKind}
            conversationNoun={conversationNoun}
            language={i18n.language}
            clearMessagesLabel={clearMessagesLabel}
            clearMemoryLabel={clearMemoryLabel}
            onOwnerChange={setOwnerCharacterId}
            onAdminChange={setAdminCharacterIds}
            onAutoModerationChange={setAutoModeration}
            onAllowMuteChange={setAllowMute}
            onAllowPrivateThreadsChange={setAllowPrivateThreads}
            onAllowCliquesChange={setAllowCliques}
            onAllowMockeryChange={setAllowMockery}
            onOpenClearMessagesDialog={openClearMessagesDialog}
            onOpenClearMemoryDialog={openClearMemoryDialog}
          />
        ) : null}

        {showRuntimeTab && configTab === runtimeTabIndex ? (
          <Suspense fallback={null}>
            <RuntimeSeedSection
              editingChatId={editingChat?.id}
              editingChatCreatedAt={editingChat?.createdAt}
              editingChatUpdatedAt={editingChat?.updatedAt}
              editingChatLastMessageAt={editingChat?.lastMessageAt}
              editingChatTimeline={editingChat?.runtimeTimeline}
              name={name}
              topic={topic}
              style={style}
              runtimeEvolutionIntensity={runtimeEvolutionIntensity}
              selectedMembers={selectedMembers}
              showRoleActions={showRoleActions}
              ownerCharacterId={ownerCharacterId}
              adminCharacterIds={adminCharacterIds}
              autoModeration={autoModeration}
              allowMute={allowMute}
              allowPrivateThreads={allowPrivateThreads}
              allowCliques={allowCliques}
              allowMockery={allowMockery}
              mood={mood}
              focus={focus}
              recentEvent={recentEvent}
              allowSpeakAs={allowSpeakAs}
              allowDirectorMode={allowDirectorMode}
              allowEventInjection={allowEventInjection}
              allowForcedReply={allowForcedReply}
              seedMemoryText={seedMemoryText}
              seedArtifactText={seedArtifactText}
              setSeedMemoryText={setSeedMemoryText}
              setSeedArtifactText={setSeedArtifactText}
              runtimePhaseLabel={runtimePhaseLabel}
              runtimeMoodLabel={runtimeMoodLabel}
              runtimeFocusLabel={runtimeFocusLabel}
              runtimeRecentEventLabel={runtimeRecentEventLabel}
              selectedCharacters={selectedCharacters}
            />
          </Suspense>
        ) : null}

        {showDirectorTab && configTab === directorTabIndex ? (
          <DirectorControlsSection
            runtimeEvolutionIntensity={runtimeEvolutionIntensity}
            setRuntimeEvolutionIntensity={setRuntimeEvolutionIntensity}
            allowSpeakAs={allowSpeakAs}
            setAllowSpeakAs={setAllowSpeakAs}
            allowDirectorMode={allowDirectorMode}
            setAllowDirectorMode={setAllowDirectorMode}
            allowEventInjection={allowEventInjection}
            setAllowEventInjection={setAllowEventInjection}
            allowForcedReply={allowForcedReply}
            setAllowForcedReply={setAllowForcedReply}
          />
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

      <MemberSelectionDialog
        open={memberDialogOpen}
        onClose={closeMemberDialog}
        customCharacters={customCharacters}
        presetCharacters={presetCharacters}
        selectedMembers={selectedMembers}
        hasCustomCharacters={hasCustomCharacters}
        hasPresetCharacters={hasPresetCharacters}
        selectedMemberGridSx={selectedMemberGridSx}
        memberOptionSx={memberOptionSx}
        title={t('chat.selectMembers')}
        presetLabel="Preset"
        confirmLabel={memberDialogConfirmLabel}
        onConfirm={confirmMemberDialog}
        onToggleMember={toggleMember}
        onStartLongPress={startMemberLongPress}
        onClearPressTimer={clearMemberPressTimer}
        onContextMenu={handleMemberItemContextMenu}
      />

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

      {hotTopicDialogEnabled ? (
        <Suspense fallback={null}>
          <HotTopicDialogContainer
            openSignal={hotTopicOpenSignal}
            language={i18n.language}
            apiConfig={api}
            aiProfiles={aiProfiles}
            autoGenerateCharacterAvatar={useSettingsStore.getState().avatarGeneration.autoGenerateCharacterAvatar}
            characters={characters}
            name={name}
            topic={topic}
            setName={setName}
            setTopic={setTopic}
            setStyle={setStyle}
            setSelectedMembers={setSelectedMembers}
            addCharacters={addCharacters}
            maxMembers={MAX_MEMBERS}
            onError={showError}
            setSnackbar={setSnackbar}
            getStyleLabel={getStyleLabel}
          />
        </Suspense>
      ) : null}
    </Box>
  );
}
