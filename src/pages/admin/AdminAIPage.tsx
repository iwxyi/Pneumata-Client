import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, FormControlLabel, Paper, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

function ProviderTable({ items, onOpen }: { items: Array<Record<string, unknown>>; onOpen: (providerCode: string) => void }) {
  return (
    <AdminResponsiveTable minWidth={720}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Code</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>AI 调用地址</TableCell>
            <TableCell>管理 API 地址</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>默认分组</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={String(item.id)}
              hover
              onClick={() => onOpen(String(item.code || ''))}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>{String(item.code || '')}</TableCell>
              <TableCell>{String(item.name || '')}</TableCell>
              <TableCell>{String(item.base_url || '')}</TableCell>
              <TableCell>{String(item.admin_base_url || '')}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={String(item.status || '') === 'active' ? '启用' : '停用'}
                  color={String(item.status || '') === 'active' ? 'success' : 'default'}
                  sx={{ height: 22 }}
                />
              </TableCell>
              <TableCell>{String(item.default_key_type_id ?? '')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminResponsiveTable>
  );
}

export default function AdminAIPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [globalDialogOpen, setGlobalDialogOpen] = useState(false);
  const [globalForm, setGlobalForm] = useState({
    defaultProvisionEnabled: false,
    defaultGrantAmount: '',
    defaultDailyQuota: '',
    defaultMonthlyQuota: '',
    defaultPlanCode: 'default',
  });
  const [loading, setLoading] = useState(false);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalSaving, setGlobalSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const providerStats = useMemo(() => ({
    active: items.filter((item) => String(item.status || '') === 'active').length,
    disabled: items.filter((item) => String(item.status || '') !== 'active').length,
  }), [items]);

  const loadProviders = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getAiProviders();
      setItems(result.items);
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  const loadGlobalConfig = async () => {
    setGlobalLoading(true);
    setGlobalError(null);
    try {
      const result = await adminApi.getPlatformGlobalConfig();
      const ai = result.ai || {};
      setGlobalForm({
        defaultProvisionEnabled: Boolean(ai.defaultProvisionEnabled),
        defaultGrantAmount: ai.defaultGrantAmount == null ? '' : String(ai.defaultGrantAmount),
        defaultDailyQuota: ai.defaultDailyQuota == null ? '' : String(ai.defaultDailyQuota),
        defaultMonthlyQuota: ai.defaultMonthlyQuota == null ? '' : String(ai.defaultMonthlyQuota),
        defaultPlanCode: ai.defaultPlanCode == null ? '' : String(ai.defaultPlanCode),
      });
    } catch (loadError) {
      setGlobalError(getAdminErrorMessage(loadError));
    } finally {
      setGlobalLoading(false);
    }
  };

  const openGlobalDialog = () => {
    setGlobalDialogOpen(true);
    void loadGlobalConfig();
  };

  const saveGlobalConfig = async () => {
    setGlobalSaving(true);
    setGlobalError(null);
    try {
      await adminApi.updatePlatformGlobalConfig({
        ai: {
          defaultProvisionEnabled: globalForm.defaultProvisionEnabled,
          defaultGrantAmount: globalForm.defaultGrantAmount ? Number(globalForm.defaultGrantAmount) : 0,
          defaultDailyQuota: globalForm.defaultDailyQuota ? Number(globalForm.defaultDailyQuota) : 0,
          defaultMonthlyQuota: globalForm.defaultMonthlyQuota ? Number(globalForm.defaultMonthlyQuota) : 0,
          defaultPlanCode: globalForm.defaultPlanCode.trim() || null,
        },
      });
      setGlobalDialogOpen(false);
      await loadProviders();
    } catch (saveError) {
      setGlobalError(getAdminErrorMessage(saveError));
    } finally {
      setGlobalSaving(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Paper variant="outlined" sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">启用 Provider</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.25 }}>{providerStats.active}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, minWidth: 120 }}>
          <Typography variant="caption" color="text.secondary">停用 Provider</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.25 }}>{providerStats.disabled}</Typography>
        </Paper>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={openGlobalDialog}>全局配置</Button>
      </Stack>
      <AdminRequestState loading={loading} error={error} onRetry={() => void loadProviders()} />
      <ProviderTable items={items} onOpen={(providerCode) => navigate(`/admin/ai/providers/${encodeURIComponent(providerCode)}`)} />
      <Dialog open={globalDialogOpen} onClose={() => setGlobalDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>AI 全局配置</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <AdminRequestState loading={globalLoading} error={globalError} onRetry={() => void loadGlobalConfig()} />
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack spacing={1.25}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>新用户默认分配额度</Typography>
                <FormControlLabel
                  control={<Switch checked={globalForm.defaultProvisionEnabled} onChange={(event) => setGlobalForm((prev) => ({ ...prev, defaultProvisionEnabled: event.target.checked }))} />}
                  label="新用户注册后自动开通默认 AI 权益并分配额度"
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <TextField label="默认点数" value={globalForm.defaultGrantAmount} onChange={(event) => setGlobalForm((prev) => ({ ...prev, defaultGrantAmount: event.target.value }))} fullWidth />
                  <TextField label="每日额度" value={globalForm.defaultDailyQuota} onChange={(event) => setGlobalForm((prev) => ({ ...prev, defaultDailyQuota: event.target.value }))} fullWidth />
                  <TextField label="每月额度" value={globalForm.defaultMonthlyQuota} onChange={(event) => setGlobalForm((prev) => ({ ...prev, defaultMonthlyQuota: event.target.value }))} fullWidth />
                </Stack>
                <TextField label="默认计划编码" value={globalForm.defaultPlanCode} onChange={(event) => setGlobalForm((prev) => ({ ...prev, defaultPlanCode: event.target.value }))} fullWidth />
              </Stack>
            </Paper>
            <Button variant="contained" disabled={globalSaving || globalLoading} onClick={() => void saveGlobalConfig()}>保存全局配置</Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
