import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useMessageStore } from '../stores/useMessageStore';
import { useCharacterArtifactStore } from '../stores/useCharacterArtifactStore';
import EmptyState from '../components/common/EmptyState';

export default function SyncStatusPage() {
  const { i18n } = useTranslation();
  const characterStore = useCharacterStore();
  const chatStore = useChatStore();
  const messageStore = useMessageStore();
  const artifactStore = useCharacterArtifactStore();
  const authMode = useAuthStore((s) => s.authMode);
  const isZh = i18n.language.startsWith('zh');

  const items = useMemo(() => {
    const characterItems = (characterStore.pendingOperations || []).map((item) => ({
      id: item.id,
      scope: isZh ? '角色' : 'Characters',
      kind: item.kind,
      status: item.status,
      createdAt: item.clientTimestamp,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: item.targetIds.length,
    }));

    const chatItems = (chatStore.pendingOperations || []).map((item) => ({
      id: item.id,
      scope: isZh ? '聊天' : 'Chats',
      kind: item.kind,
      status: item.status,
      createdAt: item.clientTimestamp,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: item.targetIds.length,
    }));

    const messageItems = (messageStore.pendingOperations || []).map((item) => ({
      id: item.id,
      scope: isZh ? '消息' : 'Messages',
      kind: item.kind,
      status: item.status,
      createdAt: item.createdAt,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: 1,
    }));

    const artifactItems = (artifactStore.jobs || [])
      .filter((item) => item.status === 'pending' || item.status === 'running' || item.status === 'failed')
      .map((item) => ({
        id: item.id,
        scope: isZh ? '信件 / 日记' : 'Letters / Diary',
        kind: item.kind,
        status: item.status === 'running' ? 'syncing' : item.status,
        createdAt: item.createdAt,
        attemptCount: item.attempts,
        lastError: item.error || null,
        targetCount: 1,
      }));

    return [...characterItems, ...chatItems, ...messageItems, ...artifactItems].sort((a, b) => b.createdAt - a.createdAt);
  }, [artifactStore.jobs, characterStore.pendingOperations, chatStore.pendingOperations, isZh, messageStore.pendingOperations]);

  const labelMap: Record<string, string> = {
    delete: isZh ? '删除' : 'Delete',
    restore: isZh ? '恢复' : 'Restore',
    purge: isZh ? '彻底删除' : 'Purge',
    empty_deleted: isZh ? '清空回收站' : 'Empty trash',
    create: isZh ? '创建' : 'Create',
    patch: isZh ? '编辑' : 'Edit',
    birth_letter: isZh ? '诞生信' : 'Birth letter',
    final_letter: isZh ? '信件' : 'Letter',
    diary: isZh ? '日记' : 'Diary',
    pending: isZh ? '待同步' : 'Pending',
    syncing: isZh ? '同步中' : 'Syncing',
    failed: isZh ? '同步失败' : 'Failed',
    succeeded: isZh ? '已完成' : 'Succeeded',
  };

  const retryAll = () => {
    void chatStore.flushPendingOperations();
    void characterStore.flushPendingOperations();
    void messageStore.flushPendingOperations();
    void artifactStore.resumeProcessing();
  };

  const failedCount = items.filter((item) => item.status === 'failed').length;
  const pendingCount = items.filter((item) => item.status === 'pending').length;
  const syncingCount = items.filter((item) => item.status === 'syncing').length;

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, maxWidth: 960, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {isZh ? '同步详情' : 'Sync details'}
        </Typography>
        <Button size="small" variant="outlined" onClick={retryAll} disabled={items.length === 0}>
          {isZh ? '重试全部' : 'Retry all'}
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {isZh ? '这里显示本地优先的创建、编辑、消息发送和信件/日记生成队列；临时网络失败会自动重试，校验失败会停在失败状态等待处理。' : 'This page shows local-first create, edit, message, and artifact queues. Temporary network failures retry automatically; validation failures stay failed for review.'}
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Chip size="small" label={isZh ? `待同步 ${pendingCount}` : `Pending ${pendingCount}`} variant="outlined" />
        <Chip size="small" label={isZh ? `同步中 ${syncingCount}` : `Syncing ${syncingCount}`} variant="outlined" color={syncingCount > 0 ? 'primary' : 'default'} />
        <Chip size="small" label={isZh ? `失败 ${failedCount}` : `Failed ${failedCount}`} variant="outlined" color={failedCount > 0 ? 'error' : 'default'} />
      </Stack>

      {authMode === 'local' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {isZh ? '当前为离线本地模式：云同步已关闭，登录后会自动尝试上传本地数据。' : 'You are in local-only offline mode. Cloud sync is disabled and local data will be uploaded automatically after login.'}
        </Alert>
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
                    <Chip size="small" label={labelMap[item.status] || item.status} color={item.status === 'syncing' ? 'primary' : 'default'} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(item.createdAt).toLocaleString()}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {isZh ? `目标数量：${item.targetCount}，重试次数：${item.attemptCount}` : `Targets: ${item.targetCount}, Retries: ${item.attemptCount}`}
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
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
