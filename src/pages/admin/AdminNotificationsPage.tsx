import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import { adminApi } from '../../services/adminApi';

function NotificationDetail({ item }: { item: Record<string, unknown> | null }) {
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
  const stats = useMemo(() => ({
    queued: items.filter((item) => String(item.status || '') === 'queued').length,
    sent: items.filter((item) => String(item.status || '') === 'sent').length,
    failed: items.filter((item) => String(item.status || '') === 'failed').length,
  }), [items]);

  useEffect(() => {
    void adminApi.getNotificationJobs({ status: status || undefined, channel: channel || undefined }).then((result) => setItems(result.items));
    void adminApi.getNotificationTemplates().then((result) => setTemplates(result.items));
  }, [status, channel]);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Alert severity="info" sx={{ flex: 1 }}>排队：{stats.queued}</Alert>
        <Alert severity="success" sx={{ flex: 1 }}>已发送：{stats.sent}</Alert>
        <Alert severity="error" sx={{ flex: 1 }}>失败：{stats.failed}</Alert>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Button variant={status === '' ? 'contained' : 'outlined'} onClick={() => setStatus('')}>全部状态</Button>
        <Button variant={status === 'queued' ? 'contained' : 'outlined'} onClick={() => setStatus('queued')}>排队</Button>
        <Button variant={status === 'sent' ? 'contained' : 'outlined'} onClick={() => setStatus('sent')}>已发送</Button>
        <Button variant={status === 'failed' ? 'contained' : 'outlined'} onClick={() => setStatus('failed')}>失败</Button>
        <Button variant={channel === '' ? 'contained' : 'outlined'} onClick={() => setChannel('')}>全部渠道</Button>
        <Button variant={channel === 'email' ? 'contained' : 'outlined'} onClick={() => setChannel('email')}>邮件</Button>
        <Button variant={channel === 'sms' ? 'contained' : 'outlined'} onClick={() => setChannel('sms')}>短信</Button>
      </Stack>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>
      <NotificationDetail item={selectedItem} />
    </Stack>
  );
}

