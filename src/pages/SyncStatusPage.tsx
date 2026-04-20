import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useChatStore } from '../stores/useChatStore';
import EmptyState from '../components/common/EmptyState';

export default function SyncStatusPage() {
  const { i18n } = useTranslation();
  const characterStore = useCharacterStore();
  const chatStore = useChatStore();

  const items = useMemo(() => {
    const characterItems = (characterStore.pendingOperations || []).map((item) => ({
      id: item.id,
      scope: i18n.language.startsWith('zh') ? '角色' : 'Characters',
      kind: item.kind,
      status: item.status,
      createdAt: item.clientTimestamp,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: item.targetIds.length,
    }));

    const chatItems = (chatStore.pendingOperations || []).map((item) => ({
      id: item.id,
      scope: i18n.language.startsWith('zh') ? '聊天' : 'Chats',
      kind: item.kind,
      status: item.status,
      createdAt: item.clientTimestamp,
      attemptCount: item.attemptCount,
      lastError: item.lastError || null,
      targetCount: item.targetIds.length,
    }));

    return [...characterItems, ...chatItems].sort((a, b) => b.createdAt - a.createdAt);
  }, [characterStore.pendingOperations, chatStore.pendingOperations, i18n.language]);

  const labelMap: Record<string, string> = {
    delete: i18n.language.startsWith('zh') ? '删除' : 'Delete',
    restore: i18n.language.startsWith('zh') ? '恢复' : 'Restore',
    purge: i18n.language.startsWith('zh') ? '彻底删除' : 'Purge',
    empty_deleted: i18n.language.startsWith('zh') ? '清空回收站' : 'Empty trash',
    pending: i18n.language.startsWith('zh') ? '待同步' : 'Pending',
    syncing: i18n.language.startsWith('zh') ? '同步中' : 'Syncing',
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, pb: { xs: 15, sm: 12 }, maxWidth: 960, mx: 'auto' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
        {i18n.language.startsWith('zh') ? '同步详情' : 'Sync details'}
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {i18n.language.startsWith('zh') ? '这里只显示字段编辑同步队列；删除、恢复、彻底删除和清空回收站已改为直接服务端操作。' : 'This page only shows queued field-edit sync operations. Delete, restore, purge, and empty-trash actions now run directly on the server.'}
      </Typography>

      {items.length === 0 ? (
        <EmptyState icon="☁️" message={i18n.language.startsWith('zh') ? '当前没有待同步的编辑项' : 'No queued edit sync items'} />
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
                  {i18n.language.startsWith('zh') ? `目标数量：${item.targetCount}，重试次数：${item.attemptCount}` : `Targets: ${item.targetCount}, Retries: ${item.attemptCount}`}
                </Typography>
                {item.lastError ? (
                  <Typography variant="body2" color="error.main">
                    {item.lastError}
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {i18n.language.startsWith('zh') ? '暂无错误，队列中的字段编辑通常会很快完成。' : 'No error recorded. Queued field edits usually finish quickly.'}
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
