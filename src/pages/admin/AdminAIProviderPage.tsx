import { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, Tab, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';
import { formatAiAmount, formatAiBalanceAmount } from '../../utils/aiPoints';

type QuotaPackageForm = {
  code: string;
  name: string;
  points: string;
  price: string;
  dailyQuota: string;
  monthlyQuota: string;
};

type DeepSeekPricingForm = {
  pointValueCny: string;
  billingMultiplier: string;
  prompt: string;
  completion: string;
  cacheHit: string;
  cacheMiss: string;
};

const DEFAULT_DEEPSEEK_PRICING_FORM: DeepSeekPricingForm = {
  pointValueCny: '1',
  billingMultiplier: '2',
  prompt: '1',
  completion: '2',
  cacheHit: '0.1',
  cacheMiss: '1',
};

const USER_USAGE_PAGE_SIZE = 100;
const USAGE_STATS_PAGE_SIZE = 100;

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

type UserUsagePageInfo = {
  page?: unknown;
  limit?: unknown;
  total?: unknown;
};

type SelectedUserUsage = {
  invocations: Array<Record<string, unknown>>;
  quotaLedger: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  invocationsPage?: UserUsagePageInfo;
  quotaLedgerPage?: UserUsagePageInfo;
};

type UsageStatsResult = {
  groupBy?: string;
  items: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  total?: unknown;
  page?: unknown;
  limit?: unknown;
};

const LEDGER_ENTRY_TYPE_LABELS: Record<string, string> = {
  grant: '额度增加',
  adjustment: '额度调整',
  consume: '调用消耗',
};

const LEDGER_SOURCE_TYPE_LABELS: Record<string, string> = {
  default_grant: '自动分配',
  purchase_order: '订单购买',
  admin_transfer: '后台增减',
  manual_adjustment: '手动调整',
  ai_invocation: 'AI 调用',
};

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberText(value: unknown, fallback: string) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}

function toPositiveNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toDeepSeekPricingForm(value: unknown): DeepSeekPricingForm {
  const pricing = getRecord(value);
  const models = getRecord(pricing.models);
  const defaultModel = getRecord(models.default);
  return {
    pointValueCny: numberText(pricing.pointValueCny, DEFAULT_DEEPSEEK_PRICING_FORM.pointValueCny),
    billingMultiplier: numberText(pricing.billingMultiplier, DEFAULT_DEEPSEEK_PRICING_FORM.billingMultiplier),
    prompt: numberText(defaultModel.prompt, DEFAULT_DEEPSEEK_PRICING_FORM.prompt),
    completion: numberText(defaultModel.completion, DEFAULT_DEEPSEEK_PRICING_FORM.completion),
    cacheHit: numberText(defaultModel.cacheHit, DEFAULT_DEEPSEEK_PRICING_FORM.cacheHit),
    cacheMiss: numberText(defaultModel.cacheMiss, DEFAULT_DEEPSEEK_PRICING_FORM.cacheMiss),
  };
}

function buildDeepSeekTokenPricing(form: DeepSeekPricingForm) {
  const modelPricing = {
    prompt: toNonNegativeNumber(form.prompt, Number(DEFAULT_DEEPSEEK_PRICING_FORM.prompt)),
    completion: toNonNegativeNumber(form.completion, Number(DEFAULT_DEEPSEEK_PRICING_FORM.completion)),
    cacheHit: toNonNegativeNumber(form.cacheHit, Number(DEFAULT_DEEPSEEK_PRICING_FORM.cacheHit)),
    cacheMiss: toNonNegativeNumber(form.cacheMiss, Number(DEFAULT_DEEPSEEK_PRICING_FORM.cacheMiss)),
  };
  return {
    unit: 'point',
    costUnit: 'CNY',
    perTokens: 1000000,
    pointValueCny: toPositiveNumber(form.pointValueCny, Number(DEFAULT_DEEPSEEK_PRICING_FORM.pointValueCny)),
    billingMultiplier: toPositiveNumber(form.billingMultiplier, Number(DEFAULT_DEEPSEEK_PRICING_FORM.billingMultiplier)),
    models: {
      default: modelPricing,
      'deepseek-chat': modelPricing,
      'deepseek-reasoner': modelPricing,
    },
  };
}

function toPackageForm(item: Record<string, unknown>): QuotaPackageForm {
  return {
    code: String(item.code || ''),
    name: String(item.name || ''),
    points: item.points == null ? '' : String(item.points),
    price: item.price == null ? '' : String(item.price),
    dailyQuota: item.dailyQuota == null ? '' : String(item.dailyQuota),
    monthlyQuota: item.monthlyQuota == null ? '' : String(item.monthlyQuota),
  };
}

function serializePackages(packages: QuotaPackageForm[]) {
  return packages
    .filter((item) => item.code.trim() || item.name.trim())
    .map((item) => ({
      code: item.code.trim(),
      name: item.name.trim(),
      points: item.points ? Number(item.points) : 0,
      price: item.price ? Number(item.price) : 0,
      dailyQuota: item.dailyQuota ? Number(item.dailyQuota) : null,
      monthlyQuota: item.monthlyQuota ? Number(item.monthlyQuota) : null,
    }));
}

function formatBalance(balance: Record<string, unknown> | null, providerCode: string) {
  const raw = balance?.availableBalance ?? balance?.available_balance;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return '未获取';
  return formatAiBalanceAmount(balance, providerCode);
}

function formatPoint(value: unknown, providerCode: string) {
  return formatAiAmount(value, providerCode);
}

function formatTime(value: unknown) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  return new Date(timestamp).toLocaleString();
}

function toPageTotal(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toZeroBasedPage(value: unknown, fallback: number) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed - 1;
}

function formatUsageType(value: unknown) {
  const key = String(value || 'unknown');
  return AI_USAGE_TYPE_LABELS[key] || key;
}

function parseDateTimeInput(value: string) {
  if (!value.trim()) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function formatCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? String(Math.round(parsed)) : '0';
}

function toAmountNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatLedgerEntryType(value: unknown) {
  const key = String(value || '');
  return LEDGER_ENTRY_TYPE_LABELS[key] || key || '-';
}

function formatLedgerSourceType(value: unknown) {
  const key = String(value || '');
  return LEDGER_SOURCE_TYPE_LABELS[key] || key || '-';
}

function formatLedgerDirection(value: unknown) {
  const amount = toAmountNumber(value);
  if (amount > 0) return '增加';
  if (amount < 0) return '扣除';
  return '无变化';
}

function getLedgerAmountSx(value: unknown) {
  const amount = toAmountNumber(value);
  if (amount > 0) return { color: '#1b5e20', fontWeight: 800 };
  if (amount < 0) return { color: 'error.main', fontWeight: 800 };
  return { color: 'text.secondary', fontWeight: 700 };
}

