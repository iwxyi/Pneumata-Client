import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Dialog, DialogContent, DialogTitle, Stack, Tab, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Tabs, Typography } from '@mui/material';
import { storageKey } from '../../constants/brand';
import { api, type AiUsageRecordsResponse, type AiUsageSummaryResponse, type AiUsageRecordItem, type AiUsageSummaryItem } from '../../services/api';
import { formatAiAmount } from '../../utils/aiPoints';

type UsageTab = 'records' | 'daily' | 'monthly';

type LoadState<T> = {
  loading: boolean;
  error: string;
  data: T | null;
};

const PAGE_SIZE = 20;
const TAB_STORAGE_KEY = storageKey('account-ai-usage-tab');

function readInitialTab(): UsageTab {
  try {
    const value = localStorage.getItem(TAB_STORAGE_KEY);
    return value === 'daily' || value === 'monthly' || value === 'records' ? value : 'records';
  } catch {
    return 'records';
  }
}

function formatTime(value: unknown) {
  const parsed = Number(value || 0);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function formatTokenCount(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return '-';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(parsed);
}

function recordTitle(item: AiUsageRecordItem) {
  if (item.usageLabel && item.usageLabel !== '未分类') return item.usageLabel;
  if (item.sourceType === 'ai_invocation') return 'AI调用';
  return item.sourceType || '扣除';
}

function emptyState(loading: boolean, hasItems: boolean, label: string, colSpan: number) {
  if (loading || hasItems) return null;
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <Alert severity="info">{label}</Alert>
      </TableCell>
    </TableRow>
  );
}

function RecordsTable({ data, loading }: { data: AiUsageRecordsResponse | null; loading: boolean }) {
  const items = data?.items || [];
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            <TableCell>来源 / 用途</TableCell>
            <TableCell>模型</TableCell>
            <TableCell align="right">消耗</TableCell>
            <TableCell align="right">余额</TableCell>
            <TableCell>时间</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {emptyState(loading, items.length > 0, '暂无消耗记录', 5)}
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{recordTitle(item)}</Typography>
              </TableCell>
              <TableCell>{item.model || '-'}</TableCell>
              <TableCell align="right">
                <Typography variant="body2" color="error.main" sx={{ fontWeight: 800 }}>
                  -{formatAiAmount(item.amount, 'deepseek')}
                </Typography>
              </TableCell>
              <TableCell align="right">{item.balanceAfter == null ? '-' : formatAiAmount(item.balanceAfter, 'deepseek')}</TableCell>
              <TableCell>{formatTime(item.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function SummaryTable({ data, loading, groupLabel }: { data: AiUsageSummaryResponse | null; loading: boolean; groupLabel: string }) {
  const items = data?.items || [];
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 640 }}>
        <TableHead>
          <TableRow>
            <TableCell>{groupLabel}</TableCell>
            <TableCell align="right">调用次数</TableCell>
            <TableCell align="right">消耗</TableCell>
            <TableCell align="right">Tokens</TableCell>
            <TableCell>最近使用</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {emptyState(loading, items.length > 0, '暂无统计记录', 5)}
          {items.map((item: AiUsageSummaryItem) => (
            <TableRow key={item.groupKey}>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.groupKey || '-'}</Typography>
              </TableCell>
              <TableCell align="right">{item.requestCount}</TableCell>
              <TableCell align="right">
                <Typography variant="body2" color="error.main" sx={{ fontWeight: 800 }}>
                  {formatAiAmount(item.chargedAmount, 'deepseek')}
                </Typography>
              </TableCell>
              <TableCell align="right">{formatTokenCount(item.totalTokens)}</TableCell>
              <TableCell>{formatTime(item.lastUsedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

export default function AiUsageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<UsageTab>(readInitialTab);
  const [recordsPage, setRecordsPage] = useState(0);
  const [dailyPage, setDailyPage] = useState(0);
  const [monthlyPage, setMonthlyPage] = useState(0);
  const [records, setRecords] = useState<LoadState<AiUsageRecordsResponse>>({ loading: false, error: '', data: null });
  const [daily, setDaily] = useState<LoadState<AiUsageSummaryResponse>>({ loading: false, error: '', data: null });
  const [monthly, setMonthly] = useState<LoadState<AiUsageSummaryResponse>>({ loading: false, error: '', data: null });

  const handleTabChange = (_event: unknown, value: UsageTab) => {
    setTab(value);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, value);
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  };

  useEffect(() => {
    if (!open || tab !== 'records') return;
    let cancelled = false;
    setRecords((state) => ({ ...state, loading: true, error: '' }));
    api.getAiUsageRecords({ page: recordsPage + 1, limit: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setRecords({ loading: false, error: '', data });
      })
      .catch((error) => {
        if (!cancelled) setRecords((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : '加载失败' }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, recordsPage]);

  useEffect(() => {
    if (!open || tab !== 'daily') return;
    let cancelled = false;
    setDaily((state) => ({ ...state, loading: true, error: '' }));
    api.getAiUsageSummary({ groupBy: 'day', page: dailyPage + 1, limit: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setDaily({ loading: false, error: '', data });
      })
      .catch((error) => {
        if (!cancelled) setDaily((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : '加载失败' }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, dailyPage]);

  useEffect(() => {
    if (!open || tab !== 'monthly') return;
    let cancelled = false;
    setMonthly((state) => ({ ...state, loading: true, error: '' }));
    api.getAiUsageSummary({ groupBy: 'month', page: monthlyPage + 1, limit: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setMonthly({ loading: false, error: '', data });
      })
      .catch((error) => {
        if (!cancelled) setMonthly((state) => ({ ...state, loading: false, error: error instanceof Error ? error.message : '加载失败' }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, monthlyPage]);

  const activeState = tab === 'records' ? records : tab === 'daily' ? daily : monthly;
  const activePage = tab === 'records' ? recordsPage : tab === 'daily' ? dailyPage : monthlyPage;
  const activeTotal = activeState.data?.total || 0;
  const setActivePage = tab === 'records' ? setRecordsPage : tab === 'daily' ? setDailyPage : setMonthlyPage;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>AI点数消耗</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Tabs value={tab} onChange={handleTabChange} variant="scrollable" allowScrollButtonsMobile>
            <Tab value="records" label="记录" />
            <Tab value="daily" label="按日" />
            <Tab value="monthly" label="按月" />
          </Tabs>
          {activeState.error ? <Alert severity="error">{activeState.error}</Alert> : null}
          {activeState.loading ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <CircularProgress size={18} />
              <Typography variant="body2">正在加载</Typography>
            </Stack>
          ) : null}
          {tab === 'records' ? <RecordsTable data={records.data} loading={records.loading} /> : null}
          {tab === 'daily' ? <SummaryTable data={daily.data} loading={daily.loading} groupLabel="日期" /> : null}
          {tab === 'monthly' ? <SummaryTable data={monthly.data} loading={monthly.loading} groupLabel="月份" /> : null}
          <TablePagination
            component="div"
            count={activeTotal}
            page={activePage}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
            onPageChange={(_event, page) => setActivePage(page)}
            labelRowsPerPage="每页"
          />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
