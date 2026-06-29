import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Typography, Button, Divider, IconButton, Chip } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChatIcon from '@mui/icons-material/Chat';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PersonIcon from '@mui/icons-material/Person';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../stores/useAuthStore';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useMessageStore } from '../stores/useMessageStore';
import type { SyncScopeSnapshot } from '../stores/syncScopeMetadata';
import { hasUsableDefaultTextAI } from '../types/settings';
import ChatCard from '../components/chat/ChatCard';
import EmptyState from '../components/common/EmptyState';
import SurfaceCard from '../components/common/SurfaceCard';
import PageSection from '../components/common/PageSection';
import SectionHeader from '../components/common/SectionHeader';
import { avatarGenerationQueue, type AvatarGenerationQueueSummary } from '../services/avatarGenerationQueue';
import type { HomeCompanionshipSnapshot } from '../services/companionshipProjection';
import { shouldShowCompanionshipStatusHints } from '../services/companionshipStatusVisibility';
import { isCloudSyncEnabled } from '../services/cloudSyncPreference';
import { buildHomeSyncOverview } from '../services/homeSyncOverview';
import { buildLocalOutboxProjection, type LocalOutboxArtifactJobLike } from '../services/localOutboxProjection';
import { mirrorLocalOutboxQueues } from '../services/localOutboxMirror';
import { api } from '../services/api';
import { getRegisteredSyncWorkerEntries } from '../stores/storeSyncScheduler';
import { motion, transition } from '../styles/motion';
import { formatAiAmount } from '../utils/aiPoints';

interface HomeOverviewCard {
  label: string;
  value: string | number;
  icon: ReactNode;
  color: string;
  onOpen: () => void | Promise<void>;
  onCreate?: () => void | Promise<void>;
  createLabel?: string;
  attention?: boolean;
}

type OfficialBalanceProvider = 'official-internal' | 'official-gpt';

interface ArtifactHomeState {
  jobs: LocalOutboxArtifactJobLike[];
  syncScopes: SyncScopeSnapshot[];
}

interface ArtifactStoreSnapshotLike {
  jobs: Array<{
    id: string;
    kind: string;
    characterId: string;
    dateKey?: string | null;
    sourceKey?: string | null;
    createdAt: number;
    status: string;
    attempts: number;
    error?: string | null;
    updatedAt: number;
  }>;
  getSyncScopeStates: () => SyncScopeSnapshot[];
}

const EMPTY_ARTIFACT_HOME_STATE: ArtifactHomeState = {
  jobs: [],
  syncScopes: [],
};

const OFFICIAL_BALANCE_PROVIDERS: Array<{
  key: OfficialBalanceProvider;
  backendProvider: 'deepseek' | 'api2d' | 'moacode';
  label: string;
}> = [
  { key: 'official-internal', backendProvider: 'moacode', label: 'AI点数' },
  { key: 'official-gpt', backendProvider: 'api2d', label: 'GPT点数' },
];

function normalizeOfficialBalanceProvider(provider: string): OfficialBalanceProvider | null {
  if (provider === 'official-deepseek' || provider === 'official-moacode' || provider === 'official') return 'official-internal';
  if (provider === 'official-gpt') return 'official-gpt';
  return null;
}

function buildStatGridSx() {
  return {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'repeat(auto-fit, minmax(104px, 1fr))',
      sm: 'repeat(auto-fit, minmax(116px, 142px))',
    },
    columnGap: { xs: 0.75, sm: 1 },
    rowGap: { xs: 1, sm: 1.25 },
    mt: 1,
    px: 0,
    pb: 0.75,
    alignItems: 'stretch',
    justifyContent: { xs: 'stretch', sm: 'start' },
  };
}

function buildStatCellSx() {
  return {
    minWidth: 0,
    display: 'flex',
    justifyContent: 'stretch',
    overflow: 'visible',
  };
}

