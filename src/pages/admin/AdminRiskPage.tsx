import { useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import { adminApi } from '../../services/adminApi';

function RestrictionDetail({ item }: { item: Record<string, unknown> | null }) {
  return (
    <AdminDetailCard title="限制详情">
      {item ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">类型：{String(item.restriction_type || '')}</Typography>
          <Typography variant="body2">状态：{String(item.status || '')}</Typography>
          <Typography variant="body2">原因：{String(item.reason_text || '')}</Typography>
          <Typography variant="body2">开始：{item.created_at ? new Date(Number(item.created_at)).toLocaleString() : '-'}</Typography>
          <Typography variant="body2">结束：{item.effective_until ? new Date(Number(item.effective_until)).toLocaleString() : '-'}</Typography>
        </Stack>
      ) : <Alert severity="info">点击限制行查看详情</Alert>}
    </AdminDetailCard>
  );
}

export default function AdminRiskPage() {
  const [userId, setUserId] = useState('');
  const [restrictionType, setRestrictionType] = useState('share_disabled');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selectedItem, setSelectedItem] = useState<Record<string, unknown> | null>(null);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <TextField label="用户ID" value={userId} onChange={(e) => setUserId(e.target.value)} fullWidth />
        <TextField label="限制类型" value={restrictionType} onChange={(e) => setRestrictionType(e.target.value)} fullWidth />
        <TextField label="原因" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" onClick={async () => {
          const result = await adminApi.getUserRestrictions(userId.trim());
          setItems(result.items);
        }}>查询</Button>
        <Button variant="contained" onClick={async () => {
          await adminApi.upsertUserRestriction(userId.trim(), restrictionType.trim(), { status: 'active', reasonText: reason });
          const result = await adminApi.getUserRestrictions(userId.trim());
          setItems(result.items);
        }}>保存限制</Button>
      </Stack>
      {!items.length ? <Alert severity="info">输入用户ID后可查询或写入限制项。</Alert> : null}
      <AdminResponsiveTable minWidth={700}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>限制类型</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>原因</TableCell>
              <TableCell>开始时间</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item.id)} hover selected={String(selectedItem?.id || '') === String(item.id)} onClick={() => setSelectedItem(item)}>
                <TableCell>{String(item.restriction_type || '')}</TableCell>
                <TableCell>{String(item.status || '')}</TableCell>
                <TableCell>{String(item.reason_text || '')}</TableCell>
                <TableCell>{item.created_at ? new Date(Number(item.created_at)).toLocaleString() : ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>
      <RestrictionDetail item={selectedItem} />
    </Stack>
  );
}

