import { useEffect, useMemo, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminInlineGroup from '../../components/admin/AdminInlineGroup';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

type PlanKind = 'vip' | 'points';

type PlanForm = {
  id: string;
  code: string;
  name: string;
  description: string;
  planKind: PlanKind;
  priceAmount: string;
  currency: string;
  durationDays: string;
  grantPoints: string;
  status: string;
  visibleToUsers: boolean;
  featured: boolean;
  sortOrder: string;
  aiEnabled: boolean;
  allowStream: boolean;
  allowAdvancedModels: boolean;
  defaultModelTier: string;
  maxRequestsPerMinute: string;
  maxConcurrentRequests: string;
  maxContextTokens: string;
  featuresText: string;
};

const EMPTY_PLAN_FORM: PlanForm = {
  id: '',
  code: '',
  name: '',
  description: '',
  planKind: 'points',
  priceAmount: '',
  currency: 'CNY',
  durationDays: '30',
  grantPoints: '',
  status: 'active',
  visibleToUsers: true,
  featured: false,
  sortOrder: '0',
  aiEnabled: true,
  allowStream: true,
  allowAdvancedModels: false,
  defaultModelTier: 'standard',
  maxRequestsPerMinute: '30',
  maxConcurrentRequests: '2',
  maxContextTokens: '64000',
  featuresText: '',
};

function formatOrderTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function numberText(value: unknown, fallback = '') {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : fallback;
}

function formatMoney(value: unknown, currency: unknown = 'CNY') {
  const parsed = Number(value || 0);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  return `${amount.toFixed(2)} ${String(currency || 'CNY')}`;
}

function formatPoints(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0P';
  return `${Number.isInteger(parsed) ? parsed : Number(parsed.toFixed(2))}P`;
}

function planKindLabel(value: unknown) {
  return String(value || '') === 'vip' ? 'VIP + 点数' : '点数包';
}

function statusLabel(value: unknown) {
  const status = String(value || '');
  if (status === 'active') return '启用';
  if (status === 'inactive') return '停用';
  if (status === 'archived') return '归档';
  if (status === 'paid') return '已支付';
  if (status === 'pending') return '待支付';
  return status || '-';
}

function parseMetadataFeatures(value: unknown) {
  if (!value) return [];
  let metadata: Record<string, unknown> = {};
  if (typeof value === 'object' && !Array.isArray(value)) metadata = value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }
  return Array.isArray(metadata.features) ? metadata.features.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function toPlanForm(item: Record<string, unknown>): PlanForm {
  const planKind = String(item.plan_kind || '') === 'vip' ? 'vip' : 'points';
  return {
    id: String(item.id || ''),
    code: String(item.code || ''),
    name: String(item.name || ''),
    description: String(item.description || ''),
    planKind,
    priceAmount: numberText(item.price_amount),
    currency: String(item.currency || 'CNY'),
    durationDays: item.duration_days == null ? '30' : numberText(item.duration_days, '30'),
    grantPoints: numberText(item.grant_points),
    status: String(item.status || 'active'),
    visibleToUsers: toBoolean(item.visible_to_users, true),
    featured: toBoolean(item.featured, false),
    sortOrder: numberText(item.sort_order, '0'),
    aiEnabled: planKind === 'vip' ? toBoolean(item.ai_enabled, true) : false,
    allowStream: toBoolean(item.allow_stream, true),
    allowAdvancedModels: toBoolean(item.allow_advanced_models, false),
    defaultModelTier: String(item.default_model_tier || 'standard'),
    maxRequestsPerMinute: numberText(item.max_requests_per_minute, '30'),
    maxConcurrentRequests: numberText(item.max_concurrent_requests, '2'),
    maxContextTokens: numberText(item.max_context_tokens, '64000'),
    featuresText: parseMetadataFeatures(item.metadata).join('\n'),
  };
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPlanPayload(form: PlanForm) {
  const isVip = form.planKind === 'vip';
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    planKind: form.planKind,
    priceAmount: Math.max(0, toNumber(form.priceAmount, 0)),
    currency: form.currency.trim() || 'CNY',
    durationDays: isVip ? Math.max(1, Math.floor(toNumber(form.durationDays, 30))) : null,
    grantPoints: Math.max(0, toNumber(form.grantPoints, 0)),
    status: form.status,
    visibleToUsers: form.visibleToUsers,
    featured: form.featured,
    sortOrder: Math.floor(toNumber(form.sortOrder, 0)),
    aiEnabled: isVip ? form.aiEnabled : false,
    allowStream: isVip ? form.allowStream : true,
    allowAdvancedModels: isVip ? form.allowAdvancedModels : false,
    defaultModelTier: form.defaultModelTier.trim() || 'standard',
    maxRequestsPerMinute: Math.max(1, Math.floor(toNumber(form.maxRequestsPerMinute, 30))),
    maxConcurrentRequests: Math.max(1, Math.floor(toNumber(form.maxConcurrentRequests, 2))),
    maxContextTokens: Math.max(1024, Math.floor(toNumber(form.maxContextTokens, 64000))),
    features: form.featuresText.split('\n').map((item) => item.trim()).filter(Boolean),
  };
}

function OrderDetailCard({ selectedOrder }: { selectedOrder: Record<string, unknown> | null }) {
  return (
    <AdminDetailCard title="订单详情">
      {selectedOrder ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">订单号：{String(selectedOrder.order_no || '')}</Typography>
          <Typography variant="body2">用户：{String(selectedOrder.user_nickname || selectedOrder.user_phone || '')}</Typography>
          <Typography variant="body2">套餐：{String(selectedOrder.plan_name || '')}</Typography>
          <Typography variant="body2">状态：{statusLabel(selectedOrder.status)}</Typography>
          <Typography variant="body2">金额：{formatMoney(selectedOrder.amount, selectedOrder.currency)}</Typography>
          <Typography variant="body2">支付渠道：{String(selectedOrder.payment_channel || '')}</Typography>
          <Typography variant="body2">创建时间：{formatOrderTime(selectedOrder.created_at)}</Typography>
          <Typography variant="body2">支付时间：{formatOrderTime(selectedOrder.paid_at)}</Typography>
        </Stack>
      ) : <Alert severity="info">点击订单行查看详情</Alert>}
    </AdminDetailCard>
  );
}

