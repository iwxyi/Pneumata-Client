import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Tabs, TextField, Typography } from '@mui/material';
import AdminInlineGroup from './AdminInlineGroup';
import AdminResponsiveTable from './AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from './AdminRequestState';
import { adminApi } from '../../services/adminApi';
import { formatAiAmount } from '../../utils/aiPoints';

const USER_USAGE_PAGE_SIZE = 100;
const USAGE_STATS_PAGE_SIZE = 100;
const USER_STATS_GROUP_STORAGE_KEY_PREFIX = 'pneumata.admin.aiUserUsageDialog.groupBy';
const USER_USAGE_TAB_STORAGE_KEY_PREFIX = 'pneumata.admin.aiUserUsageDialog.tab';
const USER_STATS_GROUP_BY_VALUES = ['usage_type', 'model', 'day'] as const;

type UserStatsGroupBy = typeof USER_STATS_GROUP_BY_VALUES[number];

type UsagePageInfo = {
  page?: unknown;
  limit?: unknown;
  total?: unknown;
};

type UserUsage = {
  invocations: Array<Record<string, unknown>>;
  quotaLedger: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  invocationsPage?: UsagePageInfo;
  quotaLedgerPage?: UsagePageInfo;
};

type UsageStatsResult = {
  groupBy?: string;
  items: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  total?: unknown;
  page?: unknown;
  limit?: unknown;
};

type AdminAiUserUsageDialogProps = {
  open: boolean;
  user: Record<string, unknown> | null;
  providerCode?: string;
  onClose: () => void;
  onTransferPoints?: (userId: string, amount: number) => Promise<Record<string, unknown>>;
  onChanged?: () => void | Promise<void>;
};

const AI_USAGE_TYPE_LABELS: Record<string, string> = {
  direct_chat: '单聊回复',
  group_chat: '群聊回复',
  story_chat: '故事回复',
  group_creation: '生成群聊',
  character_generation: '生成角色',
  character_visual_identity: '角色视觉锚点',
  relationship_analysis: '关系分析',
  memory_distillation: '记忆蒸馏',
  memory_refinement: '记忆润色',
  character_core_profile: '角色核心画像',
  user_profile_memory: '用户画像记忆',
  companionship_assessment: '陪伴评估',
  companionship_care: '陪伴关怀',
  companionship_phase: '陪伴阶段',
  companionship_ritual: '陪伴仪式',
  world_decision: '世界决策',
  message_analysis: '消息分析',
  interaction_analysis: '互动判断',
  social_event_analysis: '社交事件分析',
  chat_draft: '群聊草稿',
  character_artifact: '角色产物',
  moment_generation: '朋友圈生成',
  model_test: '测试连接',
  other: '其他',
  unknown: '未分类',
};

const LEDGER_SOURCE_TYPE_LABELS: Record<string, string> = {
  default_grant: '自动分配',
  purchase_order: '订单购买',
  admin_transfer: '后台增减',
  manual_adjustment: '手动调整',
  ai_invocation: 'AI 调用',
};

function isUserStatsGroupBy(value: unknown): value is UserStatsGroupBy {
  return USER_STATS_GROUP_BY_VALUES.includes(value as UserStatsGroupBy);
}

function storageScope(providerCode: string) {
  return providerCode || 'all';
}

function readStoredTab(providerCode: string) {
  if (typeof window === 'undefined') return 0;
  const value = Number(window.localStorage.getItem(`${USER_USAGE_TAB_STORAGE_KEY_PREFIX}.${storageScope(providerCode)}`));
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : 0;
}

function writeStoredTab(providerCode: string, tab: number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${USER_USAGE_TAB_STORAGE_KEY_PREFIX}.${storageScope(providerCode)}`, String(tab));
}

function readStoredUserStatsGroupBy(providerCode: string): UserStatsGroupBy {
  if (typeof window === 'undefined') return 'usage_type';
  const value = window.localStorage.getItem(`${USER_STATS_GROUP_STORAGE_KEY_PREFIX}.${storageScope(providerCode)}`);
  return isUserStatsGroupBy(value) ? value : 'usage_type';
}

function writeStoredUserStatsGroupBy(providerCode: string, groupBy: UserStatsGroupBy) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${USER_STATS_GROUP_STORAGE_KEY_PREFIX}.${storageScope(providerCode)}`, groupBy);
}

