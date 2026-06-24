import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

function formatOrderTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function OrderDetailCard({ selectedOrder }: { selectedOrder: Record<string, unknown> | null }) {
  return (
    <AdminDetailCard title="订单详情">
      {selectedOrder ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">订单号：{String(selectedOrder.order_no || '')}</Typography>
          <Typography variant="body2">用户：{String(selectedOrder.user_nickname || selectedOrder.user_phone || '')}</Typography>
          <Typography variant="body2">套餐：{String(selectedOrder.plan_name || '')}</Typography>
          <Typography variant="body2">状态：{String(selectedOrder.status || '')}</Typography>
          <Typography variant="body2">金额：{String(selectedOrder.amount || '')}</Typography>
          <Typography variant="body2">支付渠道：{String(selectedOrder.payment_channel || '')}</Typography>
          <Typography variant="body2">创建时间：{formatOrderTime(selectedOrder.created_at)}</Typography>
          <Typography variant="body2">支付时间：{formatOrderTime(selectedOrder.paid_at)}</Typography>
        </Stack>
      ) : <Alert severity="info">点击订单行查看详情</Alert>}
    </AdminDetailCard>
  );
}

export default function AdminBillingPage() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => ({
    pending: items.filter((item) => String(item.status || '') === 'pending').length,
    paid: items.filter((item) => String(item.status || '') === 'paid').length,
    amount: items.reduce((total, item) => total + Number(item.amount || 0), 0),
  }), [items]);

  const [status, setStatus] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getOrders({ status: status || undefined });
      setItems(result.items);
      if (selectedOrder) {
        const next = result.items.find((item) => String(item.id) === String(selectedOrder.id));
        setSelectedOrder(next || null);
      }
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  const markPaid = async (orderId: string) => {
    setActionLoadingId(orderId);
    setError(null);
    try {
      await adminApi.markOrderPaid(orderId);
      await load();
    } catch (actionError) {
      setError(getAdminErrorMessage(actionError));
    } finally {
      setActionLoadingId(null);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Button variant={status === '' ? 'contained' : 'outlined'} onClick={() => setStatus('')}>全部</Button>
        <Button variant={status === 'pending' ? 'contained' : 'outlined'} onClick={() => setStatus('pending')}>待支付</Button>
        <Button variant={status === 'paid' ? 'contained' : 'outlined'} onClick={() => setStatus('paid')}>已支付</Button>
      </Stack>
      <AdminRequestState loading={loading} error={error} onRetry={() => void load()} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
        <Alert severity="info" sx={{ flex: 1 }}>待支付：{summary.pending}</Alert>
        <Alert severity="success" sx={{ flex: 1 }}>已支付：{summary.paid}</Alert>
        <Alert severity="warning" sx={{ flex: 1 }}>总金额：{summary.amount.toFixed(2)}</Alert>
      </Stack>
      <AdminResponsiveTable minWidth={760}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>订单号</TableCell>
              <TableCell>用户</TableCell>
              <TableCell>套餐</TableCell>
              <TableCell>金额</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item.id)} hover selected={String(selectedOrder?.id || '') === String(item.id)} onClick={() => setSelectedOrder(item)}>
                <TableCell>{String(item.order_no || '')}</TableCell>
                <TableCell>{String(item.user_nickname || item.user_phone || '')}</TableCell>
                <TableCell>{String(item.plan_name || '')}</TableCell>
                <TableCell>{String(item.amount || '')}</TableCell>
                <TableCell>{String(item.status || '')}</TableCell>
                <TableCell align="right">
                  {String(item.status || '') !== 'paid' ? (
                    <Button size="small" disabled={actionLoadingId === String(item.id)} onClick={(event) => { event.stopPropagation(); void markPaid(String(item.id)); }}>标记支付</Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>
      <OrderDetailCard selectedOrder={selectedOrder} />
    </Stack>
  );
}
