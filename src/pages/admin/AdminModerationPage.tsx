import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import { adminApi } from '../../services/adminApi';

function ModerationCaseDetail({ item }: { item: Record<string, unknown> | null }) {
  return (
    <AdminDetailCard title="Case 详情">
      {item ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">Case：{String(item.id || '')}</Typography>
          <Typography variant="body2">内容类型：{String(item.content_type || '')}</Typography>
          <Typography variant="body2">创建者：{String(item.owner_nickname || item.owner_phone || '')}</Typography>
          <Typography variant="body2">状态：{String(item.status || '')}</Typography>
          <Typography variant="body2">可见性：{String(item.visibility || '')}</Typography>
          <Typography variant="body2">最新结论：{String(item.latest_decision || '')}</Typography>
          <Typography variant="body2">原因：{String(item.latest_reason || '')}</Typography>
        </Stack>
      ) : <Alert severity="info">点击审核行查看详情</Alert>}
    </AdminDetailCard>
  );
}

export default function AdminModerationPage() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selectedItem, setSelectedItem] = useState<Record<string, unknown> | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  const stats = useMemo(() => ({
    pending: items.filter((item) => String(item.status || '') === 'pending').length,
    inReview: items.filter((item) => String(item.status || '') === 'in_review').length,
    escalated: items.filter((item) => String(item.status || '') === 'escalated').length,
  }), [items]);

  const load = async () => {
    const result = await adminApi.getShareReviewCases({ status: status || undefined });
    setItems(result.items);
    if (selectedItem) {
      const next = result.items.find((item) => String(item.id) === String(selectedItem.id));
      setSelectedItem(next || null);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Alert severity="warning" sx={{ flex: 1 }}>待领取：{stats.pending}</Alert>
        <Alert severity="info" sx={{ flex: 1 }}>处理中：{stats.inReview}</Alert>
        <Alert severity="error" sx={{ flex: 1 }}>已升级：{stats.escalated}</Alert>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Button variant={status === '' ? 'contained' : 'outlined'} onClick={() => setStatus('')}>全部</Button>
        <Button variant={status === 'pending' ? 'contained' : 'outlined'} onClick={() => setStatus('pending')}>待领取</Button>
        <Button variant={status === 'in_review' ? 'contained' : 'outlined'} onClick={() => setStatus('in_review')}>处理中</Button>
        <Button variant={status === 'escalated' ? 'contained' : 'outlined'} onClick={() => setStatus('escalated')}>已升级</Button>
      </Stack>
      <TextField value={reason} onChange={(e) => setReason(e.target.value)} label="审核备注" />
      <AdminResponsiveTable minWidth={860}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Case</TableCell>
              <TableCell>内容类型</TableCell>
              <TableCell>创建者</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>最新结论</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item.id)} hover selected={String(selectedItem?.id || '') === String(item.id)} onClick={() => setSelectedItem(item)}>
                <TableCell>{String(item.id || '')}</TableCell>
                <TableCell>{String(item.content_type || '')}</TableCell>
                <TableCell>{String(item.owner_nickname || item.owner_phone || '')}</TableCell>
                <TableCell>{String(item.status || '')}</TableCell>
                <TableCell>{String(item.latest_decision || '')}</TableCell>
                <TableCell align="right">
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    {String(item.status || '') === 'pending' ? <Button size="small" onClick={async (event) => { event.stopPropagation(); await adminApi.claimShareReviewCase(String(item.id)); await load(); }}>领取</Button> : null}
                    <Button size="small" color="success" onClick={async (event) => { event.stopPropagation(); await adminApi.decideShareReviewCase(String(item.id), 'approved', reason); await load(); }}>通过</Button>
                    <Button size="small" color="error" onClick={async (event) => { event.stopPropagation(); await adminApi.decideShareReviewCase(String(item.id), 'rejected', reason); await load(); }}>拒绝</Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>
      <ModerationCaseDetail item={selectedItem} />
    </Stack>
  );
}

