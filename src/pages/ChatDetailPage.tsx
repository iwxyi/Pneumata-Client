import { lazy, Suspense, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Box, IconButton, Button, Typography, Switch, Stack, TextField, Chip, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Slider, FormControl, InputLabel, Select, MenuItem, Divider, FormControlLabel, Checkbox, CircularProgress } from '@mui/material';
import PageSection from '../components/common/PageSection';
import AppSnackbar from '../components/common/AppSnackbar';
import LoadingState from '../components/common/LoadingState';
import PeopleIcon from '@mui/icons-material/People';
import InfoIcon from '@mui/icons-material/Info';
import PlayIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SettingsIcon from '@mui/icons-material/Settings';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useSchedulerStore } from '../stores/useSchedulerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUIStore } from '../stores/useUIStore';
import { type DriverMessageCommitResult, type GroupChat, type MessageBranchState, type StoryChapterState } from '../types/chat';
import MessageList, { type MessageListScrollPosition, type MessageListScrollRequest } from '../components/chat/MessageList';
import type { NarrativeStoryChoiceOption } from '../components/chat/messageBubblePresentation';
import SessionComposerHost from '../components/session/SessionComposerHost';
import RightPanel from '../components/layout/RightPanel';
import GlassHeader from '../components/layout/GlassHeader';
import { buildRuntimeEventMessageContent, normalizeRuntimeEvent } from '../services/runtimeEventFactory';
import { persistLocalFirstMessage, persistLocalFirstMessages } from '../services/chatCommitMessage';
import { buildPrivateSessionEvent } from '../services/directSessionHelpers';
import { resolveCharacterOrDeleted } from '../utils/deletedEntity';
import type { Message, MessageAttachment } from '../types/message';
import type { AICharacter } from '../types/character';
import { buildExpressionFeedbackPatch, getExpressionFeedbackLabel, type ExpressionFeedbackKind } from '../services/characterExpressionFeedback';
import { useAuthStore } from '../stores/useAuthStore';
import { useManualInputQueue } from '../hooks/useManualInputQueue';
import { useStreamingMessageState } from '../hooks/useStreamingMessageState';
import { getConversationLoopStartBlockReason, useChatRunLoop } from '../hooks/useChatRunLoop';
import { useChatSidebarProjection } from '../hooks/useChatSidebarProjection';
import { useMessageAnalysis } from '../hooks/useMessageAnalysis';
import { useChatSurfaceActions } from '../hooks/useChatSurfaceActions';
import { useChatAutoSocialFlow } from '../hooks/useChatAutoSocialFlow';
import { getSyncableCharacterMemberIds } from '../services/pageSyncScopeContract';
import SessionInfoCards from '../components/chat/SessionInfoCards';
import { projectSessionInfoCards } from '../services/sessionInfoProjection';
import { useResponsive } from '../hooks/useResponsive';
import type { UserDraftActivity } from '../services/userInputBuffer';
import { usePaneLayout } from '../components/layout/PaneLayoutContext';
import type { LocalInterceptionEvent } from '../services/chatEngine';
import { api, type ChatShareState } from '../services/api';
import { copyTextToClipboard } from '../utils/clipboard';
import { getInputCapabilityWarning, getUsablePreferredAIProfile, resolveAIModelInputCapabilities } from '../types/settings';
import { logDeveloperDiagnostic } from '../services/developerDiagnostics';
import { isGenerationCancelledError } from '../services/generationCancellation';
import { buildStoryBranchOptions, getStoryChoiceGateState, normalizeStoryChoiceSuggestions, resolveStoryReaderRole, sanitizeStoryChoicePrompt } from '../services/storyChoices';
import { resolveSessionScrollCapabilities } from '../services/sessionScrollCapabilities';
import { messagesShareIdentity } from '../services/messageIdentity';
import { buildStoryRoomOpeningPreview, type StoryRoomOpeningPreview } from '../services/storyRoomOpeningPreview';
import { prefersReducedMotion } from '../styles/motion';
import type { StoryReaderRole } from '../types/chat';
import { attachMessageToActiveBranch, buildMessageBranchVersionInfoByMessageId, createMessageRevisionDraft, getBranchRevisionGroup, getMessageBranchVersionInfo, isMessageBranchingEnabled, projectActiveBranchMessages, resolveMessageBranchNodes } from '../services/messageBranching';
import { projectMergedChatMessages } from '../services/currentChatMessages';

const ChatSidebarPanel = lazy(() => import('../components/chat/ChatSidebarPanel'));
const SessionActionPanel = lazy(() => import('../components/session/SessionActionPanel'));
const MessageAnalysisDialog = lazy(() => import('../components/chat/MessageAnalysisDialog').then((module) => ({ default: module.MessageAnalysisDialog })));
const ProfilePreviewOverlay = lazy(() => import('../components/chat/ProfilePreviewOverlay'));
const WorldCalendarPanel = lazy(() => import('../components/calendar/WorldCalendarPanel'));
const CHAT_MESSAGE_WINDOW_SIZE = 40;
const STORY_CHOICE_COLLAPSE_MS = 420;
const STORY_READING_POSITION_SAVE_MS = 700;

type ProfilePreviewState =
  | { kind: 'character'; anchorRect: DOMRect; anchorElement: HTMLElement; character: AICharacter }
  | { kind: 'chat'; anchorRect: DOMRect; anchorElement: HTMLElement };
type PendingStoryChoiceVisual = {
  key: string;
  sourceMessageId: string;
  selectedValue: string;
  options: NarrativeStoryChoiceOption[];
};

function getMessageListElementScrollTimestamp(element: HTMLElement) {
  const raw = element.dataset.scrollTimestamp || element.closest<HTMLElement>('[data-scroll-timestamp]')?.dataset.scrollTimestamp;
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function getMessageListElementScrollAnchor(element: HTMLElement) {
  return element.dataset.scrollAnchor || element.dataset.messageId || '';
}

function captureMessageListScrollRequest(keyPrefix: string, preferredMessageId?: string): MessageListScrollRequest | null {
  const container = document.querySelector<HTMLElement>('[data-chat-message-list]');
  if (!container) return null;
  const containerRect = container.getBoundingClientRect();
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-message-id]'));
  if (!nodes.length) return null;
  const preferredNode = preferredMessageId
    ? nodes.find((node) => getMessageListElementScrollAnchor(node) === preferredMessageId)
    : null;
  const visibleNodes = preferredNode ? [] : nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > containerRect.top + 1 && rect.top < containerRect.bottom - 1;
  });
  const candidates = visibleNodes.length ? visibleNodes : nodes;
  const targetLine = preferredNode
    ? preferredNode.getBoundingClientRect().top
    : containerRect.top + containerRect.height * 0.42;
  const anchorNode = preferredNode || candidates
    .map((node) => ({ node, distance: Math.abs(node.getBoundingClientRect().top - targetLine) }))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  const messageId = anchorNode ? getMessageListElementScrollAnchor(anchorNode) : '';
  if (!anchorNode || !messageId) return null;
  return {
    key: `${keyPrefix}:${messageId}:${Date.now()}`,
    messageId,
    offsetTop: anchorNode.getBoundingClientRect().top - containerRect.top,
    sourceTimestamp: getMessageListElementScrollTimestamp(anchorNode),
    behavior: 'auto',
  };
}

function PanelFallback() {
  return null;
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function LazyPanel({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PanelFallback />}>{children}</Suspense>;
}

function ChatPageSettingsDialog({ open, onClose, isStoryRoom }: { open: boolean; onClose: () => void; isStoryRoom: boolean }) {
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const setChatAppearance = useSettingsStore((state) => state.setChatAppearance);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>聊天页设置</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 0.5 }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>页面最大宽度</Typography>
            <Slider
              value={chatAppearance.maxContentWidth}
              min={560}
              max={1080}
              step={20}
              valueLabelDisplay="auto"
              disabled={chatAppearance.maxContentWidthUnlimited}
              onChange={(_, value) => setChatAppearance({ maxContentWidth: Array.isArray(value) ? value[0] : value })}
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={chatAppearance.maxContentWidthUnlimited}
                  onChange={(event) => setChatAppearance({ maxContentWidthUnlimited: event.target.checked })}
                />
              )}
              label="不限宽"
              sx={{ mt: 0.25 }}
            />
            <Typography variant="caption" color="text.secondary">
              控制聊天气泡、发送者提示、旁白和选项卡片的最大内容宽度。
            </Typography>
          </Box>

          {isStoryRoom ? (
            <>
              <Divider />
              <Typography variant="body2" sx={{ fontWeight: 800 }}>故事房正文</Typography>
              <FormControl size="small" fullWidth>
                <InputLabel id="story-reader-font-family-label">正文字体</InputLabel>
                <Select
                  labelId="story-reader-font-family-label"
                  label="正文字体"
                  value={chatAppearance.storyReader.fontFamily}
                  onChange={(event) => setChatAppearance({ storyReader: { ...chatAppearance.storyReader, fontFamily: event.target.value as typeof chatAppearance.storyReader.fontFamily } })}
                >
                  <MenuItem value="default">跟随系统</MenuItem>
                  <MenuItem value="serif">故事衬线</MenuItem>
                  <MenuItem value="sans">清爽无衬线</MenuItem>
                </Select>
              </FormControl>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>文字大小</Typography>
                <Slider
                  value={chatAppearance.storyReader.fontSize}
                  min={14}
                  max={22}
                  step={1}
                  valueLabelDisplay="auto"
                  onChange={(_, value) => setChatAppearance({ storyReader: { ...chatAppearance.storyReader, fontSize: Array.isArray(value) ? value[0] : value } })}
                />
              </Box>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>行间距</Typography>
                <Slider
                  value={chatAppearance.storyReader.lineHeight}
                  min={1.55}
                  max={2.45}
                  step={0.05}
                  valueLabelDisplay="auto"
                  onChange={(_, value) => setChatAppearance({ storyReader: { ...chatAppearance.storyReader, lineHeight: Array.isArray(value) ? value[0] : value } })}
                />
              </Box>
              <FormControl size="small" fullWidth>
                <InputLabel id="story-reader-reveal-mode-label">节点出现方式</InputLabel>
                <Select
                  labelId="story-reader-reveal-mode-label"
                  label="节点出现方式"
                  value={chatAppearance.storyReader.revealMode}
                  onChange={(event) => setChatAppearance({ storyReader: { ...chatAppearance.storyReader, revealMode: event.target.value as typeof chatAppearance.storyReader.revealMode } })}
                >
                  <MenuItem value="fade">整节淡入</MenuItem>
                  <MenuItem value="instant">立即显示</MenuItem>
                </Select>
              </FormControl>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

export function buildStoryChoicePendingKey(params: {
  chatId: string;
  choiceEpoch?: number | null;
  sourceMessageId?: string | null;
}) {
  return `${params.chatId}:${params.choiceEpoch || 0}:${params.sourceMessageId || ''}`;
}

export function isStoryChoicePending(params: {
  pendingKey: string | null;
  chatId: string | null | undefined;
  choiceEpoch?: number | null;
  sourceMessageId?: string | null;
}) {
  if (!params.pendingKey || !params.chatId) return false;
  return params.pendingKey === buildStoryChoicePendingKey({
    chatId: params.chatId,
    choiceEpoch: params.choiceEpoch,
    sourceMessageId: params.sourceMessageId,
  });
}

export function getStoryTailStatus(params: {
  hasRunLoopStatus: boolean;
  isStoryChoiceSubmitting: boolean;
  isGeneratingStoryNode?: boolean;
  isWaitingForReaderTail?: boolean;
  isGenerationCancelled?: boolean;
}) {
  if (params.hasRunLoopStatus) return 'status' as const;
  if (params.isStoryChoiceSubmitting) return 'submitting_choice' as const;
  if (params.isGeneratingStoryNode) return 'generating_node' as const;
  if (params.isGenerationCancelled) return 'generation_cancelled' as const;
  if (params.isWaitingForReaderTail) return 'waiting_reader_tail' as const;
  return null;
}

export function shouldAutoStartStoryRoom(params: {
  hasChat: boolean;
  hasChatId: boolean;
  canAutoRunConversation: boolean;
  isStoryRoom: boolean;
  isStoryReaderAtTail: boolean;
  isRunning: boolean;
  isPaused: boolean;
  isStoryWaitingForChoice: boolean;
  isStoryChoiceSubmitting: boolean;
  hasUserDraft?: boolean;
  hasRunLoopError: boolean;
  canAutoContinueFromTail?: boolean;
}) {
  return params.hasChat
    && params.hasChatId
    && params.canAutoRunConversation
    && params.isStoryRoom
    && params.isStoryReaderAtTail
    && !params.isRunning
    && !params.isPaused
    && !params.isStoryWaitingForChoice
    && !params.isStoryChoiceSubmitting
    && !params.hasUserDraft
    && !params.hasRunLoopError
    && params.canAutoContinueFromTail !== false;
}

export function resolveEffectiveStoryReaderAtTail(params: {
  isStoryReaderAtTail: boolean;
  hasSavedNonTailStoryReadingPosition: boolean;
  hasStoryReaderReachedTailIntent: boolean;
}) {
  if (params.hasSavedNonTailStoryReadingPosition && !params.hasStoryReaderReachedTailIntent) return false;
  return params.isStoryReaderAtTail;
}

function getNarrativeRevealIdentityKeys(message: Message) {
  if (message.type !== 'ai' || !message.metadata?.narrativeTurn) return [];
  return [message.id, message.clientKey, message.serverId].filter((key): key is string => Boolean(key));
}

export function shouldRegisterLiveNarrativeReveal(message: Message) {
  const revealKeys = getNarrativeRevealIdentityKeys(message);
  if (!revealKeys.length) return false;
  const state = useMessageStore.getState();
  const currentMessages = state.messageWindowsByChatId[message.chatId]?.messages || state.messages.filter((item) => item.chatId === message.chatId);
  const existing = currentMessages.find((item) => messagesShareIdentity(item, message));
  if (existing?.isStreaming) return true;
  if (existing) return false;
  const latestHistoricalTimestamp = currentMessages
    .reduce((latest, item) => Math.max(latest, Number(item.timestamp || 0)), 0);
  return Number(message.timestamp || 0) > latestHistoricalTimestamp;
}

export function findVisibleStoryChoiceSourceMessage(params: {
  isStoryRoom: boolean;
  phase?: string | null;
  messages: Message[];
}) {
  if (!params.isStoryRoom || params.phase !== 'choice') return null;
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (normalizeStoryChoiceSuggestions(message.metadata?.storyChoices).length < 2) continue;
    return message;
  }
  return null;
}

export function buildVisibleStoryBranchOptions(params: {
  isStoryRoom: boolean;
  chat?: GroupChat | null;
  sourceMessage?: Message | null;
}) {
  const sourceMessage = params.sourceMessage;
  if (!params.isStoryRoom || params.chat?.scenarioState?.phase !== 'choice' || !sourceMessage) return [];
  const storyChoices = normalizeStoryChoiceSuggestions(sourceMessage.metadata?.storyChoices);
  if (storyChoices.length < 2) return [];
  return buildStoryBranchOptions({
    storyChoices,
    branches: params.chat.scenarioState?.branches,
    choiceEpoch: params.chat.scenarioState?.choiceEpoch,
    sourceId: sourceMessage.id,
  });
}

export function shouldRouteTextAsStoryCustomDirection(params: {
  isStoryRoom: boolean;
  hasSpeakAsCharacter: boolean;
  hasGuideTargetMember: boolean;
  content: string;
}) {
  return params.isStoryRoom
    && !params.hasSpeakAsCharacter
    && !params.hasGuideTargetMember
    && Boolean(params.content.trim());
}

export function getStoryReaderComposerPlaceholder(readerRole: StoryReaderRole = 'director') {
  return readerRole === 'participant' ? '写我的行动' : '安排剧情';
}

export function buildStoryReaderTextInputCapabilities<T extends { imageInput?: boolean; multiImageInput?: boolean; fileInput?: boolean }>(capabilities: T): T {
  return {
    ...capabilities,
    imageInput: false,
    multiImageInput: false,
    fileInput: false,
  };
}

function StoryRoomOpeningEmptyState({ preview }: { preview: StoryRoomOpeningPreview }) {
  const chatAppearance = useSettingsStore((state) => state.chatAppearance);
  const maxContentWidth = chatAppearance.maxContentWidthUnlimited ? '100%' : chatAppearance.maxContentWidth;
  return (
    <Box data-testid="story-room-opening-empty-state" sx={{ width: '100%', px: { xs: 2, sm: 3 }, py: { xs: 3, sm: 4 } }}>
      <Box
        sx={(theme) => ({
          width: '100%',
          maxWidth: maxContentWidth,
          mx: 'auto',
          borderRadius: 3,
          border: '1px solid',
          borderColor: theme.palette.mode === 'light' ? 'rgba(148,163,184,0.26)' : 'rgba(226,232,240,0.14)',
          bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(15,23,42,0.58)',
          boxShadow: theme.palette.mode === 'light' ? '0 16px 44px rgba(15,23,42,0.08)' : '0 18px 48px rgba(0,0,0,0.22)',
          backdropFilter: 'blur(18px)',
          p: { xs: 2, sm: 2.4 },
        })}
      >
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
              故事即将开始
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.35 }}>
              {preview.title}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.4 }}>
              当前目标
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>
              {preview.goal}
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.4 }}>
              开场处境
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>
              {preview.scene}
            </Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 1.2 }}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.4 }}>
                第一章目标
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>
                {preview.firstChapterGoal}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.4 }}>
                参与感
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>
                {preview.readerPromise}
              </Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', pt: 0.25 }}>
            {preview.items.map((item) => (
              <Chip
                key={`${item.label}:${item.text}`}
                size="small"
                label={`${item.label}：${item.text}`}
                variant="outlined"
                sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              />
            ))}
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}

