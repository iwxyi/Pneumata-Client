import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
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
            <TableCell>自动开通</TableCell>
            <TableCell>默认分组</TableCell>
            <TableCell>默认点数</TableCell>
            <TableCell>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={String(item.id)}>
              <TableCell>{String(item.code || '')}</TableCell>
              <TableCell>{String(item.name || '')}</TableCell>
              <TableCell>{String(item.base_url || '')}</TableCell>
              <TableCell>{String(item.admin_base_url || '')}</TableCell>
              <TableCell>{String(item.status || '')}</TableCell>
              <TableCell>{Number(item.auto_provision_enabled || 0) ? '是' : '否'}</TableCell>
              <TableCell>{String(item.default_key_type_id ?? '')}</TableCell>
              <TableCell>{String(item.default_grant_amount ?? '')}</TableCell>
              <TableCell><Button size="small" onClick={() => onOpen(String(item.code || ''))}>进入</Button></TableCell>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    void loadProviders();
  }, []);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Alert severity="success" sx={{ flex: 1 }}>启用 Provider：{providerStats.active}</Alert>
        <Alert severity="warning" sx={{ flex: 1 }}>停用 Provider：{providerStats.disabled}</Alert>
      </Stack>
      <AdminRequestState loading={loading} error={error} onRetry={() => void loadProviders()} />
      <ProviderTable items={items} onOpen={(providerCode) => navigate(`/admin/ai/providers/${encodeURIComponent(providerCode)}`)} />
    </Stack>
  );
}
