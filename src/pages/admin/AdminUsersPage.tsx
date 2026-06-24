import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Divider, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

function formatTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function WorkspaceTable({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: Array<{ key: string; label: string }> }) {
  return (
    <AdminDetailCard title={title}>
      {!rows.length ? <Alert severity="info">暂无数据</Alert> : null}
      {rows.length ? (
        <AdminResponsiveTable minWidth={520}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map((column) => <TableCell key={column.key}>{column.label}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row.id)}>
                  {columns.map((column) => (
                    <TableCell key={column.key}>{column.key.endsWith('_at') ? formatTime(row[column.key]) : String(row[column.key] || '-')}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AdminResponsiveTable>
      ) : null}
    </AdminDetailCard>
  );
}

export default function AdminUsersPage() {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Array<{ id: string; phone: string; nickname: string; created_at: number }>>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<Record<string, unknown> | null>(null);
  const [selectedRestrictions, setSelectedRestrictions] = useState<Array<Record<string, unknown>>>([]);
  const [restrictionReason, setRestrictionReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const statCards = useMemo(() => [
    { label: '聊天数', value: selectedUser?.chatCount },
    { label: '角色数', value: selectedUser?.characterCount },
    { label: '订单数', value: selectedUser?.orderCount },
    { label: '生效限制', value: selectedUser?.activeRestrictionCount },
  ], [selectedUser]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getUsers(search);
      setItems(result.items as Array<{ id: string; phone: string; nickname: string; created_at: number }>);
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedUser = async (userId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [user, restrictions] = await Promise.all([
        adminApi.getUser(userId),
        adminApi.getUserRestrictions(userId),
      ]);
      setSelectedUser(user);
      setSelectedRestrictions(restrictions.items);
    } catch (loadError) {
      setDetailError(getAdminErrorMessage(loadError));
    } finally {
      setDetailLoading(false);
    }
  };

  const saveRestriction = async (restrictionType: string, status = 'active') => {
    if (!selectedUserId) return;
    setActionLoading(true);
    setDetailError(null);
    try {
      await adminApi.upsertUserRestriction(selectedUserId, restrictionType, { status, reasonText: restrictionReason });
      await loadSelectedUser(selectedUserId);
    } catch (saveError) {
      setDetailError(getAdminErrorMessage(saveError));
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [search]);

  useEffect(() => {
    if (!selectedUserId) return;
    setSelectedUser(null);
    setSelectedRestrictions([]);
    void loadSelectedUser(selectedUserId);
  }, [selectedUserId]);

  const workspace = selectedUser?.workspace as { recentOrders?: Array<Record<string, unknown>>; recentChats?: Array<Record<string, unknown>>; recentCharacters?: Array<Record<string, unknown>> } | undefined;

  return (
    <Stack spacing={2}>
      <TextField value={search} onChange={(e) => setSearch(e.target.value)} label="搜索手机号或昵称" />
      <AdminRequestState loading={loading} error={error} onRetry={() => void loadUsers()} />
      <AdminResponsiveTable minWidth={640}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>昵称</TableCell>
              <TableCell>手机号</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!items.length && !loading ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Alert severity="info">暂无用户</Alert>
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((item) => (
              <TableRow key={item.id} hover>
                <TableCell>{item.nickname}</TableCell>
                <TableCell>{item.phone}</TableCell>
                <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                <TableCell align="right"><Button size="small" onClick={() => setSelectedUserId(item.id)}>详情</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>

      <Dialog open={Boolean(selectedUserId)} onClose={() => setSelectedUserId(null)} fullWidth maxWidth="lg" fullScreen={fullScreen}>
        <DialogTitle>用户详情</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <AdminRequestState loading={detailLoading || actionLoading} error={detailError} onRetry={selectedUserId ? () => void loadSelectedUser(selectedUserId) : undefined} />
            {selectedUser ? (
              <Stack spacing={2}>
                <AdminDetailCard title="基础信息">
                  <Stack spacing={1}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{String(selectedUser.nickname || '')}</Typography>
                    <Typography variant="body2" color="text.secondary">{String(selectedUser.phone || '')}</Typography>
                    {selectedUser.latestSubscription ? (
                      <Typography variant="body2" color="text.secondary">当前订阅：{String((selectedUser.latestSubscription as Record<string, unknown>).plan_name || (selectedUser.latestSubscription as Record<string, unknown>).plan_code || '')} · {String((selectedUser.latestSubscription as Record<string, unknown>).status || '')}</Typography>
                    ) : null}
                  </Stack>
                </AdminDetailCard>

                <Grid container spacing={1.25}>
                  {statCards.map((card) => (
                    <Grid key={card.label} size={{ xs: 6, md: 3 }}>
                      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                        <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 900 }}>{String(card.value || 0)}</Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, xl: 4 }}>
                    <WorkspaceTable title="最近订单" rows={workspace?.recentOrders || []} columns={[{ key: 'order_no', label: '订单号' }, { key: 'status', label: '状态' }, { key: 'amount', label: '金额' }, { key: 'created_at', label: '创建时间' }]} />
                  </Grid>
                  <Grid size={{ xs: 12, xl: 4 }}>
                    <WorkspaceTable title="最近聊天" rows={workspace?.recentChats || []} columns={[{ key: 'name', label: '名称' }, { key: 'type', label: '类型' }, { key: 'share_enabled', label: '分享' }, { key: 'updated_at', label: '更新时间' }]} />
                  </Grid>
                  <Grid size={{ xs: 12, xl: 4 }}>
                    <WorkspaceTable title="最近角色" rows={workspace?.recentCharacters || []} columns={[{ key: 'name', label: '名称' }, { key: 'group_name', label: '分组' }, { key: 'is_preset', label: '预设' }, { key: 'updated_at', label: '更新时间' }]} />
                  </Grid>
                </Grid>
              </Stack>
            ) : null}

            <AdminDetailCard title="限制项">
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {selectedRestrictions.map((item) => (
                  <Chip
                    key={String(item.id)}
                    label={`${String(item.restriction_type)} · ${String(item.status)}`}
                    color={String(item.status) === 'active' ? 'warning' : 'default'}
                    onDelete={String(item.status) === 'active' ? () => void saveRestriction(String(item.restriction_type || ''), 'inactive') : undefined}
                  />
                ))}
              </Box>
              {!selectedRestrictions.length ? <Alert severity="info">暂无限制项</Alert> : null}
              <Divider />
              <TextField label="限制原因" value={restrictionReason} onChange={(e) => setRestrictionReason(e.target.value)} />
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" disabled={actionLoading} onClick={() => void saveRestriction('share_disabled')}>禁分享</Button>
                <Button variant="outlined" disabled={actionLoading} onClick={() => void saveRestriction('ai_disabled')}>禁AI</Button>
                <Button variant="outlined" disabled={actionLoading} onClick={() => void saveRestriction('sync_disabled')}>禁同步</Button>
              </Stack>
            </AdminDetailCard>
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
