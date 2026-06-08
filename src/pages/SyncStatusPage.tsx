import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
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
import { parseSyncErrorClassification, type SyncErrorKind } from '../stores/storeSyncHelpers';
import { buildLocalOutboxProjection } from '../services/localOutboxProjection';
import { mirrorLocalOutboxQueues } from '../services/localOutboxMirror';

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
  if (state.lastError) return { label: isZh ? '最近失败' : 'Recent failure', color: 'error' as const };
  if (state.lastCheckedAt > 0) return { label: isZh ? '已检查' : 'Checked', color: 'success' as const };
  return { label: isZh ? '未检查' : 'Unchecked', color: 'default' as const };
}

function syncErrorKindLabel(kind: SyncErrorKind, isZh: boolean) {
  const labels: Record<SyncErrorKind, string> = {
    auth: isZh ? '鉴权' : 'Auth',
    network: isZh ? '网络' : 'Network',
    server_unavailable: isZh ? '服务端' : 'Server',
    conflict_ignored: isZh ? '冲突忽略' : 'Conflict ignored',
    validation: isZh ? '校验' : 'Validation',
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
  const recoveryImportInputRef = useRef<HTMLInputElement | null>(null);

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

  const localOutboxItems = useMemo(() => buildLocalOutboxProjection({
    characterOperations: characterStore.pendingOperations || [],
    chatOperations: chatStore.pendingOperations || [],
    messageOperations: messageStore.pendingOperations || [],
    artifactJobs: artifactStore.jobs || [],
  }), [artifactStore.jobs, characterStore.pendingOperations, chatStore.pendingOperations, messageStore.pendingOperations]);

  const items = useMemo(() => {
    const characterItems = (characterStore.pendingOperations || []).map((item) => ({
      id: item.id,
      scopeType: 'character' as const,
      scope: isZh ? '角色' : 'Characters',
      kind: item.kind,
      status: item.status,
      createdAt: item.clientTimestamp,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: item.targetIds.length,
      targetLabel: characterStore.characters.find((character) => character.id === item.entityId)?.name || item.entityId,
      summary: summarizePatch(item.patch, isZh),
      diffPreview: buildPatchDiffPreview(item.patch),
      exportPayload: {
        operation: item,
        localSnapshot: characterStore.characters.find((character) => character.id === item.entityId) || null,
      },
    }));

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

    const messageItems = (messageStore.pendingOperations || []).map((item) => ({
      targetMessage: item.payload
        || Object.values(messageStore.messageWindowsByChatId || {})
          .flatMap((window) => window.messages || [])
          .find((message) => message.id === item.localMessageId || message.id === item.messageId || message.clientKey === item.localMessageId),
      chat: chatStore.chats.find((chat) => chat.id === item.chatId),
      item,
    })).map(({ item, targetMessage, chat }) => ({
      id: item.id,
      scopeType: 'message' as const,
      scope: isZh ? '消息' : 'Messages',
      kind: item.kind,
      status: item.status,
      createdAt: item.createdAt,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: 1,
      targetLabel: chat?.name || item.chatId,
      summary: targetMessage?.content ? clipText(targetMessage.content) : (isZh ? '本地消息快照未在当前缓存窗口中找到' : 'Local message snapshot was not found in cached windows'),
      exportPayload: {
        operation: item,
        localSnapshot: targetMessage || null,
        chatSnapshot: chat || null,
      },
    }));

    const artifactItems = (artifactStore.jobs || [])
      .filter((item) => item.status === 'pending' || item.status === 'running' || item.status === 'failed')
      .map((item) => ({
        id: item.id,
        scopeType: 'artifact' as const,
        scope: isZh ? '信件 / 日记' : 'Letters / Diary',
        kind: item.kind,
        status: item.status === 'running' ? 'syncing' : item.status,
        createdAt: item.createdAt,
        attemptCount: item.attempts,
        lastError: item.error || null,
        targetCount: 1,
        targetLabel: item.snapshot?.name || item.characterId,
        summary: [item.dateKey, item.sourceKey].filter(Boolean).join(' · ') || (isZh ? '角色经历生成任务' : 'Character artifact generation job'),
        exportPayload: {
          job: item,
          localSnapshot: artifactStore.items.find((artifact) => artifact.id === item.id || artifact.characterId === item.characterId && artifact.kind === item.kind && artifact.sourceKey === item.sourceKey && artifact.dateKey === item.dateKey) || null,
        },
      }));

    return [...characterDeleteConflicts, ...chatDeleteConflicts, ...characterFieldConflicts, ...chatFieldConflicts, ...characterItems, ...chatItems, ...messageItems, ...artifactItems].sort((a, b) => b.createdAt - a.createdAt);
  }, [artifactStore.items, artifactStore.jobs, characterStore.characters, characterStore.fieldConflicts, characterStore.pendingOperations, characterStore.remoteDeletedCharacterIds, chatStore.chats, chatStore.fieldConflicts, chatStore.pendingOperations, chatStore.remoteDeletedChatIds, chatStore.remoteDeletedChats, isZh, messageStore.messageWindowsByChatId, messageStore.pendingOperations]);

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

  const visibleSyncScopes = syncScopes.slice(0, 30);

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
  const failedItems = items.filter((item) => item.status === 'failed');
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

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, maxWidth: 960, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {isZh ? '同步详情' : 'Sync details'}
        </Typography>
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

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {isZh ? '这里显示本地优先的创建、编辑、消息发送和信件/日记生成队列；临时网络失败会自动重试，校验失败会停在失败状态等待处理。' : 'This page shows local-first create, edit, message, and artifact queues. Temporary network failures retry automatically; validation failures stay failed for review.'}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        {isZh ? '放弃失败项只会移除对应同步任务；已经保存在本地的内容不会因此自动删除。' : 'Discarding a failed item only removes that sync task. Content already saved locally is not deleted automatically.'}
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Chip size="small" label={isZh ? `待同步 ${pendingCount}` : `Pending ${pendingCount}`} variant="outlined" />
        <Chip size="small" label={isZh ? `同步中 ${syncingCount}` : `Syncing ${syncingCount}`} variant="outlined" color={syncingCount > 0 ? 'primary' : 'default'} />
        <Chip size="small" label={isZh ? `失败 ${failedCount}` : `Failed ${failedCount}`} variant="outlined" color={failedCount > 0 ? 'error' : 'default'} />
        <Chip size="small" label={isZh ? `冲突 ${conflictCount}` : `Conflicts ${conflictCount}`} variant="outlined" color={conflictCount > 0 ? 'warning' : 'default'} />
        {errorKindCounts.map((item) => (
          <Chip
            key={item.kind}
            size="small"
            label={`${syncErrorKindLabel(item.kind, isZh)} ${item.count}`}
            variant="outlined"
            color={syncErrorKindColor(item.kind)}
          />
        ))}
      </Stack>

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
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {new Date(bootstrapStatus.updatedAt).toLocaleString()}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" label={isZh ? `待创建角色 ${bootstrapStatus.charactersToCreate}` : `Characters to create ${bootstrapStatus.charactersToCreate}`} variant="outlined" />
              <Chip size="small" label={isZh ? `已匹配角色 ${bootstrapStatus.charactersAlreadyRemote}` : `Matched characters ${bootstrapStatus.charactersAlreadyRemote}`} variant="outlined" />
              <Chip size="small" label={isZh ? `待创建聊天 ${bootstrapStatus.chatsToCreate}` : `Chats to create ${bootstrapStatus.chatsToCreate}`} variant="outlined" />
              <Chip size="small" label={isZh ? `已匹配聊天 ${bootstrapStatus.chatsAlreadyRemote}` : `Matched chats ${bootstrapStatus.chatsAlreadyRemote}`} variant="outlined" />
              <Chip size="small" label={isZh ? `待重放消息 ${bootstrapStatus.pendingMessageCreates}` : `Pending messages ${bootstrapStatus.pendingMessageCreates}`} variant="outlined" />
              <Chip size="small" label={isZh ? `同名冲突 ${bootstrapStatus.characterNameConflicts}` : `Name conflicts ${bootstrapStatus.characterNameConflicts}`} color={bootstrapStatus.characterNameConflicts > 0 ? 'warning' : 'default'} variant="outlined" />
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
          <Typography variant="body2" color="text.secondary">
            {isZh ? '这里展示各数据域最近一次云端 freshness 检查、cursor/revision、错误和退避状态；页面仍然优先使用本地数据。' : 'This shows the latest cloud freshness checks, cursor/revision, errors, and backoff by data scope. Pages still render local data first.'}
          </Typography>
          {syncScopes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {isZh ? '还没有记录任何云端检查。' : 'No cloud check has been recorded yet.'}
            </Typography>
          ) : (
            <Stack spacing={1}>
              {visibleSyncScopes.map((item) => {
                const health = summarizeSyncScopeState(item.state, isZh);
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
                        <Chip size="small" label={item.area} variant="outlined" />
                        <Chip size="small" label={health.label} color={health.color} />
                        {item.state.errorCount > 0 ? <Chip size="small" label={isZh ? `失败 ${item.state.errorCount}` : `Errors ${item.state.errorCount}`} color="error" variant="outlined" /> : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {item.state.scope}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Chip size="small" variant="outlined" label={isZh ? `检查 ${formatTime(item.state.lastCheckedAt, isZh)}` : `Checked ${formatTime(item.state.lastCheckedAt, isZh)}`} />
                      <Chip size="small" variant="outlined" label={isZh ? `应用 ${formatTime(item.state.lastAppliedAt, isZh)}` : `Applied ${formatTime(item.state.lastAppliedAt, isZh)}`} />
                      {item.state.retryAt > Date.now() ? <Chip size="small" variant="outlined" color="warning" label={isZh ? `下次重试 ${formatTime(item.state.retryAt, isZh)}` : `Retry ${formatTime(item.state.retryAt, isZh)}`} /> : null}
                    </Stack>
                    {item.state.cursor || item.state.revision ? (
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {`cursor=${item.state.cursor || '-'} · revision=${item.state.revision || '-'}`}
                      </Typography>
                    ) : null}
                    {item.state.lastError ? (
                      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={syncErrorKindLabel(parseSyncErrorClassification(item.state.lastError).kind, isZh)}
                          color={syncErrorKindColor(parseSyncErrorClassification(item.state.lastError).kind)}
                          variant="outlined"
                        />
                        <Typography variant="body2" color="error.main" sx={{ overflowWrap: 'anywhere', minWidth: 0, flex: 1 }}>
                          {item.state.lastError}
                        </Typography>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
              {syncScopes.length > visibleSyncScopes.length ? (
                <Typography variant="caption" color="text.secondary">
                  {isZh ? `另有 ${syncScopes.length - visibleSyncScopes.length} 个 scope 未展开，可导出查看。` : `${syncScopes.length - visibleSyncScopes.length} more scopes are not expanded here. Export to inspect them.`}
                </Typography>
              ) : null}
            </Stack>
          )}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState variant="plain" message={isZh ? '当前没有待同步项' : 'No queued sync items'} />
      ) : (
        <Stack spacing={1.5}>
          {items.map((item) => (
            <Card key={item.id} variant="outlined">
              <CardContent sx={{ display: 'grid', gap: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" label={item.scope} variant="outlined" />
                    <Chip size="small" label={labelMap[item.kind] || item.kind} color="primary" variant="outlined" />
                    <Chip size="small" label={labelMap[item.status] || item.status} color={item.status === 'conflict' ? 'warning' : item.status === 'syncing' ? 'primary' : 'default'} />
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
                          sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
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