function buildStatCardSx() {
  return {
    width: '100%',
    height: '100%',
    maxWidth: { xs: 'none', sm: 142 },
    minWidth: 0,
    position: 'relative',
    overflow: 'visible',
    cursor: 'pointer',
    transition: transition(['transform', 'box-shadow', 'border-color'], motion.durations.base, motion.gentleSpring),
    '&:hover': {
      boxShadow: (theme: Theme) => theme.palette.mode === 'light' ? '0 16px 36px rgba(15,23,42,0.08)' : '0 18px 42px rgba(0,0,0,0.34)',
      borderColor: 'primary.main',
    },
    '&:active': {
      transform: 'scale(0.992)',
      transitionTimingFunction: motion.press,
      transitionDuration: `${motion.durations.instant}ms`,
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderTop: '1px solid',
      borderColor: (theme: Theme) => `${theme.palette.primary.main}24`,
      pointerEvents: 'none',
      borderRadius: 'inherit',
    },
  };
}

function buildAttentionCardSx() {
  return {
    ...buildStatCardSx(),
    borderColor: (theme: Theme) => `${theme.palette.primary.main}42`,
    bgcolor: (theme: Theme) => theme.palette.mode === 'light'
      ? 'rgba(49,90,156,0.065)'
      : 'rgba(120,156,220,0.095)',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderTop: '1px solid',
      borderColor: (theme: Theme) => `${theme.palette.primary.main}40`,
      pointerEvents: 'none',
      borderRadius: 'inherit',
    },
  };
}

function buildStatContentSx() {
  return {
    width: '100%',
    textAlign: 'center',
    p: 0,
    '&:last-child': { pb: 0 },
    minHeight: { xs: 78, sm: 88 },
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  };
}

function buildStatCenterSx() {
  return {
    width: '100%',
    minHeight: { xs: 78, sm: 88 },
    py: { xs: 1.15, sm: 1.35 },
    px: { xs: 0.55, sm: 0.9 },
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: { xs: 0.35, sm: 0.45 },
    overflow: 'visible',
  };
}

function buildCreateButtonSx() {
  return {
    position: 'absolute',
    right: -6,
    bottom: -6,
    zIndex: 1,
    width: { xs: 28, sm: 30 },
    height: { xs: 28, sm: 30 },
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    boxShadow: (theme: Theme) => theme.palette.mode === 'light'
      ? '0 10px 24px rgba(15,23,42,0.20)'
      : '0 12px 28px rgba(0,0,0,0.42)',
    border: 2,
    borderColor: 'background.default',
    borderRadius: '50%',
    transition: transition(['transform', 'box-shadow', 'background-color'], motion.durations.base, motion.spring),
    '&:hover': {
      bgcolor: 'primary.dark',
      transform: 'translateY(-1px) scale(1.08)',
      boxShadow: 4,
    },
    '&:active': {
      transform: 'scale(0.93)',
      transitionTimingFunction: motion.press,
      transitionDuration: `${motion.durations.instant}ms`,
    },
    '& .MuiTouchRipple-root': {
      borderRadius: '50%',
    },
  };
}

function buildStatLabelSx() {
  return {
    width: '100%',
    lineHeight: 1.25,
    textAlign: 'center',
    minHeight: { xs: '2.2em', sm: '2.3em' },
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    color: 'text.secondary',
    fontSize: { xs: '0.7rem', sm: '0.78rem' },
    '& > span': {
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    },
  };
}

function buildStatValueSx() {
  return {
    fontWeight: 700,
    lineHeight: 1,
    fontSize: { xs: '1rem', sm: '1.16rem' },
  };
}

function buildStatIconSx(color: string) {
  return {
    color,
    fontSize: { xs: '0.9rem', sm: '1rem' },
    lineHeight: 1,
  };
}

function buildGridSx(columns?: { xs: string; sm: string; lg?: string; xl?: string }) {
  return {
    display: 'grid',
    gridTemplateColumns: columns || {
      xs: '1fr',
      sm: 'repeat(2, minmax(0, 1fr))',
      lg: 'repeat(3, minmax(0, 1fr))',
    },
    gap: 1.5,
  };
}