function toPageTotal(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toZeroBasedPage(value: unknown, fallback: number) {
  const parsed = Number(value || 1);
  return Number.isFinite(parsed) ? Math.max(parsed - 1, 0) : fallback;
}

function formatTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function formatCount(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : '0';
}

function formatUsageType(value: unknown) {
  const key = String(value || 'unknown');
  return AI_USAGE_TYPE_LABELS[key] || key;
}

function formatBillingSource(value: unknown) {
  const source = String(value || '').trim();
  if (!source) return '-';
  if (source === 'provider_reported') return '服务商返回';
  if (source === 'estimated') return '本地估算';
  return source;
}

function formatProviderLabel(providerCode: string) {
  if (providerCode === 'all') return '全部平台';
  if (providerCode === 'deepseek') return 'DeepSeek';
  if (providerCode === 'moacode') return 'Moacode';
  if (providerCode === 'api2d') return 'API2D';
  return providerCode.toUpperCase();
}

function formatPoint(value: unknown, providerCode: string) {
  const displayProvider = providerCode === 'api2d' ? 'api2d' : 'deepseek';
  return formatAiAmount(value, displayProvider);
}

function getLedgerAmountSx(value: unknown) {
  const amount = Number(value || 0);
  if (amount > 0) return { color: '#1b5e20', fontWeight: 800 };
  if (amount < 0) return { color: 'error.main', fontWeight: 800 };
  return { fontWeight: 800 };
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

function formatLedgerSourceType(value: unknown) {
  const key = String(value || '');
  return LEDGER_SOURCE_TYPE_LABELS[key] || key || '-';
}

function getLedgerSourcePresentation(row: Record<string, unknown>) {
  const amount = Number(row.amount || 0);
  const sourceType = String(row.source_type || '');
  const metadata = parseMetadata(row.metadata);
  if (sourceType === 'ai_invocation') {
    const usage = formatUsageType(metadata.usageType || metadata.usage_type || row.entry_type);
    const model = String(metadata.model || '').trim();
    return {
      label: usage || '调用消耗',
      secondary: model,
      sx: { fontWeight: 800 },
    };
  }
  const label = formatLedgerSourceType(sourceType);
  return {
    label,
    secondary: String(row.provider_code || '').trim(),
    sx: amount > 0 ? { color: '#1b5e20', fontWeight: 800 } : { fontWeight: 800 },
  };
}

export default function AdminAiUserUsageDialog({
  open,
  user,
  providerCode = 'all',
  onClose,
  onTransferPoints,
  onChanged,
}: AdminAiUserUsageDialogProps) {
  const userId = String(user?.id || '');
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [stats, setStats] = useState<UsageStatsResult | null>(null);
  const [tab, setTab] = useState(() => readStoredTab(providerCode));
  const [invocationPage, setInvocationPage] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [statsGroupBy, setStatsGroupBy] = useState<UserStatsGroupBy>(() => readStoredUserStatsGroupBy(providerCode));
  const [statsPage, setStatsPage] = useState(0);
  const [pointDraft, setPointDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => `${formatProviderLabel(providerCode)}额度详情`, [providerCode]);

  const loadUsage = async (nextInvocationPage = invocationPage, nextLedgerPage = ledgerPage) => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = providerCode === 'all'
        ? await adminApi.getAiUserUsage(userId, {
          invocationPage: nextInvocationPage + 1,
          invocationLimit: USER_USAGE_PAGE_SIZE,
          ledgerPage: nextLedgerPage + 1,
          ledgerLimit: USER_USAGE_PAGE_SIZE,
        })
        : await adminApi.getAiProviderUserUsage(providerCode, userId, {
          invocationPage: nextInvocationPage + 1,
          invocationLimit: USER_USAGE_PAGE_SIZE,
          ledgerPage: nextLedgerPage + 1,
          ledgerLimit: USER_USAGE_PAGE_SIZE,
        });
      setUsage({
        invocations: result.invocations || [],
        quotaLedger: result.quotaLedger || [],
        totals: result.totals,
        invocationsPage: result.invocationsPage,
        quotaLedgerPage: result.quotaLedgerPage,
      });
      setInvocationPage(toZeroBasedPage(result.invocationsPage?.page, nextInvocationPage));
      setLedgerPage(toZeroBasedPage(result.quotaLedgerPage?.page, nextLedgerPage));
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (nextPage = statsPage, nextGroupBy = statsGroupBy) => {
    if (!userId) return;
    setStatsLoading(true);
    setError(null);
    try {
      const result = providerCode === 'all'
        ? await adminApi.getAiUserUsageStats(userId, {
          groupBy: nextGroupBy,
          status: 'success',
          page: nextPage + 1,
          limit: USAGE_STATS_PAGE_SIZE,
        })
        : await adminApi.getAiProviderUsageStats(providerCode, {
          userId,
          groupBy: nextGroupBy,
          status: 'success',
          page: nextPage + 1,
          limit: USAGE_STATS_PAGE_SIZE,
        });
      setStats(result);
      setStatsPage(Math.max(Number(result.page || 1) - 1, 0));
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setStatsLoading(false);
    }
  };

  const transferPoints = async () => {
    if (!userId || !onTransferPoints) return;
    const amount = Number(pointDraft);
    if (!Number.isFinite(amount) || amount === 0) {
      setError('请输入非 0 的额度，负数表示扣除');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onTransferPoints(userId, amount);
      setPointDraft('');
      setLedgerPage(0);
      await Promise.all([
        loadUsage(invocationPage, 0),
        onChanged?.(),
      ]);
    } catch (transferError) {
      setError(getAdminErrorMessage(transferError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !userId) return;
    const nextTab = readStoredTab(providerCode);
    const nextGroupBy = readStoredUserStatsGroupBy(providerCode);
    setTab(nextTab);
    setStatsGroupBy(nextGroupBy);
    setUsage(null);
    setStats(null);
    setInvocationPage(0);
    setLedgerPage(0);
    setStatsPage(0);
    setPointDraft('');
    void loadUsage(0, 0);
    if (nextTab === 2) void loadStats(0, nextGroupBy);
  }, [open, userId, providerCode]);

  useEffect(() => {
    if (!open || !userId || tab !== 2 || stats) return;
    void loadStats(0, statsGroupBy);
  }, [open, userId, tab, stats, statsGroupBy]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {user ? (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
              <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{String(user.nickname || user.id || '-')}</Typography>
                <Typography variant="body2" color="text.secondary">{String(user.phone || '-')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: { xs: 1.5, sm: 3 }, ml: 'auto', flex: '0 0 auto' }}>
                <Box sx={{ textAlign: 'right', minWidth: 92 }}>
                  <Typography variant="caption" color="text.secondary">剩余额度</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{formatPoint(user.balanceAmount ?? user.balance_amount ?? user.aiBalanceAmount, providerCode)}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right', minWidth: 92 }}>
                  <Typography variant="caption" color="text.secondary">已使用额度</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{formatPoint(user.usedAmount ?? user.used_amount ?? user.aiUsedAmount, providerCode)}</Typography>
                </Box>
              </Box>
            </Stack>
          ) : null}

          <AdminInlineGroup>
            {onTransferPoints ? (
              <>
                <TextField size="small" label="增减额度" value={pointDraft} onChange={(event) => setPointDraft(event.target.value)} placeholder="负数扣除" sx={{ flex: '0 1 180px', minWidth: 140 }} />
                <Button variant="contained" disabled={loading || !pointDraft.trim()} onClick={() => void transferPoints()} sx={{ height: 40 }}>增减额度</Button>
              </>
            ) : null}
            <Button variant="outlined" disabled={loading || !userId} onClick={() => void loadUsage()} sx={{ height: 40 }}>刷新明细</Button>
          </AdminInlineGroup>
          <AdminRequestState loading={loading || statsLoading} error={error} />
          <Tabs
            value={tab}
            onChange={(_event, value) => {
              setTab(value);
              writeStoredTab(providerCode, value);
            }}
          >
            <Tab label="额度流水" />
            <Tab label="调用消耗" />
            <Tab label="用量统计" />
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1}>
              {!usage?.quotaLedger.length && !loading ? <Alert severity="info">暂无额度流水</Alert> : null}
              {usage?.quotaLedger.length ? (
                <AdminResponsiveTable minWidth={720}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>来源</TableCell>
                        {providerCode === 'all' ? <TableCell>平台</TableCell> : null}
                        <TableCell>额度</TableCell>
                        <TableCell>余额</TableCell>
                        <TableCell>时间</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {usage.quotaLedger.map((row) => {
                        const source = getLedgerSourcePresentation(row);
                        return (
                          <TableRow key={String(row.id)}>
                            <TableCell>
                              <Typography variant="body2" sx={source.sx}>{source.label}</Typography>
                              {source.secondary ? <Typography variant="caption" color="text.secondary">{source.secondary}</Typography> : null}
                            </TableCell>
                            {providerCode === 'all' ? <TableCell>{String(row.provider_code || '-')}</TableCell> : null}
                            <TableCell><Typography variant="body2" sx={getLedgerAmountSx(row.amount)}>{formatPoint(row.amount, providerCode)}</Typography></TableCell>
                            <TableCell>{row.balance_after == null ? '-' : formatPoint(row.balance_after, providerCode)}</TableCell>
                            <TableCell>{formatTime(row.created_at)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </AdminResponsiveTable>
              ) : null}
              <TablePagination
                component="div"
                count={toPageTotal(usage?.quotaLedgerPage?.total)}
                page={ledgerPage}
                rowsPerPage={USER_USAGE_PAGE_SIZE}
                rowsPerPageOptions={[USER_USAGE_PAGE_SIZE]}
                labelRowsPerPage="每页"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
                onPageChange={(_event, nextPage) => void loadUsage(invocationPage, nextPage)}
                onRowsPerPageChange={undefined}
              />
            </Stack>
          ) : tab === 1 ? (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                合计：{formatPoint(usage?.totals?.charged_amount, providerCode)} / {String(usage?.totals?.request_count ?? 0)} 次
              </Typography>
              {!usage?.invocations.length && !loading ? <Alert severity="info">暂无调用记录</Alert> : null}
              {usage?.invocations.length ? (
                <AdminResponsiveTable minWidth={1080}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>用途</TableCell>
                        {providerCode === 'all' ? <TableCell>平台</TableCell> : null}
                        <TableCell>模型</TableCell>
                        <TableCell>输入</TableCell>
                        <TableCell>输出</TableCell>
                        <TableCell>缓存命中</TableCell>
                        <TableCell>缓存写入</TableCell>
                        <TableCell>总量</TableCell>
                        <TableCell>扣费</TableCell>
                        <TableCell>计费来源</TableCell>
                        <TableCell>耗时</TableCell>
                        <TableCell>时间</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {usage.invocations.map((row) => (
                        <TableRow key={String(row.id)}>
                          <TableCell>{String(row.usage_label || formatUsageType(row.usage_type) || '-')}</TableCell>
                          {providerCode === 'all' ? <TableCell>{String(row.provider_code || '-')}</TableCell> : null}
                          <TableCell>{String(row.model || '-')}</TableCell>
                          <TableCell>{String(row.input_tokens ?? '-')}</TableCell>
                          <TableCell>{String(row.output_tokens ?? '-')}</TableCell>
                          <TableCell>{String(row.prompt_cache_hit_tokens ?? '-')}</TableCell>
                          <TableCell>{String(row.prompt_cache_miss_tokens ?? '-')}</TableCell>
                          <TableCell>{String(row.total_tokens ?? '-')}</TableCell>
                          <TableCell>{row.charged_amount == null ? '-' : formatPoint(row.charged_amount, providerCode)}</TableCell>
                          <TableCell>{formatBillingSource(row.billing_source)}</TableCell>
                          <TableCell>{String(row.latency_ms ?? '-')}</TableCell>
                          <TableCell>{formatTime(row.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AdminResponsiveTable>
              ) : null}
              <TablePagination
                component="div"
                count={toPageTotal(usage?.invocationsPage?.total)}
                page={invocationPage}
                rowsPerPage={USER_USAGE_PAGE_SIZE}
                rowsPerPageOptions={[USER_USAGE_PAGE_SIZE]}
                labelRowsPerPage="每页"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
                onPageChange={(_event, nextPage) => void loadUsage(nextPage, ledgerPage)}
                onRowsPerPageChange={undefined}
              />
            </Stack>
          ) : (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  select
                  size="small"
                  label="分组"
                  value={statsGroupBy}
                  onChange={(event) => {
                    const nextGroupBy = isUserStatsGroupBy(event.target.value) ? event.target.value : 'usage_type';
                    writeStoredUserStatsGroupBy(providerCode, nextGroupBy);
                    setStatsGroupBy(nextGroupBy);
                    setStatsPage(0);
                    void loadStats(0, nextGroupBy);
                  }}
                  sx={{ width: 140 }}
                >
                  <MenuItem value="usage_type">用途</MenuItem>
                  <MenuItem value="model">模型</MenuItem>
                  <MenuItem value="day">日期</MenuItem>
                </TextField>
                <Button variant="outlined" disabled={statsLoading || !userId} onClick={() => void loadStats(statsPage, statsGroupBy)} sx={{ height: 40 }}>刷新统计</Button>
              </Stack>
              {stats ? (
                <Alert severity="info">
                  调用 {formatCount(stats.totals?.requestCount)}，输入 {formatCount(stats.totals?.inputTokens)}，输出 {formatCount(stats.totals?.outputTokens)}，实扣 {formatPoint(stats.totals?.chargedAmount, providerCode)}
                </Alert>
              ) : null}
              {!stats?.items.length && !statsLoading ? <Alert severity="info">暂无用量统计</Alert> : null}
              {stats?.items.length ? (
                <AdminResponsiveTable minWidth={980}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>维度</TableCell>
                        <TableCell>调用数</TableCell>
                        <TableCell>输入</TableCell>
                        <TableCell>输出</TableCell>
                        <TableCell>总量</TableCell>
                        <TableCell>计费</TableCell>
                        <TableCell>扣费</TableCell>
                        <TableCell>最近使用</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stats.items.map((row) => (
                        <TableRow key={String(row.groupKey || row.group_key || row.label || row.model || row.userId || row.user_id || 'usage-row')}>
                          <TableCell>
                            <Stack spacing={0}>
                              <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{String(row.label || row.groupKey || row.group_key || '-')}</Typography>
                              {row.subLabel ? <Typography variant="caption" color="text.secondary">{String(row.subLabel)}</Typography> : null}
                            </Stack>
                          </TableCell>
                          <TableCell>{formatCount(row.requestCount ?? row.request_count)}</TableCell>
                          <TableCell>{formatCount(row.inputTokens ?? row.input_tokens)}</TableCell>
                          <TableCell>{formatCount(row.outputTokens ?? row.output_tokens)}</TableCell>
                          <TableCell>{formatCount(row.totalTokens ?? row.total_tokens)}</TableCell>
                          <TableCell>{formatPoint(row.billableAmount ?? row.billable_amount, providerCode)}</TableCell>
                          <TableCell>{formatPoint(row.chargedAmount ?? row.charged_amount, providerCode)}</TableCell>
                          <TableCell>{formatTime(row.lastUsedAt ?? row.last_used_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AdminResponsiveTable>
              ) : null}
              <TablePagination
                component="div"
                count={toPageTotal(stats?.total)}
                page={statsPage}
                rowsPerPage={USAGE_STATS_PAGE_SIZE}
                rowsPerPageOptions={[USAGE_STATS_PAGE_SIZE]}
                labelRowsPerPage="每页"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
                onPageChange={(_event, nextPage) => void loadStats(nextPage, statsGroupBy)}
                onRowsPerPageChange={undefined}
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