function ChatSharePanel({ chat }: { chat: GroupChat }) {
  const [state, setState] = useState<ChatShareState>(() => ({
    enabled: Boolean(chat.shareEnabled),
    token: chat.shareToken || null,
    viewerCount: chat.shareViewerCount || 0,
  }));
  const [loading, setLoading] = useState(false);
  const [copyText, setCopyText] = useState('');
  const [error, setError] = useState('');
  const shareUrl = state.token && typeof window !== 'undefined'
    ? `${window.location.origin}/shared/${state.token}`
    : '';

  useEffect(() => {
    let cancelled = false;
    setError('');
    void api.getChatShareState(chat.id)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [chat.id]);

  const toggle = async (enabled: boolean) => {
    setLoading(true);
    setError('');
    setCopyText('');
    try {
      setState(await api.updateChatShareState(chat.id, enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    const copied = await copyTextToClipboard(shareUrl);
    setCopyText(copied ? '已复制' : '复制失败，请手动复制');
  };

  if (chat.type !== 'group') return null;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25, display: 'grid', gap: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>分享聊天记录</Typography>
          <Typography variant="caption" color="text.secondary">匿名只读访问，只显示群聊名称和聊天内容</Typography>
        </Box>
        <Switch checked={state.enabled} disabled={loading} onChange={(event) => void toggle(event.target.checked)} />
      </Stack>
      {error ? <Alert severity="error" sx={{ py: 0 }}>{error}</Alert> : null}
      {state.enabled && shareUrl ? (
        <Stack spacing={1}>
          <TextField
            size="small"
            value={shareUrl}
            fullWidth
            slotProps={{ input: { readOnly: true } }}
          />
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={copy}>复制链接</Button>
            <Chip size="small" variant="outlined" label={`访问人数 ${state.viewerCount}`} />
            {copyText ? <Typography variant="caption" color="text.secondary">{copyText}</Typography> : null}
          </Stack>
        </Stack>
      ) : null}
    </Box>
  );
}

function localizeLocalInterceptionReason(reason: string) {
  const normalized = reason.trim();
  const exact: Record<string, string> = {
    empty_content: '生成内容为空或不可见',
    missing_requested_image: '没有完成图片请求',
    missing_requested_subject: '图片对象没有对准',
    missing_topic_focus: '偏离了当前话题',
    missing_question_answer: '没有回答当前问题',
    missing_direct_reply_focus: '没有先回应点名要求',
    no_media_capability: '当前模型能力不足',
    message_withdrawn: '角色内在冲动触发撤回',
  };
  if (exact[normalized]) return exact[normalized];
  if (/exactly repeats/i.test(normalized)) return '完全复用了近期发言';
  if (/substring/i.test(normalized)) return '截取了近期发言的一部分';
  if (/copies a recent line/i.test(normalized)) return '复制了近期发言';
  if (/too close/i.test(normalized) || /surface overlap/i.test(normalized)) return '与近期措辞过于接近';
  if (/opening pattern/i.test(normalized)) return '复用了房间里的高频开头';
  if (/emoji|sticker/i.test(normalized)) return '复用了近期高频表情或贴纸标记';
  return normalized || '本地规则判定不应直接发出';
}

function compactInterceptedDraft(draft: string | undefined) {
  const normalized = (draft || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '（无可展示草稿）';
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function buildLocalInterceptionSummary(event: LocalInterceptionEvent) {
  return `拦截了${event.speakerName || '角色'}的发言：${compactInterceptedDraft(event.draft)}（原因：${localizeLocalInterceptionReason(event.reason)}）`;
}

type SidebarTabValue = 'members' | 'narrative' | 'chapters' | 'clues' | 'roles' | 'world' | 'developer' | 'activities';
const EMPTY_MESSAGES: never[] = [];

function buildBranchTopologySignature(messages: Message[]) {
  return messages.map((message) => {
    const branching = message.metadata?.branching;
    return [
      message.id,
      message.clientKey || '',
      message.serverId || '',
      message.isDeleted ? 1 : 0,
      branching?.nodeId || '',
      branching?.parentNodeId ?? '',
      branching?.revisionRootId || '',
      branching?.revisionOfMessageId || '',
    ].join(':');
  }).join('|');
}

function buildVisibleMessageIdSignature(messages: Message[]) {
  return messages.map((message) => message.id).join('|');
}

export default function ChatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const { isMobile, isDesktop } = useResponsive();
  const pane = usePaneLayout();
  const isSplitDetailPane = pane.role === 'detail';
  const { setHideMobileBottomNav } = useLayoutHeaderActions();

  const chats = useChatStore((state) => state.chats);
  const updateChat = useChatStore((state) => state.updateChat);
  const applyChatRuntimeDelta = useChatStore((state) => state.applyChatRuntimeDelta);
  const loadChat = useChatStore((state) => state.loadChat);
  const restoreLocalChats = useChatStore((state) => state.restoreLocalChats);
  const markChatsWarm = useChatStore((state) => state.markChatsWarm);
  const chatsLoading = useChatStore((state) => state.isLoading);
  const remoteDeletedChatIds = useChatStore((state) => state.remoteDeletedChatIds);
  const remoteDeletedChats = useChatStore((state) => state.remoteDeletedChats);
  const characters = useCharacterStore((state) => state.characters);
  const updateCharacter = useCharacterStore((state) => state.updateCharacter);
  const updateCharacters = useCharacterStore((state) => state.updateCharacters);
  const loadCharacter = useCharacterStore((state) => state.loadCharacter);
  const markCharactersWarm = useCharacterStore((state) => state.markCharactersWarm);
  const messages = useMessageStore(useShallow((state) => (
    id ? state.messages.filter((message) => message.chatId === id) : EMPTY_MESSAGES
  )));
  const rawCurrentMessageWindow = useMessageStore((state) => (id ? state.messageWindowsByChatId[id] : undefined));
  const hydrateMessagesFromCache = useMessageStore((state) => state.hydrateMessagesFromCache);
  const openChatWindow = useMessageStore((state) => state.openChatWindow);
  const closeChatWindow = useMessageStore((state) => state.closeChatWindow);
  const loadMessages = useMessageStore((state) => state.loadMessages);
  const addMessage = useMessageStore((state) => state.addMessage);
  const upsertMessage = useMessageStore((state) => state.upsertMessage);
  const upsertMessages = useMessageStore((state) => state.upsertMessages);
  const deleteMessage = useMessageStore((state) => state.deleteMessage);
  const hasMore = useMessageStore((state) => state.hasMore);
  const hasMoreNewer = useMessageStore((state) => state.hasMoreNewer);
  const isLoading = useMessageStore((state) => state.isLoading);
  const isLoadingOlder = useMessageStore((state) => state.isLoadingOlder);
  const isLoadingNewer = useMessageStore((state) => state.isLoadingNewer);
  const { isRunning, isPaused, start, stop, pause, resume, setCurrentSpeaker, recordSpeak, resetAllCooldowns, loopToken } = useSchedulerStore();
  const api = useSettingsStore((s) => s.api);
  const aiProfiles = useSettingsStore((s) => s.aiProfiles);
  const textProfile = getUsablePreferredAIProfile(aiProfiles, 'text');
  const textInputCapabilities = resolveAIModelInputCapabilities(textProfile);
  const textInputCapabilityWarning = getInputCapabilityWarning(textProfile, isZh ? 'zh' : 'en');
  const { speakAsCharacterId, setSpeakAsCharacter, rightPanelOpen, toggleRightPanel, setRightPanelOpen, rightPanelTab, setRightPanelTab, chatReadingPositions, setChatReadingPosition } = useUIStore();
  const dramaBoost = useSettingsStore((s) => s.developerUI.dramaBoost);
  const showLocalInterceptionHints = useSettingsStore((s) => s.developerMode && s.developerUI.showLocalInterceptionHints);
  const currentUser = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const isRemoteDeletedChat = Boolean(id && remoteDeletedChatIds.includes(id));

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'error' | 'success' }>({ open: false, message: '', severity: 'error' });
  const [detailBootstrapComplete, setDetailBootstrapComplete] = useState(false);
  const [sidebarMessagesReady, setSidebarMessagesReady] = useState(false);
  const [profilePreview, setProfilePreview] = useState<ProfilePreviewState | null>(null);
  const [aiDirectPerspectiveMemberId, setAiDirectPerspectiveMemberId] = useState<string | null>(null);
  const [guideTargetMemberId, setGuideTargetMemberId] = useState<string | null>(null);
  const [pendingStoryChoiceKey, setPendingStoryChoiceKey] = useState<string | null>(null);
  const [messageScrollRequest, setMessageScrollRequest] = useState<MessageListScrollRequest | null>(null);
  const [pendingStoryChoiceVisual, setPendingStoryChoiceVisual] = useState<PendingStoryChoiceVisual | null>(null);
  const [isStoryReaderAtTail, setIsStoryReaderAtTail] = useState(true);
  const [hasStoryReaderReachedTailIntent, setHasStoryReaderReachedTailIntent] = useState(false);
  const [hasStoryUserDraft, setHasStoryUserDraft] = useState(false);
  const [isStoryGenerationCancelled, setIsStoryGenerationCancelled] = useState(false);
  const [isExplicitContinuationScrollFollowSuspended, setIsExplicitContinuationScrollFollowSuspended] = useState(false);
  const [narrativeRevealMessageKeys, setNarrativeRevealMessageKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [chatPageSettingsOpen, setChatPageSettingsOpen] = useState(false);

  const loopTokenRef = useRef<string | null>(null);
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const pendingStoryChoiceRef = useRef<string | null>(null);
  const pendingStoryChoiceVisualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStoryReaderAtTailRef = useRef(true);
  const lastReadingPositionPersistRef = useRef<{ chatId: string; key: string; at: number } | null>(null);
  const openedChatWindowRef = useRef<{ chatId: string; requestKey: string; openedAt: number; restored: boolean } | null>(null);
  const activeChatIdRef = useRef<string | null>(id ?? null);
  const isManualInputPendingRef = useRef<() => boolean>(() => false);
  const userDraftActivityRef = useRef<UserDraftActivity | null>(null);
  const directReplyAbortRef = useRef<AbortController | null>(null);
  const directReplyEpochRef = useRef(0);
  const upsertMessageWithLiveReveal = useCallback((message: Message) => {
    const revealKeys = getNarrativeRevealIdentityKeys(message);
    if (revealKeys.length && shouldRegisterLiveNarrativeReveal(message)) {
      setNarrativeRevealMessageKeys((current) => {
        const next = new Set(current);
        let changed = false;
        revealKeys.forEach((key) => {
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        });
        return changed ? next : current;
      });
    }
    upsertMessage(message);
  }, [upsertMessage]);
  const clearNarrativeRevealMessage = useCallback((message: Message) => {
    const revealKeys = getNarrativeRevealIdentityKeys(message);
    if (!revealKeys.length) return;
    setNarrativeRevealMessageKeys((current) => {
      let changed = false;
      const next = new Set(current);
      revealKeys.forEach((key) => {
        if (next.delete(key)) changed = true;
      });
      return changed ? next : current;
    });
  }, []);
  const {
    streamingMessageRef,
    updateStreamingMessage,
    discardStreamingMessage,
    clearStreamingMessageRef,
  } = useStreamingMessageState(upsertMessageWithLiveReveal);

  useLayoutEffect(() => {
    if (!id) return;
    if (!useChatStore.persist.hasHydrated()) void useChatStore.persist.rehydrate();
    if (!useCharacterStore.persist.hasHydrated()) void useCharacterStore.persist.rehydrate();
    void hydrateMessagesFromCache(id, { limit: CHAT_MESSAGE_WINDOW_SIZE });
  }, [hydrateMessagesFromCache, id]);

  useEffect(() => {
    let cancelled = false;
    setDetailBootstrapComplete(false);
    markChatsWarm();
    markCharactersWarm();
    void (async () => {
      await restoreLocalChats();
      const loadedChat = id ? await loadChat(id) : null;
      const memberIds = loadedChat?.memberIds || useChatStore.getState().chats.find((item) => item.id === id)?.memberIds || [];
      await Promise.all(
        getSyncableCharacterMemberIds(memberIds)
          .filter((memberId) => !useCharacterStore.getState().hasCharacterLoaded(memberId))
          .map((memberId) => loadCharacter(memberId)),
      );
    })().finally(() => {
      if (!cancelled) setDetailBootstrapComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, loadCharacter, loadChat, markCharactersWarm, markChatsWarm, restoreLocalChats]);

  const remoteDeletedChat = remoteDeletedChats.find((c) => c.id === id);
  const chat = chats.find((c) => c.id === id) || remoteDeletedChat;
  const sessionInfoCards = useMemo(() => {
    if (!chat) return [];
    return projectSessionInfoCards({ chat, chats, members: characters, isZh: true });
  }, [chat, chats, characters]);
  const aiDirectSourceInfoCards = useMemo(
    () => chat?.type === 'ai_direct' ? sessionInfoCards.filter((card) => card.key === 'ai-direct-source-chat') : [],
    [chat?.type, sessionInfoCards]
  );
  const globalSessionInfoCards = useMemo(
    () => sessionInfoCards.filter((card) => card.key !== 'ai-direct-source-chat'),
    [sessionInfoCards]
  );
  const currentChatAllMessages = useMemo(() => (id
    ? projectMergedChatMessages({
      chatId: id,
      activeMessages: messages,
      cachedWindow: rawCurrentMessageWindow,
    })
    : []), [id, messages, rawCurrentMessageWindow]);
  const currentChatMessages = useMemo(() => (
    chat && isMessageBranchingEnabled(chat)
      ? projectActiveBranchMessages(chat, currentChatAllMessages)
      : currentChatAllMessages
  ), [chat, currentChatAllMessages]);
  const messageWindowDebugSignatureRef = useRef('');
  useEffect(() => {
    if (!id || typeof console === 'undefined') return;
    const signature = [
      id,
      authMode,
      messages.length,
      rawCurrentMessageWindow?.messages?.length || 0,
      currentChatMessages.length,
      isLoading,
    ].join('|');
    if (messageWindowDebugSignatureRef.current === signature) return;
    messageWindowDebugSignatureRef.current = signature;
    logDeveloperDiagnostic('message-window:page-projection', {
      chatId: id,
      authMode,
      activeMessages: messages.length,
      cachedWindowMessages: rawCurrentMessageWindow?.messages?.length || 0,
      cachedWindowActiveLimit: rawCurrentMessageWindow?.activeLimit,
      projectedMessages: currentChatMessages.length,
      isLoading,
    }, 'debug', 'message-window');
  }, [authMode, currentChatMessages.length, id, isLoading, messages.length, rawCurrentMessageWindow?.activeLimit, rawCurrentMessageWindow?.messages?.length]);
  const branchTopologySignature = useMemo(
    () => buildBranchTopologySignature(currentChatAllMessages),
    [currentChatAllMessages],
  );
  const visibleMessageIdSignature = useMemo(
    () => buildVisibleMessageIdSignature(currentChatMessages),
    [currentChatMessages],
  );
  const branchVersionInfoByMessageId = useMemo(() => {
    if (!chat || !isMessageBranchingEnabled(chat)) return {} as Record<string, NonNullable<ReturnType<typeof getMessageBranchVersionInfo>>>;
    return buildMessageBranchVersionInfoByMessageId(
      chat,
      currentChatAllMessages,
      currentChatMessages.map((message) => message.id),
    ) as Record<string, NonNullable<ReturnType<typeof getMessageBranchVersionInfo>>>;
  }, [branchTopologySignature, chat?.messageBranchState, chat?.mode, chat?.sessionKind?.scenarioId, visibleMessageIdSignature]);
  const sidebarMessages = sidebarMessagesReady ? currentChatMessages : EMPTY_MESSAGES;
  const {
    analysisDialogOpen,
    analysisError,
    analysisLoading,
    analysisTarget,
    analysisText,
    analyzeMessage,
    closeAnalysisDialog,
  } = useMessageAnalysis({
    api,
    chat,
    messages: currentChatMessages,
    characters,
    fallbackError: t('common.error'),
  });
  const members = useMemo(
    () => chat ? chat.memberIds.map((memberId) => resolveCharacterOrDeleted(characters, memberId)) : [],
    [characters, chat]
  );
  const activeMembers = useMemo(
    () => chat ? characters.filter((c) => chat.memberIds.includes(c.id)) : [],
    [characters, chat]
  );
  const aiDirectMemberIds = useMemo(
    () => chat?.type === 'ai_direct' ? getSyncableCharacterMemberIds(chat.memberIds) : [],
    [chat]
  );
  const speakAsChar = useMemo(
    () => speakAsCharacterId ? characters.find((c) => c.id === speakAsCharacterId) ?? null : null,
    [characters, speakAsCharacterId]
  );
  const savedStoryReadingPositionForChat = id ? chatReadingPositions[id] : null;
  const storyReadingRestoreKey = savedStoryReadingPositionForChat && !savedStoryReadingPositionForChat.pinned
    ? `${savedStoryReadingPositionForChat.messageId}:${savedStoryReadingPositionForChat.sourceTimestamp ?? ''}:${Math.round(savedStoryReadingPositionForChat.offsetTop)}`
    : '';
  const hasSavedNonTailStoryReadingPosition = Boolean(chat?.sessionKind?.scenarioId === 'story-reader' && savedStoryReadingPositionForChat && !savedStoryReadingPositionForChat.pinned);
  useEffect(() => {
    if (!chat || chat.type !== 'ai_direct') {
      setAiDirectPerspectiveMemberId(null);
      return;
    }
    if (aiDirectPerspectiveMemberId && aiDirectMemberIds.includes(aiDirectPerspectiveMemberId)) return;
    setAiDirectPerspectiveMemberId(aiDirectMemberIds[0] || null);
  }, [aiDirectMemberIds, aiDirectPerspectiveMemberId, chat]);
  useEffect(() => {
    setGuideTargetMemberId(null);
    setNarrativeRevealMessageKeys(new Set());
    setPendingStoryChoiceVisual(null);
    setHasStoryReaderReachedTailIntent(false);
    const nextAtTail = chat?.sessionKind?.scenarioId === 'story-reader' && savedStoryReadingPositionForChat
      ? savedStoryReadingPositionForChat.pinned
      : true;
    setIsStoryReaderAtTail(nextAtTail);
    isStoryReaderAtTailRef.current = nextAtTail;
    if (pendingStoryChoiceVisualTimerRef.current) {
      clearTimeout(pendingStoryChoiceVisualTimerRef.current);
      pendingStoryChoiceVisualTimerRef.current = null;
    }
  }, [chat?.sessionKind?.scenarioId, id, savedStoryReadingPositionForChat?.pinned]);
  useEffect(() => () => {
    if (pendingStoryChoiceVisualTimerRef.current) clearTimeout(pendingStoryChoiceVisualTimerRef.current);
  }, []);
  const aiDirectPerspectiveChar = useMemo(
    () => {
      if (chat?.type !== 'ai_direct') return null;
      const perspectiveId = aiDirectPerspectiveMemberId && aiDirectMemberIds.includes(aiDirectPerspectiveMemberId)
        ? aiDirectPerspectiveMemberId
        : aiDirectMemberIds[0] || null;
      return perspectiveId ? characters.find((c) => c.id === perspectiveId) ?? members.find((member) => member.id === perspectiveId) ?? null : null;
    },
    [aiDirectMemberIds, aiDirectPerspectiveMemberId, characters, chat, members]
  );
  const effectiveAiDirectPerspectiveMemberId = chat?.type === 'ai_direct'
    ? (aiDirectPerspectiveMemberId && aiDirectMemberIds.includes(aiDirectPerspectiveMemberId) ? aiDirectPerspectiveMemberId : aiDirectMemberIds[0] || null)
    : null;
  const effectiveSpeakAsChar = chat?.type === 'ai_direct' ? aiDirectPerspectiveChar : speakAsChar;
  const guideTargetMember = useMemo(
    () => guideTargetMemberId ? characters.find((c) => c.id === guideTargetMemberId) ?? null : null,
    [characters, guideTargetMemberId]
  );

  const openCharacterPreview = useCallback((character: AICharacter, anchorEl: HTMLElement) => {
    setProfilePreview({ kind: 'character', anchorRect: anchorEl.getBoundingClientRect(), anchorElement: anchorEl, character });
  }, []);

  const openChatPreview = useCallback((anchorEl: HTMLElement) => {
    setProfilePreview({ kind: 'chat', anchorRect: anchorEl.getBoundingClientRect(), anchorElement: anchorEl });
  }, []);
  const {
    actionSchema,
    actionPanelTitle,
    activeSidebarTab,
    composerSurfaces,
    directMemoryPanelContext,
    memberTabTitle,
    privatePayloads,
    projectedActionPanelActions,
    projectedDetailState,
    projectedRuntimeState,
    projectedSidebarChat,
    runtimePanelLoading,
    runtimeTabTitle,
    sessionActions,
    showActionTab,
    showMemberTab,
    showRuntimeTab,
    sidebarTitle,
  } = useChatSidebarProjection({
    chat,
    members,
    activeMembers,
    characters,
    currentChatMessages: sidebarMessages,
    rightPanelTab,
    speakAsChar: effectiveSpeakAsChar,
    language: i18n.language,
  });
  const sidebarTabValue = activeSidebarTab === 'actions' ? 'activities' : activeSidebarTab;
  const isStoryRoom = chat?.sessionKind?.scenarioId === 'story-reader';
  const storyRoomOpeningPreview = useMemo(
    () => buildStoryRoomOpeningPreview(chat, members),
    [chat, members],
  );
  const sessionScrollCapabilities = useMemo(
    () => resolveSessionScrollCapabilities({
      sessionKind: chat?.sessionKind,
      explicitContinuationPending: isExplicitContinuationScrollFollowSuspended,
    }),
    [chat?.sessionKind, isExplicitContinuationScrollFollowSuspended],
  );
  const initialStoryReadingPosition = useMemo<MessageListScrollPosition | null>(() => {
    if (!isStoryRoom || !id) return null;
    const position = savedStoryReadingPositionForChat;
    if (!position) return null;
    return {
      messageId: position.messageId,
      offsetTop: position.offsetTop,
      pinned: position.pinned,
      sourceTimestamp: position.sourceTimestamp,
    };
  }, [id, isStoryRoom, savedStoryReadingPositionForChat]);
  const effectiveTextInputCapabilities = useMemo(
    () => (isStoryRoom && !effectiveSpeakAsChar ? buildStoryReaderTextInputCapabilities(textInputCapabilities) : textInputCapabilities),
    [effectiveSpeakAsChar, isStoryRoom, textInputCapabilities],
  );
  const effectiveTextInputCapabilityWarning = isStoryRoom && !effectiveSpeakAsChar ? undefined : textInputCapabilityWarning;
  const storyReaderRole = isStoryRoom ? resolveStoryReaderRole(chat || undefined) : 'director';
  const effectiveComposerSurfaces = useMemo(() => {
    const primaryTextSurface = composerSurfaces.find((surface) => surface.type === 'text') || { key: 'member-guide-text', type: 'text' as const };
    const nonTextSurfaces = isStoryRoom ? [] : composerSurfaces.filter((surface) => surface.type !== 'text');
    if (guideTargetMember && !effectiveSpeakAsChar) {
      const nextSurface = {
        ...primaryTextSurface,
        key: 'member-guide-text',
        type: 'text' as const,
        mode: 'guide' as const,
        actorId: guideTargetMember.id,
        capability: 'guide' as const,
        placeholder: `安排${guideTargetMember.name}回应、说话或行动`,
      };
      return [nextSurface, ...nonTextSurfaces];
    }
    if (!effectiveSpeakAsChar && isStoryRoom) {
      return [{
        ...primaryTextSurface,
        key: 'story-reader-direction-text',
        type: 'text' as const,
        mode: 'memberSpeak' as const,
        actorId: 'user',
        capability: 'speak' as const,
        placeholder: getStoryReaderComposerPlaceholder(storyReaderRole),
      }];
    }
    if (!effectiveSpeakAsChar && chat?.type === 'group' && chat.memberIds.includes('user')) {
      return [{
        ...primaryTextSurface,
        key: 'member-user-text',
        type: 'text' as const,
        mode: 'memberSpeak' as const,
        actorId: 'user',
        capability: 'speak' as const,
        placeholder: isStoryRoom ? getStoryReaderComposerPlaceholder(storyReaderRole) : '输入消息',
      }, ...nonTextSurfaces];
    }
    if (!effectiveSpeakAsChar && chat?.type === 'direct') {
      return [{
        ...primaryTextSurface,
        key: 'direct-user-text',
        type: 'text' as const,
        mode: 'memberSpeak' as const,
        actorId: 'user',
        capability: 'speak' as const,
        placeholder: '输入消息',
      }, ...nonTextSurfaces];
    }
    if (!effectiveSpeakAsChar && chat?.type === 'ai_direct') {
      return [{
        ...primaryTextSurface,
        key: 'ai-direct-text',
        type: 'text' as const,
        mode: 'memberSpeak' as const,
        actorId: 'user',
        capability: 'speak' as const,
        placeholder: '输入消息',
      }, ...nonTextSurfaces];
    }
    return composerSurfaces;
  }, [chat, composerSurfaces, effectiveSpeakAsChar, guideTargetMember, isStoryRoom, storyReaderRole]);
  const handleSidebarTabChange = useCallback((value: SidebarTabValue) => {
    setRightPanelTab(value === 'activities' ? 'actions' : value === 'developer' ? 'developer' : value);
  }, [setRightPanelTab]);
  void dramaBoost;
  void rightPanelOpen;

  useEffect(() => {
    setSidebarMessagesReady(false);
    const scheduler = (window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    if (typeof scheduler === 'function') {
      const handle = scheduler(() => setSidebarMessagesReady(true), { timeout: 700 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setSidebarMessagesReady(true), 160);
    return () => window.clearTimeout(handle);
  }, [id]);

  useEffect(() => {
    if (!isDesktop) setRightPanelOpen(false);
  }, [id, isDesktop, setRightPanelOpen]);

  const showErrorToast = useCallback((message: string) => {
    const normalized = message.trim();
    const imageInputCompatibilityHint = isZh
      ? '当前服务商不兼容图片输入格式。可关闭该模型的图片输入能力，或改用官方支持多模态的模型。'
      : 'Current provider is not compatible with the image input format. Disable image input for this model or switch to an officially supported multimodal model.';
    const corsHint = isZh
      ? '浏览器直连被目标服务的跨域策略拦截。可继续保存配置，正式使用建议走服务端代理。'
      : 'The target service blocked browser-direct requests via CORS. You can still save the config, but production use should go through your server proxy.';
    if (/unknown variant `image_url`|expected `text`/i.test(normalized)) {
      setSnackbar({ open: true, message: imageInputCompatibilityHint, severity: 'error' });
      return;
    }
    if (/failed to fetch|cors/i.test(normalized)) {
      setSnackbar({ open: true, message: corsHint, severity: 'error' });
      return;
    }
    setSnackbar({ open: true, message, severity: 'error' });
  }, [isZh]);

  const closeSnackbar = useCallback(() => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  }, []);

  useEffect(() => {
    isRunningRef.current = isRunning;
    isPausedRef.current = isPaused;
  }, [isPaused, isRunning]);

  useEffect(() => {
    isStoryReaderAtTailRef.current = isStoryReaderAtTail;
  }, [isStoryReaderAtTail]);

  useEffect(() => {
    if (!isRemoteDeletedChat) return;
    pause();
    stop();
  }, [isRemoteDeletedChat, pause, stop]);

  useEffect(() => {
    activeChatIdRef.current = id ?? null;
    loopTokenRef.current = loopToken;
  }, [id, loopToken]);

  const appendEventMessage = useCallback(async (chatId: string, payload: { eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[]; createdAt?: number; sourceMessageId?: string }, sourceMessageId?: string) => {
    const targetChat = chats.find((item) => item.id === chatId);
    const eventPayload = normalizeRuntimeEvent(targetChat ? buildPrivateSessionEvent(targetChat, payload) : payload);
    const eventMessage = attachMessageToActiveBranch(targetChat || chat, currentChatMessages, {
      chatId,
      type: 'event' as const,
      senderId: 'system',
      senderName: 'System',
      content: buildRuntimeEventMessageContent({
        ...eventPayload,
        sourceMessageId: eventPayload.sourceMessageId || sourceMessageId,
      }),
      emotion: 0,
      timestamp: eventPayload.createdAt,
    });
    const { timestamp: eventTimestamp, ...persistedEventMessage } = eventMessage;
    await persistLocalFirstMessage({
      upsertMessage,
      timestamp: eventTimestamp,
      message: persistedEventMessage,
    });
  }, [chat, chats, currentChatMessages, upsertMessage]);

  const appendEventMessages = useCallback(async (chatId: string, payloads: Array<{ eventType: string; title: string; summary: string; pair?: [string, string]; metrics?: unknown; visibilityScope?: 'public' | 'role_private' | 'moderator_only' | 'pair_private' | 'derived_public'; visibleToIds?: string[]; visibleToRoles?: string[]; createdAt?: number; sourceMessageId?: string }>, sourceMessageId?: string) => {
    if (!payloads.length) return;
    const targetChat = chats.find((item) => item.id === chatId);
    await persistLocalFirstMessages({
      upsertMessages,
      deferLocalUpsert: true,
      messages: payloads.map((payload, index) => {
        const eventPayload = normalizeRuntimeEvent(targetChat ? buildPrivateSessionEvent(targetChat, payload) : payload);
        const createdAt = eventPayload.createdAt ?? Date.now() + index;
        const message = attachMessageToActiveBranch(targetChat || chat, currentChatMessages, {
          timestamp: createdAt,
          chatId,
          type: 'event' as const,
          senderId: 'system',
          senderName: 'System',
          content: buildRuntimeEventMessageContent({
            ...eventPayload,
            createdAt,
            sourceMessageId: eventPayload.sourceMessageId || sourceMessageId,
          }),
          emotion: 0,
        });
        const { timestamp, ...persistedMessage } = message;
        return {
          timestamp,
          message: persistedMessage,
        };
      }),
    });
  }, [chat, chats, currentChatMessages, upsertMessages]);

  const addAnchoredMessage = useCallback(async (message: Omit<Message, 'id' | 'timestamp' | 'isDeleted'> & { timestamp?: number }) => {
    const anchoredMessage = chat && message.chatId === chat.id
      ? attachMessageToActiveBranch(chat, currentChatMessages, message)
      : message;
    return addMessage(anchoredMessage as Parameters<typeof addMessage>[0]);
  }, [addMessage, chat, currentChatMessages]);

  const upsertMessageStable = useCallback((message: Message) => {
    upsertMessageWithLiveReveal(message);
  }, [upsertMessageWithLiveReveal]);

  const appendEventMessageStable = appendEventMessage;
  const appendEventMessagesStable = appendEventMessages;

  const appendMembershipNotice = useCallback(async (content: string) => {
    if (!chat || !id) return;
    await useMessageStore.getState().addMessage({
      chatId: id,
      type: 'system',
      senderId: 'system',
      senderName: 'System',
      content,
      emotion: 0,
      timestamp: Date.now(),
    });
  }, [chat, id]);
  const addMessageStable = addAnchoredMessage;
  const getNextMessageTimestamp = useCallback(() => {
    const latestTimestamp = currentChatMessages.reduce((latest, message) => Math.max(latest, Number(message.timestamp || 0)), 0);
    return Math.max(Date.now(), latestTimestamp + 1);
  }, [currentChatMessages]);

  const appendLocalInterceptionHint = useCallback(async (event: LocalInterceptionEvent) => {
    if (!chat?.id || !showLocalInterceptionHints) return;
    await appendEventMessageStable(chat.id, {
      eventType: 'local_interception',
      title: '提示：本地拦截',
      summary: buildLocalInterceptionSummary(event),
      visibilityScope: 'moderator_only',
      metrics: {
        kind: event.kind,
        speakerId: event.speakerId,
        speakerName: event.speakerName,
        reason: event.reason,
        attempt: event.attempt,
      },
    });
  }, [appendEventMessageStable, chat?.id, showLocalInterceptionHints]);

  const handleStartDirectChat = useCallback(async (characterId: string) => {
    const character = characters.find((item) => item.id === characterId);
    if (!character) return;
    const existing = chats.find((item) => item.type === 'direct' && item.memberIds.length === 1 && item.memberIds[0] === characterId);
    if (existing) {
      navigate(`/chats/${existing.id}?fromTab=1`);
      return;
    }
    try {
      const { buildDirectChatDraft } = await import('../services/chatDraftBuilder');
      const directChat = await useChatStore.getState().addChat(buildDirectChatDraft(character.id, character.name));
      navigate(`/chats/${directChat.id}?fromTab=1`);
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    }
  }, [characters, chats, navigate, t]);

  const {
    thinkingId,
    chatError,
    runLoopError,
    hasPendingTurnWork,
    startConversationLoopIfNeeded,
    cancelActiveConversationLoop,
    resetRunLoopUiState,
  } = useChatRunLoop({
    chat,
    chatId: id,
    activeMembers,
    api,
    aiProfiles,
    isRunningRef,
    isPausedRef,
    loopTokenRef,
    activeChatIdRef,
    streamingMessageRef,
    updateStreamingMessage,
    onLocalInterception: appendLocalInterceptionHint,
    discardStreamingMessage,
    clearStreamingMessageRef,
    isManualInputPending: () => isManualInputPendingRef.current(),
    isStoryReaderAtTail: () => isStoryReaderAtTailRef.current,
    setCurrentSpeaker,
    resetAllCooldowns,
    start,
    stop,
    pause,
    updateChat,
    showErrorToast,
    t,
    upsertMessage: upsertMessageStable,
    updateCharacter,
    updateCharacters,
    appendEventMessage: appendEventMessageStable,
    appendEventMessages: appendEventMessagesStable,
    applyChatRuntimeDelta,
    recordSpeak,
    getUserDraftActivity: () => userDraftActivityRef.current,
  });
  const { enqueueManualInput, isManualInputPending } = useManualInputQueue({
    isRunningRef,
    isPausedRef,
    hasPendingTurnWork,
    pause,
  });
  isManualInputPendingRef.current = isManualInputPending;

  const commitPersistedManualRuntime = useCallback(async (message: Message, recentMessages: Message[]) => {
    if (!chat || !id) return;
    const [{ runPersistedSessionCommitRuntime }, { resolveSessionEngine }] = await Promise.all([
      import('../services/sessionCommitPipeline'),
      import('../services/sessionEngineRegistry'),
    ]);
    const sessionEngine = resolveSessionEngine(chat);
    await runPersistedSessionCommitRuntime({
      api,
      chatId: id,
      chat,
      characters,
      message,
      currentMessages: recentMessages,
      onCommit: async (args) => await (sessionEngine.onMessageCommitted as (commitArgs: {
        conversation: GroupChat;
        characters: typeof characters;
        message: Pick<Message, 'content' | 'type' | 'senderId'>;
        previousAiMessage: Pick<Message, 'senderId'> | null;
        recentMessages?: Message[];
        apiConfig?: typeof api;
      }) => DriverMessageCommitResult | Promise<DriverMessageCommitResult>)(args),
      updateCharacter,
      updateCharacters: async (patches) => updateCharacters(patches.map((patch) => ({ id: patch.id, updates: patch.patch }))),
      appendEventMessage: appendEventMessageStable,
      appendEventMessages: appendEventMessagesStable,
      updateChat,
      applyChatRuntimeDelta,
      recordSpeak,
      getCurrentChat: (chatId) => useChatStore.getState().chats.find((item) => item.id === chatId),
      getCurrentCharacters: () => useCharacterStore.getState().characters,
    });
  }, [api, appendEventMessageStable, appendEventMessagesStable, applyChatRuntimeDelta, characters, chat, id, recordSpeak, updateCharacter, updateCharacters, updateChat]);

  const handleCreateMessageRevision = useCallback(async (sourceMessage: Message, nextContent: string) => {
    if (!chat || !id || !isMessageBranchingEnabled(chat)) return;
    const trimmedContent = nextContent.trim();
    if (!trimmedContent) return;
    directReplyAbortRef.current?.abort();
    const directReplyEpoch = directReplyEpochRef.current + 1;
    directReplyEpochRef.current = directReplyEpoch;

    await enqueueManualInput(async () => {
      const cancelledRunningLoop = isRunningRef.current;
      if (cancelledRunningLoop) cancelActiveConversationLoop('message_revision_created');
      const scrollRestoreRequest = captureMessageListScrollRequest('branch-create', sourceMessage.id);
      const sourceNode = resolveMessageBranchNodes(currentChatAllMessages)
        .find((node) => node.message.id === sourceMessage.id || node.nodeId === sourceMessage.id);
      if (!sourceNode) return;

      const revisionDraft = createMessageRevisionDraft({
        sourceMessage,
        parentNodeId: sourceNode.parentNodeId,
        content: trimmedContent,
        timestamp: getNextMessageTimestamp(),
      });
      const createdRevision = await addAnchoredMessage(revisionDraft);
      const revisionNodeId = createdRevision.metadata?.branching?.nodeId || createdRevision.id;
      const revisionRootId = createdRevision.metadata?.branching?.revisionRootId || sourceNode.revisionRootId || sourceMessage.id;
      const parentKey = sourceNode.parentNodeId || '';
      const nextBranchState: MessageBranchState = {
        ...(chat.messageBranchState || {}),
        enabled: true,
        selectedRevisionByRootId: {
          ...(chat.messageBranchState?.selectedRevisionByRootId || {}),
          [revisionRootId]: revisionNodeId,
        },
        activeChildByParentNodeId: {
          ...(chat.messageBranchState?.activeChildByParentNodeId || {}),
          [parentKey]: revisionNodeId,
        },
        activeLeafNodeId: revisionNodeId,
        updatedAt: Date.now(),
      };
      const nextChat: GroupChat = {
        ...chat,
        messageBranchState: nextBranchState,
        lastMessageAt: createdRevision.timestamp,
        latestMessage: createdRevision,
      };
      const nextAllMessages = [
        ...currentChatAllMessages.filter((message) => message.id !== createdRevision.id),
        createdRevision,
      ];
      const activeMessagesAfterRevision = projectActiveBranchMessages(nextChat, nextAllMessages);

      await updateChat(id, {
        messageBranchState: nextBranchState,
        lastMessageAt: createdRevision.timestamp,
        latestMessage: createdRevision,
      });
      if (scrollRestoreRequest) {
        setMessageScrollRequest({
          ...scrollRestoreRequest,
          key: `branch-create:${createdRevision.id}:${Date.now()}`,
          messageId: createdRevision.id,
          sourceTimestamp: createdRevision.timestamp,
        });
      }
      if (chat.type === 'direct' && createdRevision.type === 'user') {
        const directReplyAbortController = new AbortController();
        directReplyAbortRef.current = directReplyAbortController;
        const shouldContinueDirectRevision = () => {
          if (directReplyAbortController.signal.aborted) return false;
          if (directReplyEpochRef.current !== directReplyEpoch) return false;
          const latestChat = useChatStore.getState().chats.find((item) => item.id === id) || nextChat;
          if (latestChat.messageBranchState?.selectedRevisionByRootId?.[revisionRootId] !== revisionNodeId) return false;
          const messageState = useMessageStore.getState();
          const latestMessages = projectMergedChatMessages({
            chatId: id,
            activeMessages: messageState.messages,
            cachedWindow: messageState.messageWindowsByChatId[id],
          });
          return projectActiveBranchMessages(latestChat, latestMessages).some((message) => message.id === createdRevision.id);
        };
        void (async () => {
          const { runDirectUserReplyFlow } = await import('../services/directUserReplyFlow');
          try {
            await runDirectUserReplyFlow({
              api,
              aiProfiles,
              chatId: id,
              chat: nextChat,
              userMessage: createdRevision,
              content: trimmedContent,
              characters,
              updateCharacter,
              updateCharacters,
              upsertMessage: upsertMessageStable,
              appendEventMessage: appendEventMessageStable,
              appendEventMessages: appendEventMessagesStable,
              updateChat,
              applyChatRuntimeDelta,
              recordSpeak,
              onLocalInterception: appendLocalInterceptionHint,
              signal: directReplyAbortController.signal,
              shouldContinue: shouldContinueDirectRevision,
              deferRuntimePersistenceUntilCommit: true,
            });
          } catch (error) {
            if (!isGenerationCancelledError(error)) {
              console.error('[direct-reply:revision-error]', error);
              showErrorToast(error instanceof Error ? error.message : String(error));
            }
          } finally {
            if (directReplyAbortRef.current === directReplyAbortController) directReplyAbortRef.current = null;
          }
        })();
      } else if (createdRevision.type === 'user' || createdRevision.type === 'god') {
        await commitPersistedManualRuntime(createdRevision, activeMessagesAfterRevision);
        if (chat.type === 'ai_direct') {
          const { applyAiDirectFeedback } = await import('../services/directSessionRuntime');
          await applyAiDirectFeedback({
            chat: nextChat,
            chats,
            characters,
            content: trimmedContent,
            updateCharacter,
            updateChat,
            appendEventMessage,
          });
        }
      }
      if (cancelledRunningLoop) {
        setSnackbar({ open: true, message: '已切换到新分支，当前生成已重启', severity: 'success' });
      }
      if (chat.type !== 'direct') startConversationLoopIfNeeded(nextChat, { immediate: true });
    });
  }, [addAnchoredMessage, aiProfiles, api, appendEventMessage, appendEventMessageStable, appendEventMessagesStable, appendLocalInterceptionHint, applyChatRuntimeDelta, cancelActiveConversationLoop, characters, chat, chats, commitPersistedManualRuntime, currentChatAllMessages, enqueueManualInput, getNextMessageTimestamp, id, recordSpeak, setSnackbar, showErrorToast, startConversationLoopIfNeeded, updateCharacter, updateCharacters, updateChat, upsertMessageStable]);

  const handleSwitchMessageRevision = useCallback(async (sourceMessage: Message, direction: -1 | 1) => {
    if (!chat || !id || !isMessageBranchingEnabled(chat)) return;
    directReplyAbortRef.current?.abort();
    directReplyEpochRef.current += 1;
    const cancelledRunningLoop = isRunningRef.current;
    if (cancelledRunningLoop) cancelActiveConversationLoop('message_revision_switched');
    const scrollRestoreRequest = captureMessageListScrollRequest('branch-switch', sourceMessage.id);
    const group = getBranchRevisionGroup(currentChatAllMessages, sourceMessage.id);
    const currentIndex = group.findIndex((message) => message.id === sourceMessage.id);
    const target = group[currentIndex + direction];
    if (!target) return;
    const targetNode = resolveMessageBranchNodes(currentChatAllMessages)
      .find((node) => node.message.id === target.id || node.nodeId === target.id);
    if (!targetNode) return;

    const targetNodeId = targetNode.nodeId || target.id;
    const revisionRootId = targetNode.revisionRootId || target.id;
    const parentKey = targetNode.parentNodeId || '';
    const nextBranchState: MessageBranchState = {
      ...(chat.messageBranchState || {}),
      enabled: true,
      selectedRevisionByRootId: {
        ...(chat.messageBranchState?.selectedRevisionByRootId || {}),
        [revisionRootId]: targetNodeId,
      },
      activeChildByParentNodeId: {
        ...(chat.messageBranchState?.activeChildByParentNodeId || {}),
        [parentKey]: targetNodeId,
      },
      activeLeafNodeId: targetNodeId,
      updatedAt: Date.now(),
    };
    const nextChat: GroupChat = {
      ...chat,
      messageBranchState: nextBranchState,
    };
    const activeTail = projectActiveBranchMessages(nextChat, currentChatAllMessages).at(-1);
    await updateChat(id, {
      messageBranchState: {
        ...nextBranchState,
        activeLeafNodeId: activeTail?.metadata?.branching?.nodeId || activeTail?.id || targetNodeId,
      },
    });
    if (scrollRestoreRequest) {
      setMessageScrollRequest({
        ...scrollRestoreRequest,
        key: `branch-switch:${target.id}:${Date.now()}`,
        messageId: target.id,
        sourceTimestamp: target.timestamp,
      });
    }
    if (cancelledRunningLoop) {
      setSnackbar({ open: true, message: '已切换分支，当前生成已停止', severity: 'success' });
    }
  }, [cancelActiveConversationLoop, chat, currentChatAllMessages, id, setSnackbar, updateChat]);

  useEffect(() => {
    if (id) {
      const aroundTimestamp = chat?.sessionKind?.scenarioId === 'story-reader' && savedStoryReadingPositionForChat && !savedStoryReadingPositionForChat.pinned
        ? savedStoryReadingPositionForChat.sourceTimestamp
        : undefined;
      const requestKey = aroundTimestamp !== undefined && storyReadingRestoreKey
        ? `restore:${storyReadingRestoreKey}`
        : 'tail';
      const previousOpen = openedChatWindowRef.current;
      if (previousOpen?.chatId === id && previousOpen.requestKey === requestKey) return;
      if (previousOpen?.chatId === id && previousOpen.restored) return;
      if (previousOpen?.chatId === id && requestKey !== 'tail' && Date.now() - previousOpen.openedAt > 3000) return;
      openedChatWindowRef.current = {
        chatId: id,
        requestKey,
        openedAt: Date.now(),
        restored: requestKey !== 'tail',
      };
      logDeveloperDiagnostic('chat-window:open', {
        chatId: id,
        isStoryRoom: chat?.sessionKind?.scenarioId === 'story-reader',
        requestKey,
        savedPosition: savedStoryReadingPositionForChat ? {
          messageId: savedStoryReadingPositionForChat.messageId,
          offsetTop: savedStoryReadingPositionForChat.offsetTop,
          pinned: savedStoryReadingPositionForChat.pinned,
          sourceTimestamp: savedStoryReadingPositionForChat.sourceTimestamp,
          updatedAt: savedStoryReadingPositionForChat.updatedAt,
        } : null,
        aroundTimestamp,
      }, 'info');
      void openChatWindow(id, { limit: CHAT_MESSAGE_WINDOW_SIZE, revalidate: true, aroundTimestamp });
    }
  }, [chat?.sessionKind?.scenarioId, id, openChatWindow, savedStoryReadingPositionForChat?.pinned, storyReadingRestoreKey]);

  useEffect(() => {
    userDraftActivityRef.current = null;
    setHasStoryUserDraft(false);
    setIsStoryGenerationCancelled(false);
    setIsExplicitContinuationScrollFollowSuspended(false);
  }, [id, isStoryRoom]);

  useEffect(() => {
    if (!id) return undefined;
    return () => {
      if (openedChatWindowRef.current?.chatId === id) openedChatWindowRef.current = null;
      activeChatIdRef.current = null;
      loopTokenRef.current = null;
      resetRunLoopUiState();
      discardStreamingMessage();
      closeChatWindow(id, { clearActiveOnly: true });
      directReplyAbortRef.current?.abort();
      directReplyAbortRef.current = null;
      directReplyEpochRef.current += 1;
      stop();
    };
  }, [closeChatWindow, discardStreamingMessage, id, resetRunLoopUiState, stop]);

  const handleMemberSpeakSend = useCallback(async (content: string, attachments: MessageAttachment[] = []) => {
    if (!chat || !id) return;
    await enqueueManualInput(async () => {
      const recentMessages = currentChatMessages;
      const userMessage = await addMessageStable({
        chatId: id,
        type: 'user',
        senderId: 'user',
        senderName: currentUser?.nickname?.trim() || '我',
        content,
        emotion: 0,
        timestamp: getNextMessageTimestamp(),
        metadata: attachments.length ? { attachments } : undefined,
      });
      void updateChat(id, { lastMessageAt: userMessage.timestamp, latestMessage: userMessage });
      const recentMessagesWithUser = [...recentMessages.filter((message) => message.id !== userMessage.id), userMessage];
      if (chat.type === 'direct') {
        directReplyAbortRef.current?.abort();
        const directReplyEpoch = directReplyEpochRef.current + 1;
        directReplyEpochRef.current = directReplyEpoch;
        const directReplyAbortController = new AbortController();
        directReplyAbortRef.current = directReplyAbortController;
        void (async () => {
          const { runDirectUserReplyFlow } = await import('../services/directUserReplyFlow');
          try {
            await runDirectUserReplyFlow({
              api,
              aiProfiles,
              chatId: id,
              chat,
              userMessage,
              content,
              characters,
              updateCharacter,
              updateCharacters,
              upsertMessage: upsertMessageStable,
              appendEventMessage: appendEventMessageStable,
              appendEventMessages: appendEventMessagesStable,
              updateChat,
              applyChatRuntimeDelta,
              recordSpeak,
              onLocalInterception: appendLocalInterceptionHint,
              signal: directReplyAbortController.signal,
              shouldContinue: () => !directReplyAbortController.signal.aborted && directReplyEpochRef.current === directReplyEpoch,
            });
          } catch (error) {
            if (!isGenerationCancelledError(error)) {
              console.error('[direct-reply:send-error]', error);
              showErrorToast(error instanceof Error ? error.message : String(error));
            }
          } finally {
            if (directReplyAbortRef.current === directReplyAbortController) directReplyAbortRef.current = null;
          }
        })();
        return;
      }
      await commitPersistedManualRuntime(userMessage, recentMessagesWithUser);
      if (chat.type === 'ai_direct') {
        startConversationLoopIfNeeded(chat);
        const { applyAiDirectFeedback } = await import('../services/directSessionRuntime');
        await applyAiDirectFeedback({ chat, chats, characters, content, updateCharacter, updateChat, appendEventMessage });
        return;
      }
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, aiProfiles, api, appendEventMessage, appendEventMessageStable, appendEventMessagesStable, appendLocalInterceptionHint, applyChatRuntimeDelta, characters, chat, chats, commitPersistedManualRuntime, currentChatMessages, currentUser?.nickname, enqueueManualInput, getNextMessageTimestamp, id, recordSpeak, showErrorToast, startConversationLoopIfNeeded, updateCharacter, updateCharacters, updateChat, upsertMessageStable]);

  const handleGuideSend = useCallback(async (content: string, attachments: MessageAttachment[] = []) => {
    if (!chat || !id) return;
    await enqueueManualInput(async () => {
      const recentMessages = currentChatMessages;
      const guidedMessage = await addMessageStable({
        chatId: id,
        type: 'god',
        senderId: 'user',
        senderName: '导演安排',
        content,
        emotion: 0,
        timestamp: getNextMessageTimestamp(),
        metadata: attachments.length ? { attachments } : undefined,
      });
      void updateChat(id, { lastMessageAt: guidedMessage.timestamp, latestMessage: guidedMessage });
      const recentMessagesWithGuide = [...recentMessages.filter((message) => message.id !== guidedMessage.id), guidedMessage];
      await commitPersistedManualRuntime(guidedMessage, recentMessagesWithGuide);
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, chat, commitPersistedManualRuntime, currentChatMessages, enqueueManualInput, getNextMessageTimestamp, id, startConversationLoopIfNeeded, updateChat]);

  const handleSpeakAs = useCallback(async (content: string, attachments: MessageAttachment[] = []) => {
    if (!chat || !id || !effectiveSpeakAsChar) return;
    const char = effectiveSpeakAsChar;
    if (!char) return;
    await enqueueManualInput(async () => {
      const recentMessages = currentChatMessages;
      const spokeMessage = await addMessageStable({
        chatId: id,
        type: 'user',
        senderId: char.id,
        senderName: char.name,
        content,
        emotion: 0,
        timestamp: getNextMessageTimestamp(),
        metadata: {
          manualSpeaker: {
            actorId: char.id,
            actorName: char.name,
            avatar: char.avatar,
          },
          ...(attachments.length ? { attachments } : {}),
        },
      });
      void updateChat(id, { lastMessageAt: spokeMessage.timestamp, latestMessage: spokeMessage });
      const recentMessagesWithSpeaker = [...recentMessages.filter((message) => message.id !== spokeMessage.id), spokeMessage];
      await commitPersistedManualRuntime(spokeMessage, recentMessagesWithSpeaker);
      startConversationLoopIfNeeded(chat);
    });
  }, [addMessageStable, chat, commitPersistedManualRuntime, currentChatMessages, effectiveSpeakAsChar, enqueueManualInput, getNextMessageTimestamp, id, startConversationLoopIfNeeded, updateChat]);

  const { runSessionAction, triggerPairPrivateThread, normalizeAndRunSurfaceIntent, runAutoSocialEventFlow } = useChatSurfaceActions({
    chat,
    chats,
    characters,
    updateChat,
    addMessage: addMessageStable,
    appendEventMessage: appendEventMessageStable,
    actionSchema,
    aiProfiles,
    speakAsChar: effectiveSpeakAsChar,
    handleGuideSend,
    handleMemberSpeakSend,
    handleSpeakAs,
    setSnackbar,
  });

  const storyChoiceSourceMessage = useMemo(
    () => findVisibleStoryChoiceSourceMessage({
      isStoryRoom,
      phase: chat?.scenarioState?.phase,
      messages: currentChatMessages,
    }),
    [chat?.scenarioState?.phase, currentChatMessages, isStoryRoom],
  );
  const storyBranchOptions = useMemo(
    () => buildVisibleStoryBranchOptions({
      isStoryRoom,
      chat,
      sourceMessage: storyChoiceSourceMessage,
    }),
    [chat, isStoryRoom, storyChoiceSourceMessage],
  );
  useEffect(() => {
    if (!isStoryRoom || chat?.scenarioState?.phase !== 'choice') {
      pendingStoryChoiceRef.current = null;
      setPendingStoryChoiceKey(null);
    }
  }, [chat?.scenarioState?.phase, isStoryRoom]);
  const isCurrentStoryChoiceSubmitting = isStoryChoicePending({
    pendingKey: pendingStoryChoiceKey,
    chatId: id,
    choiceEpoch: chat?.scenarioState?.choiceEpoch,
    sourceMessageId: storyChoiceSourceMessage?.id,
  });
  const visibleStoryBranchOptions = isCurrentStoryChoiceSubmitting ? [] : storyBranchOptions;
  const storyChoiceGate = useMemo(
    () => getStoryChoiceGateState(chat, currentChatMessages),
    [chat, currentChatMessages],
  );
  const visibleActionPanelActions = useMemo(
    () => (projectedActionPanelActions.length ? projectedActionPanelActions : sessionActions)
      .filter((action) => action.type !== 'choose_story_branch'),
    [projectedActionPanelActions, sessionActions],
  );
  const isStoryWaitingForChoice = chat?.sessionKind?.scenarioId === 'story-reader'
    && !isCurrentStoryChoiceSubmitting
    && storyChoiceGate.waiting;
  const displayedStoryChoiceVisual = pendingStoryChoiceVisual;
  const displayedStoryChoiceMessageId = isStoryWaitingForChoice
    ? storyChoiceSourceMessage?.id
    : displayedStoryChoiceVisual?.sourceMessageId || null;
  const displayedStoryChoiceOptions = isStoryWaitingForChoice
    ? visibleStoryBranchOptions
    : displayedStoryChoiceVisual?.options || [];
  const displayedStoryChoiceSubmittingValue = isStoryWaitingForChoice
    ? null
    : displayedStoryChoiceVisual?.selectedValue || null;
  const runLoopStatusContent = (chatError || runLoopError) ? (
    <Alert severity="error" variant="outlined" sx={{ mx: { xs: 1.25, sm: 2 }, mt: 1, borderRadius: 3 }}>
      {chatError || runLoopError}
    </Alert>
  ) : null;
  const handleChooseStoryBranch = useCallback(async (optionValue: string) => {
    if (!chat || !id) return;
    const option = storyBranchOptions.find((item) => item.value === optionValue);
    const branches = chat.scenarioState?.branches || [];
    const currentEpoch = Number(chat.scenarioState?.choiceEpoch || 0);
    const currentBranches = branches.filter((branch) => Number(branch.choiceEpoch || 0) === currentEpoch);
    const selectedBranch = currentBranches.find((branch) => branch.branchId === optionValue)
      || currentBranches.find((branch) => branch.label === option?.label && branch.prompt === option?.prompt)
      || currentBranches.find((branch) => branch.label === option?.label);
    const branchId = selectedBranch?.branchId || optionValue;
    const storyDirection = sanitizeStoryChoicePrompt(selectedBranch?.prompt || selectedBranch?.description || option?.prompt || option?.label || chat.scenarioState?.storyDirection || '');
    const choiceLabel = option?.label || selectedBranch?.label || storyDirection || branchId;
    const choiceKey = buildStoryChoicePendingKey({
      chatId: id,
      choiceEpoch: chat.scenarioState?.choiceEpoch,
      sourceMessageId: storyChoiceSourceMessage?.id,
    });
    if (pendingStoryChoiceRef.current === choiceKey) return;
    pendingStoryChoiceRef.current = choiceKey;
    setPendingStoryChoiceKey(choiceKey);
    setIsExplicitContinuationScrollFollowSuspended(true);
    if (pendingStoryChoiceVisualTimerRef.current) clearTimeout(pendingStoryChoiceVisualTimerRef.current);
    if (storyChoiceSourceMessage?.id) {
      setPendingStoryChoiceVisual({
        key: choiceKey,
        sourceMessageId: storyChoiceSourceMessage.id,
        selectedValue: optionValue,
        options: storyBranchOptions,
      });
      pendingStoryChoiceVisualTimerRef.current = setTimeout(() => {
        pendingStoryChoiceVisualTimerRef.current = null;
        setPendingStoryChoiceVisual((current) => (current?.key === choiceKey ? null : current));
      }, STORY_CHOICE_COLLAPSE_MS);
    }
    logDeveloperDiagnostic('story-choice:select', {
      chatId: id,
      optionValue,
      branchId,
      choiceLabel,
      choiceEpoch: chat.scenarioState?.choiceEpoch || null,
      sourceMessageId: storyChoiceSourceMessage?.id || null,
      gateBeforeAction: storyChoiceGate,
    }, 'info');
    let actionSucceeded = false;
    try {
      const choiceMessage = await addMessageStable({
        chatId: id,
        type: 'user',
        senderId: 'user',
        senderName: currentUser?.nickname?.trim() || '我',
        content: `我选择：${choiceLabel}`,
        emotion: 0,
        timestamp: getNextMessageTimestamp(),
        metadata: {
          storyChoiceSelection: {
            branchId,
            sourceMessageId: storyChoiceSourceMessage?.id,
            label: choiceLabel,
            prompt: storyDirection || null,
            intent: option?.intent || selectedBranch?.intent || null,
            risk: option?.risk || selectedBranch?.risk || null,
            reward: option?.reward || selectedBranch?.reward || null,
            choiceEpoch: chat.scenarioState?.choiceEpoch,
          },
        },
      });
      void updateChat(id, { lastMessageAt: choiceMessage.timestamp, latestMessage: choiceMessage });
      const actionResult = await runSessionAction({ type: 'choose_story_branch', actorId: 'user' }, { branchId, prompt: storyDirection });
      actionSucceeded = true;
      logDeveloperDiagnostic('story-choice:action-result', {
        chatId: id,
        branchId,
        choiceEpoch: chat.scenarioState?.choiceEpoch || null,
        chatPatchPhase: actionResult?.chatPatch?.scenarioState?.phase || null,
        chatPatchChoiceEpoch: actionResult?.chatPatch?.scenarioState?.choiceEpoch || null,
        hasChatPatch: Boolean(actionResult?.chatPatch),
      }, actionResult?.chatPatch?.scenarioState?.phase === 'branch' ? 'info' : 'warn');
      const nextChat = actionResult?.chatPatch ? {
        ...chat,
        ...actionResult.chatPatch,
        scenarioState: {
          ...(chat.scenarioState || {}),
          ...(actionResult.chatPatch.scenarioState || {}),
        },
        worldState: {
          ...chat.worldState,
          ...(actionResult.chatPatch.worldState || {}),
        },
      } : chat;
      await updateChat(id, actionResult?.chatPatch || {});
      setIsStoryGenerationCancelled(false);
      const startBlockReason = startConversationLoopIfNeeded(nextChat, { ignoreReaderPositionOnce: true, immediate: true });
      if (startBlockReason) {
        logDeveloperDiagnostic('story-choice:start-blocked-after-select', {
          chatId: id,
          branchId,
          startBlockReason,
          nextPhase: nextChat.scenarioState?.phase || null,
        }, 'warn');
        setSnackbar({ open: true, message: startBlockReason === 'waiting_story_choice' ? '剧情选择已记录，但运行仍在等待选择，请查看开发者日志。' : '剧情选择已记录，但运行没有启动，请查看开发者日志。', severity: 'error' });
      }
    } finally {
      if (!actionSucceeded && pendingStoryChoiceRef.current === choiceKey) {
        pendingStoryChoiceRef.current = null;
        setPendingStoryChoiceKey(null);
        setPendingStoryChoiceVisual((current) => (current?.key === choiceKey ? null : current));
      }
    }
  }, [addMessageStable, chat, currentUser?.nickname, getNextMessageTimestamp, id, runSessionAction, setSnackbar, startConversationLoopIfNeeded, storyBranchOptions, storyChoiceGate, storyChoiceSourceMessage?.id, updateChat]);

  const handleStoryCustomDirectionSend = useCallback(async (content: string, attachments: MessageAttachment[] = []) => {
    if (!chat || !id) return;
    const storyDirection = sanitizeStoryChoicePrompt(content);
    if (!storyDirection) return;
    if (attachments.length) {
      setSnackbar({ open: true, message: '故事房自定义走向暂不支持附件，请用文字描述你想推动的剧情。', severity: 'error' });
      return;
    }
    await enqueueManualInput(async () => {
      const choiceKey = buildStoryChoicePendingKey({
        chatId: id,
        choiceEpoch: chat.scenarioState?.choiceEpoch,
        sourceMessageId: storyChoiceSourceMessage?.id,
      });
      if (pendingStoryChoiceRef.current === choiceKey) return;
      pendingStoryChoiceRef.current = choiceKey;
      setPendingStoryChoiceKey(choiceKey);
      setIsExplicitContinuationScrollFollowSuspended(true);
      let actionSucceeded = false;
      try {
        const choiceMessage = await addMessageStable({
          chatId: id,
          type: 'user',
          senderId: 'user',
          senderName: currentUser?.nickname?.trim() || '我',
          content: `我选择：${storyDirection}`,
          emotion: 0,
          timestamp: getNextMessageTimestamp(),
          metadata: {
            storyChoiceSelection: {
              branchId: '__custom_story_branch',
              sourceMessageId: storyChoiceSourceMessage?.id,
              label: storyDirection,
              prompt: storyDirection,
              intent: null,
              risk: null,
              reward: null,
              choiceEpoch: chat.scenarioState?.choiceEpoch,
            },
          },
        });
        void updateChat(id, { lastMessageAt: choiceMessage.timestamp, latestMessage: choiceMessage });
        const actionResult = await runSessionAction(
          { type: 'choose_story_branch', actorId: 'user' },
          { branchId: '__custom_story_branch', prompt: storyDirection },
        );
        actionSucceeded = true;
        logDeveloperDiagnostic('story-choice:custom-action-result', {
          chatId: id,
          choiceEpoch: chat.scenarioState?.choiceEpoch || null,
          chatPatchPhase: actionResult?.chatPatch?.scenarioState?.phase || null,
          chatPatchChoiceEpoch: actionResult?.chatPatch?.scenarioState?.choiceEpoch || null,
          hasChatPatch: Boolean(actionResult?.chatPatch),
        }, actionResult?.chatPatch?.scenarioState?.phase === 'branch' ? 'info' : 'warn');
        const nextChat = actionResult?.chatPatch ? {
          ...chat,
          ...actionResult.chatPatch,
          scenarioState: {
            ...(chat.scenarioState || {}),
            ...(actionResult.chatPatch.scenarioState || {}),
          },
          worldState: {
            ...chat.worldState,
            ...(actionResult.chatPatch.worldState || {}),
          },
        } : chat;
        await updateChat(id, actionResult?.chatPatch || {});
        setIsStoryGenerationCancelled(false);
        const startBlockReason = startConversationLoopIfNeeded(nextChat, { ignoreReaderPositionOnce: true, immediate: true });
        if (startBlockReason) {
          logDeveloperDiagnostic('story-choice:start-blocked-after-custom-direction', {
            chatId: id,
            startBlockReason,
            nextPhase: nextChat.scenarioState?.phase || null,
          }, 'warn');
          setSnackbar({ open: true, message: startBlockReason === 'waiting_story_choice' ? '剧情选择已记录，但运行仍在等待选择，请查看开发者日志。' : '剧情选择已记录，但运行没有启动，请查看开发者日志。', severity: 'error' });
        }
      } finally {
        if (!actionSucceeded && pendingStoryChoiceRef.current === choiceKey) {
          pendingStoryChoiceRef.current = null;
          setPendingStoryChoiceKey(null);
        }
      }
    });
  }, [addMessageStable, chat, currentUser?.nickname, enqueueManualInput, getNextMessageTimestamp, id, runSessionAction, setSnackbar, startConversationLoopIfNeeded, storyChoiceSourceMessage?.id, updateChat]);
  const storyTailStatus = getStoryTailStatus({
    hasRunLoopStatus: Boolean(runLoopStatusContent),
    isStoryChoiceSubmitting: isCurrentStoryChoiceSubmitting,
    isGeneratingStoryNode: Boolean(isStoryRoom && !isStoryWaitingForChoice && !isCurrentStoryChoiceSubmitting && isRunning && !isPaused && (thinkingId || hasPendingTurnWork())),
    isGenerationCancelled: Boolean(isStoryRoom && isStoryGenerationCancelled && !isStoryWaitingForChoice && !isCurrentStoryChoiceSubmitting),
    isWaitingForReaderTail: Boolean(isStoryRoom && !isStoryWaitingForChoice && !isCurrentStoryChoiceSubmitting && isRunning && !isPaused && !thinkingId && !hasPendingTurnWork() && !isStoryReaderAtTail),
  });
  const handleCancelStoryGeneration = useCallback(() => {
    setIsStoryGenerationCancelled(true);
    cancelActiveConversationLoop('story_generation_cancelled');
  }, [cancelActiveConversationLoop]);
  const handleContinueStoryGeneration = useCallback(() => {
    if (!chat || !id) return;
    setIsStoryGenerationCancelled(false);
    setIsExplicitContinuationScrollFollowSuspended(true);
    resume();
    const startBlockReason = startConversationLoopIfNeeded(chat, { ignoreReaderPositionOnce: true, immediate: true });
    if (startBlockReason) {
      logDeveloperDiagnostic('story-run:continue-blocked-after-cancel', {
        chatId: id,
        startBlockReason,
        phase: chat.scenarioState?.phase || null,
        storyChoiceGate,
      }, startBlockReason === 'waiting_story_choice' ? 'info' : 'warn');
    }
  }, [chat, id, resume, startConversationLoopIfNeeded, storyChoiceGate]);
  const hasStoryTailStatusContent = Boolean(runLoopStatusContent)
    || storyTailStatus === 'submitting_choice'
    || storyTailStatus === 'generating_node'
    || storyTailStatus === 'generation_cancelled';
  const storyBranchSuggestionContent = hasStoryTailStatusContent ? (
    <>
      {runLoopStatusContent}
      {storyTailStatus === 'submitting_choice' ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 3 }, pt: 0.75, pb: 1.5 }}>
          <Chip
            size="small"
            label="正在进入你选择的剧情"
            variant="outlined"
            sx={(theme) => ({
              borderRadius: 2,
              px: 0.8,
              py: 1.75,
              fontWeight: 700,
              bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(15,23,42,0.72)',
              boxShadow: '0 8px 22px rgba(15,23,42,0.10)',
            })}
          />
        </Box>
      ) : null}
      {storyTailStatus === 'generating_node' ? (
        <Box data-message-id="story-generating-next-node" data-message-type="story-loading" sx={{ display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 3 }, pt: 0.75, pb: 1.5 }}>
          <Box
            sx={(theme) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              maxWidth: '100%',
              px: 1.4,
              py: 0.9,
              borderRadius: 2,
              border: '1px solid',
              borderColor: theme.palette.mode === 'light' ? 'rgba(148,163,184,0.28)' : 'rgba(226,232,240,0.14)',
              bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(15,23,42,0.72)',
              boxShadow: '0 8px 22px rgba(15,23,42,0.10)',
            })}
          >
            <CircularProgress size={16} thickness={4} />
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              正在生成下一节
            </Typography>
            <Button size="small" variant="text" onClick={handleCancelStoryGeneration} sx={{ minWidth: 0, px: 0.75 }}>
              停止
            </Button>
          </Box>
        </Box>
      ) : null}
      {storyTailStatus === 'generation_cancelled' ? (
        <Box data-message-id="story-generation-cancelled" data-message-type="story-loading" sx={{ display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 3 }, pt: 0.75, pb: 1.5 }}>
          <Box
            sx={(theme) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              maxWidth: '100%',
              px: 1.4,
              py: 0.9,
              borderRadius: 2,
              border: '1px solid',
              borderColor: theme.palette.mode === 'light' ? 'rgba(148,163,184,0.28)' : 'rgba(226,232,240,0.14)',
              bgcolor: theme.palette.mode === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.78)',
              boxShadow: '0 8px 22px rgba(15,23,42,0.10)',
            })}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              生成已停止
            </Typography>
            <Button size="small" variant="contained" onClick={handleContinueStoryGeneration} sx={{ minWidth: 0, px: 1 }}>
              继续
            </Button>
          </Box>
        </Box>
      ) : null}
    </>
  ) : null;
  const messageListBottomInset = isRemoteDeletedChat
    ? { xs: '24px', sm: '24px' }
    : hasStoryTailStatusContent
      ? { xs: 'calc(136px + env(safe-area-inset-bottom, 0px))', sm: '124px' }
      : { xs: 'calc(96px + env(safe-area-inset-bottom, 0px))', sm: '88px' };

  const handleExpressionFeedback = useCallback(async (message: Message, kind: ExpressionFeedbackKind) => {
    if (message.type !== 'ai') return;
    const character = characters.find((item) => item.id === message.senderId);
    if (!character) {
      setSnackbar({ open: true, message: '未找到这个角色，无法记录反馈', severity: 'error' });
      return;
    }
    const patch = buildExpressionFeedbackPatch({ character, message, kind });
    await updateCharacter(character.id, patch);
    setSnackbar({ open: true, message: `已记录反馈：${getExpressionFeedbackLabel(kind)}`, severity: 'success' });
  }, [characters, updateCharacter]);

  const handleRetryMedia = useCallback(async (message: Message, attachmentId: string) => {
    const character = message.type === 'ai' ? characters.find((item) => item.id === message.senderId) : null;
    const { retryRichMessageMedia } = await import('../services/richMessageMedia');
    await retryRichMessageMedia({
      message,
      attachmentId,
      character,
      characters,
      aiProfiles,
      upsertMessage: upsertMessageStable,
    });
  }, [aiProfiles, characters, upsertMessageStable]);

  useChatAutoSocialFlow({ chat, runAutoSocialEventFlow });

  const handleLoadOlderMessages = useCallback(async () => {
    if (!id || loadingMoreRef.current || !hasMore || currentChatMessages.length === 0) return;
    loadingMoreRef.current = true;
    try {
      await loadMessages(id, { append: true, before: currentChatMessages[0].timestamp, limit: CHAT_MESSAGE_WINDOW_SIZE });
    } finally {
      loadingMoreRef.current = false;
    }
  }, [currentChatMessages, hasMore, id, loadMessages]);

  const handleLoadNewerMessages = useCallback(async () => {
    if (!id || loadingMoreRef.current || !hasMoreNewer || currentChatMessages.length === 0) return;
    const latestTimestamp = currentChatMessages.at(-1)?.timestamp;
    if (latestTimestamp === undefined) return;
    loadingMoreRef.current = true;
    try {
      await loadMessages(id, { append: true, after: latestTimestamp, limit: CHAT_MESSAGE_WINDOW_SIZE });
    } finally {
      loadingMoreRef.current = false;
    }
  }, [currentChatMessages, hasMoreNewer, id, loadMessages]);

  const handleNearTop = useCallback(() => {
    void handleLoadOlderMessages();
  }, [handleLoadOlderMessages]);

  const handleNearBottom = useCallback(() => {
    void handleLoadNewerMessages();
  }, [handleLoadNewerMessages]);

  const handleJumpToConversationBottom = useCallback(async () => {
    if (!id) return;
    if (hasMoreNewer) {
      await openChatWindow(id, { limit: CHAT_MESSAGE_WINDOW_SIZE, revalidate: true, resetWindow: true });
      await waitForNextFrame();
    }
    const scrollContainer = document.querySelector<HTMLElement>('[data-chat-message-list]');
    scrollContainer?.scrollTo({ top: scrollContainer.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [hasMoreNewer, id, openChatWindow]);

  const fromTab = useMemo(() => new URLSearchParams(window.location.search).get('fromTab'), []);

  const handleHeaderBack = useCallback(() => {
    navigate(fromTab ? `/chats?tab=${fromTab}` : '/chats');
  }, [fromTab, navigate]);

  const handleStoryChapterClick = useCallback(async (chapter: StoryChapterState) => {
    const messageId = chapter.startMessageId;
    if (!id || !messageId) return;
    if (chapter.openedAt) {
      await loadMessages(id, { aroundTimestamp: chapter.openedAt, limit: CHAT_MESSAGE_WINDOW_SIZE * 2 });
      await waitForNextFrame();
    }
    setMessageScrollRequest({
      key: `story-chapter:${chapter.id}:${messageId}:${chapter.openedAt || 0}:${Date.now()}`,
      messageId,
      offsetTop: isSplitDetailPane ? 84 : 96,
      sourceTimestamp: chapter.openedAt,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      highlight: true,
    });
    logDeveloperDiagnostic('story-chapter:jump-request', {
      chatId: id,
      chapterId: chapter.id,
      startMessageId: chapter.startMessageId,
      openedAt: chapter.openedAt,
    }, 'info');
  }, [id, isSplitDetailPane, loadMessages]);

  const handleMessageScrollRequestResolved = useCallback((request: MessageListScrollRequest, resolved: boolean) => {
    if (resolved) return;
    if (request.key.startsWith('branch-switch:') || request.key.startsWith('branch-create:')) {
      logDeveloperDiagnostic('chat-scroll:branch-restore-miss', {
        chatId: id,
        requestKey: request.key,
        messageId: request.messageId,
        sourceTimestamp: request.sourceTimestamp,
      }, 'debug', 'message-window');
      return;
    }
    setSnackbar({ open: true, message: '没有定位到章节起点；当前消息窗口或云端分页里缺少对应消息。', severity: 'error' });
    logDeveloperDiagnostic('chat-scroll:request-miss', {
      chatId: id,
      requestKey: request.key,
      messageId: request.messageId,
      sourceTimestamp: request.sourceTimestamp,
    }, 'warn');
  }, [id, setSnackbar]);

  const canAutoRunConversation = chat?.type !== 'direct' && !isRemoteDeletedChat;

  const handleMessageListBottomPinnedChange = useCallback((pinned: boolean) => {
    isStoryReaderAtTailRef.current = pinned;
    setIsStoryReaderAtTail(pinned);
  }, []);

  const handleMessageListNearBottomChange = useCallback((nearBottom: boolean) => {
    if (!nearBottom) return;
    isStoryReaderAtTailRef.current = true;
    setIsStoryReaderAtTail(true);
    setHasStoryReaderReachedTailIntent(true);
    setIsExplicitContinuationScrollFollowSuspended(false);
  }, []);

  const handleStoryReadingPositionChange = useCallback((position: MessageListScrollPosition) => {
    if (!id || !isStoryRoom) return;
    const roundedOffsetTop = Math.round(position.offsetTop);
    const key = `${position.messageId}:${roundedOffsetTop}:${position.pinned ? '1' : '0'}`;
    const now = Date.now();
    const previous = lastReadingPositionPersistRef.current;
    if (previous?.chatId === id && previous.key === key && now - previous.at < STORY_READING_POSITION_SAVE_MS) return;
    lastReadingPositionPersistRef.current = { chatId: id, key, at: now };
    logDeveloperDiagnostic('chat-scroll:save-position', {
      chatId: id,
      messageId: position.messageId,
      offsetTop: roundedOffsetTop,
      pinned: position.pinned,
      sourceTimestamp: position.sourceTimestamp,
    }, 'debug');
    setChatReadingPosition(id, {
      messageId: position.messageId,
      offsetTop: roundedOffsetTop,
      pinned: position.pinned,
      sourceTimestamp: position.sourceTimestamp,
    });
  }, [id, isStoryRoom, setChatReadingPosition]);

  useEffect(() => {
    const effectiveStoryReaderAtTail = resolveEffectiveStoryReaderAtTail({
      isStoryReaderAtTail,
      hasSavedNonTailStoryReadingPosition,
      hasStoryReaderReachedTailIntent,
    });
    if (!shouldAutoStartStoryRoom({
      hasChat: Boolean(chat),
      hasChatId: Boolean(id),
      canAutoRunConversation: Boolean(canAutoRunConversation),
      isStoryRoom,
      isStoryReaderAtTail: effectiveStoryReaderAtTail,
      isRunning,
      isPaused,
      isStoryWaitingForChoice,
      isStoryChoiceSubmitting: isCurrentStoryChoiceSubmitting,
      hasUserDraft: hasStoryUserDraft,
      hasRunLoopError: Boolean(chatError || runLoopError),
      canAutoContinueFromTail: sessionScrollCapabilities.autoContinueFromTail,
    })) return;
    if (!chat || !id) return;
    setIsStoryGenerationCancelled(false);
    logDeveloperDiagnostic('story-run:auto-tail-start', {
      chatId: id,
      phase: chat.scenarioState?.phase || null,
      isStoryReaderAtTail: effectiveStoryReaderAtTail,
      rawStoryReaderAtTail: isStoryReaderAtTail,
      hasSavedNonTailStoryReadingPosition,
      hasStoryReaderReachedTailIntent,
      hasUserDraft: hasStoryUserDraft,
      autoStickToBottom: sessionScrollCapabilities.autoStickToBottom,
      autoContinueFromTail: sessionScrollCapabilities.autoContinueFromTail,
      storyChoiceGate,
    }, 'info');
    resume();
    const startBlockReason = startConversationLoopIfNeeded(chat);
    if (startBlockReason) {
      logDeveloperDiagnostic('story-run:auto-tail-blocked', {
        chatId: id,
        blockReason: startBlockReason,
        phase: chat.scenarioState?.phase || null,
        storyChoiceGate,
      }, startBlockReason === 'waiting_story_choice' ? 'info' : 'warn');
    }
  }, [canAutoRunConversation, chat, chatError, hasSavedNonTailStoryReadingPosition, hasStoryReaderReachedTailIntent, hasStoryUserDraft, id, isCurrentStoryChoiceSubmitting, isPaused, isRunning, isStoryReaderAtTail, isStoryRoom, isStoryWaitingForChoice, resume, runLoopError, sessionScrollCapabilities.autoContinueFromTail, sessionScrollCapabilities.autoStickToBottom, startConversationLoopIfNeeded, storyChoiceGate]);

  const handleHeaderPrimaryAction = useCallback(() => {
    if (!chat || !id || !canAutoRunConversation) return;
    logDeveloperDiagnostic('chat-run:button', {
      chatId: id,
      phase: chat.scenarioState?.phase || null,
      isRunning,
      isPaused,
      isStoryWaitingForChoice,
      visibleChoiceCount: visibleStoryBranchOptions.length,
      storyChoiceGate,
    }, 'info');
    const blockReason = getConversationLoopStartBlockReason({
      conversationType: chat.type,
      isRunning,
      isPaused,
      isStoryChoiceBlocked: isStoryWaitingForChoice,
      hasActiveLoop: false,
    });
    if (blockReason === 'waiting_story_choice') {
      isRunningRef.current = false;
      isPausedRef.current = false;
      stop();
      void updateChat(id, { isActive: false });
      setSnackbar({
        open: true,
        message: storyChoiceGate.mismatch === 'runtime_without_visible_options'
          ? '剧情等待选择，但当前没有可见选项，请查看开发者日志。'
          : '请先选择一个剧情走向',
        severity: 'error',
      });
      return;
    }
    if (!isRunning || isPaused) {
      setIsStoryGenerationCancelled(false);
      resume();
      const startBlockReason = startConversationLoopIfNeeded(chat);
      if (startBlockReason) {
        setSnackbar({
          open: true,
          message: startBlockReason === 'waiting_story_choice'
            ? '请先选择一个剧情走向'
            : '当前会话暂时不能开始运行，请查看开发者日志。',
          severity: 'error',
        });
      }
    } else {
      if (isStoryRoom) setIsStoryGenerationCancelled(true);
      cancelActiveConversationLoop(isStoryRoom ? 'story_header_cancelled' : 'header_cancelled');
    }
  }, [canAutoRunConversation, cancelActiveConversationLoop, chat, id, isPaused, isRunning, isStoryRoom, isStoryWaitingForChoice, resume, setSnackbar, startConversationLoopIfNeeded, stop, storyChoiceGate, updateChat, visibleStoryBranchOptions.length]);

  const headerPrimaryActionButton = canAutoRunConversation && !isStoryRoom ? (
    <IconButton onClick={handleHeaderPrimaryAction} color={isRunning && !isPaused ? 'primary' : 'default'}>
      {isRunning && !isPaused ? <PauseIcon /> : <PlayIcon />}
    </IconButton>
  ) : null;

  useEffect(() => {
    setHideMobileBottomNav(true);
    return () => setHideMobileBottomNav(false);
  }, [setHideMobileBottomNav]);

  if (!chat && currentChatMessages.length > 0) {
    return (
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden', position: 'relative' }}>
        <GlassHeader
          title={detailBootstrapComplete
            ? (isZh ? '本地聊天记录' : 'Local messages')
            : (isZh ? '本地聊天记录 · 后台同步中' : 'Local messages · syncing')}
          leading={(
            <IconButton onClick={() => navigate('/chats')}>
              <ArrowBackIcon />
            </IconButton>
          )}
        />
        <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1 }}>
          <MessageList
            key={id}
            messages={currentChatMessages}
            characters={characters}
            selfMemberId={effectiveAiDirectPerspectiveMemberId}
            currentUser={currentUser ? { nickname: currentUser.nickname, avatar: currentUser.avatar } : undefined}
            onCreateRevision={isMessageBranchingEnabled(chat) ? handleCreateMessageRevision : undefined}
            onSwitchRevision={isMessageBranchingEnabled(chat) ? handleSwitchMessageRevision : undefined}
            branchVersionInfoByMessageId={branchVersionInfoByMessageId}
            isLoadingOlder={isLoadingOlder}
            isLoadingNewer={isLoadingNewer}
            hasMore={hasMore}
            hasMoreNewer={hasMoreNewer}
            onReachTop={handleNearTop}
            onReachBottom={handleNearBottom}
            onJumpToConversationBottom={handleJumpToConversationBottom}
            loadingText={t('common.loading')}
            topHint="没有更早的消息"
            topInset={isSplitDetailPane ? { xs: '76px', sm: '76px' } : { xs: 'calc(88px + env(safe-area-inset-top, 0px))', sm: '80px' }}
            bottomInset={{ xs: '24px', sm: '24px' }}
          />
        </Box>
      </Box>
    );
  }

  if (!chat) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', flex: 1, width: '100%', height: '100%', minHeight: 0, p: 3 }}>
        {!isRemoteDeletedChat && (chatsLoading || !detailBootstrapComplete) ? (
          <LoadingState title="正在打开会话" compact />
        ) : (
          <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'center', textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {isRemoteDeletedChat ? '这个会话已在其他设备删除' : '未找到这个会话'}
            </Typography>
            {isRemoteDeletedChat ? (
              <Button size="small" variant="outlined" onClick={() => navigate('/settings/recycle-bin')}>
                查看回收站
              </Button>
            ) : null}
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Box sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
        display: 'block',
        position: 'relative',
        bgcolor: 'background.default',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: (theme) => theme.palette.mode === 'light'
            ? 'repeating-linear-gradient(0deg, rgba(15,23,42,0.030) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(15,23,42,0.024) 0 1px, transparent 1px 28px)'
            : 'repeating-linear-gradient(0deg, rgba(226,232,240,0.030) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(226,232,240,0.024) 0 1px, transparent 1px 28px)',
        },
      }}>
        <GlassHeader
          title={(
            <Box
              component="button"
              type="button"
              onClick={(event) => openChatPreview(event.currentTarget)}
              sx={{
                minWidth: 0,
                maxWidth: '100%',
                p: 0,
                m: 0,
                border: 0,
                bgcolor: 'transparent',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
                display: 'flex',
                alignItems: 'center',
                minHeight: 40,
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {chat.name}
              </Typography>
            </Box>
          )}
          safeAreaTop={!isSplitDetailPane}
          zIndex={4}
          leading={!isSplitDetailPane ? (
            <IconButton onClick={handleHeaderBack} sx={{ flexShrink: 0 }}>
                <ArrowBackIcon />
            </IconButton>
          ) : null}
          actions={isRemoteDeletedChat ? null : (
            <>
              {headerPrimaryActionButton}
              {!isMobile ? (
                <IconButton onClick={toggleRightPanel}>
                <PeopleIcon />
                </IconButton>
              ) : null}
              <IconButton onClick={() => navigate(`/chats/${chat.id}/edit`)}>
                <InfoIcon />
              </IconButton>
            </>
          )}
        />
        {isRemoteDeletedChat ? (
          <Box sx={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: isSplitDetailPane ? 76 : 'calc(88px + env(safe-area-inset-top, 0px))',
            zIndex: 3,
            p: 1.25,
            borderRadius: 1,
            bgcolor: 'warning.light',
            color: 'warning.contrastText',
            boxShadow: 2,
          }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>此会话已在其他设备删除</Typography>
            <Typography variant="caption">当前仅保留本地只读历史；已停止自动生成和新消息提交。</Typography>
          </Box>
        ) : null}
        <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1 }}>
          <MessageList
            key={id}
            messages={currentChatMessages}
            characters={characters}
            currentUser={currentUser ? { nickname: currentUser.nickname, avatar: currentUser.avatar } : undefined}
            onCreateRevision={isMessageBranchingEnabled(chat) ? handleCreateMessageRevision : undefined}
            onSwitchRevision={isMessageBranchingEnabled(chat) ? handleSwitchMessageRevision : undefined}
            branchVersionInfoByMessageId={branchVersionInfoByMessageId}
            onDeleteMessage={deleteMessage}
            onAnalyzeMessage={analyzeMessage}
            onExpressionFeedback={handleExpressionFeedback}
            onRetryMedia={handleRetryMedia}
            onCharacterAvatarClick={openCharacterPreview}
            selfMemberId={effectiveAiDirectPerspectiveMemberId}
            onReachTop={handleNearTop}
            onReachBottom={handleNearBottom}
            onJumpToConversationBottom={handleJumpToConversationBottom}
            isLoadingOlder={isLoadingOlder}
            isLoadingNewer={isLoadingNewer}
            hasMore={hasMore}
            hasMoreNewer={hasMoreNewer}
            loadingText={t('common.loading')}
            topHint="没有更早的消息"
            topInset={isSplitDetailPane ? { xs: '76px', sm: '76px' } : { xs: 'calc(88px + env(safe-area-inset-top, 0px))', sm: '80px' }}
            bottomInset={messageListBottomInset}
            emptyContent={isStoryRoom && storyRoomOpeningPreview ? <StoryRoomOpeningEmptyState preview={storyRoomOpeningPreview} /> : undefined}
            privateConversation={chat.type === 'direct' || chat.type === 'ai_direct'}
            tailContent={undefined}
            storyChoiceMessageId={displayedStoryChoiceMessageId}
            storyChoiceOptions={displayedStoryChoiceOptions}
            storyChoiceSubmittingValue={displayedStoryChoiceSubmittingValue}
            onChooseStoryChoice={isStoryWaitingForChoice ? handleChooseStoryBranch : undefined}
            onBottomPinnedChange={isStoryRoom ? handleMessageListBottomPinnedChange : undefined}
            onNearBottomChange={isStoryRoom ? handleMessageListNearBottomChange : undefined}
            initialScrollPosition={isStoryRoom ? initialStoryReadingPosition : null}
            scrollRequest={messageScrollRequest}
            onScrollRequestResolved={handleMessageScrollRequestResolved}
            onScrollPositionChange={isStoryRoom ? handleStoryReadingPositionChange : undefined}
            narrativeRevealMessageKeys={narrativeRevealMessageKeys}
            onNarrativeRevealComplete={clearNarrativeRevealMessage}
            autoStickToBottom={sessionScrollCapabilities.autoStickToBottom}
          />
        </Box>
        {isRemoteDeletedChat ? null : <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2,
          }}
        >
          {storyBranchSuggestionContent ? (
            <Box
              sx={{
                pointerEvents: 'auto',
                pb: 0.25,
              }}
            >
              {storyBranchSuggestionContent}
            </Box>
          ) : null}
          <SessionComposerHost
            surfaces={effectiveComposerSurfaces}
            speakAsCharacterName={effectiveSpeakAsChar?.name}
            onCloseSpeakAs={effectiveSpeakAsChar && chat.type !== 'ai_direct' ? () => setSpeakAsCharacter(null) : undefined}
            sendingLabel="等待角色发言结束"
            hideSpeakAsChip={chat.type === 'ai_direct'}
            inputCapabilities={effectiveTextInputCapabilities}
            inputCapabilityWarning={effectiveTextInputCapabilityWarning}
            onOpenPanel={isMobile ? () => setRightPanelOpen(true) : undefined}
            onDraftActivity={(activity) => {
              userDraftActivityRef.current = activity;
              if (isStoryRoom) setHasStoryUserDraft(Boolean(activity.hasDraft));
            }}
            onSubmitText={(submission, surface) => {
              if (shouldRouteTextAsStoryCustomDirection({
                isStoryRoom,
                hasSpeakAsCharacter: Boolean(effectiveSpeakAsChar),
                hasGuideTargetMember: Boolean(guideTargetMember),
                content: submission.content,
              })) {
                return handleStoryCustomDirectionSend(submission.content, submission.attachments || []);
              }
              if (!effectiveSpeakAsChar && guideTargetMember && surface.mode === 'guide') {
                const guidedContent = `${guideTargetMember.name}，${submission.content}`;
                setGuideTargetMemberId(null);
                return normalizeAndRunSurfaceIntent(surface, { ...submission, content: guidedContent, actorId: guideTargetMember.id });
              }
              const effectiveSurface = effectiveSpeakAsChar ? { ...surface, mode: 'speakAs' as const, actorId: effectiveSpeakAsChar.id } : surface;
              const effectiveSubmission = effectiveSpeakAsChar ? { ...submission, actorId: effectiveSpeakAsChar.id } : submission;
              return normalizeAndRunSurfaceIntent(effectiveSurface, effectiveSubmission);
            }}
            onSendError={showErrorToast}
            onSubmitForm={(submission, surface) => {
              return normalizeAndRunSurfaceIntent(surface, submission);
            }}
            onSubmitBoard={(submission, surface) => {
              return normalizeAndRunSurfaceIntent(surface, submission);
            }}
          />
        </Box>}
      </Box>

      {isRemoteDeletedChat ? null : <RightPanel
        title={sidebarTitle}
        hideMobileTitle
        titleActions={(
          <IconButton size="small" aria-label="聊天页设置" onClick={() => setChatPageSettingsOpen(true)}>
            <SettingsIcon fontSize="small" />
          </IconButton>
        )}
      >
        <PageSection spacing={2} fill animate={false}>
          <SessionInfoCards cards={globalSessionInfoCards} onOpenChat={(chatId) => navigate(`/chats/${chatId}`)} />
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <LazyPanel>
              {runtimePanelLoading ? <LoadingState title="正在加载" compact /> : <ChatSidebarPanel
                chat={projectedSidebarChat || { ...chat, primaryRecentEvent: projectedRuntimeState?.primaryRecentEvent }}
                members={members}
                messages={sidebarMessages}
                thinkingId={thinkingId}
                rightPanelTab={sidebarTabValue}
                setRightPanelTab={handleSidebarTabChange}
                showMemberTab={showMemberTab}
                showRuntimeTab={showRuntimeTab}
                memberPanelTitle={memberTabTitle}
                runtimePanelTitle={runtimeTabTitle}
                memberFooter={aiDirectSourceInfoCards.length ? (
                  <SessionInfoCards cards={aiDirectSourceInfoCards} onOpenChat={(chatId) => navigate(`/chats/${chatId}`)} />
                ) : null}
                privatePayloads={projectedDetailState?.sidebarChat.privatePayloads || privatePayloads}
                privatePayloadTitle={projectedDetailState?.privatePayloadTitle}
                directMemoryContext={directMemoryPanelContext}
                showActivityTab={showActionTab}
                activityPanel={showActionTab ? (
                  <LazyPanel>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'stretch' }}>
                      <Button size="small" variant="outlined" onClick={() => navigate(`/calendar?conversationId=${chat.id}`)}>
                        查看当前会话日历
                      </Button>
                      <WorldCalendarPanel
                        chats={chats}
                        characters={characters}
                        updateChat={updateChat}
                        isZh={isZh}
                        conversationId={chat.id}
                        compact
                        title="会话日历"
                        subtitle="世界事件驱动的会话活动时间线"
                        showHeader={false}
                      />
                      <ChatSharePanel chat={chat} />
                      <SessionActionPanel title={projectedDetailState?.actionPanel.title || actionPanelTitle} actions={visibleActionPanelActions} onRunAction={runSessionAction} hideHeader frameless />
                    </Box>
                  </LazyPanel>
                ) : null}
                onSpeakAs={(charId) => {
                  setGuideTargetMemberId(null);
                  setSpeakAsCharacter(charId);
                }}
                onGuideMember={chat.type === 'group' ? (charId) => {
                  setSpeakAsCharacter(null);
                  setGuideTargetMemberId(charId);
                } : undefined}
                onSetPerspectiveMember={chat.type === 'ai_direct' ? (charId) => {
                  setAiDirectPerspectiveMemberId(charId);
                } : undefined}
                perspectiveMemberId={effectiveAiDirectPerspectiveMemberId}
                onStartDirectChat={chat.type === 'group' ? handleStartDirectChat : undefined}
                onRemoveMember={chat.type === 'group' ? async (charId) => {
                  const newMembers = chat.memberIds.filter((m) => m !== charId);
                  if (newMembers.length < 2) return;
                  const removedName = members.find((member) => member.id === charId)?.name || charId;
                  await updateChat(chat.id, { memberIds: newMembers });
                  await appendMembershipNotice(`${removedName} 离开群聊`);
                } : undefined}
                onUpdateSeats={chat.type === 'group' ? async (memberIds) => {
                  const previousMembers = new Set(chat.memberIds);
                  const nextMembers = new Set(memberIds);
                  const addedMembers = memberIds.filter((memberId) => !previousMembers.has(memberId));
                  const removedMembers = chat.memberIds.filter((memberId) => !nextMembers.has(memberId));
                  await updateChat(chat.id, {
                    memberIds,
                    scenarioState: {
                      ...chat.scenarioState,
                      seats: memberIds.map((memberId, index) => {
                        const existing = chat.scenarioState?.seats?.find((seat) => seat.actorId === memberId);
                        return {
                          seatId: existing?.seatId || `seat-${index + 1}`,
                          seatIndex: index,
                          actorId: memberId,
                          roleId: existing?.roleId || null,
                          teamId: existing?.teamId || null,
                          displayName: existing?.displayName,
                        };
                      }),
                      turnOrder: memberIds,
                    },
                    layoutState: {
                      slots: memberIds.map((memberId, index) => ({
                        slotId: `slot-${index + 1}`,
                        x: index,
                        y: 0,
                        actorId: memberId,
                      })),
                    },
                  });
                  if (addedMembers.length) {
                    const names = addedMembers.map((memberId) => members.find((member) => member.id === memberId)?.name || memberId);
                    await appendMembershipNotice(`${names.join('、')} 加入群聊`);
                  }
                  if (removedMembers.length) {
                    const names = removedMembers.map((memberId) => members.find((member) => member.id === memberId)?.name || memberId);
                    await appendMembershipNotice(`${names.join('、')} 离开群聊`);
                  }
                } : undefined}
                onStoryChapterClick={handleStoryChapterClick}
              />}
            </LazyPanel>
          </Box>
        </PageSection>
      </RightPanel>}
      <ChatPageSettingsDialog open={chatPageSettingsOpen} onClose={() => setChatPageSettingsOpen(false)} isStoryRoom={isStoryRoom} />

      {analysisDialogOpen ? (
        <LazyPanel>
          <MessageAnalysisDialog
            open={analysisDialogOpen}
            target={analysisTarget}
            members={members}
            text={analysisText}
            loading={analysisLoading}
            error={analysisError}
            onClose={closeAnalysisDialog}
          />
        </LazyPanel>
      ) : null}

      {profilePreview ? (
        <LazyPanel>
          <ProfilePreviewOverlay
            open
            kind={profilePreview.kind}
            anchorRect={profilePreview.anchorRect}
            anchorElement={profilePreview.anchorElement}
            character={profilePreview.kind === 'character' ? profilePreview.character : null}
            chat={chat}
            members={members}
            chatStatusLabel={isRunning && !isPaused ? '运行中' : chat.isActive ? '已暂停' : '未运行'}
            actionLabel={profilePreview.kind === 'character' ? '角色详情' : '群聊详情'}
            actionTiming="immediate"
            onAction={() => {
              if (profilePreview.kind === 'character') {
                navigate(`/characters/${profilePreview.character.id}/edit?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
                return;
              }
              navigate(`/chats/${chat.id}/edit`);
            }}
            onClose={() => setProfilePreview(null)}
          />
        </LazyPanel>
      ) : null}

      <AppSnackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={closeSnackbar}
        severity={snackbar.severity}
        message={snackbar.message}
        offset="composer"
      />
    </Box>
  );
}
