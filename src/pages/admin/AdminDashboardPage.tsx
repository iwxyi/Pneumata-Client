import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import { adminApi } from '../../services/adminApi';

const metricMeta: Record<string, { title: string; route?: string }> = {
  users: { title: '用户总数', route: '/admin/users' },
  activeAiEntitlements: { title: 'AI开通数', route: '/admin/ai' },
  pendingShareReviews: { title: '待处理审核', route: '/admin/moderation' },
  activeRestrictions: { title: '生效限制', route: '/admin/risk' },
  pendingOrders: { title: '待支付订单', route: '/admin/billing' },
  queuedNotifications: { title: '排队通知', route: '/admin/notifications' },
  auditEvents24h: { title: '24h审计事件', route: '/admin/audit' },
  paidOrders: { title: '已支付订单', route: '/admin/billing' },
};

function formatTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function CompactSummaryTable({ title, empty, rows, route }: { title: string; empty: string; rows: Array<Record<string, unknown>>; route: string }) {
  const navigate = useNavigate();
  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden', height: '100%' }}>
      <Stack direction="row" sx={{ px: 2, py: 1.5, justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800 }}>{title}</Typography>
        <Button size="small" onClick={() => navigate(route)}>查看全部</Button>
      </Stack>
      {!rows.length ? <Alert severity="info" sx={{ mx: 2, mb: 2 }}>{empty}</Alert> : null}
      {rows.length ? (
        <AdminResponsiveTable minWidth={520}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>主信息</TableCell>
                <TableCell>状态</TableCell>
                <TableCell>时间</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((item) => {
                const primary = String(item.order_no || item.id || item.action || '-');
                const status = String(item.status || item.result || item.latest_decision || '-');
                const time = formatTime(item.created_at);
                return (
                  <TableRow key={String(item.id || primary)} hover>
                    <TableCell>{primary}</TableCell>
                    <TableCell>{status}</TableCell>
                    <TableCell>{time}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </AdminResponsiveTable>
      ) : null}
    </Paper>
  );
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [recentOrders, setRecentOrders] = useState<Array<Record<string, unknown>>>([]);
  const [recentReviews, setRecentReviews] = useState<Array<Record<string, unknown>>>([]);
  const [recentAudits, setRecentAudits] = useState<Array<Record<string, unknown>>>([]);
  const metricCards = useMemo(() => Object.entries(metricMeta), []);

  useEffect(() => {
    void adminApi.getDashboardStats().then((result) => {
      setMetrics(result.metrics);
      setRecentOrders(result.recentOrders);
      setRecentReviews(result.recentReviews);
      setRecentAudits(result.recentAudits);
    });
  }, []);

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        {metricCards.map(([key, meta]) => (
          <Grid key={key} size={{ xs: 12, sm: 6, xl: 3 }}>
            <Paper sx={{ p: { xs: 1.75, sm: 2.25 }, borderRadius: 3, height: '100%', cursor: meta.route ? 'pointer' : 'default' }} onClick={meta.route ? () => navigate(meta.route!) : undefined}>
              <Typography variant="body2" color="text.secondary">{meta.title}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5 }}>{metrics[key] ?? 0}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, xl: 4 }}>
          <CompactSummaryTable title="最近订单" empty="暂无订单" rows={recentOrders} route="/admin/billing" />
        </Grid>
        <Grid size={{ xs: 12, xl: 4 }}>
          <CompactSummaryTable title="最近审核" empty="暂无审核" rows={recentReviews} route="/admin/moderation" />
        </Grid>
        <Grid size={{ xs: 12, xl: 4 }}>
          <CompactSummaryTable title="最近审计" empty="暂无审计" rows={recentAudits} route="/admin/audit" />
        </Grid>
      </Grid>
    </Stack>
  );
}
