import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import EmptyState from '../components/common/EmptyState';
import { readCloudSyncBootstrapStatus, type CloudSyncBootstrapStatus } from '../services/cloudSyncBootstrapStatus';
import { scheduleSyncWorkersByPriority } from '../stores/storeSyncScheduler';

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

export default function SyncStatusPage() {
  const { i18n } = useTranslation();
  const characterStore = useCharacterStore();
  const chatStore = useChatStore();
  const messageStore = useMessageStore();
  const artifactStore = useCharacterArtifactStore();
  const authMode = useAuthStore((s) => s.authMode);
  const isZh = i18n.language.startsWith('zh');
  const [bootstrapStatus, setBootstrapStatus] = useState<CloudSyncBootstrapStatus | null>(() => readCloudSyncBootstrapStatus());

  useEffect(() => {
    const handler = (event: Event) => {
      const status = event instanceof CustomEvent ? event.detail?.status as CloudSyncBootstrapStatus | null : readCloudSyncBootstrapStatus();
      setBootstrapStatus(status || null);
    };
    window.addEventListener('pneumata-cloud-sync-bootstrap-status-changed', handler);
    return () => window.removeEventListener('pneumata-cloud-sync-bootstrap-status-changed', handler);
  }, []);

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
        exportPayload: {
          conflict: 'remote_delete_with_local_pending',
          remoteDeletedId: item.id,
          pendingOperations: item.pending,
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
        exportPayload: {
          conflict: 'remote_delete_with_local_pending',
          remoteDeletedId: item.id,
          pendingOperations: item.pending,
          localSnapshot: item.localSnapshot,
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

    return [...characterDeleteConflicts, ...chatDeleteConflicts, ...characterItems, ...chatItems, ...messageItems, ...artifactItems].sort((a, b) => b.createdAt - a.createdAt);
  }, [artifactStore.items, artifactStore.jobs, characterStore.characters, characterStore.pendingOperations, characterStore.remoteDeletedCharacterIds, chatStore.chats, chatStore.pendingOperations, chatStore.remoteDeletedChatIds, chatStore.remoteDeletedChats, isZh, messageStore.messageWindowsByChatId, messageStore.pendingOperations]);

  const labelMap: Record<string, string> = {
    delete: isZh ? '删除' : 'Delete',
    restore: isZh ? '恢复' : 'Restore',
    purge: isZh ? '彻底删除' : 'Purge',
    empty_deleted: isZh ? '清空回收站' : 'Empty trash',
    create: isZh ? '创建' : 'Create',
    patch: isZh ? '编辑' : 'Edit',
    delete_edit_conflict: isZh ? '远端删除 / 本地编辑冲突' : 'Remote delete / local edit conflict',
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

  const failedCount = items.filter((item) => item.status === 'failed').length;
  const pendingCount = items.filter((item) => item.status === 'pending').length;
  const syncingCount = items.filter((item) => item.status === 'syncing').length;
  const conflictCount = items.filter((item) => item.status === 'conflict').length;
  const failedItems = items.filter((item) => item.status === 'failed');
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

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, maxWidth: 960, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {isZh ? '同步详情' : 'Sync details'}
        </Typography>
        <Button size="small" variant="outlined" onClick={retryAll} disabled={items.length === 0}>
          {isZh ? '重试全部' : 'Retry all'}
        </Button>
        <Button size="small" variant="outlined" onClick={exportFailed} disabled={failedItems.length === 0}>
          {isZh ? '导出失败项' : 'Export failed'}
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
      </Stack>

      {authMode === 'local' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {isZh ? '当前为离线本地模式：云同步已关闭，登录后会自动尝试上传本地数据。' : 'You are in local-only offline mode. Cloud sync is disabled and local data will be uploaded automatically after login.'}
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
                {item.lastError ? (
                  <Typography variant="body2" color="error.main">
                    {item.lastError}
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {isZh ? '暂无错误，队列中的本地操作通常会很快完成。' : 'No error recorded. Queued local operations usually finish quickly.'}
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