export default function AdminBillingPage() {
  const [tab, setTab] = useState(0);
  const [plans, setPlans] = useState<Array<Record<string, unknown>>>([]);
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(EMPTY_PLAN_FORM);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [plansLoading, setPlansLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const selectedPlanId = planForm.id;

  const orderSummary = useMemo(() => ({
    pending: orders.filter((item) => String(item.status || '') === 'pending').length,
    paid: orders.filter((item) => String(item.status || '') === 'paid').length,
    amount: orders.reduce((total, item) => total + Number(item.amount || 0), 0),
  }), [orders]);

  const planSummary = useMemo(() => ({
    vip: plans.filter((item) => String(item.plan_kind || '') === 'vip').length,
    points: plans.filter((item) => String(item.plan_kind || '') !== 'vip').length,
    active: plans.filter((item) => String(item.status || '') === 'active').length,
  }), [plans]);

  const loadPlans = async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const result = await adminApi.getBillingPlans();
      setPlans(result.items || []);
      if (planDialogOpen && selectedPlanId) {
        const next = result.items.find((item) => String(item.id) === selectedPlanId);
        if (next) setPlanForm(toPlanForm(next));
      }
    } catch (loadError) {
      setPlansError(getAdminErrorMessage(loadError));
    } finally {
      setPlansLoading(false);
    }
  };

  const loadOrders = async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const result = await adminApi.getOrders({ status: status || undefined });
      setOrders(result.items || []);
      if (selectedOrder) {
        const next = result.items.find((item) => String(item.id) === String(selectedOrder.id));
        setSelectedOrder(next || null);
      }
    } catch (loadError) {
      setOrdersError(getAdminErrorMessage(loadError));
    } finally {
      setOrdersLoading(false);
    }
  };

  const savePlan = async () => {
    setSavingPlan(true);
    setPlansError(null);
    try {
      const payload = buildPlanPayload(planForm);
      if (planForm.id) await adminApi.updateBillingPlan(planForm.id, payload);
      else await adminApi.createBillingPlan(payload);
      setPlanForm(EMPTY_PLAN_FORM);
      setPlanDialogOpen(false);
      await loadPlans();
    } catch (saveError) {
      setPlansError(getAdminErrorMessage(saveError));
    } finally {
      setSavingPlan(false);
    }
  };

  const markPaid = async (orderId: string) => {
    setActionLoadingId(orderId);
    setOrdersError(null);
    try {
      await adminApi.markOrderPaid(orderId, { paymentChannel: 'admin_manual' });
      await loadOrders();
    } catch (actionError) {
      setOrdersError(getAdminErrorMessage(actionError));
    } finally {
      setActionLoadingId(null);
    }
  };

  useEffect(() => {
    if (tab === 0) void loadPlans();
    if (tab === 1) void loadOrders();
  }, [tab]);

  useEffect(() => {
    if (tab === 1) void loadOrders();
  }, [status]);

  const updateForm = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => {
    setPlanForm((prev) => ({ ...prev, [key]: value }));
  };

  const openCreatePlanDialog = () => {
    setPlanForm(EMPTY_PLAN_FORM);
    setPlanDialogOpen(true);
  };

  const openEditPlanDialog = (item: Record<string, unknown>) => {
    setPlanForm(toPlanForm(item));
    setPlanDialogOpen(true);
  };

  return (
    <Stack spacing={2}>
      <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="套餐" />
        <Tab label="订单" />
      </Tabs>

      {tab === 0 ? (
        <Stack spacing={2}>
          <AdminRequestState loading={plansLoading} error={plansError} onRetry={() => void loadPlans()} />
          <AdminInlineGroup gap={1.25}>
            <Alert severity="info">VIP 套餐：{planSummary.vip}</Alert>
            <Alert severity="success">点数套餐：{planSummary.points}</Alert>
            <Alert severity="warning">启用中：{planSummary.active}</Alert>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={openCreatePlanDialog}
              sx={{ ml: 'auto' }}
            >
              新建套餐
            </Button>
          </AdminInlineGroup>

          <Stack spacing={1.25}>
            <AdminResponsiveTable minWidth={900}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>套餐</TableCell>
                    <TableCell>类型</TableCell>
                    <TableCell>价格</TableCell>
                    <TableCell>赠送点数</TableCell>
                    <TableCell>时长</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plans.map((item) => (
                    <TableRow
                      key={String(item.id)}
                      hover
                      selected={planDialogOpen && selectedPlanId === String(item.id)}
                      onClick={() => openEditPlanDialog(item)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>{String(item.name || '')}</Typography>
                          <Typography variant="caption" color="text.secondary">{String(item.code || '')}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={planKindLabel(item.plan_kind)} color={String(item.plan_kind || '') === 'vip' ? 'primary' : 'default'} />
                      </TableCell>
                      <TableCell>{formatMoney(item.price_amount, item.currency)}</TableCell>
                      <TableCell>{formatPoints(item.grant_points)}</TableCell>
                      <TableCell>{String(item.plan_kind || '') === 'vip' ? `${String(item.duration_days || 0)} 天` : '-'}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Chip size="small" label={statusLabel(item.status)} color={String(item.status || '') === 'active' ? 'success' : 'default'} />
                          {toBoolean(item.visible_to_users, true) ? null : <Chip size="small" label="隐藏" />}
                          {toBoolean(item.featured, false) ? <Chip size="small" label="推荐" color="warning" /> : null}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={(event) => { event.stopPropagation(); openEditPlanDialog(item); }}>编辑</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AdminResponsiveTable>
          </Stack>

          <Dialog open={planDialogOpen} onClose={() => setPlanDialogOpen(false)} maxWidth="md" fullWidth>
            <DialogTitle>{planForm.id ? '编辑套餐' : '新增套餐'}</DialogTitle>
            <DialogContent>
              <Stack spacing={1.25} sx={{ pt: 1 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <TextField label="套餐编码" value={planForm.code} onChange={(event) => updateForm('code', event.target.value)} fullWidth />
                  <TextField select label="类型" value={planForm.planKind} onChange={(event) => updateForm('planKind', event.target.value as PlanKind)} sx={{ minWidth: 150 }}>
                    <MenuItem value="points">点数包</MenuItem>
                    <MenuItem value="vip">VIP + 点数</MenuItem>
                  </TextField>
                </Stack>
                <TextField label="套餐名称" value={planForm.name} onChange={(event) => updateForm('name', event.target.value)} fullWidth />
                <TextField label="说明" value={planForm.description} onChange={(event) => updateForm('description', event.target.value)} fullWidth multiline minRows={2} />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <TextField label="价格" value={planForm.priceAmount} onChange={(event) => updateForm('priceAmount', event.target.value)} fullWidth />
                  <TextField label="币种" value={planForm.currency} onChange={(event) => updateForm('currency', event.target.value)} sx={{ minWidth: 100 }} />
                  <TextField label="赠送点数" value={planForm.grantPoints} onChange={(event) => updateForm('grantPoints', event.target.value)} fullWidth />
                </Stack>
                {planForm.planKind === 'vip' ? (
                  <>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                      <TextField label="有效天数" value={planForm.durationDays} onChange={(event) => updateForm('durationDays', event.target.value)} fullWidth />
                      <TextField label="模型等级" value={planForm.defaultModelTier} onChange={(event) => updateForm('defaultModelTier', event.target.value)} fullWidth />
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                      <TextField label="每分钟请求" value={planForm.maxRequestsPerMinute} onChange={(event) => updateForm('maxRequestsPerMinute', event.target.value)} fullWidth />
                      <TextField label="最大并发" value={planForm.maxConcurrentRequests} onChange={(event) => updateForm('maxConcurrentRequests', event.target.value)} fullWidth />
                    </Stack>
                    <TextField label="上下文 Token 上限" value={planForm.maxContextTokens} onChange={(event) => updateForm('maxContextTokens', event.target.value)} fullWidth />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5}>
                      <FormControlLabel control={<Switch checked={planForm.aiEnabled} onChange={(event) => updateForm('aiEnabled', event.target.checked)} />} label="解锁 AI" />
                      <FormControlLabel control={<Switch checked={planForm.allowStream} onChange={(event) => updateForm('allowStream', event.target.checked)} />} label="流式" />
                      <FormControlLabel control={<Switch checked={planForm.allowAdvancedModels} onChange={(event) => updateForm('allowAdvancedModels', event.target.checked)} />} label="高级模型" />
                    </Stack>
                    <TextField label="功能权益（每行一项）" value={planForm.featuresText} onChange={(event) => updateForm('featuresText', event.target.value)} fullWidth multiline minRows={3} />
                  </>
                ) : null}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <TextField select label="状态" value={planForm.status} onChange={(event) => updateForm('status', event.target.value)} fullWidth>
                    <MenuItem value="active">启用</MenuItem>
                    <MenuItem value="inactive">停用</MenuItem>
                    <MenuItem value="archived">归档</MenuItem>
                  </TextField>
                  <TextField label="排序" value={planForm.sortOrder} onChange={(event) => updateForm('sortOrder', event.target.value)} fullWidth />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5}>
                  <FormControlLabel control={<Switch checked={planForm.visibleToUsers} onChange={(event) => updateForm('visibleToUsers', event.target.checked)} />} label="用户可见" />
                  <FormControlLabel control={<Switch checked={planForm.featured} onChange={(event) => updateForm('featured', event.target.checked)} />} label="推荐" />
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPlanDialogOpen(false)} disabled={savingPlan}>取消</Button>
              <Button variant="contained" startIcon={<SaveIcon />} disabled={savingPlan} onClick={() => void savePlan()}>
                {planForm.id ? '保存套餐' : '添加套餐'}
              </Button>
            </DialogActions>
          </Dialog>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <AdminInlineGroup gap={1.25}>
            <Button variant={status === '' ? 'contained' : 'outlined'} onClick={() => setStatus('')}>全部</Button>
            <Button variant={status === 'pending' ? 'contained' : 'outlined'} onClick={() => setStatus('pending')}>待支付</Button>
            <Button variant={status === 'paid' ? 'contained' : 'outlined'} onClick={() => setStatus('paid')}>已支付</Button>
            <Button startIcon={<RefreshIcon />} onClick={() => void loadOrders()}>刷新</Button>
          </AdminInlineGroup>
          <AdminRequestState loading={ordersLoading} error={ordersError} onRetry={() => void loadOrders()} />
          <AdminInlineGroup gap={1.25}>
            <Alert severity="info">待支付：{orderSummary.pending}</Alert>
            <Alert severity="success">已支付：{orderSummary.paid}</Alert>
            <Alert severity="warning">当前列表金额：{orderSummary.amount.toFixed(2)}</Alert>
          </AdminInlineGroup>
          <AdminResponsiveTable minWidth={820}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>订单号</TableCell>
                  <TableCell>用户</TableCell>
                  <TableCell>套餐</TableCell>
                  <TableCell>类型</TableCell>
                  <TableCell>金额</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((item) => (
                  <TableRow key={String(item.id)} hover selected={String(selectedOrder?.id || '') === String(item.id)} onClick={() => setSelectedOrder(item)}>
                    <TableCell>{String(item.order_no || '')}</TableCell>
                    <TableCell>{String(item.user_nickname || item.user_phone || '')}</TableCell>
                    <TableCell>{String(item.plan_name || '')}</TableCell>
                    <TableCell>{planKindLabel(item.order_type || item.plan_kind)}</TableCell>
                    <TableCell>{formatMoney(item.amount, item.currency)}</TableCell>
                    <TableCell>{statusLabel(item.status)}</TableCell>
                    <TableCell align="right">
                      {String(item.status || '') !== 'paid' ? (
                        <Button size="small" disabled={actionLoadingId === String(item.id)} onClick={(event) => { event.stopPropagation(); void markPaid(String(item.id)); }}>确认支付</Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AdminResponsiveTable>
          <OrderDetailCard selectedOrder={selectedOrder} />
        </Stack>
      )}
    </Stack>
  );
}
