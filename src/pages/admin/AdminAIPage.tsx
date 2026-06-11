import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dialog, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import { adminApi } from '../../services/adminApi';

function formatDateTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function DetailLine({ label, value }: { label: string; value: unknown }) {
  return <Typography variant="body2">{label}：{String(value ?? '-')}</Typography>;
}

function EntitlementDetails({ entitlement }: { entitlement: Record<string, unknown> }) {
  return (
    <AdminDetailCard title="权限详情">
      <DetailLine label="状态" value={entitlement.status} />
      <DetailLine label="套餐" value={entitlement.plan_code} />
      <DetailLine label="默认档位" value={entitlement.default_model_tier} />
      <DetailLine label="流式" value={entitlement.allow_stream} />
      <DetailLine label="高级模型" value={entitlement.allow_advanced_models} />
      <DetailLine label="RPM" value={entitlement.max_requests_per_minute} />
      <DetailLine label="并发" value={entitlement.max_concurrent_requests} />
      <DetailLine label="上下文" value={entitlement.max_context_tokens} />
      <DetailLine label="生效时间" value={formatDateTime(entitlement.effective_from)} />
      <DetailLine label="到期时间" value={formatDateTime(entitlement.effective_until)} />
    </AdminDetailCard>
  );
}

function KeyCard({ keyItem }: { keyItem: Record<string, unknown> }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
      <Typography variant="body2">{String(keyItem.key_mask || '')} · {String(keyItem.status || '')}</Typography>
      <Typography variant="caption" color="text.secondary">分配时间：{formatDateTime(keyItem.assigned_at)}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>最近余额同步：{formatDateTime(keyItem.last_balance_sync_at)}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>最近使用：{formatDateTime(keyItem.last_used_at)}</Typography>
    </Paper>
  );
}

function ProviderTable({ items }: { items: Array<Record<string, unknown>> }) {
  return (
    <AdminResponsiveTable minWidth={720}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Code</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Base URL</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={String(item.id)}>
              <TableCell>{String(item.code || '')}</TableCell>
              <TableCell>{String(item.name || '')}</TableCell>
              <TableCell>{String(item.base_url || '')}</TableCell>
              <TableCell>{String(item.status || '')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminResponsiveTable>
  );
}

function BalanceCard({ balance }: { balance: Record<string, unknown> | null }) {
  return (
    <AdminDetailCard title="余额快照">
      {balance ? (
        <Stack spacing={0.5}>
          <DetailLine label="状态" value={balance.keyStatus} />
          <DetailLine label="可用余额" value={balance.availableBalance} />
          <DetailLine label="单位" value={balance.currencyUnit} />
          <DetailLine label="查询时间" value={formatDateTime(balance.fetchedAt)} />
        </Stack>
      ) : <Alert severity="info">暂无余额快照</Alert>}
    </AdminDetailCard>
  );
}

function ActionButtons({ userId, onActivate, onSuspend }: { userId: string; onActivate: () => Promise<void>; onSuspend: () => Promise<void> }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
      <Button variant="outlined" onClick={() => void onActivate()}>开通</Button>
      <Button variant="outlined" color="warning" onClick={() => void onSuspend()}>停用</Button>
      <Button variant="text" onClick={() => { navigator.clipboard.writeText(userId).catch(() => undefined); }}>复制用户ID</Button>
    </Stack>
  );
}

function QueryBar({ userId, onChange, onQuery }: { userId: string; onChange: (value: string) => void; onQuery: () => Promise<void> }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
      <TextField label="用户ID" value={userId} onChange={(e) => onChange(e.target.value)} fullWidth />
      <Button variant="contained" onClick={() => void onQuery()} sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}>查询权益</Button>
    </Stack>
  );
}

export default function AdminAIPage() {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [userId, setUserId] = useState('');
  const [entitlement, setEntitlement] = useState<Record<string, unknown> | null>(null);
  const [keys, setKeys] = useState<Array<Record<string, unknown>>>([]);
  const [balance, setBalance] = useState<Record<string, unknown> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const providerStats = useMemo(() => ({
    active: items.filter((item) => String(item.status || '') === 'active').length,
    disabled: items.filter((item) => String(item.status || '') !== 'active').length,
  }), [items]);

  useEffect(() => {
    void adminApi.getAiProviders().then((result) => setItems(result.items));
  }, []);

  const loadUserEntitlement = async () => {
    const trimmedUserId = userId.trim();
    const [entitlementResult, balanceResult] = await Promise.all([
      adminApi.getAiEntitlement(trimmedUserId),
      adminApi.getAiBalance(trimmedUserId).catch(() => null),
    ]);
    setEntitlement(entitlementResult.entitlement);
    setKeys(entitlementResult.keys);
    setBalance(balanceResult);
    setDialogOpen(true);
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Alert severity="success" sx={{ flex: 1 }}>启用 Provider：{providerStats.active}</Alert>
        <Alert severity="warning" sx={{ flex: 1 }}>停用 Provider：{providerStats.disabled}</Alert>
      </Stack>
      <QueryBar userId={userId} onChange={setUserId} onQuery={loadUserEntitlement} />
      <ProviderTable items={items} />
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="lg" fullScreen={fullScreen}>
        <DialogTitle>用户 AI 权益</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {entitlement ? (
              <Stack spacing={2}>
                <EntitlementDetails entitlement={entitlement} />
                <ActionButtons
                  userId={userId}
                  onActivate={async () => {
                    if (!userId.trim()) return;
                    const updated = await adminApi.updateAiEntitlement(userId.trim(), { aiEnabled: true, status: 'active' });
                    setEntitlement(updated);
                  }}
                  onSuspend={async () => {
                    if (!userId.trim()) return;
                    const updated = await adminApi.updateAiEntitlement(userId.trim(), { aiEnabled: false, status: 'suspended' });
                    setEntitlement(updated);
                  }}
                />
              </Stack>
            ) : <Alert severity="info">该用户暂无 AI 权益记录</Alert>}
            <BalanceCard balance={balance} />
            <AdminDetailCard title="Key 列表">
              {!keys.length ? <Alert severity="info">暂无分配 key</Alert> : null}
              <Stack spacing={1}>{keys.map((key) => <KeyCard key={String(key.id)} keyItem={key} />)}</Stack>
            </AdminDetailCard>
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