function projectArtifactHomeState(state: ArtifactStoreSnapshotLike): ArtifactHomeState {
  return {
    jobs: state.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      characterId: job.characterId,
      dateKey: job.dateKey,
      sourceKey: job.sourceKey,
      createdAt: job.createdAt,
      status: job.status,
      attempts: job.attempts,
      error: job.error,
      updatedAt: job.updatedAt,
    })),
    syncScopes: state.getSyncScopeStates(),
  };
}

function areArtifactJobsEqual(a: LocalOutboxArtifactJobLike[], b: LocalOutboxArtifactJobLike[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return Boolean(other)
      && item.id === other.id
      && item.kind === other.kind
      && item.characterId === other.characterId
      && item.dateKey === other.dateKey
      && item.sourceKey === other.sourceKey
      && item.createdAt === other.createdAt
      && item.status === other.status
      && item.attempts === other.attempts
      && item.error === other.error
      && item.updatedAt === other.updatedAt;
  });
}

function areSyncScopeSnapshotsEqual(a: SyncScopeSnapshot[], b: SyncScopeSnapshot[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return Boolean(other)
      && item.scope === other.scope
      && item.lastCheckedAt === other.lastCheckedAt
      && item.lastAppliedAt === other.lastAppliedAt
      && item.cursor === other.cursor
      && item.revision === other.revision
      && item.lastError === other.lastError
      && item.errorCount === other.errorCount
      && item.retryAt === other.retryAt
      && item.inflight === other.inflight;
  });
}

function areArtifactHomeStatesEqual(a: ArtifactHomeState, b: ArtifactHomeState) {
  return areArtifactJobsEqual(a.jobs, b.jobs) && areSyncScopeSnapshotsEqual(a.syncScopes, b.syncScopes);
}

