import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Divider, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';
import { formatAiBalanceAmount } from '../../utils/aiPoints';

type KeyDraft = {
  apiKey: string;
  externalKeyId: string;
  transferAmount: string;
  dailyQuota: string;
  monthlyQuota: string;
  minuteTimes: string;
  requestLimit: string;
  note: string;
};

function formatTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeAiKeyIntoUser(user: Record<string, unknown> | null, key: Record<string, unknown>) {
  if (!user || !key.id) return user;
  const existingKeys = Array.isArray(user.aiKeys) ? user.aiKeys as Array<Record<string, unknown>> : [];
  const normalizedKey = {
    ...key,
    provider_code: key.provider_code || 'api2d',
    api_key: key.api_key || key.apiKey || '',
    status: key.status || 'active',
    source: key.source || 'admin_manual',
    is_primary: key.is_primary ?? true,
  };
  return {
    ...user,
    aiKeys: [normalizedKey, ...existingKeys.filter((item) => String(item.id || '') !== String(key.id))],
  };
}

function extractTransferredCustomKey(result: Record<string, unknown>) {
  const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : null;
  const customKey = data?.custom_key;
  return customKey && typeof customKey === 'object' && !Array.isArray(customKey)
    ? customKey as Record<string, unknown>
    : null;
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
  const [keyDrafts, setKeyDrafts] = useState<Record<string, KeyDraft>>({});
  const [expandedLimits, setExpandedLimits] = useState<Record<string, boolean>>({});
  const [expandedUsage, setExpandedUsage] = useState<Record<string, boolean>>({});
  const [keyUsage, setKeyUsage] = useState<Record<string, { invocations: Array<Record<string, unknown>>; quotaLedger: Array<Record<string, unknown>> }>>({});
  const [keyBalance, setKeyBalance] = useState<Record<string, unknown> | null>(null);
  const [keyBalanceLoading, setKeyBalanceLoading] = useState(false);
  const [manualKeyDraft, setManualKeyDraft] = useState({ visible: false, apiKey: '', externalKeyId: '' });
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

  const loadKeyBalance = async (userId: string) => {
    setKeyBalanceLoading(true);
    try {
      const balance = await adminApi.getAiBalance(userId);
      setKeyBalance(balance);
    } catch (loadError) {
      console.error('Failed to load AI key balance', loadError);
      setKeyBalance(null);
    } finally {
      setKeyBalanceLoading(false);
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

  const saveManualKey = async () => {
    if (!selectedUserId || !manualKeyDraft.apiKey.trim()) return;
    setActionLoading(true);
    setDetailError(null);
    try {
      const key = await adminApi.setAiUserKey(selectedUserId, {
        providerCode: 'api2d',
        apiKey: manualKeyDraft.apiKey.trim(),
        externalKeyId: manualKeyDraft.externalKeyId.trim() || undefined,
        isPrimary: true,
      });
      setSelectedUser((prev) => mergeAiKeyIntoUser(prev, key));
      setManualKeyDraft({ visible: false, apiKey: '', externalKeyId: '' });
      await loadSelectedUser(selectedUserId);
    } catch (saveError) {
      setDetailError(getAdminErrorMessage(saveError));
    } finally {
      setActionLoading(false);
    }
  };

  const getKeyDraft = (key: Record<string, unknown>): KeyDraft => {
    const keyId = String(key.id || '');
    const metadata = parseMetadata(key.metadata);
    const providerLimits = parseMetadata(metadata.providerLimits);
    return keyDrafts[keyId] || {
      apiKey: String(key.api_key || ''),
      externalKeyId: String(key.external_key_id || ''),
      transferAmount: '',
      dailyQuota: providerLimits.dailyQuota == null ? '' : String(providerLimits.dailyQuota),
      monthlyQuota: providerLimits.monthlyQuota == null ? '' : String(providerLimits.monthlyQuota),
      minuteTimes: providerLimits.minuteTimes == null ? '' : String(providerLimits.minuteTimes),
      requestLimit: providerLimits.requestLimit == null ? '' : String(providerLimits.requestLimit),
      note: providerLimits.note == null ? '' : String(providerLimits.note),
    };
  };

  const buildKeyDraft = (key: Record<string, unknown>): KeyDraft => {
    const metadata = parseMetadata(key.metadata);
    const providerLimits = parseMetadata(metadata.providerLimits);
    return {
      apiKey: String(key.api_key || ''),
      externalKeyId: String(key.external_key_id || ''),
      transferAmount: '',
      dailyQuota: providerLimits.dailyQuota == null ? '' : String(providerLimits.dailyQuota),
      monthlyQuota: providerLimits.monthlyQuota == null ? '' : String(providerLimits.monthlyQuota),
      minuteTimes: providerLimits.minuteTimes == null ? '' : String(providerLimits.minuteTimes),
      requestLimit: providerLimits.requestLimit == null ? '' : String(providerLimits.requestLimit),
      note: providerLimits.note == null ? '' : String(providerLimits.note),
    };
  };

  const updateKeyDraft = (key: Record<string, unknown>, patch: Partial<KeyDraft>) => {
    const keyId = String(key.id || '');
    setKeyDrafts((prev) => ({
      ...prev,
      [keyId]: { ...(prev[keyId] || buildKeyDraft(key)), ...patch },
    }));
  };

  const saveKeySecret = async (key: Record<string, unknown>) => {
    if (!selectedUserId) return;
    const keyId = String(key.id || '');
    const draft = getKeyDraft(key);
    if (!draft.apiKey.trim()) return;
    setActionLoading(true);
    setDetailError(null);
    try {
      await adminApi.updateAiUserKeySecret(selectedUserId, keyId, { apiKey: draft.apiKey.trim(), externalKeyId: draft.externalKeyId.trim() || undefined });
      await loadSelectedUser(selectedUserId);
    } catch (saveError) {
      setDetailError(getAdminErrorMessage(saveError));
    } finally {
      setActionLoading(false);
    }
  };

  const toggleKeyStatus = async (key: Record<string, unknown>) => {
    if (!selectedUserId) return;
    const keyId = String(key.id || '');
    const enabled = String(key.status || '') !== 'active';
    setActionLoading(true);
    setDetailError(null);
    try {
      await adminApi.updateAiUserKeyStatus(selectedUserId, keyId, { enabled });
      await loadSelectedUser(selectedUserId);
    } catch (saveError) {
      setDetailError(getAdminErrorMessage(saveError));
    } finally {
      setActionLoading(false);
    }
  };

  const transferKeyPoints = async (key: Record<string, unknown>) => {
    if (!selectedUserId) return;
    const keyId = String(key.id || '');
    const amount = Number(getKeyDraft(key).transferAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setDetailError('请输入非 0 的转入额度，负数表示扣除');
      return;
    }
    setActionLoading(true);
    setDetailError(null);
    try {
      const result = await adminApi.transferAiUserKeyPoints(selectedUserId, keyId, { amount });
      const customKey = extractTransferredCustomKey(result);
      if (customKey) {
        setKeyBalance((prev) => ({
          ...(prev || {}),
          provider: String(key.provider_code || 'api2d'),
          keyStatus: String(customKey.enabled ?? '') === '0' ? 'inactive' : 'active',
          availableBalance: customKey.point,
          available_balance: customKey.point,
          raw: result,
          fetchedAt: Date.now(),
        }));
      }
      updateKeyDraft(key, { transferAmount: '' });
      await Promise.all([
        loadSelectedUser(selectedUserId),
        loadKeyBalance(selectedUserId),
      ]);
    } catch (saveError) {
      setDetailError(getAdminErrorMessage(saveError));
    } finally {
      setActionLoading(false);
    }
  };

  const updateKeyLimits = async (key: Record<string, unknown>) => {
    if (!selectedUserId) return;
    const keyId = String(key.id || '');
    const draft = getKeyDraft(key);
    setActionLoading(true);
    setDetailError(null);
    try {
      await adminApi.updateAiUserKeyLimits(selectedUserId, keyId, {
        note: draft.note || undefined,
        dailyQuota: numberOrNull(draft.dailyQuota),
        monthlyQuota: numberOrNull(draft.monthlyQuota),
        minuteTimes: numberOrNull(draft.minuteTimes),
        requestLimit: numberOrNull(draft.requestLimit),
      });
      setExpandedLimits((prev) => ({ ...prev, [keyId]: false }));
      await loadSelectedUser(selectedUserId);
    } catch (saveError) {
      setDetailError(getAdminErrorMessage(saveError));
    } finally {
      setActionLoading(false);
    }
  };

  const loadKeyUsage = async (key: Record<string, unknown>) => {
    if (!selectedUserId) return;
    const keyId = String(key.id || '');
    const nextExpanded = !expandedUsage[keyId];
    setExpandedUsage((prev) => ({ ...prev, [keyId]: nextExpanded }));
    if (!nextExpanded || keyUsage[keyId]) return;
    setActionLoading(true);
    setDetailError(null);
    try {
      const usage = await adminApi.getAiUserKeyUsage(selectedUserId, keyId);
      setKeyUsage((prev) => ({ ...prev, [keyId]: usage }));
    } catch (loadError) {
      setDetailError(getAdminErrorMessage(loadError));
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
    setKeyDrafts({});
    setExpandedLimits({});
    setExpandedUsage({});
    setKeyUsage({});
    setKeyBalance(null);
    setManualKeyDraft({ visible: false, apiKey: '', externalKeyId: '' });
    void loadSelectedUser(selectedUserId);
  }, [selectedUserId]);

  const workspace = selectedUser?.workspace as { recentOrders?: Array<Record<string, unknown>>; recentChats?: Array<Record<string, unknown>>; recentCharacters?: Array<Record<string, unknown>> } | undefined;
  const aiKeys = (selectedUser?.aiKeys || []) as Array<Record<string, unknown>>;
  const aiKey = aiKeys[0] || null;

  useEffect(() => {
    if (!selectedUserId || !aiKey?.id) {
      setKeyBalance(null);
      return;
    }
    void loadKeyBalance(selectedUserId);
  }, [selectedUserId, aiKey?.id]);

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
              <TableCell align="right">详情</TableCell>
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
              <TableRow key={item.id} hover onClick={() => setSelectedUserId(item.id)} sx={{ cursor: 'pointer' }}>
                <TableCell>{item.nickname}</TableCell>
                <TableCell>{item.phone}</TableCell>
                <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <Typography variant="body2" color="primary">查看</Typography>
                </TableCell>
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

                <AdminDetailCard title="绑定 Key">
                  {!aiKeys.length ? (
                    <Alert
                      severity="info"
                      action={<Button color="inherit" size="small" onClick={() => setManualKeyDraft((prev) => ({ ...prev, visible: true }))}>设置 Key</Button>}
                    >
                      暂未绑定 AI Key
                    </Alert>
                  ) : null}
                  {manualKeyDraft.visible ? (
                    <Stack direction="row" spacing={0.75} sx={{ mb: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
                      <TextField
                        size="small"
                        label="API2D Key"
                        value={manualKeyDraft.apiKey}
                        onChange={(event) => setManualKeyDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                        sx={{ flex: '1 1 320px', minWidth: 180 }}
                      />
                      <TextField
                        size="small"
                        label="外部 ID"
                        value={manualKeyDraft.externalKeyId}
                        onChange={(event) => setManualKeyDraft((prev) => ({ ...prev, externalKeyId: event.target.value }))}
                        sx={{ flex: '0 1 180px', minWidth: 120 }}
                      />
                      <Button variant="contained" size="small" disabled={actionLoading || !manualKeyDraft.apiKey.trim()} onClick={() => void saveManualKey()} sx={{ minHeight: 32 }}>保存</Button>
                      <Button size="small" disabled={actionLoading} onClick={() => setManualKeyDraft({ visible: false, apiKey: '', externalKeyId: '' })} sx={{ minHeight: 32 }}>取消</Button>
                    </Stack>
                  ) : null}
                  <Stack spacing={1.25}>
                    {aiKey ? [aiKey].map((key) => {
                      const keyId = String(key.id || '');
                      const draft = getKeyDraft(key);
                      const usage = keyUsage[keyId];
                      const keyChanged = draft.apiKey.trim() !== String(key.api_key || '') || draft.externalKeyId.trim() !== String(key.external_key_id || '');
                      return (
                        <Paper key={keyId} variant="outlined" sx={{ p: 1, borderRadius: 1.5 }}>
                          <Stack spacing={1}>
                            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', pb: 0.25 }}>
                              <TextField
                                size="small"
                                label={`${String(key.provider_code || 'api2d').toUpperCase()} Key`}
                                value={draft.apiKey}
                                placeholder={String(key.key_mask || '')}
                                onChange={(event) => updateKeyDraft(key, { apiKey: event.target.value })}
                                sx={{ flex: '1 1 auto', minWidth: 260 }}
                              />
                              <TextField
                                size="small"
                                label="外部 ID"
                                value={draft.externalKeyId}
                                onChange={(event) => updateKeyDraft(key, { externalKeyId: event.target.value })}
                                sx={{ flex: '0 0 160px' }}
                              />
                              {keyChanged && draft.apiKey.trim() ? (
                                <Button size="small" variant="contained" disabled={actionLoading} onClick={() => void saveKeySecret(key)} sx={{ minHeight: 32, flexShrink: 0 }}>保存</Button>
                              ) : null}
                            </Stack>
                            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75, alignItems: 'center' }}>
                              <Chip
                                size="small"
                                label={keyBalanceLoading ? '余额查询中' : `余额：${formatAiBalanceAmount(keyBalance, String(key.provider_code || 'api2d'))}`}
                                variant="outlined"
                                sx={{ height: 28 }}
                              />
                              <TextField
                                size="small"
                                label="转入额度"
                                value={draft.transferAmount}
                                onChange={(event) => updateKeyDraft(key, { transferAmount: event.target.value })}
                                placeholder="负数扣除"
                                sx={{ width: 120 }}
                              />
                              <Button size="small" variant="outlined" disabled={actionLoading} onClick={() => void transferKeyPoints(key)} sx={{ minHeight: 30 }}>转入/扣除</Button>
                              <Button size="small" variant="outlined" onClick={() => setExpandedLimits((prev) => ({ ...prev, [keyId]: !prev[keyId] }))} sx={{ minHeight: 30 }}>更新 Key</Button>
                              <Button size="small" variant="outlined" disabled={actionLoading} onClick={() => void loadKeyUsage(key)} sx={{ minHeight: 30 }}>
                                {expandedUsage[keyId] ? '收起消耗' : '查询消耗'}
                              </Button>
                              <Box sx={{ flex: '1 1 auto' }} />
                              <Button size="small" variant="outlined" disabled={actionLoading} onClick={() => void toggleKeyStatus(key)} sx={{ minHeight: 30 }}>
                                {String(key.status || '') === 'active' ? '禁用' : '启用'}
                              </Button>
                            </Stack>
                            {expandedLimits[keyId] ? (
                              <Stack spacing={1}>
                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                                  <TextField size="small" label="备注" value={draft.note} onChange={(event) => updateKeyDraft(key, { note: event.target.value })} />
                                  <TextField size="small" label="每日额度" value={draft.dailyQuota} onChange={(event) => updateKeyDraft(key, { dailyQuota: event.target.value })} />
                                  <TextField size="small" label="每月额度" value={draft.monthlyQuota} onChange={(event) => updateKeyDraft(key, { monthlyQuota: event.target.value })} />
                                  <TextField size="small" label="每分钟次数" value={draft.minuteTimes} onChange={(event) => updateKeyDraft(key, { minuteTimes: event.target.value })} />
                                  <TextField size="small" label="请求上限" value={draft.requestLimit} onChange={(event) => updateKeyDraft(key, { requestLimit: event.target.value })} />
                                </Stack>
                                <Button size="small" variant="contained" disabled={actionLoading} onClick={() => void updateKeyLimits(key)} sx={{ alignSelf: 'flex-start' }}>保存上限</Button>
                              </Stack>
                            ) : null}
                            {expandedUsage[keyId] ? (
                              <Stack spacing={1}>
                                <Typography variant="subtitle2">额度流水</Typography>
                                {!usage?.quotaLedger?.length ? <Alert severity="info">暂无额度流水</Alert> : null}
                                {usage?.quotaLedger?.length ? (
                                  <AdminResponsiveTable minWidth={640}>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>类型</TableCell>
                                          <TableCell>来源</TableCell>
                                          <TableCell>额度</TableCell>
                                          <TableCell>状态</TableCell>
                                          <TableCell>时间</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {usage.quotaLedger.map((row) => (
                                          <TableRow key={String(row.id)}>
                                            <TableCell>{String(row.entry_type || '-')}</TableCell>
                                            <TableCell>{String(row.source_type || '-')}</TableCell>
                                            <TableCell>{String(row.amount ?? '-')}</TableCell>
                                            <TableCell>{String(row.status || '-')}</TableCell>
                                            <TableCell>{formatTime(row.created_at)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </AdminResponsiveTable>
                                ) : null}
                                <Typography variant="subtitle2">调用消耗</Typography>
                                {!usage?.invocations?.length ? <Alert severity="info">暂无调用记录</Alert> : null}
                                {usage?.invocations?.length ? (
                                  <AdminResponsiveTable minWidth={760}>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>模型</TableCell>
                                          <TableCell>状态</TableCell>
                                          <TableCell>输入</TableCell>
                                          <TableCell>输出</TableCell>
                                          <TableCell>总量</TableCell>
                                          <TableCell>耗时</TableCell>
                                          <TableCell>时间</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {usage.invocations.map((row) => (
                                          <TableRow key={String(row.id)}>
                                            <TableCell>{String(row.model || '-')}</TableCell>
                                            <TableCell>{String(row.status || '-')}</TableCell>
                                            <TableCell>{String(row.input_tokens ?? '-')}</TableCell>
                                            <TableCell>{String(row.output_tokens ?? '-')}</TableCell>
                                            <TableCell>{String(row.total_tokens ?? '-')}</TableCell>
                                            <TableCell>{String(row.latency_ms ?? '-')}</TableCell>
                                            <TableCell>{formatTime(row.created_at)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </AdminResponsiveTable>
                                ) : null}
                              </Stack>
                            ) : null}
                          </Stack>
                        </Paper>
                      );
                    }) : null}
                  </Stack>
                </AdminDetailCard>

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
