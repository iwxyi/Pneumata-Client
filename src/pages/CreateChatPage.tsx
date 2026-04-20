import { useState, useEffect, useRef, useCallback } from 'react';
import { useLayoutHeaderActions } from '../components/layout/AppLayout';
import {
  Box, Typography, TextField, Button, IconButton,
  Checkbox, Avatar, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Divider,
  FormControlLabel, Switch, Snackbar, Alert, Tabs, Tab, MenuItem, Card, CardContent, Stack,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, AutoAwesome as AutoAwesomeIcon } from '@mui/icons-material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { ChatStyle } from '../types/chat';
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
  }, [chatDraftDefaults.showRoleActions, chatDraftDefaults.style, editingChat, id]);

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

  useEffect(() => {
    setHeaderTitle(headerTitle);
    setHeaderBackAction(() => () => navigate(-1));
  }, [headerTitle, navigate, setHeaderBackAction, setHeaderTitle]);

  useEffect(() => {
    setHeaderActions(
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {!editingChat ? (
          <Button variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => void handleAutofill()} disabled={!canAutofill}>
            {autofillLabel}
          </Button>
        ) : null}
        {editingChat ? (
          <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => setDeleteConfirmOpen(true)}>
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
        setChatDraftDefaults({ style, showRoleActions });
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
      setChatDraftDefaults({ style, showRoleActions });
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
        <Tabs value={configTab} onChange={(_, value) => setConfigTab(value)} variant="scrollable" allowScrollButtonsMobile>
          <Tab label={i18n.language.startsWith('zh') ? '设定' : 'Config'} />
          <Tab label={i18n.language.startsWith('zh') ? '治理' : 'Governance'} />
          <Tab label={i18n.language.startsWith('zh') ? '戏剧规则' : 'Drama'} />
          <Tab label={i18n.language.startsWith('zh') ? '运行态' : 'Runtime'} />
          <Tab label={i18n.language.startsWith('zh') ? '导演控制' : 'Director'} />
        </Tabs>

        {configTab === 0 ? (
          <Stack spacing={2}>
            <Card variant="outlined"><CardContent><TextField label={t('chat.name')} placeholder={t('chat.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} required fullWidth /></CardContent></Card>
            <Card variant="outlined"><CardContent><TextField label={t('chat.topic')} placeholder={i18n.language.startsWith('zh') ? '创建后由用户发送首条消息启动讨论，可先写简介或目标' : 'After creation the user starts discussion with the first message; use this for description or goal'} value={topic} onChange={(e) => setTopic(e.target.value)} fullWidth multiline rows={2} /></CardContent></Card>
            <Card variant="outlined"><CardContent><Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}><Box><Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('chat.selectMembers')}</Typography><Typography variant="caption" color="text.secondary">{t('chat.membersHint')} ({selectedMembers.length}/{MAX_MEMBERS})</Typography></Box><IconButton color="primary" onClick={() => setMemberDialogOpen(true)}><AddIcon /></IconButton></Box>{selectedCharacters.length > 0 ? (<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{selectedCharacters.map((char) => (<Chip key={char.id} avatar={<Avatar sx={{ bgcolor: 'primary.light' }}>{char.avatar}</Avatar>} label={char.name} onDelete={() => toggleMember(char.id)} />))}</Box>) : (<Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 3, color: 'text.secondary' }}>未选择AI角色</Box>)}</CardContent></Card>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('chat.style')}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{CHAT_STYLE_OPTIONS.map((opt) => (<Button key={opt.value} variant={style === opt.value ? 'contained' : 'outlined'} onClick={() => setStyle(opt.value)} sx={{ borderRadius: 999 }}>{getStyleLabel(opt.value)}</Button>))}</Box></CardContent></Card>
            <Card variant="outlined"><CardContent><FormControlLabel control={<Switch checked={showRoleActions} onChange={(e) => setShowRoleActions(e.target.checked)} />} label={i18n.language.startsWith('zh') ? '显示角色动作' : 'Show role actions'} /></CardContent></Card>
          </Stack>
        ) : null}

        {configTab === 3 ? (
          <Stack spacing={2}>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>群聊运行态</Typography><Stack spacing={1}><Typography variant="body2"><strong>阶段：</strong>{editingChat?.worldState.phase || 'idle'}</Typography><Typography variant="body2"><strong>气氛：</strong>{mood || '未设置'}</Typography><Typography variant="body2"><strong>焦点：</strong>{focus || '未设置'}</Typography><Typography variant="body2"><strong>最近事件：</strong>{recentEvent || '暂无'}</Typography></Stack></CardContent></Card>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>长期沉淀记忆</Typography><TextField value={runtimeNotesText} onChange={(e) => setRuntimeNotesText(e.target.value)} multiline rows={5} fullWidth placeholder="每行一条，例如：该群容易因技术路线分裂" /></CardContent></Card>
            <Card variant="outlined"><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>成果 / 产物</Typography><TextField value={runtimeArtifactsText} onChange={(e) => setRuntimeArtifactsText(e.target.value)} multiline rows={4} fullWidth placeholder="每行一条，例如：一份共识纪要 / 一张关系图" /></CardContent></Card>
            <ChatRuntimePanel chat={{ ...(editingChat || {}), id: editingChat?.id || 'draft', type: 'group', mode: 'open_chat', modeConfig: DEFAULT_OPEN_CHAT_MODE_CONFIG, modeState: DEFAULT_OPEN_CHAT_MODE_STATE, name: name || '未命名群聊', topic, style, memberIds: selectedMembers, speed: 1, isActive: false, allowIntervention: true, showRoleActions, topicSeed: '', sourceChatId: null, sourceMemberIds: [], runtimeNotes: runtimeNotesText.split('\n').map((item) => item.trim()).filter(Boolean), runtimeArtifacts: runtimeArtifactsText.split('\n').map((item) => item.trim()).filter(Boolean), runtimeTimeline: editingChat?.runtimeTimeline || [], governance: { ...DEFAULT_CONVERSATION_GOVERNANCE, ownerCharacterId: ownerCharacterId || null, adminCharacterIds, autoModeration, allowMute, allowPrivateThreads }, dramaRules: { ...DEFAULT_CONVERSATION_DRAMA_RULES, allowCliques, allowMockery }, worldState: { ...DEFAULT_CONVERSATION_WORLD_STATE, mood, focus, recentEvent }, directorControls: { ...DEFAULT_CONVERSATION_DIRECTOR_CONTROLS, allowSpeakAs, allowDirectorMode, allowEventInjection, allowForcedReply }, createdAt: editingChat?.createdAt || Date.now(), updatedAt: editingChat?.updatedAt || Date.now(), lastMessageAt: editingChat?.lastMessageAt || Date.now() }} members={selectedCharacters} />
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
              <MenuItem value="">{i18n.language.startsWith('zh') ? '未设置' : 'None'}</MenuItem>
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
              value={adminCharacterIds.length ? adminCharacterIds.map((memberId) => selectedCharacters.find((char) => char.id === memberId)?.name).filter(Boolean).join(', ') : (i18n.language.startsWith('zh') ? '未设置' : 'None')}
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
          onClick={() => void handleCreate()}
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
          {saving ? t('common.loading') : editingChat ? t('common.save') : '开始群聊'}
        </Button>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>

      <Dialog open={memberDialogOpen} onClose={() => setMemberDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('chat.selectMembers')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {hasCustomCharacters ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                {customCharacters.map((char) => (
                  <Box
                    key={char.id}
                    onClick={() => toggleMember(char.id)}
                    onPointerDown={() => startMemberLongPress(char.id)}
                    onPointerUp={clearMemberPressTimer}
                    onPointerLeave={clearMemberPressTimer}
                    onPointerCancel={clearMemberPressTimer}
                    onContextMenu={(e) => handleMemberItemContextMenu(e, char.id)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, borderRadius: 3, border: 1,
                      borderColor: selectedMembers.includes(char.id) ? 'primary.main' : 'divider',
                      bgcolor: selectedMembers.includes(char.id) ? 'primary.light' : 'background.paper',
                      cursor: 'pointer', transition: 'all 0.18s ease', '&:hover': { boxShadow: 1, borderColor: 'primary.main' },
                    }}
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
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                {presetCharacters.map((char) => (
                  <Box
                    key={char.id}
                    onClick={() => toggleMember(char.id)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, borderRadius: 3, border: 1,
                      borderColor: selectedMembers.includes(char.id) ? 'primary.main' : 'divider',
                      bgcolor: selectedMembers.includes(char.id) ? 'primary.light' : 'background.paper',
                      cursor: 'pointer', transition: 'all 0.18s ease', '&:hover': { boxShadow: 1, borderColor: 'primary.main' },
                    }}
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
          <Button onClick={() => {
            setMemberDialogOpen(false);
            if (selectedMembers.length < MIN_MEMBERS) {
              showError(i18n.language.startsWith('zh') ? `当前至少需要${MIN_MEMBERS}个AI成员才能开始群聊` : `At least ${MIN_MEMBERS} AI members are required to start the chat`);
            }
          }}>{t('common.confirm')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('chat.delete')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">{t('chat.deleteConfirm')}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              if (!editingChat) return;
              try {
                await deleteChat(editingChat.id);
                setDeleteConfirmOpen(false);
                navigate(-1);
              } catch (error) {
                showError(getActionErrorMessage(error, i18n.language.startsWith('zh') ? '删除群聊失败' : 'Failed to delete chat'));
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
