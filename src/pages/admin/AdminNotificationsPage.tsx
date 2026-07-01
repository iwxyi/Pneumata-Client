import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminInlineGroup from '../../components/admin/AdminInlineGroup';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

function parsePayload(value: unknown) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function NotificationDetail({ item }: { item: Record<string, unknown> | null }) {
  const payload = item ? parsePayload(item.payload) : {};
  return (
    <AdminDetailCard title="通知任务详情">
      {item ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">渠道：{String(item.channel || '')}</Typography>
          <Typography variant="body2">接收方：{String(item.recipient || '')}</Typography>
          <Typography variant="body2">模板：{String(item.template_code || '')}</Typography>
          <Typography variant="body2">状态：{String(item.status || '')}</Typography>
          <Typography variant="body2">次数：{String(item.attempt_count || 0)}</Typography>
          <Typography variant="body2">用户：{String(item.user_nickname || item.user_phone || '')}</Typography>
          {payload.lastError ? <Alert severity="error">{String(payload.lastError)}</Alert> : null}
          {payload.lastResult ? <Alert severity="success">最近一次投递成功</Alert> : null}
        </Stack>
      ) : <Alert severity="info">点击任务行查看详情</Alert>}
    </AdminDetailCard>
  );
}

export default function AdminNotificationsPage() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [templates, setTemplates] = useState<Array<Record<string, unknown>>>([]);
  const [selectedItem, setSelectedItem] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [loading, setLoading] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [deliveringId, setDeliveringId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stats = useMemo(() => ({
    queued: items.filter((item) => String(item.status || '') === 'queued').length,
    sent: items.filter((item) => String(item.status || '') === 'sent').length,
    failed: items.filter((item) => String(item.status || '') === 'failed').length,
  }), [items]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobsResult, templatesResult] = await Promise.all([
        adminApi.getNotificationJobs({ status: status || undefined, channel: channel || undefined }),
        adminApi.getNotificationTemplates(),
      ]);
      setItems(jobsResult.items);
      setTemplates(templatesResult.items);
      if (selectedItem) {
        const next = jobsResult.items.find((item) => String(item.id) === String(selectedItem.id));
        setSelectedItem(next || null);
      }
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status, channel]);

  const deliverQueued = async () => {
    setDelivering(true);
    setError(null);
    try {
      await adminApi.deliverNotificationJobs({ limit: 20 });
      await load();
    } catch (deliverError) {
      setError(getAdminErrorMessage(deliverError));
    } finally {
      setDelivering(false);
    }
  };

  const deliverOne = async (item: Record<string, unknown>) => {
    const id = String(item.id || '');
    if (!id) return;
    setDeliveringId(id);
    setError(null);
    try {
      await adminApi.deliverNotificationJob(id);
      await load();
    } catch (deliverError) {
      setError(getAdminErrorMessage(deliverError));
    } finally {
      setDeliveringId('');
    }
  };

  return (
    <Stack spacing={2}>
      <AdminInlineGroup gap={1.25}>
        <Alert severity="info">排队：{stats.queued}</Alert>
        <Alert severity="success">已发送：{stats.sent}</Alert>
        <Alert severity="error">失败：{stats.failed}</Alert>
      </AdminInlineGroup>
      <AdminInlineGroup gap={1.25}>
        <Button variant={status === '' ? 'contained' : 'outlined'} onClick={() => setStatus('')}>全部状态</Button>
        <Button variant={status === 'queued' ? 'contained' : 'outlined'} onClick={() => setStatus('queued')}>排队</Button>
        <Button variant={status === 'sent' ? 'contained' : 'outlined'} onClick={() => setStatus('sent')}>已发送</Button>
        <Button variant={status === 'failed' ? 'contained' : 'outlined'} onClick={() => setStatus('failed')}>失败</Button>
        <Button variant={channel === '' ? 'contained' : 'outlined'} onClick={() => setChannel('')}>全部渠道</Button>
        <Button variant={channel === 'email' ? 'contained' : 'outlined'} onClick={() => setChannel('email')}>邮件</Button>
        <Button variant={channel === 'sms' ? 'contained' : 'outlined'} onClick={() => setChannel('sms')}>短信</Button>
        <Button variant="outlined" disabled={delivering} onClick={() => void deliverQueued()} sx={{ ml: 'auto' }}>{delivering ? '投递中' : '投递队列'}</Button>
      </AdminInlineGroup>
      <AdminRequestState loading={loading} error={error} onRetry={() => void load()} />
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.25 }}>模板数量：{templates.length}</Typography>
        <Stack spacing={0.75}>
          {templates.map((item) => (
            <Typography key={String(item.id)} variant="body2">{String(item.channel || '')} · {String(item.code || '')} · {String(item.status || '')}</Typography>
          ))}
        </Stack>
      </Paper>
      <AdminResponsiveTable minWidth={760}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>渠道</TableCell>
              <TableCell>接收方</TableCell>
              <TableCell>模板</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>次数</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item.id)} hover selected={String(selectedItem?.id || '') === String(item.id)} onClick={() => setSelectedItem(item)}>
                <TableCell>{String(item.channel || '')}</TableCell>
                <TableCell>{String(item.recipient || '')}</TableCell>
                <TableCell>{String(item.template_code || '')}</TableCell>
                <TableCell>{String(item.status || '')}</TableCell>
                <TableCell>{String(item.attempt_count || 0)}</TableCell>
                <TableCell>{new Date(Number(item.created_at || 0)).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    disabled={deliveringId === String(item.id || '') || String(item.status || '') === 'sent'}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deliverOne(item);
                    }}
                  >
                    {String(item.status || '') === 'failed' ? '重试' : '投递'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>
      <NotificationDetail item={selectedItem} />
    </Stack>
  );
}
