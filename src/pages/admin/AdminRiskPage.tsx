import { useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminInlineGroup from '../../components/admin/AdminInlineGroup';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRestrictions = async () => {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      setError('请输入用户ID');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getUserRestrictions(trimmedUserId);
      setItems(result.items);
      if (selectedItem) {
        const next = result.items.find((item) => String(item.id) === String(selectedItem.id));
        setSelectedItem(next || null);
      }
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  const saveRestriction = async (status = 'active', overrideRestrictionType?: string) => {
    const trimmedUserId = userId.trim();
    const trimmedType = (overrideRestrictionType ?? restrictionType).trim();
    if (!trimmedUserId) {
      setError('请输入用户ID');
      return;
    }
    if (!trimmedType) {
      setError('请输入限制类型');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await adminApi.upsertUserRestriction(trimmedUserId, trimmedType, { status, reasonText: reason });
      const result = await adminApi.getUserRestrictions(trimmedUserId);
      setItems(result.items);
      const next = result.items.find((item) => String(item.restriction_type) === trimmedType);
      setSelectedItem(next || null);
    } catch (saveError) {
      setError(getAdminErrorMessage(saveError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <TextField label="用户ID" value={userId} onChange={(e) => setUserId(e.target.value)} fullWidth />
        <TextField label="限制类型" value={restrictionType} onChange={(e) => setRestrictionType(e.target.value)} fullWidth />
        <TextField label="原因" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth />
      </Stack>
      <AdminInlineGroup>
        <Button variant="outlined" disabled={loading} onClick={() => void loadRestrictions()}>查询</Button>
        <Button variant="contained" disabled={loading} onClick={() => void saveRestriction('active')}>保存限制</Button>
        <Button variant="outlined" color="warning" disabled={loading} onClick={() => void saveRestriction('inactive')}>解除限制</Button>
      </AdminInlineGroup>
      <AdminRequestState loading={loading} error={error} onRetry={() => void loadRestrictions()} />
      {!items.length ? <Alert severity="info">输入用户ID后可查询或写入限制项。</Alert> : null}
      <AdminResponsiveTable minWidth={700}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>限制类型</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>原因</TableCell>
              <TableCell>开始时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item.id)} hover selected={String(selectedItem?.id || '') === String(item.id)} onClick={() => setSelectedItem(item)}>
                <TableCell>{String(item.restriction_type || '')}</TableCell>
                <TableCell>{String(item.status || '')}</TableCell>
                <TableCell>{String(item.reason_text || '')}</TableCell>
                <TableCell>{item.created_at ? new Date(Number(item.created_at)).toLocaleString() : ''}</TableCell>
                <TableCell align="right">
                  {String(item.status || '') === 'active' ? (
                    <Button
                      size="small"
                      color="warning"
                      disabled={loading}
                      onClick={(event) => {
                        event.stopPropagation();
                        setRestrictionType(String(item.restriction_type || ''));
                        void saveRestriction('inactive', String(item.restriction_type || ''));
                      }}
                    >
                      解除
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>
      <RestrictionDetail item={selectedItem} />
    </Stack>
  );
}