export default function AdminAIProviderPage() {
  const { providerCode: routeProviderCode } = useParams();
  const providerCode = routeProviderCode || 'api2d';
  const isApi2d = providerCode === 'api2d';
  const isDeepSeek = providerCode === 'deepseek';
  const providerDisplayName = isApi2d ? 'API2D' : providerCode === 'deepseek' ? 'DeepSeek' : providerCode.toUpperCase();
  const [tab, setTab] = useState(0);
  const [providerConfig, setProviderConfig] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    name: '',
    baseUrl: '',
    adminBaseUrl: '',
    status: 'active',
    adminToken: '',
    forwardKey: '',
    autoProvisionEnabled: false,
    defaultKeyTypeId: '',
    defaultGrantAmount: '',
    defaultDailyQuota: '',
    defaultMonthlyQuota: '',
    quotaTransferPath: '',
    quotaTransferMethod: 'POST',
    quotaTransferBodyTemplate: '',
    deepseekPricing: DEFAULT_DEEPSEEK_PRICING_FORM,
  });
  const [loadedSecrets, setLoadedSecrets] = useState({ adminToken: '', forwardKey: '' });
  const [quotaPackages, setQuotaPackages] = useState<QuotaPackageForm[]>([]);
  const [keys, setKeys] = useState<Array<Record<string, unknown>>>([]);
  const [keySearch, setKeySearch] = useState({ typeId: '', keyword: '' });
  const [keyCreate, setKeyCreate] = useState({ typeId: '', note: '', grantAmount: '', dailyQuota: '', monthlyQuota: '' });
  const [keyAction, setKeyAction] = useState({ externalKeyId: '', dailyQuota: '', monthlyQuota: '', minuteTimes: '', note: '', enabled: true });
  const [userBalanceSearch, setUserBalanceSearch] = useState('');
  const [userBalances, setUserBalances] = useState<Array<Record<string, unknown>>>([]);
  const [userBalancePage, setUserBalancePage] = useState(0);
  const [userBalanceRowsPerPage, setUserBalanceRowsPerPage] = useState(20);
  const [userBalanceTotal, setUserBalanceTotal] = useState(0);
  const [selectedBalanceUser, setSelectedBalanceUser] = useState<Record<string, unknown> | null>(null);
  const [selectedUserUsage, setSelectedUserUsage] = useState<SelectedUserUsage | null>(null);
  const [selectedUsageTab, setSelectedUsageTab] = useState(0);
  const [selectedInvocationPage, setSelectedInvocationPage] = useState(0);
  const [selectedLedgerPage, setSelectedLedgerPage] = useState(0);
  const [selectedUserStats, setSelectedUserStats] = useState<UsageStatsResult | null>(null);
  const [selectedUserStatsGroupBy, setSelectedUserStatsGroupBy] = useState('usage_type');
  const [selectedUserStatsPage, setSelectedUserStatsPage] = useState(0);
  const [userPointDraft, setUserPointDraft] = useState('');
  const [usageStats, setUsageStats] = useState<UsageStatsResult | null>(null);
  const [usageStatsFilters, setUsageStatsFilters] = useState({
    groupBy: 'usage_type',
    usageType: '',
    model: '',
    search: '',
    status: '',
    from: '',
    to: '',
  });
  const [usageStatsPage, setUsageStatsPage] = useState(0);
  const [usageStatsRowsPerPage, setUsageStatsRowsPerPage] = useState(USAGE_STATS_PAGE_SIZE);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);
  const [userBalanceLoading, setUserBalanceLoading] = useState(false);
  const [userUsageLoading, setUserUsageLoading] = useState(false);
  const [selectedUserStatsLoading, setSelectedUserStatsLoading] = useState(false);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [accountBalance, setAccountBalance] = useState<Record<string, unknown> | null>(null);
  const [accountBalanceLoading, setAccountBalanceLoading] = useState(false);
  const [accountBalanceError, setAccountBalanceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const usesInternalLedger = isDeepSeek || String(providerConfig?.billingMode || '') === 'internal_ledger';

  const loadAccountBalance = async () => {
    setAccountBalanceLoading(true);
    setAccountBalanceError(null);
    try {
      const balance = await adminApi.getAiProviderAccountBalance(providerCode);
      setAccountBalance(balance);
    } catch (loadError) {
      setAccountBalance(null);
      setAccountBalanceError(getAdminErrorMessage(loadError));
    } finally {
      setAccountBalanceLoading(false);
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const config = await adminApi.getAiProviderConfig(providerCode);
      const adminToken = typeof config.adminToken === 'string' ? config.adminToken : '';
      const forwardKey = typeof config.forwardKey === 'string' ? config.forwardKey : '';
      setProviderConfig(config);
      setLoadedSecrets({ adminToken, forwardKey });
      setForm({
        name: String(config.name || ''),
        baseUrl: String(config.baseUrl || ''),
        adminBaseUrl: String(config.adminBaseUrl || ''),
        status: String(config.status || 'active'),
        adminToken,
        forwardKey,
        autoProvisionEnabled: Boolean(config.autoProvisionEnabled),
        defaultKeyTypeId: config.defaultKeyTypeId == null ? '' : String(config.defaultKeyTypeId),
        defaultGrantAmount: config.defaultGrantAmount == null ? '' : String(config.defaultGrantAmount),
        defaultDailyQuota: config.defaultDailyQuota == null ? '' : String(config.defaultDailyQuota),
        defaultMonthlyQuota: config.defaultMonthlyQuota == null ? '' : String(config.defaultMonthlyQuota),
        quotaTransferPath: config.quotaTransferPath == null ? '' : String(config.quotaTransferPath),
        quotaTransferMethod: String(config.quotaTransferMethod || 'POST'),
        quotaTransferBodyTemplate: config.quotaTransferBodyTemplate == null
          ? ''
          : JSON.stringify(config.quotaTransferBodyTemplate, null, 2),
        deepseekPricing: toDeepSeekPricingForm(config.tokenPricing),
      });
      setQuotaPackages(Array.isArray(config.quotaPackages) ? (config.quotaPackages as Array<Record<string, unknown>>).map(toPackageForm) : []);
      if (config.forwardKeyConfigured || (!isApi2d && config.adminTokenConfigured)) void loadAccountBalance();
      else {
        setAccountBalance(null);
        setAccountBalanceError(null);
      }
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
    setKeys([]);
    setUserBalances([]);
    setUserBalancePage(0);
    setUserBalanceTotal(0);
    setSelectedBalanceUser(null);
    setSelectedUserUsage(null);
    setSelectedUsageTab(0);
    setSelectedInvocationPage(0);
    setSelectedLedgerPage(0);
    setSelectedUserStats(null);
    setSelectedUserStatsGroupBy('usage_type');
    setSelectedUserStatsPage(0);
    setUsageStats(null);
    setUsageStatsPage(0);
    setUsageStatsRowsPerPage(USAGE_STATS_PAGE_SIZE);
    setUsageStatsError(null);
  }, [providerCode]);

  useEffect(() => {
    if (tab === 1) {
      if (usesInternalLedger) void loadUserBalances();
      else void loadKeys();
    }
    if (tab === 2) void loadUsageStats();
  }, [tab, providerCode, usesInternalLedger]);

  const saveConfig = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        baseUrl: form.baseUrl,
        adminBaseUrl: form.adminBaseUrl,
        status: form.status,
        autoProvisionEnabled: form.autoProvisionEnabled,
        defaultKeyTypeId: form.defaultKeyTypeId || null,
        defaultGrantAmount: form.defaultGrantAmount ? Number(form.defaultGrantAmount) : null,
        defaultDailyQuota: form.defaultDailyQuota ? Number(form.defaultDailyQuota) : null,
        defaultMonthlyQuota: form.defaultMonthlyQuota ? Number(form.defaultMonthlyQuota) : null,
        quotaTransferPath: form.quotaTransferPath.trim() || null,
        quotaTransferMethod: form.quotaTransferMethod || 'POST',
        quotaTransferBodyTemplate: form.quotaTransferBodyTemplate.trim()
          ? JSON.parse(form.quotaTransferBodyTemplate)
          : null,
        quotaPackages: serializePackages(quotaPackages),
      };
      if (isDeepSeek) payload.tokenPricing = buildDeepSeekTokenPricing(form.deepseekPricing);
      const nextAdminToken = form.adminToken.trim();
      const nextForwardKey = form.forwardKey.trim();
      if (nextAdminToken !== loadedSecrets.adminToken) payload.adminToken = nextAdminToken;
      if (nextForwardKey !== loadedSecrets.forwardKey) payload.forwardKey = nextForwardKey;
      const updated = await adminApi.updateAiProviderConfig(providerCode, payload);
      const updatedAdminToken = typeof updated.adminToken === 'string' ? updated.adminToken : nextAdminToken;
      const updatedForwardKey = typeof updated.forwardKey === 'string' ? updated.forwardKey : nextForwardKey;
      setProviderConfig(updated);
      setLoadedSecrets({ adminToken: updatedAdminToken, forwardKey: updatedForwardKey });
      setForm((prev) => ({
        ...prev,
        adminToken: updatedAdminToken,
        forwardKey: updatedForwardKey,
        deepseekPricing: toDeepSeekPricingForm(updated.tokenPricing),
      }));
    } catch (saveError) {
      setError(getAdminErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const loadKeys = async () => {
    setKeyLoading(true);
    setKeyError(null);
    try {
      const result = await adminApi.getAiProviderKeys(providerCode, {
        typeId: keySearch.typeId || undefined,
        keyword: keySearch.keyword || undefined,
      });
      setKeys(result.items);
    } catch (loadError) {
      setKeyError(getAdminErrorMessage(loadError));
    } finally {
      setKeyLoading(false);
    }
  };

  const loadUserBalances = async (page = userBalancePage, rowsPerPage = userBalanceRowsPerPage) => {
    setUserBalanceLoading(true);
    setKeyError(null);
    try {
      const result = await adminApi.getAiProviderUserBalances(providerCode, {
        search: userBalanceSearch.trim() || undefined,
        page: page + 1,
        limit: rowsPerPage,
      });
      setUserBalances(result.items);
      setUserBalancePage(Math.max(Number(result.page || 1) - 1, 0));
      setUserBalanceRowsPerPage(Number(result.limit || rowsPerPage));
      setUserBalanceTotal(Number(result.total || 0));
    } catch (loadError) {
      setKeyError(getAdminErrorMessage(loadError));
    } finally {
      setUserBalanceLoading(false);
    }
  };

  const loadSelectedUserUsage = async (userId: string, invocationPage = selectedInvocationPage, ledgerPage = selectedLedgerPage) => {
    setUserUsageLoading(true);
    setKeyError(null);
    try {
      const result = await adminApi.getAiProviderUserUsage(providerCode, userId, {
        invocationPage: invocationPage + 1,
        invocationLimit: USER_USAGE_PAGE_SIZE,
        ledgerPage: ledgerPage + 1,
        ledgerLimit: USER_USAGE_PAGE_SIZE,
      });
      setSelectedUserUsage({
        invocations: result.invocations,
        quotaLedger: result.quotaLedger,
        totals: result.totals,
        invocationsPage: result.invocationsPage,
        quotaLedgerPage: result.quotaLedgerPage,
      });
      setSelectedInvocationPage(toZeroBasedPage(result.invocationsPage?.page, invocationPage));
      setSelectedLedgerPage(toZeroBasedPage(result.quotaLedgerPage?.page, ledgerPage));
    } catch (loadError) {
      setKeyError(getAdminErrorMessage(loadError));
    } finally {
      setUserUsageLoading(false);
    }
  };

  const loadUsageStats = async (
    page = usageStatsPage,
    rowsPerPage = usageStatsRowsPerPage,
    filters: typeof usageStatsFilters = usageStatsFilters,
  ) => {
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const result = await adminApi.getAiProviderUsageStats(providerCode, {
        groupBy: filters.groupBy,
        usageType: filters.usageType || undefined,
        model: filters.model || undefined,
        search: filters.search.trim() || undefined,
        status: filters.status || undefined,
        from: parseDateTimeInput(filters.from),
        to: parseDateTimeInput(filters.to),
        page: page + 1,
        limit: rowsPerPage,
      });
      setUsageStats(result);
      setUsageStatsPage(Math.max(Number(result.page || 1) - 1, 0));
      setUsageStatsRowsPerPage(Number(result.limit || rowsPerPage));
    } catch (loadError) {
      setUsageStatsError(getAdminErrorMessage(loadError));
    } finally {
      setUsageStatsLoading(false);
    }
  };

  const loadSelectedUserStats = async (
    userId: string,
    page = selectedUserStatsPage,
    groupBy = selectedUserStatsGroupBy,
  ) => {
    if (!userId) return;
    setSelectedUserStatsLoading(true);
    setKeyError(null);
    try {
      const result = await adminApi.getAiProviderUsageStats(providerCode, {
        userId,
        groupBy,
        status: 'success',
        page: page + 1,
        limit: USAGE_STATS_PAGE_SIZE,
      });
      setSelectedUserStats(result);
      setSelectedUserStatsPage(Math.max(Number(result.page || 1) - 1, 0));
    } catch (loadError) {
      setKeyError(getAdminErrorMessage(loadError));
    } finally {
      setSelectedUserStatsLoading(false);
    }
  };

  const openUserUsageDialog = (item: Record<string, unknown>) => {
    const userId = String(item.id || '');
    if (!userId) return;
    setSelectedBalanceUser(item);
    setSelectedUserUsage(null);
    setSelectedUsageTab(0);
    setSelectedInvocationPage(0);
    setSelectedLedgerPage(0);
    setSelectedUserStats(null);
    setSelectedUserStatsGroupBy('usage_type');
    setSelectedUserStatsPage(0);
    setUserPointDraft('');
    void loadSelectedUserUsage(userId, 0, 0);
    void loadSelectedUserStats(userId, 0, 'usage_type');
  };

  const transferUserPoints = async () => {
    const userId = String(selectedBalanceUser?.id || '');
    const amount = Number(userPointDraft);
    if (!userId) return;
    if (!Number.isFinite(amount) || amount === 0) {
      setKeyError('请输入非 0 的额度，负数表示扣除');
      return;
    }
    setUserUsageLoading(true);
    setKeyError(null);
    try {
      const result = await adminApi.transferAiProviderUserPoints(providerCode, userId, { amount });
      setUserPointDraft('');
      const balanceAfter = Number(result.balanceAfter);
      if (Number.isFinite(balanceAfter)) {
        setSelectedBalanceUser((prev) => prev ? { ...prev, balanceAmount: balanceAfter, balance_amount: balanceAfter } : prev);
      }
      setSelectedLedgerPage(0);
      await Promise.all([
        loadUserBalances(userBalancePage, userBalanceRowsPerPage),
        loadSelectedUserUsage(userId, selectedInvocationPage, 0),
      ]);
    } catch (saveError) {
      setKeyError(getAdminErrorMessage(saveError));
    } finally {
      setUserUsageLoading(false);
    }
  };

  const createKey = async () => {
    setKeyLoading(true);
    setKeyError(null);
    try {
      await adminApi.createAiProviderKey(providerCode, {
        typeId: keyCreate.typeId || null,
        note: keyCreate.note || undefined,
        grantAmount: keyCreate.grantAmount ? Number(keyCreate.grantAmount) : null,
        dailyQuota: keyCreate.dailyQuota ? Number(keyCreate.dailyQuota) : null,
        monthlyQuota: keyCreate.monthlyQuota ? Number(keyCreate.monthlyQuota) : null,
      });
      setCreateDialogOpen(false);
      setKeyCreate({ typeId: '', note: '', grantAmount: '', dailyQuota: '', monthlyQuota: '' });
      await loadKeys();
    } catch (createError) {
      console.error('Create AI provider key failed', createError);
      setKeyError(getAdminErrorMessage(createError));
    } finally {
      setKeyLoading(false);
    }
  };

  const updateKey = async () => {
    if (!keyAction.externalKeyId.trim()) {
      setKeyError('请输入 Key ID');
      return;
    }
    setKeyLoading(true);
    setKeyError(null);
    try {
      await adminApi.updateAiProviderKey(providerCode, keyAction.externalKeyId.trim(), {
        enabled: keyAction.enabled,
        note: keyAction.note || undefined,
        dailyQuota: keyAction.dailyQuota ? Number(keyAction.dailyQuota) : null,
        monthlyQuota: keyAction.monthlyQuota ? Number(keyAction.monthlyQuota) : null,
        minuteTimes: keyAction.minuteTimes ? Number(keyAction.minuteTimes) : null,
      });
      setUpdateDialogOpen(false);
      await loadKeys();
    } catch (updateError) {
      setKeyError(getAdminErrorMessage(updateError));
    } finally {
      setKeyLoading(false);
    }
  };

  const addPackage = () => {
    setQuotaPackages((prev) => [...prev, { code: '', name: '', points: '', price: '', dailyQuota: '', monthlyQuota: '' }]);
  };

  const updatePackage = (index: number, field: keyof QuotaPackageForm, value: string) => {
    setQuotaPackages((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  };

  const removePackage = (index: number) => {
    setQuotaPackages((prev) => prev.filter((_item, itemIndex) => itemIndex !== index));
  };

  const updateDeepSeekPricing = (field: keyof DeepSeekPricingForm, value: string) => {
    setForm((prev) => ({
      ...prev,
      deepseekPricing: {
        ...prev.deepseekPricing,
        [field]: value,
      },
    }));
  };

  const openUpdateDialog = (item: Record<string, unknown>) => {
    setKeyAction({
      externalKeyId: String(item.id || ''),
      dailyQuota: item.daily_quota == null ? '' : String(item.daily_quota),
      monthlyQuota: item.monthly_quota == null ? '' : String(item.monthly_quota),
      minuteTimes: item.minute_times == null ? '' : String(item.minute_times),
      note: String(item.note || ''),
      enabled: Number(item.enabled ?? 1) !== 0,
    });
    setUpdateDialogOpen(true);
  };

  return (
    <Stack spacing={2} sx={{ pb: 10 }}>
      <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
        <Tab label="配置" />
        <Tab label={usesInternalLedger ? '用户额度' : 'Key 查询'} />
        <Tab label="用量统计" />
      </Tabs>
      <AdminRequestState
        loading={loading || saving || keyLoading || userBalanceLoading || userUsageLoading || selectedUserStatsLoading || usageStatsLoading}
        error={tab === 0 ? error : tab === 1 ? keyError : usageStatsError}
        onRetry={tab === 0 ? () => void loadConfig() : tab === 1 ? (usesInternalLedger ? () => void loadUserBalances() : () => void loadKeys()) : () => void loadUsageStats()}
      />

      {tab === 0 ? (
        <Stack spacing={1.25}>
          <AdminDetailCard title="主账号配置">
            <Stack spacing={1.25}>
              <Alert severity={providerConfig?.adminTokenConfigured ? 'success' : 'warning'}>
                {providerDisplayName} 主账号 Key：{providerConfig?.adminTokenConfigured ? String(providerConfig.adminToken || '') : '未配置'}
              </Alert>
              {isApi2d ? (
                <Alert severity={providerConfig?.forwardKeyConfigured ? 'success' : 'warning'}>
                  主账号 ForwardKey：{providerConfig?.forwardKeyConfigured ? String(providerConfig.forwardKey || '') : '未配置'}
                </Alert>
              ) : null}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <TextField label="名称" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} fullWidth />
                <TextField select label="状态" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} sx={{ minWidth: 140 }}>
                  <MenuItem value="active">启用</MenuItem>
                  <MenuItem value="inactive">停用</MenuItem>
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <TextField label="AI 调用 Base URL" value={form.baseUrl} onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))} fullWidth />
                {isApi2d ? (
                  <TextField
                    label="管理 API Base URL"
                    value={form.adminBaseUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, adminBaseUrl: e.target.value }))}
                    helperText="API2D 开发者计划 custom_key 管理接口，例如 https://api.api2d.com"
                    fullWidth
                  />
                ) : null}
              </Stack>
                <TextField
                  label={isApi2d ? 'API2D 主账号管理 Token（不是模型调用 Key）' : `${providerDisplayName} 主账号 API Key`}
                  value={form.adminToken}
                  onChange={(e) => setForm((prev) => ({ ...prev, adminToken: e.target.value }))}
                  fullWidth
                />
                {isApi2d ? (
                  <TextField
                    label="API2D 主账号 ForwardKey（用于余额查询）"
                    value={form.forwardKey}
                    onChange={(e) => setForm((prev) => ({ ...prev, forwardKey: e.target.value }))}
                    fullWidth
                  />
                ) : null}
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.25}
                sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">主账号总余额</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                    {accountBalanceLoading ? '查询中' : formatBalance(accountBalance, providerCode)}
                  </Typography>
                  {accountBalanceError ? <Typography variant="caption" color="error">{accountBalanceError}</Typography> : null}
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => void loadAccountBalance()}
                  disabled={!(isApi2d ? providerConfig?.forwardKeyConfigured : providerConfig?.adminTokenConfigured) || accountBalanceLoading}
                >
                  刷新余额
                </Button>
              </Stack>
              </Stack>
          </AdminDetailCard>

          {isDeepSeek ? (
            <AdminDetailCard title="DeepSeek 扣费配置">
              <Stack spacing={1.25}>
                <Alert severity="info">
                  扣费按 DeepSeek 官方元价计算成本，再换算为用户 P。默认 1P=1元，计费倍率 2 表示官方成本价加 1 倍。
                </Alert>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                  <TextField
                    label="1P 等于多少元"
                    value={form.deepseekPricing.pointValueCny}
                    onChange={(e) => updateDeepSeekPricing('pointValueCny', e.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="计费倍率"
                    value={form.deepseekPricing.billingMultiplier}
                    onChange={(e) => updateDeepSeekPricing('billingMultiplier', e.target.value)}
                    helperText="2 表示官方成本价加 1 倍"
                    fullWidth
                  />
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                  <TextField
                    label="输入价格（元/百万 tokens）"
                    value={form.deepseekPricing.prompt}
                    onChange={(e) => updateDeepSeekPricing('prompt', e.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="输出价格（元/百万 tokens）"
                    value={form.deepseekPricing.completion}
                    onChange={(e) => updateDeepSeekPricing('completion', e.target.value)}
                    fullWidth
                  />
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                  <TextField
                    label="缓存命中价格（元/百万 tokens）"
                    value={form.deepseekPricing.cacheHit}
                    onChange={(e) => updateDeepSeekPricing('cacheHit', e.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="缓存未命中价格（元/百万 tokens）"
                    value={form.deepseekPricing.cacheMiss}
                    onChange={(e) => updateDeepSeekPricing('cacheMiss', e.target.value)}
                    fullWidth
                  />
                </Stack>
              </Stack>
            </AdminDetailCard>
          ) : null}

          <AdminDetailCard title={usesInternalLedger ? '新用户自动分配额度' : '新用户自动分配 Key'}>
            <Stack spacing={1.25}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <FormControlLabel control={<Switch checked={form.autoProvisionEnabled} onChange={(e) => setForm((prev) => ({ ...prev, autoProvisionEnabled: e.target.checked }))} />} label={usesInternalLedger ? '新用户自动分配额度' : '新用户自动生成 Key'} />
                {isApi2d ? (
                  <TextField
                    label="默认 Key 分组 ID"
                    value={form.defaultKeyTypeId}
                    onChange={(e) => setForm((prev) => ({ ...prev, defaultKeyTypeId: e.target.value }))}
                    helperText="填写 custom_key_type/search 返回的数字 id，例如 1219，不要带 CK 前缀"
                  />
                ) : null}
                <TextField label="默认点数" value={form.defaultGrantAmount} onChange={(e) => setForm((prev) => ({ ...prev, defaultGrantAmount: e.target.value }))} />
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <TextField label="每日重置额度" value={form.defaultDailyQuota} onChange={(e) => setForm((prev) => ({ ...prev, defaultDailyQuota: e.target.value }))} />
                <TextField label="每月最高额度（0 表示不限制）" value={form.defaultMonthlyQuota} onChange={(e) => setForm((prev) => ({ ...prev, defaultMonthlyQuota: e.target.value }))} />
              </Stack>
              {isApi2d ? (
                <>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                    <TextField
                      label="额度转入路径"
                      value={form.quotaTransferPath}
                      onChange={(e) => setForm((prev) => ({ ...prev, quotaTransferPath: e.target.value }))}
                      helperText="API2D 点数转入接口路径，例如 /custom_key/transfer_point；留空则使用后端默认值"
                      fullWidth
                    />
                    <TextField
                      select
                      label="额度转入方法"
                      value={form.quotaTransferMethod}
                      onChange={(e) => setForm((prev) => ({ ...prev, quotaTransferMethod: e.target.value }))}
                      sx={{ minWidth: 140 }}
                    >
                      <MenuItem value="POST">POST</MenuItem>
                      <MenuItem value="PUT">PUT</MenuItem>
                    </TextField>
                  </Stack>
                  <TextField
                    label="额度转入请求体模板"
                    value={form.quotaTransferBodyTemplate}
                    onChange={(e) => setForm((prev) => ({ ...prev, quotaTransferBodyTemplate: e.target.value }))}
                    helperText='JSON 模板，可使用 {externalKeyId}、{apiKey}、{amount}；API2D 默认 body 为 {"key":"{apiKey}","direction":"to","point":"{amount}"}'
                    minRows={4}
                    multiline
                    fullWidth
                  />
                </>
              ) : null}
            </Stack>
          </AdminDetailCard>

          <AdminDetailCard title="额度套餐">
            <Stack spacing={1.25}>
              {!quotaPackages.length ? <Alert severity="info">暂无套餐，添加后可用于后续支付购买。</Alert> : null}
              {quotaPackages.length ? (
                <AdminResponsiveTable minWidth={900}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>套餐编码</TableCell>
                        <TableCell>套餐名称</TableCell>
                        <TableCell>点数额度</TableCell>
                        <TableCell>价格</TableCell>
                        <TableCell>每日额度</TableCell>
                        <TableCell>每月额度</TableCell>
                        <TableCell align="right">操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {quotaPackages.map((item, index) => (
                        <TableRow key={`${item.code}-${index}`}>
                          <TableCell><TextField size="small" value={item.code} onChange={(e) => updatePackage(index, 'code', e.target.value)} sx={{ minWidth: 120 }} /></TableCell>
                          <TableCell><TextField size="small" value={item.name} onChange={(e) => updatePackage(index, 'name', e.target.value)} sx={{ minWidth: 140 }} /></TableCell>
                          <TableCell><TextField size="small" value={item.points} onChange={(e) => updatePackage(index, 'points', e.target.value)} sx={{ width: 110 }} /></TableCell>
                          <TableCell><TextField size="small" value={item.price} onChange={(e) => updatePackage(index, 'price', e.target.value)} sx={{ width: 100 }} /></TableCell>
                          <TableCell><TextField size="small" value={item.dailyQuota} onChange={(e) => updatePackage(index, 'dailyQuota', e.target.value)} sx={{ width: 110 }} /></TableCell>
                          <TableCell><TextField size="small" value={item.monthlyQuota} onChange={(e) => updatePackage(index, 'monthlyQuota', e.target.value)} sx={{ width: 110 }} /></TableCell>
                          <TableCell align="right">
                            <Button size="small" color="warning" onClick={() => removePackage(index)}>删除</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AdminResponsiveTable>
              ) : null}
              <Button variant="outlined" onClick={addPackage} sx={{ alignSelf: 'flex-start' }}>添加套餐</Button>
            </Stack>
          </AdminDetailCard>
        </Stack>
      ) : tab === 1 ? (
        usesInternalLedger ? (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" label="搜索用户" value={userBalanceSearch} onChange={(e) => setUserBalanceSearch(e.target.value)} sx={{ width: { xs: 180, sm: 260 } }} />
              <Button variant="contained" disabled={userBalanceLoading} onClick={() => void loadUserBalances(0, userBalanceRowsPerPage)} sx={{ minWidth: 88, height: 40 }}>查询</Button>
            </Stack>
            <AdminResponsiveTable minWidth={760}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>用户</TableCell>
                    <TableCell>手机号</TableCell>
                    <TableCell>剩余额度</TableCell>
                    <TableCell>已使用额度</TableCell>
                    <TableCell>请求数</TableCell>
                    <TableCell>最近调用</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!userBalances.length && !userBalanceLoading ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Alert severity="info">暂无用户额度记录</Alert>
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {userBalances.map((item) => (
                    <TableRow key={String(item.id)} hover onClick={() => openUserUsageDialog(item)} sx={{ cursor: 'pointer' }}>
                      <TableCell>{String(item.nickname || item.id || '-')}</TableCell>
                      <TableCell>{String(item.phone || '-')}</TableCell>
                      <TableCell>{formatPoint(item.balanceAmount ?? item.balance_amount, providerCode)}</TableCell>
                      <TableCell>{formatPoint(item.usedAmount ?? item.used_amount, providerCode)}</TableCell>
                      <TableCell>{String(item.requestCount ?? item.request_count ?? 0)}</TableCell>
                      <TableCell>{formatTime(item.last_used_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AdminResponsiveTable>
            <TablePagination
              component="div"
              count={userBalanceTotal}
              page={userBalancePage}
              rowsPerPage={userBalanceRowsPerPage}
              rowsPerPageOptions={[10, 20, 50, 100]}
              labelRowsPerPage="每页"
              labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
              onPageChange={(_event, nextPage) => void loadUserBalances(nextPage, userBalanceRowsPerPage)}
              onRowsPerPageChange={(event) => {
                const nextRowsPerPage = Number(event.target.value);
                void loadUserBalances(0, nextRowsPerPage);
              }}
            />
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" label="分组 ID" value={keySearch.typeId} onChange={(e) => setKeySearch((prev) => ({ ...prev, typeId: e.target.value }))} sx={{ width: { xs: 132, sm: 180 } }} />
              <TextField size="small" label="搜索关键字" value={keySearch.keyword} onChange={(e) => setKeySearch((prev) => ({ ...prev, keyword: e.target.value }))} sx={{ width: { xs: 156, sm: 260 } }} />
              <Button variant="contained" disabled={keyLoading} onClick={() => void loadKeys()} sx={{ minWidth: 88, height: 40 }}>查询</Button>
              <Box sx={{ flex: 1 }} />
              <Button variant="contained" onClick={() => setCreateDialogOpen(true)} sx={{ minWidth: 88, height: 40 }}>创建</Button>
            </Stack>
            <AdminResponsiveTable minWidth={980}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Key</TableCell>
                    <TableCell>分组</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>点数</TableCell>
                    <TableCell>每日</TableCell>
                    <TableCell>每月</TableCell>
                    <TableCell>备注</TableCell>
                    <TableCell>更新时间</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {keys.map((item) => (
                    <TableRow key={String(item.id || item.key)}>
                      <TableCell>{String(item.id || '')}</TableCell>
                      <TableCell>{String(item.key || '')}</TableCell>
                      <TableCell>{String(item.type_id || '')}</TableCell>
                      <TableCell>{String(item.enabled ?? '')}</TableCell>
                      <TableCell>{formatPoint(item.point, providerCode)}</TableCell>
                      <TableCell>{String(item.daily_quota ?? '')}</TableCell>
                      <TableCell>{String(item.monthly_quota ?? '')}</TableCell>
                      <TableCell>{String(item.note || '')}</TableCell>
                      <TableCell>{String(item.updated_at || '')}</TableCell>
                      <TableCell><Button size="small" onClick={() => openUpdateDialog(item)}>修改</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AdminResponsiveTable>
          </Stack>
        )
      ) : (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              select
              size="small"
              label="分组"
              value={usageStatsFilters.groupBy}
              onChange={(e) => setUsageStatsFilters((prev) => ({ ...prev, groupBy: e.target.value }))}
              sx={{ width: 140 }}
            >
              <MenuItem value="usage_type">用途</MenuItem>
              <MenuItem value="model">模型</MenuItem>
              <MenuItem value="user">用户</MenuItem>
              <MenuItem value="day">日期</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="用途类型"
              value={usageStatsFilters.usageType}
              onChange={(e) => setUsageStatsFilters((prev) => ({ ...prev, usageType: e.target.value }))}
              sx={{ width: 180 }}
            >
              <MenuItem value="">全部</MenuItem>
              {Object.entries(AI_USAGE_TYPE_LABELS).filter(([key]) => key !== 'unknown').map(([key, label]) => (
                <MenuItem key={key} value={key}>{label}</MenuItem>
              ))}
            </TextField>
            <TextField size="small" label="模型" value={usageStatsFilters.model} onChange={(e) => setUsageStatsFilters((prev) => ({ ...prev, model: e.target.value }))} sx={{ width: 180 }} />
            <TextField size="small" label="关键字" value={usageStatsFilters.search} onChange={(e) => setUsageStatsFilters((prev) => ({ ...prev, search: e.target.value }))} sx={{ width: { xs: 180, sm: 240 } }} />
            <TextField
              select
              size="small"
              label="状态"
              value={usageStatsFilters.status}
              onChange={(e) => setUsageStatsFilters((prev) => ({ ...prev, status: e.target.value }))}
              sx={{ width: 120 }}
            >
              <MenuItem value="">全部</MenuItem>
              <MenuItem value="failed">失败</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="开始时间"
              type="datetime-local"
              value={usageStatsFilters.from}
              onChange={(e) => setUsageStatsFilters((prev) => ({ ...prev, from: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 220 }}
            />
            <TextField
              size="small"
              label="结束时间"
              type="datetime-local"
              value={usageStatsFilters.to}
              onChange={(e) => setUsageStatsFilters((prev) => ({ ...prev, to: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 220 }}
            />
            <Button variant="contained" disabled={usageStatsLoading} onClick={() => void loadUsageStats(0, usageStatsRowsPerPage)} sx={{ minWidth: 88, height: 40 }}>查询</Button>
            <Button
              variant="outlined"
              disabled={usageStatsLoading}
              onClick={() => {
                const nextFilters = {
                  groupBy: 'usage_type',
                  usageType: '',
                  model: '',
                  search: '',
                  status: '',
                  from: '',
                  to: '',
                };
                setUsageStatsFilters(nextFilters);
                void loadUsageStats(0, usageStatsRowsPerPage, nextFilters);
              }}
              sx={{ minWidth: 88, height: 40 }}
            >
              重置
            </Button>
          </Stack>
          {usageStats ? (
            <Alert severity="info">
              调用 {formatCount(usageStats.totals?.requestCount)}，失败 {formatCount(usageStats.totals?.failedCount)}，输入 {formatCount(usageStats.totals?.inputTokens)}，输出 {formatCount(usageStats.totals?.outputTokens)}，实扣 {formatPoint(usageStats.totals?.chargedAmount, providerCode)}
            </Alert>
          ) : null}
          <AdminResponsiveTable minWidth={1200}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>维度</TableCell>
                  <TableCell>调用数</TableCell>
                  <TableCell>失败</TableCell>
                  <TableCell>输入</TableCell>
                  <TableCell>输出</TableCell>
                  <TableCell>总量</TableCell>
                  <TableCell>计费</TableCell>
                  <TableCell>实扣</TableCell>
                  <TableCell>平均耗时</TableCell>
                  <TableCell>最近调用</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!usageStats?.items.length && !usageStatsLoading ? (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <Alert severity="info">暂无用量统计</Alert>
                    </TableCell>
                  </TableRow>
                ) : null}
                {usageStats?.items.map((row) => (
                  <TableRow key={String(row.groupKey || row.group_key || row.label || row.model || row.userId || row.user_id || 'usage-row')}>
                    <TableCell>
                      <Stack spacing={0}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{String(row.label || row.groupKey || row.group_key || '-')}</Typography>
                        {row.subLabel ? <Typography variant="caption" color="text.secondary">{String(row.subLabel)}</Typography> : null}
                      </Stack>
                    </TableCell>
                    <TableCell>{formatCount(row.requestCount ?? row.request_count)}</TableCell>
                    <TableCell>{formatCount(row.failedCount ?? row.failed_count)}</TableCell>
                    <TableCell>{formatCount(row.inputTokens ?? row.input_tokens)}</TableCell>
                    <TableCell>{formatCount(row.outputTokens ?? row.output_tokens)}</TableCell>
                    <TableCell>{formatCount(row.totalTokens ?? row.total_tokens)}</TableCell>
                    <TableCell>{formatPoint(row.billableAmount ?? row.billable_amount, providerCode)}</TableCell>
                    <TableCell>{formatPoint(row.chargedAmount ?? row.charged_amount, providerCode)}</TableCell>
                    <TableCell>{formatCount(row.averageLatencyMs ?? row.average_latency_ms)} ms</TableCell>
                    <TableCell>{formatTime(row.lastUsedAt ?? row.last_used_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AdminResponsiveTable>
          <TablePagination
            component="div"
            count={toPageTotal(usageStats?.total)}
            page={usageStatsPage}
            rowsPerPage={usageStatsRowsPerPage}
            rowsPerPageOptions={[USAGE_STATS_PAGE_SIZE]}
            labelRowsPerPage="每页"
            labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
            onPageChange={(_event, nextPage) => {
              setUsageStatsPage(nextPage);
              void loadUsageStats(nextPage, usageStatsRowsPerPage);
            }}
            onRowsPerPageChange={undefined}
          />
        </Stack>
      )}

      {tab === 0 ? (
        <Button
          variant="contained"
          disabled={saving}
          onClick={() => void saveConfig()}
          sx={{
            position: 'fixed',
            right: { xs: 16, md: 32 },
            bottom: { xs: 16, md: 32 },
            zIndex: (theme) => theme.zIndex.drawer + 1,
            boxShadow: 6,
          }}
        >
          保存配置
        </Button>
      ) : null}
      <Dialog open={Boolean(selectedBalanceUser)} onClose={() => setSelectedBalanceUser(null)} fullWidth maxWidth="lg">
        <DialogTitle>用户额度详情</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {selectedBalanceUser ? (
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} sx={{ alignItems: { xs: 'stretch', md: 'center' } }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{String(selectedBalanceUser.nickname || selectedBalanceUser.id || '-')}</Typography>
                  <Typography variant="body2" color="text.secondary">{String(selectedBalanceUser.phone || '-')}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">剩余额度</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>{formatPoint(selectedBalanceUser.balanceAmount ?? selectedBalanceUser.balance_amount, providerCode)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">已使用额度</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>{formatPoint(selectedBalanceUser.usedAmount ?? selectedBalanceUser.used_amount, providerCode)}</Typography>
                </Box>
              </Stack>
            ) : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
              <TextField
                size="small"
                label="增减额度"
                value={userPointDraft}
                onChange={(e) => setUserPointDraft(e.target.value)}
                placeholder="负数扣除"
                sx={{ width: { xs: '100%', sm: 180 } }}
              />
              <Button variant="contained" disabled={userUsageLoading || !userPointDraft.trim()} onClick={() => void transferUserPoints()} sx={{ height: 40 }}>增减额度</Button>
              <Button variant="outlined" disabled={userUsageLoading || !selectedBalanceUser?.id} onClick={() => void loadSelectedUserUsage(String(selectedBalanceUser?.id || ''))} sx={{ height: 40 }}>刷新明细</Button>
            </Stack>
            <AdminRequestState loading={userUsageLoading || selectedUserStatsLoading} error={null} />
            <Tabs value={selectedUsageTab} onChange={(_event, value) => setSelectedUsageTab(value)}>
              <Tab label="额度流水" />
              <Tab label="调用消耗" />
              <Tab label="用量统计" />
            </Tabs>
            {selectedUsageTab === 0 ? (
              <Stack spacing={1}>
                {!selectedUserUsage?.quotaLedger.length && !userUsageLoading ? <Alert severity="info">暂无额度流水</Alert> : null}
                {selectedUserUsage?.quotaLedger.length ? (
                  <AdminResponsiveTable minWidth={860}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>方向</TableCell>
                          <TableCell>类型</TableCell>
                          <TableCell>来源</TableCell>
                          <TableCell>额度</TableCell>
                          <TableCell>余额</TableCell>
                          <TableCell>时间</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedUserUsage.quotaLedger.map((row) => (
                          <TableRow key={String(row.id)}>
                            <TableCell>{formatLedgerDirection(row.amount)}</TableCell>
                            <TableCell>{formatLedgerEntryType(row.entry_type)}</TableCell>
                            <TableCell>{formatLedgerSourceType(row.source_type)}</TableCell>
                            <TableCell><Typography variant="body2" sx={getLedgerAmountSx(row.amount)}>{formatPoint(row.amount, providerCode)}</Typography></TableCell>
                            <TableCell>{row.balance_after == null ? '-' : formatPoint(row.balance_after, providerCode)}</TableCell>
                            <TableCell>{formatTime(row.created_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AdminResponsiveTable>
                ) : null}
                <TablePagination
                  component="div"
                  count={toPageTotal(selectedUserUsage?.quotaLedgerPage?.total)}
                  page={selectedLedgerPage}
                  rowsPerPage={USER_USAGE_PAGE_SIZE}
                  rowsPerPageOptions={[USER_USAGE_PAGE_SIZE]}
                  labelRowsPerPage="每页"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
                  onPageChange={(_event, nextPage) => {
                    setSelectedLedgerPage(nextPage);
                    if (selectedBalanceUser?.id) void loadSelectedUserUsage(String(selectedBalanceUser.id), selectedInvocationPage, nextPage);
                  }}
                  onRowsPerPageChange={undefined}
                />
              </Stack>
            ) : selectedUsageTab === 1 ? (
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  合计：{formatPoint(selectedUserUsage?.totals?.charged_amount, providerCode)} / {String(selectedUserUsage?.totals?.request_count ?? 0)} 次
                </Typography>
                {!selectedUserUsage?.invocations.length && !userUsageLoading ? <Alert severity="info">暂无调用记录</Alert> : null}
                {selectedUserUsage?.invocations.length ? (
                  <AdminResponsiveTable minWidth={920}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>用途</TableCell>
                          <TableCell>模型</TableCell>
                          <TableCell>输入</TableCell>
                          <TableCell>输出</TableCell>
                          <TableCell>总量</TableCell>
                          <TableCell>扣费</TableCell>
                          <TableCell>耗时</TableCell>
                          <TableCell>时间</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedUserUsage.invocations.map((row) => (
                          <TableRow key={String(row.id)}>
                            <TableCell>{String(row.usage_label || formatUsageType(row.usage_type) || '-')}</TableCell>
                            <TableCell>{String(row.model || '-')}</TableCell>
                            <TableCell>{String(row.input_tokens ?? '-')}</TableCell>
                            <TableCell>{String(row.output_tokens ?? '-')}</TableCell>
                            <TableCell>{String(row.total_tokens ?? '-')}</TableCell>
                            <TableCell>{row.charged_amount == null ? '-' : formatPoint(row.charged_amount, providerCode)}</TableCell>
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
                  count={toPageTotal(selectedUserUsage?.invocationsPage?.total)}
                  page={selectedInvocationPage}
                  rowsPerPage={USER_USAGE_PAGE_SIZE}
                  rowsPerPageOptions={[USER_USAGE_PAGE_SIZE]}
                  labelRowsPerPage="每页"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
                  onPageChange={(_event, nextPage) => {
                    setSelectedInvocationPage(nextPage);
                    if (selectedBalanceUser?.id) void loadSelectedUserUsage(String(selectedBalanceUser.id), nextPage, selectedLedgerPage);
                  }}
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
                    value={selectedUserStatsGroupBy}
                    onChange={(event) => {
                      const nextGroupBy = event.target.value;
                      setSelectedUserStatsGroupBy(nextGroupBy);
                      setSelectedUserStatsPage(0);
                      if (selectedBalanceUser?.id) void loadSelectedUserStats(String(selectedBalanceUser.id), 0, nextGroupBy);
                    }}
                    sx={{ width: 140 }}
                  >
                    <MenuItem value="usage_type">用途</MenuItem>
                    <MenuItem value="model">模型</MenuItem>
                    <MenuItem value="day">日期</MenuItem>
                  </TextField>
                  <Button
                    variant="outlined"
                    disabled={selectedUserStatsLoading || !selectedBalanceUser?.id}
                    onClick={() => void loadSelectedUserStats(String(selectedBalanceUser?.id || ''), selectedUserStatsPage, selectedUserStatsGroupBy)}
                    sx={{ height: 40 }}
                  >
                    刷新统计
                  </Button>
                </Stack>
                {selectedUserStats ? (
                  <Alert severity="info">
                    调用 {formatCount(selectedUserStats.totals?.requestCount)}，输入 {formatCount(selectedUserStats.totals?.inputTokens)}，输出 {formatCount(selectedUserStats.totals?.outputTokens)}，实扣 {formatPoint(selectedUserStats.totals?.chargedAmount, providerCode)}
                  </Alert>
                ) : null}
                {!selectedUserStats?.items.length && !selectedUserStatsLoading ? <Alert severity="info">暂无用量统计</Alert> : null}
                {selectedUserStats?.items.length ? (
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
                          <TableCell>实扣</TableCell>
                          <TableCell>平均耗时</TableCell>
                          <TableCell>最近调用</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {selectedUserStats.items.map((row) => (
                          <TableRow key={String(row.groupKey || row.group_key || row.label || row.model || 'selected-user-stat-row')}>
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
                            <TableCell>{formatCount(row.averageLatencyMs ?? row.average_latency_ms)} ms</TableCell>
                            <TableCell>{formatTime(row.lastUsedAt ?? row.last_used_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AdminResponsiveTable>
                ) : null}
                <TablePagination
                  component="div"
                  count={toPageTotal(selectedUserStats?.total)}
                  page={selectedUserStatsPage}
                  rowsPerPage={USAGE_STATS_PAGE_SIZE}
                  rowsPerPageOptions={[USAGE_STATS_PAGE_SIZE]}
                  labelRowsPerPage="每页"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
                  onPageChange={(_event, nextPage) => {
                    setSelectedUserStatsPage(nextPage);
                    if (selectedBalanceUser?.id) void loadSelectedUserStats(String(selectedBalanceUser.id), nextPage, selectedUserStatsGroupBy);
                  }}
                  onRowsPerPageChange={undefined}
                />
              </Stack>
            )}
          </Stack>
        </DialogContent>
      </Dialog>
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>创建 Key</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            <TextField
              label="分组 ID（留空使用默认）"
              value={keyCreate.typeId}
              onChange={(e) => setKeyCreate((prev) => ({ ...prev, typeId: e.target.value }))}
              helperText={providerCode === 'api2d' ? '填写数字 id，例如 1219，不要带 CK 前缀' : undefined}
            />
            <TextField label="备注（留空使用默认）" value={keyCreate.note} onChange={(e) => setKeyCreate((prev) => ({ ...prev, note: e.target.value }))} />
            <TextField label="初始点数（留空使用默认）" value={keyCreate.grantAmount} onChange={(e) => setKeyCreate((prev) => ({ ...prev, grantAmount: e.target.value }))} />
            <TextField label="每日额度（留空使用默认）" value={keyCreate.dailyQuota} onChange={(e) => setKeyCreate((prev) => ({ ...prev, dailyQuota: e.target.value }))} />
            <TextField label="每月额度（留空使用默认）" value={keyCreate.monthlyQuota} onChange={(e) => setKeyCreate((prev) => ({ ...prev, monthlyQuota: e.target.value }))} />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setCreateDialogOpen(false)}>取消</Button>
              <Button variant="contained" disabled={keyLoading} onClick={() => void createKey()}>创建</Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>
      <Dialog open={updateDialogOpen} onClose={() => setUpdateDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>更新 Key</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 1 }}>
            <TextField label="Key ID" value={keyAction.externalKeyId} disabled />
            <FormControlLabel control={<Switch checked={keyAction.enabled} onChange={(e) => setKeyAction((prev) => ({ ...prev, enabled: e.target.checked }))} />} label="启用" />
            <TextField label="备注" value={keyAction.note} onChange={(e) => setKeyAction((prev) => ({ ...prev, note: e.target.value }))} />
            <TextField label="每日额度" value={keyAction.dailyQuota} onChange={(e) => setKeyAction((prev) => ({ ...prev, dailyQuota: e.target.value }))} />
            <TextField label="每月额度" value={keyAction.monthlyQuota} onChange={(e) => setKeyAction((prev) => ({ ...prev, monthlyQuota: e.target.value }))} />
            <TextField label="每分钟次数" value={keyAction.minuteTimes} onChange={(e) => setKeyAction((prev) => ({ ...prev, minuteTimes: e.target.value }))} />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setUpdateDialogOpen(false)}>取消</Button>
              <Button variant="contained" disabled={keyLoading} onClick={() => void updateKey()}>保存</Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