function scheduleIdleTask(callback: () => void, timeout = 1200) {
  const scheduler = (window as typeof window & {
    requestIdleCallback?: (idleCallback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  }).requestIdleCallback;
  if (typeof scheduler === 'function') {
    const idleHandle = scheduler(callback, { timeout });
    return () => window.cancelIdleCallback?.(idleHandle);
  }
  const timeoutHandle = window.setTimeout(callback, Math.min(timeout, 400));
  return () => window.clearTimeout(timeoutHandle);
}

function useDeferredArtifactHomeState() {
  const [artifactState, setArtifactState] = useState<ArtifactHomeState>(EMPTY_ARTIFACT_HOME_STATE);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const cancelScheduled = scheduleIdleTask(() => {
      void import('../stores/useCharacterArtifactStore').then(({ useCharacterArtifactStore }) => {
        if (cancelled) return;
        const applyNextState = (nextState: ArtifactHomeState) => {
          setArtifactState((prev) => areArtifactHomeStatesEqual(prev, nextState) ? prev : nextState);
        };
        applyNextState(projectArtifactHomeState(useCharacterArtifactStore.getState()));
        unsubscribe = useCharacterArtifactStore.subscribe((state) => {
          applyNextState(projectArtifactHomeState(state));
        });
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      cancelScheduled();
    };
  }, []);

  return artifactState;
}

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chats, prefetchChats, markChatsWarm, pendingOperations: chatPendingOperations, getSyncScopeStates: getChatSyncScopeStates } = useChatStore(useShallow((state) => ({
    chats: state.chats,
    prefetchChats: state.prefetchChats,
    markChatsWarm: state.markChatsWarm,
    pendingOperations: state.pendingOperations,
    getSyncScopeStates: state.getSyncScopeStates,
  })));
  const { characters, prefetchCharacters, markCharactersWarm, pendingOperations: characterPendingOperations, getSyncScopeStates: getCharacterSyncScopeStates } = useCharacterStore(useShallow((state) => ({
    characters: state.characters,
    prefetchCharacters: state.prefetchCharacters,
    markCharactersWarm: state.markCharactersWarm,
    pendingOperations: state.pendingOperations,
    getSyncScopeStates: state.getSyncScopeStates,
  })));
  const aiProfiles = useSettingsStore((state) => state.aiProfiles);
  const usageStats = useSettingsStore((state) => state.usageStats);
  const messagePendingOperations = useMessageStore((state) => state.pendingOperations);
  const getMessageSyncScopeStates = useMessageStore((state) => state.getSyncScopeStates);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const { jobs: artifactJobs, syncScopes: artifactSyncScopes } = useDeferredArtifactHomeState();
  const getSettingsSyncScopeStates = useSettingsStore((state) => state.getSyncScopeStates);
  const activeDiaryJobs = artifactJobs.filter((job) => job.kind === 'diary' && (job.status === 'pending' || job.status === 'running')).length;
  const authMode = useAuthStore((state) => state.authMode);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const [avatarQueueSummary, setAvatarQueueSummary] = useState<AvatarGenerationQueueSummary>(() => avatarGenerationQueue.getSummary());
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(() => isCloudSyncEnabled());
  const [workerEntries, setWorkerEntries] = useState(() => getRegisteredSyncWorkerEntries());
  const [aiBalances, setAiBalances] = useState<Partial<Record<OfficialBalanceProvider, number | null>>>({});
  const [companionshipSnapshot, setCompanionshipSnapshot] = useState<HomeCompanionshipSnapshot | null>(null);
  const recentChats = useMemo(() => chats.slice(0, 10), [chats]);
  const recentChatIds = useMemo(() => new Set(recentChats.map((chat) => chat.id)), [recentChats]);
  const recentActiveMessages = useMessageStore(useShallow((state) => (
    state.messages.filter((message) => recentChatIds.has(message.chatId)).slice(-60)
  )));
  const recentWindowMessages = useMessageStore(useShallow((state) => (
    recentChats.flatMap((chat) => (state.messageWindowsByChatId[chat.id]?.messages || []).slice(-20))
  )));

  useEffect(() => {
    markChatsWarm();
    markCharactersWarm();
    void prefetchChats();
    void prefetchCharacters();
  }, [markCharactersWarm, markChatsWarm, prefetchCharacters, prefetchChats]);

  useEffect(() => avatarGenerationQueue.subscribeSummary(setAvatarQueueSummary), []);

  useEffect(() => {
    void mirrorLocalOutboxQueues({
      chatOperations: chatPendingOperations,
      characterOperations: characterPendingOperations,
      messageOperations: messagePendingOperations,
      artifactJobs,
    }).catch((error) => {
      console.warn('[local-outbox] failed to mirror home queues', error);
    });
  }, [artifactJobs, characterPendingOperations, chatPendingOperations, messagePendingOperations]);

  useEffect(() => {
    const update = () => {
      setCloudSyncEnabledState(isCloudSyncEnabled());
      setWorkerEntries(getRegisteredSyncWorkerEntries());
    };
    update();
    const timer = window.setInterval(update, 2500);
    window.addEventListener('pneumata-cloud-sync-preference-changed', update);
    window.addEventListener('pneumata-cloud-sync-bootstrap-lock-changed', update);
    window.addEventListener('online', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pneumata-cloud-sync-preference-changed', update);
      window.removeEventListener('pneumata-cloud-sync-bootstrap-lock-changed', update);
      window.removeEventListener('online', update);
    };
  }, []);

  const customCharacters = characters.filter((character) => !character.isPreset);
  const totalDirectChats = chats.filter((chat) => chat.type === 'direct' || chat.type === 'ai_direct').length;
  const totalGroupChats = chats.filter((chat) => chat.type === 'group').length;
  const openChatFromHome = (chat: typeof chats[number]) => navigate(`/chats/${chat.id}?fromTab=${chat.type === 'group' ? 0 : chat.type === 'ai_direct' ? 2 : 1}`);
  const recentChatsTitle = '最近会话';
  const recentChatsActionTab = recentChats[0]?.type === 'group' ? 0 : recentChats[0]?.type === 'ai_direct' ? 2 : 1;
  const needsAIModelSetup = !hasUsableDefaultTextAI(aiProfiles);
  const needsLogin = authMode === 'local' || !isLoggedIn;
  const enabledOfficialBalanceProviders = useMemo(() => {
    const providerKeys = new Set<OfficialBalanceProvider>();
    aiProfiles.forEach((profile) => {
      const normalized = normalizeOfficialBalanceProvider(profile.provider);
      if (normalized) providerKeys.add(normalized);
    });
    return OFFICIAL_BALANCE_PROVIDERS.filter((provider) => providerKeys.has(provider.key));
  }, [aiProfiles]);
  const canQueryAiPoints = !needsLogin && enabledOfficialBalanceProviders.length > 0;
  const needsOwnCharacter = characters.length > 0 && customCharacters.length === 0;
  const hasActiveAvatarTasks = avatarQueueSummary.active > 0;
  const knownMessages = useMemo(() => [
    ...recentActiveMessages,
    ...recentWindowMessages,
  ], [recentActiveMessages, recentWindowMessages]);
  const recentKnownAiMessageCount = useMemo(() => {
    const keys = new Set<string>();
    const collect = (message: typeof knownMessages[number]) => {
      if (message.type !== 'ai' || message.isDeleted) return;
      keys.add(message.clientKey || message.serverId || message.id);
    };
    knownMessages.forEach(collect);
    return keys.size;
  }, [knownMessages]);
  const aiMessageCount = Math.max(usageStats?.aiMessageCount || 0, recentKnownAiMessageCount);
  const companionshipSettings = useSettingsStore((state) => state.companionship);
  const showCompanionshipStatusHints = shouldShowCompanionshipStatusHints(companionshipSettings);
  useEffect(() => {
    if (!showCompanionshipStatusHints) {
      setCompanionshipSnapshot(null);
      return undefined;
    }
    let cancelled = false;
    const now = Date.now();
    const buildSnapshot = () => {
      void import('../services/companionshipProjection').then(({ buildHomeCompanionshipSnapshot }) => {
        if (cancelled) return;
        setCompanionshipSnapshot(buildHomeCompanionshipSnapshot({
          chats: recentChats,
          characters,
          messages: knownMessages,
          now,
        }));
      });
    };
    const scheduler = (window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    const idleHandle = typeof scheduler === 'function' ? scheduler(buildSnapshot, { timeout: 1800 }) : null;
    const timeoutHandle = idleHandle == null ? window.setTimeout(buildSnapshot, 900) : null;
    return () => {
      cancelled = true;
      if (idleHandle != null) window.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [characters, knownMessages, recentChats, showCompanionshipStatusHints]);
  const syncOverview = useMemo(() => buildHomeSyncOverview({
    cloudSyncAvailable: !needsLogin,
    cloudSyncEnabled,
    operations: buildLocalOutboxProjection({
      chatOperations: chatPendingOperations,
      characterOperations: characterPendingOperations,
      messageOperations: messagePendingOperations,
      artifactJobs,
    }),
    artifactJobs: [],
    syncScopes: [
      ...getCharacterSyncScopeStates(),
      ...getChatSyncScopeStates(),
      ...getMessageSyncScopeStates(),
      ...artifactSyncScopes,
      ...getSettingsSyncScopeStates(),
    ],
    workerEntries,
  }), [
    artifactJobs,
    characterPendingOperations,
    chatPendingOperations,
    cloudSyncEnabled,
    artifactSyncScopes,
    getCharacterSyncScopeStates,
    getChatSyncScopeStates,
    getMessageSyncScopeStates,
    getSettingsSyncScopeStates,
    messagePendingOperations,
    needsLogin,
    workerEntries,
  ]);
  const syncUploadingCount = syncOverview.uploading + syncOverview.pendingUpload;
  const syncDownloadingCount = syncOverview.checkingDownloads + syncOverview.pendingDownload;
  const syncExceptionCount = syncOverview.failedUpload + syncOverview.failedScopes + syncOverview.backoffScopes;
  useEffect(() => {
    if (!canQueryAiPoints) {
      setAiBalances({});
      return;
    }
    let cancelled = false;
    const activeProviderKeys = new Set(enabledOfficialBalanceProviders.map((provider) => provider.key));
    setAiBalances((prev) => Object.fromEntries(
      Object.entries(prev).filter(([providerKey]) => activeProviderKeys.has(providerKey as OfficialBalanceProvider)),
    ) as Partial<Record<OfficialBalanceProvider, number | null>>);
    const loadBalances = () => {
      enabledOfficialBalanceProviders.forEach((provider) => {
        api.getAiBalance(provider.backendProvider)
          .then((balance) => {
            const raw = balance.availableBalance ?? balance.available_balance;
            if (!cancelled) {
              setAiBalances((prev) => ({
                ...prev,
                [provider.key]: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
              }));
            }
          })
          .catch(() => {
            if (!cancelled) {
              setAiBalances((prev) => ({ ...prev, [provider.key]: null }));
            }
          });
      });
    };
    const scheduler = (window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    const idleHandle = typeof scheduler === 'function' ? scheduler(loadBalances, { timeout: 2400 }) : null;
    const timeoutHandle = idleHandle == null ? window.setTimeout(loadBalances, 1200) : null;
    return () => {
      cancelled = true;
      if (idleHandle != null) window.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [canQueryAiPoints, enabledOfficialBalanceProviders]);

  const syncStatusStats: HomeOverviewCard[] = (!needsLogin && cloudSyncEnabled) ? [
    ...(syncUploadingCount > 0 ? [{
      label: syncOverview.uploading > 0 ? `${syncOverview.uploading} 正在上传` : '等待上传',
      value: syncUploadingCount,
      icon: <CloudUploadIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/account/sync-status'),
      attention: syncOverview.uploading > 0,
    }] : []),
    ...(syncDownloadingCount > 0 ? [{
      label: syncOverview.checkingDownloads > 0 ? `${syncOverview.checkingDownloads} 正在下载` : '等待下载',
      value: syncDownloadingCount,
      icon: <CloudDownloadIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/account/sync-status'),
      attention: syncOverview.checkingDownloads > 0,
    }] : []),
    ...(syncExceptionCount > 0 ? [{
      label: '未读同步异常',
      value: syncExceptionCount,
      icon: <SyncProblemIcon />,
      color: 'warning.main',
      onOpen: () => navigate('/account/sync-status'),
      attention: true,
    }] : []),
  ].slice(0, 3) : [];

  const attentionStats: HomeOverviewCard[] = [
    ...(needsLogin ? [{
      label: t('nav.signInSync'),
      value: t('nav.localMode'),
      icon: <PersonIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/login'),
      attention: true,
    }] : []),
    ...(needsAIModelSetup ? [{
      label: '默认文本模型',
      value: '待设置',
      icon: <SettingsSuggestIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/models'),
      attention: true,
    }] : []),
    ...(developerMode ? [{
      label: '开发者模式',
      value: '已开启',
      icon: <DeveloperModeIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/settings'),
      attention: true,
    }] : []),
    ...(needsOwnCharacter ? [{
      label: '自定义角色',
      value: '暂无',
      icon: <PersonIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/characters'),
      attention: true,
    }] : []),
    ...(hasActiveAvatarTasks ? [{
      label: avatarQueueSummary.running > 0
        ? `头像生成中，队列 ${avatarQueueSummary.queued}`
        : '头像等待生成',
      value: avatarQueueSummary.active,
      icon: <AutoAwesomeIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/characters'),
      attention: true,
    }] : []),
    ...(activeDiaryJobs > 0 ? [{
      label: '生成日记',
      value: activeDiaryJobs,
      icon: <MenuBookIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/letters?tab=diary'),
      attention: true,
    }] : []),
  ];

  const stats: HomeOverviewCard[] = [
    ...attentionStats,
    {
      label: t('home.totalChats'),
      value: totalGroupChats,
      icon: <ChatIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/chats?tab=0'),
      onCreate: () => navigate('/chats/create'),
      createLabel: t('chat.create'),
    },
    {
      label: '单聊数量',
      value: totalDirectChats,
      icon: <ChatIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/chats?tab=1'),
      onCreate: () => navigate('/direct/create'),
      createLabel: '创建单聊',
    },
    {
      label: t('home.totalCharacters'),
      value: customCharacters.length,
      icon: <PersonIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/characters'),
      onCreate: () => navigate('/characters/create'),
      createLabel: t('character.create'),
    },
    {
      label: '角色消息',
      value: aiMessageCount,
      icon: <ChatIcon />,
      color: 'primary.main',
      onOpen: () => navigate('/chats?tab=0'),
    },
    ...enabledOfficialBalanceProviders.flatMap((provider) => {
      const balance = aiBalances[provider.key];
      if (balance === null || balance === undefined) return [];
      return [{
        label: provider.label,
        value: formatAiAmount(balance, provider.backendProvider, { compact: true }),
        icon: <AutoAwesomeIcon />,
        color: 'primary.main',
        onOpen: () => navigate('/models'),
      }];
    }),
    ...syncStatusStats,
  ];

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2.5, sm: 3, md: 3.5 }, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 96px)', sm: 3, md: 3.5 } }}>
      <PageSection spacing={3}>
        <SurfaceCard>
          <SectionHeader title="工作台概览" />
          <Box sx={buildStatGridSx()}>
            {stats.map((stat) => (
              <Box key={stat.label} sx={buildStatCellSx()}>
                <SurfaceCard
                  sx={stat.attention ? buildAttentionCardSx() : buildStatCardSx()}
                  contentSx={buildStatContentSx()}
                  onClick={stat.onOpen}
                  aria-label={`${stat.label}快捷入口`}
                >
                  {stat.onCreate ? (
                    <IconButton
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        stat.onCreate?.();
                      }}
                      aria-label={stat.createLabel}
                      sx={buildCreateButtonSx()}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  ) : null}
                  <Box sx={buildStatCenterSx()}>
                    <Box sx={buildStatIconSx(stat.color)}>{stat.icon}</Box>
                    <Typography variant="h5" sx={buildStatValueSx()}>{stat.value}</Typography>
                    <Typography variant="body2" sx={buildStatLabelSx()}><span>{stat.label}</span></Typography>
                  </Box>
                </SurfaceCard>
              </Box>
            ))}
          </Box>
        </SurfaceCard>

        <Divider />

        <SurfaceCard>
          <SectionHeader title={recentChatsTitle} action={<Button size="small" variant="outlined" onClick={() => navigate(`/chats?tab=${recentChatsActionTab}`)}>查看全部</Button>} />
          {companionshipSnapshot ? (
            <Box
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/chats/${companionshipSnapshot.chatId}?fromTab=1`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') navigate(`/chats/${companionshipSnapshot.chatId}?fromTab=1`);
              }}
              sx={{
                mb: 1.5,
                px: 1.5,
                py: 1.25,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.045)' : 'rgba(120,156,220,0.075)',
                cursor: 'pointer',
                transition: transition(['border-color', 'background-color'], motion.durations.base, motion.gentleSpring),
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: (theme: Theme) => theme.palette.mode === 'light' ? 'rgba(49,90,156,0.075)' : 'rgba(120,156,220,0.11)',
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Chip size="small" label={companionshipSnapshot.characterName} variant="outlined" sx={{ height: 22, borderRadius: 999 }} />
                <Typography variant="caption" color="text.secondary">回来以后</Typography>
              </Box>
              <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.55 }}>
                {companionshipSnapshot.text}
              </Typography>
            </Box>
          ) : null}
          {recentChats.length === 0 ? (
            <EmptyState
              icon="🍵"
              message={t('home.noChats')}
              action={<Button variant="outlined" onClick={() => navigate('/chats/create')}>{t('chat.create')}</Button>}
            />
          ) : (
            <Box sx={buildGridSx()}>
              {recentChats.map((chat) => (
                <ChatCard key={chat.id} chat={chat} characters={characters} onClick={() => openChatFromHome(chat)} />
              ))}
            </Box>
          )}
        </SurfaceCard>
      </PageSection>
    </Box>
  );
}
