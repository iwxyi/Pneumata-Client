import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import { Alert, Box, Button, Card, CardContent, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useMessageStore } from '../stores/useMessageStore';
import { ensureCharacterArtifactStoreHydrated, useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import EmptyState from '../components/common/EmptyState';
import { readCloudSyncBootstrapStatus, type CloudSyncBootstrapStatus } from '../services/cloudSyncBootstrapStatus';
import { scheduleSyncWorkersByPriority } from '../stores/storeSyncScheduler';
import { buildOperationsDiffPreview, buildPatchDiffPreview } from '../services/syncDiffPreview';
import type { SyncScopeSnapshot } from '../stores/syncScopeMetadata';
import { clearPersistenceFailures, PERSISTENCE_HEALTH_EVENT, readPersistenceHealth } from '../services/persistenceHealth';
import { buildLocalRecoverySnapshot } from '../services/localRecoveryExport';
import { importLocalRecoverySnapshot, type LocalRecoveryImportResult } from '../services/localRecoveryImport';
import { runLocalPersistenceMaintenance, type LocalPersistenceMaintenanceResult } from '../services/localPersistenceMaintenance';
import { classifySyncError, parseSyncErrorClassification, type SyncErrorKind } from '../stores/storeSyncHelpers';
import { buildLocalOutboxProjection } from '../services/localOutboxProjection';
import { mirrorLocalOutboxQueues } from '../services/localOutboxMirror';
import { clearLocalOutboxHistory, listLocalOutboxHistory, type LocalOutboxHistoryEntry } from '../services/localOutboxWorkerBridge';
import type { Message } from '../types/message';

function clipText(value: unknown, max = 120) {
  if (value == null) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function summarizePatch(patch: Record<string, unknown> | undefined, isZh: boolean) {
  const keys = Object.keys(patch || {}).filter((key) => key !== 'updatedAt');
  if (!keys.length) return isZh ? '本地操作没有可展示的字段变更' : 'No displayable field changes in this local operation';
  return isZh ? `变更字段：${keys.slice(0, 8).join('、')}${keys.length > 8 ? '...' : ''}` : `Fields: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? '...' : ''}`;
}

function rememberMessageSnapshot(index: Map<string, Message>, message: Message | undefined | null) {
  if (!message) return;
  index.set(message.id, message);
  if (message.clientKey) index.set(message.clientKey, message);
  if (message.serverId) index.set(message.serverId, message);
}

function downloadJson(filename: string, data: unknown) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatTime(value: number, isZh: boolean) {
  if (!value) return isZh ? '未记录' : 'Not recorded';
  return new Date(value).toLocaleString();
}

function summarizeSyncScopeState(state: SyncScopeSnapshot, isZh: boolean) {
  const now = Date.now();
  if (state.inflight) return { label: isZh ? '检查中' : 'Checking', color: 'primary' as const };
  if (state.retryAt > now) return { label: isZh ? '退避中' : 'Backoff', color: 'warning' as const };
  if (state.lastError) return { label: isZh ? '异常' : 'Issue', color: 'error' as const };
  if (state.lastCheckedAt > 0) return { label: isZh ? '已检查' : 'Checked', color: 'success' as const };
  return { label: isZh ? '未检查' : 'Unchecked', color: 'default' as const };
}

function syncErrorKindLabel(kind: SyncErrorKind, isZh: boolean) {
  const labels: Record<SyncErrorKind, string> = {
    auth: isZh ? '鉴权' : 'Auth',
    network: isZh ? '网络' : 'Network',
    server_unavailable: isZh ? '服务端' : 'Server',
    conflict_ignored: isZh ? '冲突忽略' : 'Conflict ignored',
    validation: isZh ? '校验失败' : 'Validation failed',
    unknown: isZh ? '未知' : 'Unknown',
  };
  return labels[kind];
}

function syncErrorKindColor(kind: SyncErrorKind) {
  if (kind === 'network' || kind === 'server_unavailable') return 'warning' as const;
  if (kind === 'conflict_ignored') return 'info' as const;
  if (kind === 'unknown') return 'default' as const;
  return 'error' as const;
}

function resolveDisplayErrorClassification(raw: string | null | undefined) {
  const initial = parseSyncErrorClassification(raw);
  if (initial.kind !== 'unknown' || !initial.message) return initial;
  return parseSyncErrorClassification(classifySyncError(initial.message));
}

type SyncStatusFilterKey =
  | 'all'
  | 'queued'
  | 'syncing'
  | 'failed'
  | 'conflict'
  | 'checking'
  | 'backoff'
  | 'scope_issue'
  | 'checked'
  | `error_kind:${SyncErrorKind}`;

function matchesSyncStatusFilter(item: ReturnType<typeof buildLocalOutboxProjection>[number], filter: SyncStatusFilterKey) {
  if (filter === 'all') return true;
  if (filter === 'queued') return item.status === 'pending';
  if (filter === 'syncing') return item.status === 'syncing';
  if (filter === 'failed') return item.status === 'failed';
  if (filter === 'conflict') return false;
  if (filter.startsWith('error_kind:')) {
    return item.lastError ? resolveDisplayErrorClassification(item.lastError).kind === filter.slice('error_kind:'.length) : false;
  }
  return false;
}

function matchesScopeFilter(state: SyncScopeSnapshot, filter: SyncStatusFilterKey) {
  if (filter === 'all') return true;
  if (filter === 'checking') return state.inflight;
  if (filter === 'backoff') return !state.inflight && state.retryAt > Date.now();
  if (filter === 'scope_issue') return !state.inflight && !(state.retryAt > Date.now()) && Boolean(state.lastError);
  if (filter === 'checked') return !state.inflight && !(state.retryAt > Date.now()) && !state.lastError && state.lastCheckedAt > 0;
  if (filter.startsWith('error_kind:')) {
    return state.lastError ? resolveDisplayErrorClassification(state.lastError).kind === filter.slice('error_kind:'.length) : false;
  }
  return false;
}

function matchesQueueItemFilter(item: { status: string; lastError: string | null }, filter: SyncStatusFilterKey) {
  if (filter === 'all') return true;
  if (filter === 'queued') return item.status === 'pending';
  if (filter === 'syncing') return item.status === 'syncing';
  if (filter === 'failed') return item.status === 'failed';
  if (filter === 'conflict') return item.status === 'conflict';
  if (filter.startsWith('error_kind:')) {
    return item.lastError ? resolveDisplayErrorClassification(item.lastError).kind === filter.slice('error_kind:'.length) : false;
  }
  return false;
}

function isQueueFilter(filter: SyncStatusFilterKey) {
  return filter === 'all' || filter === 'queued' || filter === 'syncing' || filter === 'failed' || filter === 'conflict' || filter.startsWith('error_kind:');
}

function isScopeFilter(filter: SyncStatusFilterKey) {
  return filter === 'all' || filter === 'checking' || filter === 'backoff' || filter === 'scope_issue' || filter === 'checked' || filter.startsWith('error_kind:');
}

function countForFilter(items: { status: string; lastError: string | null }[], scopes: SyncScopeSnapshot[], filter: SyncStatusFilterKey) {
  const queueCount = items.filter((item) => matchesQueueItemFilter(item, filter)).length;
  const scopeCount = scopes.filter((scope) => matchesScopeFilter(scope, filter)).length;
  if (filter === 'queued' || filter === 'syncing' || filter === 'failed' || filter === 'conflict') return queueCount;
  if (filter === 'checking' || filter === 'backoff' || filter === 'scope_issue' || filter === 'checked') return scopeCount;
  return queueCount + scopeCount;
}

function chipVariant(active: boolean) {
  return active ? 'filled' as const : 'outlined' as const;
}

function chipColor(active: boolean, inactive: 'default' | 'primary' | 'error' | 'warning' | 'success' | 'info') {
  return active ? inactive : 'default' as const;
}

function describeScopeTarget(scope: string, area: string, isZh: boolean) {
  const [scopeType, targetId] = scope.split(':');
  if (!targetId) return null;
  if (scopeType === 'messages.window') {
    return isZh ? `关联聊天：${targetId}` : `Related chat: ${targetId}`;
  }
  if (scopeType === 'chats.detail') {
    return isZh ? `目标聊天：${targetId}` : `Target chat: ${targetId}`;
  }
  return isZh ? `${area}目标：${targetId}` : `${area} target: ${targetId}`;
}

function describeScopeFailureHint(scope: string, rawError: string | null | undefined, isZh: boolean) {
  const message = String(rawError || '');
  const [, targetId] = scope.split(':');
  const isLocalChat = typeof targetId === 'string' && targetId.startsWith('local-chat-');
  if (/群聊不存在|聊天不存在|LOCAL_CHAT_NOT_REMOTE|404|不存在/i.test(message)) {
    if (scope.startsWith('messages.window:') && isLocalChat) {
      return isZh
        ? '原因：这批消息依赖的本地临时聊天还没有云端对应记录，或该聊天已被删除，所以消息窗口检查无法继续。先检查该聊天的创建同步是否成功。'
        : 'Cause: this message batch depends on a local temporary chat that does not have a remote record yet, or the chat was deleted. Check whether chat creation synced successfully first.';
    }
    if (scope.startsWith('chats.detail:') && isLocalChat) {
      return isZh
        ? '原因：这个本地临时聊天还没有对应的云端聊天记录，或云端记录已不存在，所以详情检查失败。先检查聊天创建任务。'
        : 'Cause: this local temporary chat does not have a matching remote chat yet, or the remote record no longer exists. Check the chat creation task first.';
    }
    return isZh ? '原因：检查目标在云端不存在，通常是依赖对象尚未上传成功，或已被删除。' : 'Cause: the checked target does not exist in the cloud, usually because a dependency was not uploaded successfully or was deleted.';
  }
  return null;
}

const compactChipSx = {
  borderRadius: 999,
  height: 24,
  '& .MuiChip-label': {
    px: 1.1,
    fontWeight: 600,
  },
};

const SYNC_HISTORY_PAGE_SIZE = 50;

export default function SyncStatusPage() {
  const { i18n } = useTranslation();
  const characterStore = useCharacterStore();
  const chatStore = useChatStore();
  const messageStore = useMessageStore();
  const artifactStore = useCharacterArtifactStore();
  const settingsStore = useSettingsStore();
  const authMode = useAuthStore((s) => s.authMode);
  const isZh = i18n.language.startsWith('zh');
  const [bootstrapStatus, setBootstrapStatus] = useState<CloudSyncBootstrapStatus | null>(() => readCloudSyncBootstrapStatus());
  const [persistenceHealth, setPersistenceHealth] = useState(() => readPersistenceHealth());
  const [importResult, setImportResult] = useState<LocalRecoveryImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [maintenanceResult, setMaintenanceResult] = useState<LocalPersistenceMaintenanceResult | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [isMaintainingPersistence, setIsMaintainingPersistence] = useState(false);
  const [historyItems, setHistoryItems] = useState<LocalOutboxHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historySucceededTotal, setHistorySucceededTotal] = useState(0);
  const [historyFailedTotal, setHistoryFailedTotal] = useState(0);
  const [activeFilter, setActiveFilter] = useState<SyncStatusFilterKey>('all');
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const recoveryImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void ensureCharacterArtifactStoreHydrated();
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const status = event instanceof CustomEvent ? event.detail?.status as CloudSyncBootstrapStatus | null : readCloudSyncBootstrapStatus();
      setBootstrapStatus(status || null);
    };
    window.addEventListener('pneumata-cloud-sync-bootstrap-status-changed', handler);
    return () => window.removeEventListener('pneumata-cloud-sync-bootstrap-status-changed', handler);
  }, []);

  useEffect(() => {
    const handler = () => setPersistenceHealth(readPersistenceHealth());
    window.addEventListener(PERSISTENCE_HEALTH_EVENT, handler);
    return () => window.removeEventListener(PERSISTENCE_HEALTH_EVENT, handler);
  }, []);

  useEffect(() => {
    void mirrorLocalOutboxQueues({
      characterOperations: characterStore.pendingOperations || [],
      chatOperations: chatStore.pendingOperations || [],
      messageOperations: messageStore.pendingOperations || [],
      artifactJobs: artifactStore.jobs || [],
    }).catch((error) => {
      console.warn('[local-outbox] failed to mirror sync status queues', error);
    });
  }, [artifactStore.jobs, characterStore.pendingOperations, chatStore.pendingOperations, messageStore.pendingOperations]);

  const loadHistory = async (offset = 0, append = false) => {
    if (append) {
      setIsLoadingMoreHistory(true);
    } else {
      setIsLoadingHistory(true);
    }
    setHistoryError(null);
    try {
      const result = await listLocalOutboxHistory({ offset, limit: SYNC_HISTORY_PAGE_SIZE });
      setHistoryItems((current) => append ? [...current, ...result.items] : result.items);
      setHistoryTotal(result.total);
      setHistorySucceededTotal(result.succeededTotal);
      setHistoryFailedTotal(result.failedTotal);
      setHistoryHasMore(result.hasMore);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (append) {
        setIsLoadingMoreHistory(false);
      } else {
        setIsLoadingHistory(false);
      }
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [artifactStore.jobs, characterStore.pendingOperations, chatStore.pendingOperations, messageStore.pendingOperations]);

  const localOutboxItems = useMemo(() => buildLocalOutboxProjection({
    characterOperations: characterStore.pendingOperations || [],
    chatOperations: chatStore.pendingOperations || [],
    messageOperations: messageStore.pendingOperations || [],
    artifactJobs: artifactStore.jobs || [],
  }), [artifactStore.jobs, characterStore.pendingOperations, chatStore.pendingOperations, messageStore.pendingOperations]);

  const items = useMemo(() => {
    const characterOperationsById = new Map((characterStore.pendingOperations || []).map((operation) => [operation.id, operation]));
    const chatOperationsById = new Map((chatStore.pendingOperations || []).map((operation) => [operation.id, operation]));
    const messageOperationsById = new Map((messageStore.pendingOperations || []).map((operation) => [operation.id, operation]));
    const artifactJobsById = new Map((artifactStore.jobs || []).map((job) => [job.id, job]));
    const pendingMessageKeys = new Set<string>();
    (messageStore.pendingOperations || []).forEach((operation) => {
      [operation.localMessageId, operation.messageId, operation.payload?.id, operation.payload?.clientKey, operation.payload?.serverId]
        .filter((key): key is string => Boolean(key))
        .forEach((key) => pendingMessageKeys.add(key));
    });
    localOutboxItems
      .filter((outboxItem) => outboxItem.scopeType === 'message')
      .forEach((outboxItem) => {
        if (outboxItem.targetId) pendingMessageKeys.add(outboxItem.targetId);
      });
    const messageSnapshotsByKey = new Map<string, Message>();
    (messageStore.pendingOperations || []).forEach((operation) => rememberMessageSnapshot(messageSnapshotsByKey, operation.payload));
    if (pendingMessageKeys.size > 0) {
      Object.values(messageStore.messageWindowsByChatId || {}).forEach((window) => {
        (window.messages || []).forEach((message) => {
          if (
            pendingMessageKeys.has(message.id)
            || Boolean(message.clientKey && pendingMessageKeys.has(message.clientKey))
            || Boolean(message.serverId && pendingMessageKeys.has(message.serverId))
          ) {
            rememberMessageSnapshot(messageSnapshotsByKey, message);
          }
        });
      });
    }

    const queueItems = localOutboxItems.map((outboxItem) => {
      if (outboxItem.scopeType === 'character') {
        const operation = characterOperationsById.get(outboxItem.id);
        const targetId = operation?.entityId || outboxItem.targetId;
        const localSnapshot = characterStore.characters.find((character) => character.id === targetId) || null;
        return {
          id: outboxItem.id,
          scopeType: 'character' as const,
          scope: isZh ? '角色' : 'Characters',
          kind: outboxItem.kind,
          status: outboxItem.status,
          createdAt: outboxItem.createdAt,
          attemptCount: outboxItem.attemptCount,
          lastError: outboxItem.lastError || null,
          targetCount: outboxItem.targetIds.length || 1,
          targetLabel: localSnapshot?.name || targetId,
          summary: summarizePatch(operation?.patch, isZh),
          diffPreview: buildPatchDiffPreview(operation?.patch),
          exportPayload: {
            operation: operation || outboxItem,
            outboxItem,
            localSnapshot,
          },
        };
      }

      if (outboxItem.scopeType === 'chat') {
        const operation = chatOperationsById.get(outboxItem.id);
        const targetId = operation?.entityId || outboxItem.targetId;
        const localSnapshot = chatStore.chats.find((chat) => chat.id === targetId) || null;
        return {
          id: outboxItem.id,
          scopeType: 'chat' as const,
          scope: isZh ? '聊天' : 'Chats',
          kind: outboxItem.kind,
          status: outboxItem.status,
          createdAt: outboxItem.createdAt,
          attemptCount: outboxItem.attemptCount,
          lastError: outboxItem.lastError || null,
          targetCount: outboxItem.targetIds.length || 1,
          targetLabel: localSnapshot?.name || targetId,
          summary: summarizePatch(operation?.patch, isZh),
          diffPreview: buildPatchDiffPreview(operation?.patch),
          exportPayload: {
            operation: operation || outboxItem,
            outboxItem,
            localSnapshot,
          },
        };
      }

      if (outboxItem.scopeType === 'message') {
        const operation = messageOperationsById.get(outboxItem.id);
        const chatId = operation?.chatId || outboxItem.summaryKey || '';
        const targetMessage = operation?.payload
          || (operation?.localMessageId ? messageSnapshotsByKey.get(operation.localMessageId) : null)
          || (operation?.messageId ? messageSnapshotsByKey.get(operation.messageId) : null)
          || messageSnapshotsByKey.get(outboxItem.targetId);
        const chat = chatStore.chats.find((item) => item.id === chatId);
        return {
          id: outboxItem.id,
          scopeType: 'message' as const,
          scope: isZh ? '消息' : 'Messages',
          kind: outboxItem.kind,
          status: outboxItem.status,
          createdAt: outboxItem.createdAt,
          attemptCount: outboxItem.attemptCount,
          lastError: outboxItem.lastError || null,
          targetCount: outboxItem.targetIds.length || 1,
          targetLabel: chat?.name || chatId || outboxItem.targetId,
          summary: targetMessage?.content ? clipText(targetMessage.content) : (isZh ? '本地消息快照未在当前缓存窗口中找到' : 'Local message snapshot was not found in cached windows'),
          exportPayload: {
            operation: operation || outboxItem,
            outboxItem,
            localSnapshot: targetMessage || null,
            chatSnapshot: chat || null,
          },
        };
      }

      const job = artifactJobsById.get(outboxItem.id);
      const localSnapshot = job
        ? artifactStore.items.find((artifact) => (
          artifact.id === job.id
          || artifact.characterId === job.characterId && artifact.kind === job.kind && artifact.sourceKey === job.sourceKey && artifact.dateKey === job.dateKey
        )) || null
        : null;
      return {
        id: outboxItem.id,
        scopeType: 'artifact' as const,
        scope: isZh ? '信件 / 日记' : 'Letters / Diary',
        kind: outboxItem.kind,
        status: outboxItem.status,
        createdAt: outboxItem.createdAt,
        attemptCount: outboxItem.attemptCount,
        lastError: outboxItem.lastError || null,
        targetCount: outboxItem.targetIds.length || 1,
        targetLabel: job?.snapshot?.name || job?.characterId || outboxItem.targetId,
        summary: [job?.dateKey, job?.sourceKey].filter(Boolean).join(' · ') || outboxItem.summaryKey || (isZh ? '角色经历生成任务' : 'Character artifact generation job'),
        exportPayload: {
          job: job || outboxItem,
          outboxItem,
          localSnapshot,
        },
      };
    });

    const characterDeleteConflicts = (characterStore.remoteDeletedCharacterIds || [])
      .map((id) => ({
        id,
        localSnapshot: characterStore.characters.find((character) => character.id === id) || null,
        pending: (characterStore.pendingOperations || []).filter((operation) => operation.entityId === id && operation.kind !== 'create'),
      }))
      .filter((item) => item.pending.length > 0)
      .map((item) => ({
        id: `character-delete-conflict-${item.id}`,
        scopeType: 'character' as const,
        scope: isZh ? '角色' : 'Characters',
        kind: 'delete_edit_conflict',
        status: 'conflict',
        createdAt: Math.max(...item.pending.map((operation) => operation.clientTimestamp), 0),
        attemptCount: item.pending.reduce((sum, operation) => sum + operation.attemptCount, 0),
        lastError: null,
        targetCount: item.pending.length,
        targetLabel: item.localSnapshot?.name || item.id,
        summary: isZh ? '云端已删除，本地仍有未同步编辑；本地投影会继续保留，等待手动处理。' : 'Remote deleted this item while local edits are still pending. Local projection is preserved for manual resolution.',
        conflictTargetId: item.id,
        diffPreview: buildOperationsDiffPreview(item.pending),
        exportPayload: {
          conflict: 'remote_delete_with_local_pending',
          remoteDeletedId: item.id,
          pendingOperations: item.pending,
          diffPreview: buildOperationsDiffPreview(item.pending),
          localSnapshot: item.localSnapshot,
        },
      }));

    const chatItems = (chatStore.pendingOperations || []).map((item) => ({
      id: item.id,
      scopeType: 'chat' as const,
      scope: isZh ? '聊天' : 'Chats',
      kind: item.kind,
      status: item.status,
      createdAt: item.clientTimestamp,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: item.targetIds.length,
      targetLabel: chatStore.chats.find((chat) => chat.id === item.entityId)?.name || item.entityId,
      summary: summarizePatch(item.patch, isZh),
      diffPreview: buildPatchDiffPreview(item.patch),
      exportPayload: {
        operation: item,
        localSnapshot: chatStore.chats.find((chat) => chat.id === item.entityId) || null,
      },
    }));

    const chatDeleteConflicts = (chatStore.remoteDeletedChatIds || [])
      .map((id) => ({
        id,
        localSnapshot: chatStore.chats.find((chat) => chat.id === id) || chatStore.remoteDeletedChats.find((chat) => chat.id === id) || null,
        pending: (chatStore.pendingOperations || []).filter((operation) => operation.entityId === id && operation.kind !== 'create'),
      }))
      .filter((item) => item.pending.length > 0)
      .map((item) => ({
        id: `chat-delete-conflict-${item.id}`,
        scopeType: 'chat' as const,
        scope: isZh ? '聊天' : 'Chats',
        kind: 'delete_edit_conflict',
        status: 'conflict',
        createdAt: Math.max(...item.pending.map((operation) => operation.clientTimestamp), 0),
        attemptCount: item.pending.reduce((sum, operation) => sum + operation.attemptCount, 0),
        lastError: null,
        targetCount: item.pending.length,
        targetLabel: item.localSnapshot?.name || item.id,
        summary: isZh ? '云端已删除，本地仍有未同步编辑；本地投影会继续保留，等待手动处理。' : 'Remote deleted this item while local edits are still pending. Local projection is preserved for manual resolution.',
        conflictTargetId: item.id,
        diffPreview: buildOperationsDiffPreview(item.pending),
        exportPayload: {
          conflict: 'remote_delete_with_local_pending',
          remoteDeletedId: item.id,
          pendingOperations: item.pending,
          diffPreview: buildOperationsDiffPreview(item.pending),
          localSnapshot: item.localSnapshot,
        },
      }));

    const characterFieldConflicts = (characterStore.fieldConflicts || [])
      .filter((conflict) => conflict.entityType === 'character')
      .map((conflict) => ({
        id: `character-field-conflict-${conflict.entityId}-${conflict.field}`,
        scopeType: 'character' as const,
        scope: isZh ? '角色' : 'Characters',
        kind: 'field_update_conflict',
        status: 'conflict',
        createdAt: conflict.detectedAt,
        attemptCount: 0,
        lastError: null,
        targetCount: 1,
        targetLabel: characterStore.characters.find((character) => character.id === conflict.entityId)?.name || conflict.entityId,
        summary: isZh ? `字段“${conflict.field}”云端也有不同更新；本地待提交值继续显示，等待手动确认。` : `Field "${conflict.field}" also changed remotely. The local pending value remains visible until manually reviewed.`,
        diffPreview: [{
          field: conflict.field,
          value: isZh ? `本地 ${clipText(conflict.localValue, 48)} / 云端 ${clipText(conflict.remoteValue, 48)}` : `Local ${clipText(conflict.localValue, 48)} / Cloud ${clipText(conflict.remoteValue, 48)}`,
        }],
        exportPayload: {
          conflict: 'remote_field_update_with_local_pending',
          ...conflict,
          localSnapshot: characterStore.characters.find((character) => character.id === conflict.entityId) || null,
        },
      }));

    const chatFieldConflicts = (chatStore.fieldConflicts || [])
      .filter((conflict) => conflict.entityType === 'chat')
      .map((conflict) => ({
        id: `chat-field-conflict-${conflict.entityId}-${conflict.field}`,
        scopeType: 'chat' as const,
        scope: isZh ? '聊天' : 'Chats',
        kind: 'field_update_conflict',
        status: 'conflict',
        createdAt: conflict.detectedAt,
        attemptCount: 0,
        lastError: null,
        targetCount: 1,
        targetLabel: chatStore.chats.find((chat) => chat.id === conflict.entityId)?.name || conflict.entityId,
        summary: isZh ? `字段“${conflict.field}”云端也有不同更新；本地待提交值继续显示，等待手动确认。` : `Field "${conflict.field}" also changed remotely. The local pending value remains visible until manually reviewed.`,
        diffPreview: [{
          field: conflict.field,
          value: isZh ? `本地 ${clipText(conflict.localValue, 48)} / 云端 ${clipText(conflict.remoteValue, 48)}` : `Local ${clipText(conflict.localValue, 48)} / Cloud ${clipText(conflict.remoteValue, 48)}`,
        }],
        exportPayload: {
          conflict: 'remote_field_update_with_local_pending',
          ...conflict,
          localSnapshot: chatStore.chats.find((chat) => chat.id === conflict.entityId) || null,
        },
      }));

    return [...characterDeleteConflicts, ...chatDeleteConflicts, ...characterFieldConflicts, ...chatFieldConflicts, ...queueItems].sort((a, b) => b.createdAt - a.createdAt);
  }, [artifactStore.items, artifactStore.jobs, characterStore.characters, characterStore.fieldConflicts, characterStore.pendingOperations, characterStore.remoteDeletedCharacterIds, chatStore.chats, chatStore.fieldConflicts, chatStore.pendingOperations, chatStore.remoteDeletedChatIds, chatStore.remoteDeletedChats, isZh, localOutboxItems, messageStore.messageWindowsByChatId, messageStore.pendingOperations]);

  const syncScopes = useMemo(() => {
    const entries = [
      ...characterStore.getSyncScopeStates().map((state) => ({ area: isZh ? '角色' : 'Characters', state })),
      ...chatStore.getSyncScopeStates().map((state) => ({ area: isZh ? '聊天' : 'Chats', state })),
      ...messageStore.getSyncScopeStates().map((state) => ({ area: isZh ? '消息' : 'Messages', state })),
      ...artifactStore.getSyncScopeStates().map((state) => ({ area: isZh ? '信件 / 日记' : 'Letters / Diary', state })),
      ...settingsStore.getSyncScopeStates().map((state) => ({ area: isZh ? '设置' : 'Settings', state })),
    ];
    const priority = (item: typeof entries[number]) => {
      if (item.state.inflight) return 0;
      if (item.state.retryAt > Date.now()) return 1;
      if (item.state.lastError) return 2;
      if (item.state.lastCheckedAt > 0) return 3;
      return 4;
    };
    return entries.sort((a, b) => priority(a) - priority(b) || b.state.lastCheckedAt - a.state.lastCheckedAt || a.state.scope.localeCompare(b.state.scope));
  }, [artifactStore, characterStore, chatStore, isZh, messageStore, settingsStore]);

  const filteredSyncScopes = useMemo(() => syncScopes.filter((item) => matchesScopeFilter(item.state, activeFilter)), [activeFilter, syncScopes]);
  const visibleSyncScopes = filteredSyncScopes.slice(0, 30);

  const labelMap: Record<string, string> = {
    delete: isZh ? '删除' : 'Delete',
    restore: isZh ? '恢复' : 'Restore',
    purge: isZh ? '彻底删除' : 'Purge',
    empty_deleted: isZh ? '清空回收站' : 'Empty trash',
    create: isZh ? '创建' : 'Create',
    patch: isZh ? '编辑' : 'Edit',
    delete_edit_conflict: isZh ? '远端删除 / 本地编辑冲突' : 'Remote delete / local edit conflict',
    field_update_conflict: isZh ? '字段更新冲突' : 'Field update conflict',
    birth_letter: isZh ? '诞生信' : 'Birth letter',
    final_letter: isZh ? '信件' : 'Letter',
    diary: isZh ? '日记' : 'Diary',
    pending: isZh ? '待同步' : 'Pending',
    syncing: isZh ? '同步中' : 'Syncing',
    failed: isZh ? '同步失败' : 'Failed',
    conflict: isZh ? '冲突' : 'Conflict',
    succeeded: isZh ? '已完成' : 'Succeeded',
    planned: isZh ? '已生成计划' : 'Planned',
    running: isZh ? '准备同步中' : 'Running',
  };

  const retryAll = () => {
    chatStore.retryFailedOperations();
    characterStore.retryFailedOperations();
    messageStore.retryFailedOperations();
    scheduleSyncWorkersByPriority(0);
    void artifactStore.resumeProcessing();
  };

  const discardFailed = (item: { id: string; scopeType: 'character' | 'chat' | 'message' | 'artifact'; status: string }) => {
    if (item.status !== 'failed') return;
    if (item.scopeType === 'character') characterStore.discardFailedOperation(item.id);
    if (item.scopeType === 'chat') chatStore.discardFailedOperation(item.id);
    if (item.scopeType === 'message') messageStore.discardFailedOperation(item.id);
    if (item.scopeType === 'artifact') artifactStore.discardFailedJob(item.id);
  };

  const resolveDeleteEditConflict = (item: typeof items[number], resolution: 'restore_local' | 'discard_local' | 'save_as_new') => {
    if (item.status !== 'conflict') return;
    const targetId = 'conflictTargetId' in item && typeof item.conflictTargetId === 'string' ? item.conflictTargetId : null;
    if (!targetId) return;
    if (item.scopeType === 'character') void characterStore.resolveRemoteDeleteConflict(targetId, resolution);
    if (item.scopeType === 'chat') void chatStore.resolveRemoteDeleteConflict(targetId, resolution);
  };

  const failedCount = localOutboxItems.filter((item) => item.status === 'failed').length;
  const pendingCount = localOutboxItems.filter((item) => item.status === 'pending').length;
  const syncingCount = localOutboxItems.filter((item) => item.status === 'syncing').length;
  const conflictCount = items.filter((item) => item.status === 'conflict').length;
  const checkingCount = syncScopes.filter((item) => item.state.inflight).length;
  const backoffCount = syncScopes.filter((item) => !item.state.inflight && item.state.retryAt > Date.now()).length;
  const scopeIssueCount = syncScopes.filter((item) => !item.state.inflight && !(item.state.retryAt > Date.now()) && Boolean(item.state.lastError)).length;
  const checkedCount = syncScopes.filter((item) => !item.state.inflight && !(item.state.retryAt > Date.now()) && !item.state.lastError && item.state.lastCheckedAt > 0).length;
  const errorKindCounts = useMemo(() => {
    const counts = new Map<SyncErrorKind, number>();
    for (const item of localOutboxItems) {
      if (!item.lastError) continue;
      const kind = parseSyncErrorClassification(item.lastError).kind;
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    for (const item of syncScopes) {
      if (!item.state.lastError) continue;
      const kind = parseSyncErrorClassification(item.state.lastError).kind;
      counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    const order: SyncErrorKind[] = ['auth', 'network', 'server_unavailable', 'conflict_ignored', 'validation', 'unknown'];
    return order
      .map((kind) => ({ kind, count: counts.get(kind) || 0 }))
      .filter((item) => item.count > 0);
  }, [localOutboxItems, syncScopes]);
  const filteredItems = useMemo(() => items.filter((item) => matchesQueueItemFilter(item, activeFilter)), [activeFilter, items]);
  const failedItems = filteredItems.filter((item) => item.status === 'failed');
  const historyShownCount = historyItems.length;
  const filterChipItems = useMemo(() => {
    const base = [
      { key: 'all' as const, label: isZh ? `全部 ${items.length + syncScopes.length}` : `All ${items.length + syncScopes.length}`, color: 'default' as const },
      { key: 'queued' as const, label: isZh ? `待处理队列 ${pendingCount}` : `Queued ${pendingCount}`, color: 'default' as const },
      { key: 'syncing' as const, label: isZh ? `同步执行中 ${syncingCount}` : `Syncing ${syncingCount}`, color: 'primary' as const },
      { key: 'failed' as const, label: isZh ? `同步失败 ${failedCount}` : `Sync failed ${failedCount}`, color: 'error' as const },
      { key: 'conflict' as const, label: isZh ? `冲突待处理 ${conflictCount}` : `Conflicts ${conflictCount}`, color: 'warning' as const },
      { key: 'checking' as const, label: isZh ? `云端检查中 ${checkingCount}` : `Checking ${checkingCount}`, color: 'primary' as const },
      { key: 'backoff' as const, label: isZh ? `检查退避 ${backoffCount}` : `Backoff ${backoffCount}`, color: 'warning' as const },
      { key: 'scope_issue' as const, label: isZh ? `检查异常 ${scopeIssueCount}` : `Check issues ${scopeIssueCount}`, color: 'error' as const },
      { key: 'checked' as const, label: isZh ? `已有检查记录 ${checkedCount}` : `Checked scopes ${checkedCount}`, color: 'success' as const },
    ];
    const errorKinds = errorKindCounts.map((item) => ({
      key: `error_kind:${item.kind}` as const,
      label: `${syncErrorKindLabel(item.kind, isZh)} ${item.count}`,
      color: syncErrorKindColor(item.kind),
    }));
    return [...base, ...errorKinds].filter((item) => item.key === 'all' || countForFilter(items, syncScopes.map((entry) => entry.state), item.key) > 0);
  }, [checkedCount, checkingCount, conflictCount, errorKindCounts, failedCount, isZh, items, pendingCount, scopeIssueCount, syncScopes, syncingCount, backoffCount]);
  const activeFilterCount = useMemo(() => countForFilter(items, syncScopes.map((entry) => entry.state), activeFilter), [activeFilter, items, syncScopes]);
  const exportFailed = () => downloadJson(`pneumata-sync-failed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
    exportedAt: Date.now(),
    authMode,
    items: failedItems.map((item) => ({
      id: item.id,
      scopeType: item.scopeType,
      scope: item.scope,
      kind: item.kind,
      status: item.status,
      createdAt: item.createdAt,
      attemptCount: item.attemptCount,
      lastError: item.lastError,
      targetLabel: item.targetLabel,
      summary: item.summary,
      data: item.exportPayload,
    })),
  });
  const exportItem = (item: typeof items[number]) => downloadJson(`pneumata-sync-${item.scopeType}-${item.id}.json`, {
    exportedAt: Date.now(),
    authMode,
    item,
  });
  const exportBootstrapStatus = () => downloadJson(`pneumata-cloud-sync-bootstrap-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
    exportedAt: Date.now(),
    authMode,
    bootstrapStatus,
  });
  const exportSyncScopes = () => downloadJson(`pneumata-sync-scopes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
    exportedAt: Date.now(),
    authMode,
    scopes: syncScopes,
  });
  const exportPersistenceHealth = async () => {
    const snapshot = await buildLocalRecoverySnapshot({ persistenceFailures: persistenceHealth.failures });
    downloadJson(`pneumata-local-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, snapshot);
  };
  const handleRecoveryImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError(null);
    setImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setImportResult(importLocalRecoverySnapshot(parsed));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };
  const maintainLocalPersistence = async () => {
    setIsMaintainingPersistence(true);
    setMaintenanceError(null);
    setMaintenanceResult(null);
    try {
      const result = await runLocalPersistenceMaintenance();
      setMaintenanceResult(result);
      setPersistenceHealth(readPersistenceHealth());
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMaintainingPersistence(false);
    }
  };
  const clearPersistenceHealth = () => {
    clearPersistenceFailures();
    setPersistenceHealth(readPersistenceHealth());
  };

  const loadMoreHistory = () => {
    if (isLoadingMoreHistory || !historyHasMore) return;
    void loadHistory(historyItems.length, true);
  };

  const clearHistory = async () => {
    setIsClearingHistory(true);
    setHistoryError(null);
    try {
      await clearLocalOutboxHistory();
      setHistoryItems([]);
      setHistoryTotal(0);
      setHistorySucceededTotal(0);
      setHistoryFailedTotal(0);
      setHistoryHasMore(false);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClearingHistory(false);
    }
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, maxWidth: 960, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.5 }}>
            {isZh ? '同步详情' : 'Sync details'}
          </Typography>
          <Tooltip
            title={isZh
              ? '这里显示本地优先的创建、编辑、消息发送和信件/日记生成队列；临时网络失败会自动重试，校验失败会停在失败状态等待处理。放弃失败项只会移除对应同步任务；已经保存在本地的内容不会因此自动删除。'
              : 'This page shows local-first create, edit, message, and artifact queues. Temporary network failures retry automatically; validation failures stay failed for review. Discarding a failed item only removes that sync task, and content already saved locally is not deleted automatically.'}
            arrow
          >
            <IconButton size="small" sx={{ color: 'text.secondary', p: 0.25, alignSelf: 'center' }}>
              <HelpOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', flex: 1, minWidth: 280 }}>
          <Button size="small" variant="outlined" onClick={retryAll} disabled={localOutboxItems.length === 0}>
            {isZh ? '重试全部' : 'Retry all'}
          </Button>
          <Button size="small" variant="outlined" onClick={exportFailed} disabled={failedItems.length === 0}>
            {isZh ? '导出失败项' : 'Export failed'}
          </Button>
          <input
            ref={recoveryImportInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleRecoveryImport}
            style={{ display: 'none' }}
          />
          <Button size="small" variant="outlined" onClick={() => recoveryImportInputRef.current?.click()}>
            {isZh ? '导入本地恢复快照' : 'Import local recovery snapshot'}
          </Button>
          <Button size="small" variant="outlined" onClick={maintainLocalPersistence} disabled={isMaintainingPersistence}>
            {isZh ? '整理并重试本地保存' : 'Clean up and retry local persistence'}
          </Button>
        </Box>
      </Box>

      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 1, flexWrap: 'wrap' }}>
        {filterChipItems.map((item) => (
          <Chip
            key={item.key}
            size="small"
            clickable
            onClick={() => setActiveFilter(item.key)}
            label={item.label}
            variant={chipVariant(activeFilter === item.key)}
            color={chipColor(activeFilter === item.key, item.color)}
            sx={{ ...compactChipSx, cursor: 'pointer' }}
          />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        {activeFilter === 'all'
          ? (isZh ? '当前显示全部同步队列与云端检查项。' : 'Showing all sync queue and cloud check items.')
          : (isZh ? `当前筛选结果 ${activeFilterCount} 项。` : `Showing ${activeFilterCount} filtered items.`)}
      </Typography>


      {authMode === 'local' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {isZh ? '当前为离线本地模式：云同步已关闭，登录后会自动尝试上传本地数据。' : 'You are in local-only offline mode. Cloud sync is disabled and local data will be uploaded automatically after login.'}
        </Alert>
      ) : null}

      {persistenceHealth.latestFailure ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Stack spacing={0.75}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {isZh ? '本地数据保存失败' : 'Local persistence failed'}
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {isZh
                ? `最近失败：${persistenceHealth.latestFailure.name} · ${persistenceHealth.latestFailure.reason === 'quota_exceeded' ? '存储空间不足' : '写入失败'} · ${formatTime(persistenceHealth.latestFailure.at, isZh)}`
                : `Latest failure: ${persistenceHealth.latestFailure.name} · ${persistenceHealth.latestFailure.reason === 'quota_exceeded' ? 'quota exceeded' : 'write failed'} · ${formatTime(persistenceHealth.latestFailure.at, isZh)}`}
              {persistenceHealth.latestFailure.sizeBytes ? ` · ${Math.round(persistenceHealth.latestFailure.sizeBytes / 1024)} KiB` : ''}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button size="small" variant="outlined" color="error" onClick={exportPersistenceHealth}>
                {isZh ? '导出本地恢复快照' : 'Export local recovery snapshot'}
              </Button>
              <Button size="small" variant="outlined" color="error" onClick={maintainLocalPersistence} disabled={isMaintainingPersistence}>
                {isZh ? '整理并重试' : 'Clean up and retry'}
              </Button>
              <Button size="small" color="error" onClick={clearPersistenceHealth}>
                {isZh ? '清除提示' : 'Clear notice'}
              </Button>
            </Stack>
          </Stack>
        </Alert>
      ) : null}

      {maintenanceResult ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          {isZh
            ? `本地保存维护完成：迁移旧副本 ${maintenanceResult.migratedFallbacks.migrated} 个，清理旧副本 ${maintenanceResult.migratedFallbacks.removed} 个，跳过 ${maintenanceResult.migratedFallbacks.skipped} 个，失败 ${maintenanceResult.migratedFallbacks.failed} 个；已重试 ${maintenanceResult.retriedStores.length} 个本地 store 的保存。IndexedDB 当前约 ${Math.round(maintenanceResult.diagnostics.totalBytes / 1024)} KiB。`
            : `Local persistence maintenance finished: migrated ${maintenanceResult.migratedFallbacks.migrated}, removed ${maintenanceResult.migratedFallbacks.removed}, skipped ${maintenanceResult.migratedFallbacks.skipped}, failed ${maintenanceResult.migratedFallbacks.failed}. Retried ${maintenanceResult.retriedStores.length} local stores. IndexedDB is about ${Math.round(maintenanceResult.diagnostics.totalBytes / 1024)} KiB.`}
        </Alert>
      ) : null}

      {maintenanceError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {isZh ? `本地保存维护失败：${maintenanceError}` : `Local persistence maintenance failed: ${maintenanceError}`}
        </Alert>
      ) : null}

      {importResult ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          {isZh
            ? `本地恢复导入完成：角色 ${importResult.counts.characters.imported}，聊天 ${importResult.counts.chats.imported}，消息 ${importResult.counts.messages.imported}，artifact ${importResult.counts.characterArtifacts.imported}；已保留现有较新数据 ${importResult.counts.characters.preserved + importResult.counts.chats.preserved + importResult.counts.messages.preserved + importResult.counts.characterArtifacts.preserved} 项。`
            : `Local recovery import finished: characters ${importResult.counts.characters.imported}, chats ${importResult.counts.chats.imported}, messages ${importResult.counts.messages.imported}, artifacts ${importResult.counts.characterArtifacts.imported}. Preserved newer local records ${importResult.counts.characters.preserved + importResult.counts.chats.preserved + importResult.counts.messages.preserved + importResult.counts.characterArtifacts.preserved}.`}
          {importResult.ignored.length ? ` ${isZh ? '未导入字段：' : 'Ignored fields: '}${importResult.ignored.join(', ')}` : ''}
        </Alert>
      ) : null}

      {importError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {isZh ? `本地恢复导入失败：${importError}` : `Local recovery import failed: ${importError}`}
        </Alert>
      ) : null}

      {bootstrapStatus ? (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent sx={{ display: 'grid', gap: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {isZh ? '云同步开启计划' : 'Cloud sync bootstrap plan'}
              </Typography>
              <Chip
                size="small"
                label={labelMap[bootstrapStatus.state] || bootstrapStatus.state}
                color={bootstrapStatus.state === 'failed' ? 'error' : bootstrapStatus.state === 'succeeded' ? 'success' : 'primary'}
                variant="outlined"
                sx={compactChipSx}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {new Date(bootstrapStatus.updatedAt).toLocaleString()}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" label={isZh ? `待创建角色 ${bootstrapStatus.charactersToCreate}` : `Characters to create ${bootstrapStatus.charactersToCreate}`} variant="outlined" sx={compactChipSx} />
              <Chip size="small" label={isZh ? `已匹配角色 ${bootstrapStatus.charactersAlreadyRemote}` : `Matched characters ${bootstrapStatus.charactersAlreadyRemote}`} variant="outlined" sx={compactChipSx} />
              <Chip size="small" label={isZh ? `待创建聊天 ${bootstrapStatus.chatsToCreate}` : `Chats to create ${bootstrapStatus.chatsToCreate}`} variant="outlined" sx={compactChipSx} />
              <Chip size="small" label={isZh ? `已匹配聊天 ${bootstrapStatus.chatsAlreadyRemote}` : `Matched chats ${bootstrapStatus.chatsAlreadyRemote}`} variant="outlined" sx={compactChipSx} />
              <Chip size="small" label={isZh ? `待重放消息 ${bootstrapStatus.pendingMessageCreates}` : `Pending messages ${bootstrapStatus.pendingMessageCreates}`} variant="outlined" sx={compactChipSx} />
              <Chip size="small" label={isZh ? `同名冲突 ${bootstrapStatus.characterNameConflicts}` : `Name conflicts ${bootstrapStatus.characterNameConflicts}`} color={bootstrapStatus.characterNameConflicts > 0 ? 'warning' : 'default'} variant="outlined" sx={compactChipSx} />
            </Stack>
            {(bootstrapStatus.characterNameConflictDetails || []).length > 0 ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600 }}>
                  {isZh ? '同名角色会保留两份，上传本地角色时自动追加“（本地）”后缀；后续需要在冲突处理页合并。' : 'Same-name characters are kept as separate records. Local uploads get a local suffix and can be merged later.'}
                </Typography>
                <Stack spacing={0.75}>
                  {bootstrapStatus.characterNameConflictDetails?.map((item) => (
                    <Box
                      key={`${item.localId}:${item.remoteId}`}
                      sx={{
                        p: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        display: 'grid',
                        gap: 0.25,
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {item.localName || item.remoteName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {isZh ? `本地 ${item.localId} / 云端 ${item.remoteId}` : `Local ${item.localId} / Cloud ${item.remoteId}`}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
                {bootstrapStatus.characterNameConflictDetailOverflow ? (
                  <Typography variant="caption" color="text.secondary">
                    {isZh ? `另有 ${bootstrapStatus.characterNameConflictDetailOverflow} 条冲突未在页面展开，可导出计划查看。` : `${bootstrapStatus.characterNameConflictDetailOverflow} more conflicts are not expanded here. Export the plan to inspect them.`}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
            {bootstrapStatus.lastError ? (
              <Typography variant="body2" color="error.main">
                {bootstrapStatus.lastError}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {isZh ? '此计划只记录摘要对账结果；完整冲突解决仍会继续补齐。' : 'This records the summary reconcile plan. Full conflict resolution is still being expanded.'}
              </Typography>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="small" variant="outlined" onClick={exportBootstrapStatus}>
                {isZh ? '导出开启计划' : 'Export plan'}
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : null}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {isZh ? '云端检查状态' : 'Cloud check state'}
            </Typography>
            <Button size="small" variant="outlined" onClick={exportSyncScopes} disabled={syncScopes.length === 0}>
              {isZh ? '导出 scope' : 'Export scopes'}
            </Button>
          </Box>
          {filteredSyncScopes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {isScopeFilter(activeFilter)
                ? (isZh ? '当前筛选下没有匹配的云端检查项。' : 'No cloud check item matches the current filter.')
                : (isZh ? '当前筛选不显示云端检查项。' : 'Cloud check items are hidden by the current filter.')}
            </Typography>
          ) : (
            <Stack spacing={1}>
              {visibleSyncScopes.map((item) => {
                const health = summarizeSyncScopeState(item.state, isZh);
                const errorInfo = resolveDisplayErrorClassification(item.state.lastError);
                const targetInfo = describeScopeTarget(item.state.scope, item.area, isZh);
                const failureHint = describeScopeFailureHint(item.state.scope, item.state.lastError, isZh);
                return (
                  <Box
                    key={`${item.area}:${item.state.scope}`}
                    sx={{
                      p: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      display: 'grid',
                      gap: 0.75,
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        <Chip size="small" label={item.area} variant="outlined" sx={compactChipSx} />
                        {item.state.lastError ? null : <Chip size="small" label={health.label} color={health.color} variant="outlined" sx={compactChipSx} />}
                        {item.state.errorCount > 0 ? <Chip size="small" label={isZh ? `失败 ${item.state.errorCount}` : `Errors ${item.state.errorCount}`} color="error" variant="outlined" sx={compactChipSx} /> : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {item.state.scope}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {isZh
                        ? `检查：${formatTime(item.state.lastCheckedAt, isZh)} · 应用：${formatTime(item.state.lastAppliedAt, isZh)}`
                        : `Checked: ${formatTime(item.state.lastCheckedAt, isZh)} · Applied: ${formatTime(item.state.lastAppliedAt, isZh)}`}
                      {item.state.retryAt > Date.now()
                        ? (isZh ? ` · 重试：${formatTime(item.state.retryAt, isZh)}` : ` · Retry: ${formatTime(item.state.retryAt, isZh)}`)
                        : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {isZh
                        ? `cursor：${item.state.cursor || '未记录'} · revision：${item.state.revision || '未记录'}`
                        : `cursor: ${item.state.cursor || 'none'} · revision: ${item.state.revision || 'none'}`}
                    </Typography>
                    {targetInfo ? (
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {targetInfo}
                      </Typography>
                    ) : null}
                    {item.state.lastError ? (
                      <Box sx={{ display: 'grid', gap: 0.35 }}>
                        <Typography variant="caption" color="error.main" sx={{ fontWeight: 700 }}>
                          {syncErrorKindLabel(errorInfo.kind, isZh)}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
                          <Typography variant="body2" color="error.main" sx={{ overflowWrap: 'anywhere', minWidth: 0, lineHeight: 1.5 }}>
                            {errorInfo.message}
                          </Typography>
                          {failureHint ? (
                            <Tooltip title={failureHint} arrow>
                              <IconButton size="small" sx={{ color: 'text.secondary', p: 0.25, mt: '2px', alignSelf: 'flex-start', flexShrink: 0 }}>
                                <HelpOutlineIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                          ) : null}
                        </Box>
                      </Box>
                    ) : null}
                    {item.state.lastError ? null : (
                      <Typography variant="caption" color="text.secondary">
                        {isZh ? '无异常记录' : 'No error recorded'}
                      </Typography>
                    )}
                  </Box>
                );
              })}
              {filteredSyncScopes.length > visibleSyncScopes.length ? (
                <Typography variant="caption" color="text.secondary">
                  {isZh ? `另有 ${filteredSyncScopes.length - visibleSyncScopes.length} 个 scope 未展开，可导出查看。` : `${filteredSyncScopes.length - visibleSyncScopes.length} more scopes are not expanded here. Export to inspect them.`}
                </Typography>
              ) : null}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {isZh ? '同步历史' : 'Sync history'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip size="small" label={isZh ? `已展示 ${historyShownCount} / 共 ${historyTotal}` : `Shown ${historyShownCount} / ${historyTotal}`} variant="outlined" sx={compactChipSx} />
              <Chip size="small" label={isZh ? `成功 ${historySucceededTotal}` : `Succeeded ${historySucceededTotal}`} variant="outlined" color={historySucceededTotal > 0 ? 'success' : 'default'} sx={compactChipSx} />
              <Chip size="small" label={isZh ? `失败 ${historyFailedTotal}` : `Failed ${historyFailedTotal}`} variant="outlined" color={historyFailedTotal > 0 ? 'error' : 'default'} sx={compactChipSx} />
              <Button size="small" variant="outlined" onClick={clearHistory} disabled={isClearingHistory || historyTotal === 0}>
                {isZh ? '清空历史' : 'Clear history'}
              </Button>
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {isZh ? '历史最多保留 1000 条已完成或失败的同步记录，新的记录会顶掉更早记录。' : 'History keeps up to 1000 finished or failed sync records. Newer records evict older ones.'}
          </Typography>
          {historyError ? <Alert severity="error">{isZh ? `历史读取失败：${historyError}` : `Failed to load history: ${historyError}`}</Alert> : null}
          {isLoadingHistory ? (
            <Typography variant="body2" color="text.secondary">{isZh ? '正在加载同步历史…' : 'Loading sync history...'}</Typography>
          ) : historyItems.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{isZh ? '还没有历史记录。' : 'No history yet.'}</Typography>
          ) : (
            <Stack spacing={1}>
              {historyItems.map((item) => (
                <Box key={`history-${item.id}`} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, display: 'grid', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Chip size="small" label={labelMap[item.scopeType] || item.scopeType} variant="outlined" sx={compactChipSx} />
                      <Chip size="small" label={labelMap[item.kind] || item.kind} variant="outlined" sx={compactChipSx} />
                      <Chip size="small" label={labelMap[item.status] || item.status} color={item.status === 'failed' ? 'error' : 'success'} variant="outlined" sx={compactChipSx} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{formatTime(item.updatedAt || item.createdAt, isZh)}</Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {isZh ? `目标：${item.targetId || '未记录'} · 重试 ${item.attemptCount}` : `Target: ${item.targetId || 'none'} · Retries ${item.attemptCount}`}
                  </Typography>
                  {item.lastError ? <Typography variant="body2" color="error.main" sx={{ overflowWrap: 'anywhere' }}>{item.lastError}</Typography> : null}
                </Box>
              ))}
              {historyHasMore ? (
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <Button size="small" variant="outlined" onClick={loadMoreHistory} disabled={isLoadingMoreHistory}>
                    {isLoadingMoreHistory ? (isZh ? '加载中…' : 'Loading...') : (isZh ? '加载更多' : 'Load more')}
                  </Button>
                </Box>
              ) : null}
            </Stack>
          )}
        </CardContent>
      </Card>

      {filteredItems.length === 0 ? (
        <EmptyState variant="plain" message={isQueueFilter(activeFilter) ? (isZh ? '当前筛选下没有匹配的同步队列' : 'No sync queue item matches the current filter') : (isZh ? '当前筛选不显示同步队列' : 'Sync queue items are hidden by the current filter')} />
      ) : (
        <Stack spacing={1.5}>
          {filteredItems.map((item) => (
            <Card key={item.id} variant="outlined">
              <CardContent sx={{ display: 'grid', gap: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" label={item.scope} variant="outlined" sx={compactChipSx} />
                    <Chip size="small" label={labelMap[item.kind] || item.kind} color="primary" variant="outlined" sx={compactChipSx} />
                    <Chip size="small" label={labelMap[item.status] || item.status} color={item.status === 'conflict' ? 'warning' : item.status === 'syncing' ? 'primary' : 'default'} variant="outlined" sx={compactChipSx} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(item.createdAt).toLocaleString()}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {isZh ? `目标数量：${item.targetCount}，重试次数：${item.attemptCount}` : `Targets: ${item.targetCount}, Retries: ${item.attemptCount}`}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {item.targetLabel}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.summary}
                </Typography>
                {'diffPreview' in item && item.diffPreview?.length ? (
                  <Box sx={{ display: 'grid', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      {isZh ? '本地待提交字段' : 'Local pending fields'}
                    </Typography>
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {item.diffPreview.map((diff) => (
                        <Chip
                          key={`${item.id}:${diff.field}`}
                          size="small"
                          variant="outlined"
                          label={`${diff.field}: ${diff.value}`}
                          sx={{ ...compactChipSx, maxWidth: '100%', '& .MuiChip-label': { px: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 } }}
                        />
                      ))}
                    </Stack>
                  </Box>
                ) : null}
                {item.lastError ? (
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Chip
                      size="small"
                      label={syncErrorKindLabel(parseSyncErrorClassification(item.lastError).kind, isZh)}
                      color={syncErrorKindColor(parseSyncErrorClassification(item.lastError).kind)}
                      variant="outlined"
                      sx={compactChipSx}
                    />
                    <Typography variant="body2" color="error.main" sx={{ overflowWrap: 'anywhere', minWidth: 0, flex: 1 }}>
                      {item.lastError}
                    </Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {item.status === 'conflict'
                      ? (isZh ? '需要选择恢复本地编辑或放弃本地改动；选择前本地投影会保留。' : 'Choose whether to restore local edits or discard them. Local projection is preserved until then.')
                      : (isZh ? '暂无错误，队列中的本地操作通常会很快完成。' : 'No error recorded. Queued local operations usually finish quickly.')}
                  </Typography>
                )}
                {item.status === 'failed' || item.status === 'conflict' ? (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => exportItem(item)}>
                      {isZh ? '导出此项' : 'Export item'}
                    </Button>
                    {item.status === 'failed' ? (
                      <Button size="small" color="warning" onClick={() => discardFailed(item)}>
                        {isZh ? '放弃此同步任务' : 'Discard this sync task'}
                      </Button>
                    ) : null}
                    {item.status === 'conflict' && item.kind === 'delete_edit_conflict' && (item.scopeType === 'character' || item.scopeType === 'chat') ? (
                      <>
                        <Button size="small" color="warning" onClick={() => resolveDeleteEditConflict(item, 'discard_local')}>
                          {isZh ? '放弃本地改动' : 'Discard local edits'}
                        </Button>
                        <Button size="small" variant="outlined" color="warning" onClick={() => resolveDeleteEditConflict(item, 'save_as_new')}>
                          {isZh ? '另存为新对象' : 'Save as new'}
                        </Button>
                        <Button size="small" variant="contained" color="warning" onClick={() => resolveDeleteEditConflict(item, 'restore_local')}>
                          {isZh ? '恢复本地编辑' : 'Restore local edits'}
                        </Button>
                      </>
                    ) : null}
                  </Box>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
