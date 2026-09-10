import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import BoltIcon from '@mui/icons-material/Bolt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import PaymentIcon from '@mui/icons-material/Payment';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import RefreshIcon from '@mui/icons-material/Refresh';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useAuthStore } from '../stores/useAuthStore';
import { api, ApiError, type BillingMembershipConfig, type BillingMembershipResponse, type BillingOrderItem, type BillingPaymentResponse, type BillingPlanItem } from '../services/api';
import { formatAiBalanceAmount } from '../utils/aiPoints';
import AppSnackbar from '../components/common/AppSnackbar';
import { motion, transition } from '../styles/motion';

type SnackbarState = {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'info' | 'warning';
};

const refinedHoverSx = {
  '&:active': {
    transform: 'translateY(-1px) scale(0.996)',
    transitionTimingFunction: motion.press,
    transitionDuration: `${motion.durations.instant}ms`,
  },
};

const membershipRadius = {
  pageCard: 2.25,
  card: 2,
  panel: 1.6,
};

const membershipBlockSx = {
  scrollMarginTop: 88,
};

const DEFAULT_MEMBERSHIP_CONFIG: BillingMembershipConfig = {
  title: 'VIP 会员',
  subtitle: '解锁完整体验并获得 AI 点数',
  description: '开通会员解锁产品能力，购买点数用于官方 AI 调用。支付成功后系统会自动记录订单、开通权益并发放点数。',
  benefits: ['解锁会员功能权益', '会员专属体验', '优先使用新功能'],
  fulfillmentNote: '支付完成后自动履约',
  tiers: [
    { code: 'basic', name: '基础会员', rank: 10, enabled: true, description: '适合轻量体验和基础创作。', conversionRatio: 1, benefitsMarkdown: '- 基础角色与群聊权益\n- 标准记忆能力\n- 基础 AI 生成能力' },
    { code: 'pro', name: '高级会员', rank: 20, enabled: true, description: '适合高频聊天、角色创作和长期记忆。', conversionRatio: 0.5, benefitsMarkdown: '- 包含基础会员权益\n- **更高角色与群聊上限**\n- **长期记忆与高级生成**' },
    { code: 'premium', name: '旗舰会员', rank: 30, enabled: true, description: '适合重度创作和更高性能需求。', conversionRatio: 0.5, benefitsMarkdown: '- 包含高级会员权益\n- **最高使用上限**\n- **优先体验新功能**' },
  ],
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function membershipTierEnabled(value: { enabled?: unknown }) {
  return toBoolean(value.enabled, true);
}

function parseMetadata(value: unknown) {
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

function planGrantPoints(plan: BillingPlanItem) {
  return Math.max(0, toNumber(plan.grant_points));
}

function planStorageBytes(plan: BillingPlanItem) {
  return Math.max(0, getPlanMetaNumber(plan, 'storageBytes'));
}

function planIsVip(plan: BillingPlanItem) {
  return String(plan.plan_kind || '') === 'vip';
}

function formatMoney(value: unknown, currency: unknown = 'CNY') {
  const amount = toNumber(value);
  const normalizedCurrency = String(currency || 'CNY').trim().toUpperCase();
  if (normalizedCurrency === 'CNY' || normalizedCurrency === 'RMB') return `¥${amount.toFixed(2)}`;
  if (normalizedCurrency === 'USD') return `$${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${normalizedCurrency || 'CNY'}`;
}

function formatPoints(value: unknown) {
  const amount = toNumber(value);
  if (!Number.isFinite(amount) || amount <= 0) return '0P';
  return `${Number.isInteger(amount) ? amount : Number(amount.toFixed(2))}P`;
}

function formatStorageCompact(value: unknown) {
  const bytes = Math.max(0, toNumber(value));
  if (bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number(gb.toFixed(gb >= 10 ? 0 : 1))}GB`;
  }
  return `${Number(mb.toFixed(mb >= 100 ? 0 : 1))}MB`;
}

function formatDateTime(value: unknown) {
  const parsed = toNumber(value);
  return parsed > 0 ? new Date(parsed).toLocaleString() : '-';
}

function formatDate(value: unknown) {
  const parsed = toNumber(value);
  return parsed > 0 ? new Date(parsed).toLocaleDateString() : '-';
}

function orderNo(order: BillingOrderItem) {
  return String(order.orderNo || order.order_no || '');
}

function orderPlanName(order: BillingOrderItem) {
  return String(order.planName || order.plan_name || '-');
}

function orderCreatedAt(order: BillingOrderItem) {
  return order.createdAt ?? order.created_at;
}

function orderStatusLabel(value: unknown, isZh: boolean) {
  const status = String(value || '');
  if (status === 'paid') return isZh ? '已支付' : 'Paid';
  if (status === 'pending') return isZh ? '待支付' : 'Pending';
  if (status === 'cancelled') return isZh ? '已取消' : 'Cancelled';
  return status || '-';
}

function orderStatusColor(value: unknown): 'success' | 'warning' | 'default' {
  const status = String(value || '');
  if (status === 'paid') return 'success';
  if (status === 'pending') return 'warning';
  return 'default';
}

function getPlanMetaText(plan: BillingPlanItem, key: string, fallback = '') {
  const metadata = parseMetadata(plan.metadata);
  const value = metadata[key];
  return value === null || value === undefined ? fallback : String(value);
}

function getPlanMetaNumber(plan: BillingPlanItem, key: string, fallback = 0) {
  const metadata = parseMetadata(plan.metadata);
  return toNumber(metadata[key], fallback);
}

function planDisplayGroup(plan: BillingPlanItem) {
  return getPlanMetaText(plan, 'displayGroup', planIsVip(plan) ? 'vip' : 'points');
}

function planVipTierCode(plan: BillingPlanItem) {
  return getPlanMetaText(plan, 'vipTierCode', 'basic');
}

function planDurationLabel(plan: BillingPlanItem, isZh: boolean) {
  const label = getPlanMetaText(plan, 'durationLabel');
  if (label) return label;
  return plan.duration_days ? `${plan.duration_days}${isZh ? '天' : 'd'}` : '';
}

function planStorageDurationLabel(plan: BillingPlanItem, isZh: boolean) {
  const label = getPlanMetaText(plan, 'durationLabel');
  if (label) return label;
  const days = getPlanMetaNumber(plan, 'storageDurationDays');
  return days > 0 ? `${days}${isZh ? '天' : 'd'}` : '';
}

function planDisplaySortOrder(plan: BillingPlanItem) {
  const groupSortOrder = getPlanMetaNumber(plan, 'sortOrderInGroup', 0);
  if (groupSortOrder !== 0) return groupSortOrder;
  return toNumber(plan.sort_order, 0);
}

function formatAiPoints(balance: Record<string, unknown> | null, loading: boolean, isZh: boolean) {
  if (loading) return isZh ? '刷新中' : 'Refreshing';
  const raw = balance?.availableBalance ?? balance?.available_balance;
  if (typeof raw === 'number' && Number.isFinite(raw)) return formatAiBalanceAmount(balance);
  return isZh ? '未分配' : 'Not assigned';
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Box key={`${part}-${index}`} component="strong" sx={{ color: 'primary.main', fontWeight: 900 }}>{part.slice(2, -2)}</Box>;
    }
    return part;
  });
}

function markdownLines(value: unknown) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.replace(/^[-*]\s+/, ''));
}

function submitPaymentForm(payment: BillingPaymentResponse, targetWindow: Window | null) {
  if (payment.paymentUrl) {
    if (targetWindow) targetWindow.location.href = payment.paymentUrl;
    else window.location.href = payment.paymentUrl;
    return;
  }
  const action = String(payment.formAction || '').trim();
  const fields = payment.formFields || {};
  if (action && Object.keys(fields).length > 0) {
    const doc = targetWindow?.document || window.document;
    if (targetWindow) {
      doc.open();
      doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Redirecting...</title></head><body></body></html>');
      doc.close();
    }
    const form = doc.createElement('form');
    form.method = 'post';
    form.action = action;
    form.acceptCharset = 'UTF-8';
    form.enctype = 'application/x-www-form-urlencoded';
    form.style.display = 'none';
    Object.entries(fields).forEach(([key, value]) => {
      const input = doc.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = String(value);
      form.appendChild(input);
    });
    doc.body.appendChild(form);
    form.submit();
    return;
  }
  throw new Error('支付参数缺失，无法跳转支付宝');
}

function LoadingLine({ loading }: { loading: boolean }) {
  return (
    <Box sx={{ height: 4 }}>
      {loading ? <LinearProgress sx={{ height: 4, borderRadius: 999 }} /> : null}
    </Box>
  );
}

function MembershipDownCue({ sx }: { sx?: object }) {
  return (
    <Box
      aria-hidden
      sx={{
        height: 58,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'primary.main',
        pointerEvents: 'none',
        ...sx,
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 80 58"
        sx={{
          width: 80,
          height: 58,
          overflow: 'visible',
          filter: (theme) => `drop-shadow(0 10px 18px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.20 : 0.13)})`,
        }}
      >
        {[0, 1, 2].map((index) => {
          const y = 8 + index * 14;
          return (
          <Box
            key={index}
            component="path"
            d={`M22 ${y} L40 ${y + 12} L58 ${y}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            sx={{
              animation: `membershipDownCue 1900ms ${motion.emphasized} infinite`,
              animationDelay: `${index * 190}ms`,
              transformOrigin: '40px 29px',
            }}
          />
          );
        })}
      </Box>
    </Box>
  );
}

export default function MembershipPage() {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const navigate = useNavigate();
  const { setHeaderTitle, setHeaderBackAction, setHeaderActions } = useLayoutHeaderActions();
  const { authMode, isLoggedIn } = useAuthStore();
  const [plans, setPlans] = useState<BillingPlanItem[]>([]);
  const [membershipConfig, setMembershipConfig] = useState<BillingMembershipConfig>(DEFAULT_MEMBERSHIP_CONFIG);
  const [membership, setMembership] = useState<BillingMembershipResponse | null>(null);
  const [aiBalance, setAiBalance] = useState<Record<string, unknown> | null>(null);
  const [selectedVipTierCode, setSelectedVipTierCode] = useState('basic');
  const tierCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tierScrollTimerRef = useRef<number | null>(null);
  const [tierCardsScrolling, setTierCardsScrolling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiBalanceLoading, setAiBalanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchasingPlanCode, setPurchasingPlanCode] = useState<string | null>(null);
  const [claimingPointKind, setClaimingPointKind] = useState<'daily' | 'monthly' | null>(null);
  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'info' });

  useEffect(() => {
    setHeaderTitle(t('nav.membership'));
    setHeaderBackAction(null);
    setHeaderActions(null);
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHeaderActions(null);
    };
  }, [setHeaderActions, setHeaderBackAction, setHeaderTitle, t]);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const [planResult, configResult] = await Promise.all([
        api.getBillingPlans(),
        api.getBillingMembershipConfig(),
      ]);
      setPlans(planResult.items || []);
      const nextConfig = {
        ...DEFAULT_MEMBERSHIP_CONFIG,
        ...configResult,
        benefits: Array.isArray(configResult.benefits) ? configResult.benefits : DEFAULT_MEMBERSHIP_CONFIG.benefits,
        tiers: Array.isArray(configResult.tiers) && configResult.tiers.length ? configResult.tiers : DEFAULT_MEMBERSHIP_CONFIG.tiers,
      };
      setMembershipConfig(nextConfig);
      const nextTiers = nextConfig.tiers || [];
      const nextEnabledTiers = nextTiers.filter(membershipTierEnabled);
      setSelectedVipTierCode((current) => (nextEnabledTiers.some((tier) => tier.code === current) ? current : nextEnabledTiers[0]?.code || 'basic'));
      if (authMode !== 'local' && isLoggedIn) {
        setAiBalanceLoading(true);
        const [membershipResult, balanceResult] = await Promise.all([
          api.getBillingMembership(),
          api.getAiBalance(undefined, { force }),
        ]);
        setMembership(membershipResult);
        setAiBalance(balanceResult);
      } else {
        setMembership(null);
        setAiBalance(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : (isZh ? '加载会员信息失败' : 'Failed to load membership'));
    } finally {
      setLoading(false);
      setAiBalanceLoading(false);
    }
  }, [authMode, isLoggedIn, isZh]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (authMode === 'local' || !isLoggedIn) return undefined;
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') void loadData(true);
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [authMode, isLoggedIn, loadData]);

  const sortedPlans = useMemo(() => [...plans].sort((a, b) => {
    const vipDiff = Number(planDisplayGroup(b) === 'vip') - Number(planDisplayGroup(a) === 'vip');
    if (vipDiff) return vipDiff;
    const sortOrderDiff = planDisplaySortOrder(a) - planDisplaySortOrder(b);
    if (sortOrderDiff) return sortOrderDiff;
    return toNumber(a.price_amount) - toNumber(b.price_amount);
  }), [plans]);

  // 展示位置由后台设置的展示分组决定；缺少旧字段时，planDisplayGroup 会按套餐类型回退。
  const vipPlans = sortedPlans.filter((plan) => planDisplayGroup(plan) === 'vip');
  const pointPlans = sortedPlans.filter((plan) => planDisplayGroup(plan) === 'points');
  // 只有明确归入“容量”分组、且不包含 VIP/点数权益的套餐才作为容量包展示。
  // VIP 套餐可能也带有容量，但应继续留在会员套餐中，避免重复显示。
  const storagePlans = sortedPlans.filter((plan) => (
    planDisplayGroup(plan) === 'storage'
    && !planIsVip(plan)
    && planGrantPoints(plan) <= 0
    && planStorageBytes(plan) > 0
  ));
  const purchasableVipTierCodes = new Set(vipPlans.map((plan) => planVipTierCode(plan)));
  const enabledConfigTiers = [...(membershipConfig.tiers || DEFAULT_MEMBERSHIP_CONFIG.tiers || [])]
    .filter(membershipTierEnabled)
    .sort((a, b) => toNumber(a.rank) - toNumber(b.rank));
  const vipTiers = enabledConfigTiers
    .filter((tier) => purchasableVipTierCodes.has(tier.code));
  const entitlementForTier = (code: string) => membershipConfig.entitlements?.[code] || membershipConfig.entitlements?.free;
  const freeEntitlement = entitlementForTier('free');
  const tierOptions = [
    {
      code: 'free',
      name: isZh ? '免费用户' : 'Free',
      rank: 0,
      enabled: true,
      description: String(freeEntitlement?.description || (isZh ? '基础体验，适合先试用。' : 'Basic access for trying the product.')),
      benefitsMarkdown: String(freeEntitlement?.benefitsMarkdown || (isZh ? '- 基础聊天体验\n- 每日/每月免费点数\n- 本地数据可用' : '- Basic chat experience\n- Daily/monthly free points\n- Local data')),
    },
    ...enabledConfigTiers,
  ];
  const selectedVipTier = vipTiers.find((tier) => tier.code === selectedVipTierCode) || vipTiers[0];
  const selectedTierOption = tierOptions.find((tier) => tier.code === selectedVipTierCode) || selectedVipTier || tierOptions[0];
  const displayTierOptions = tierOptions.filter((tier) => tier.code !== 'free');
  const selectedTierIndex = Math.max(0, displayTierOptions.findIndex((tier) => tier.code === selectedTierOption?.code));
  const durationCardsJustify = selectedTierIndex <= 0
    ? 'start'
    : selectedTierIndex >= tierOptions.length - 1
      ? 'end'
      : 'center';
  // Desktop tier cards should retain a calm, readable width instead of
  // stretching across the whole content column. The same tracks are reused
  // by the cue row below so the arrow remains anchored to the selected card.
  const tierGridTemplateColumns = `repeat(${Math.max(displayTierOptions.length, 1)}, minmax(220px, 238px))`;
  const selectedTierPlans = vipPlans.filter((plan) => planVipTierCode(plan) === (selectedTierOption?.code || 'basic'));
  const visibleVipPlans = selectedTierPlans;
  const activeSubscription = membership?.activeSubscription || null;
  const latestSubscription = membership?.latestSubscription || null;
  const recentOrders = membership?.recentOrders || [];
  const loggedInCloud = authMode !== 'local' && isLoggedIn;
  const heroDescription = String(membershipConfig.description || membershipConfig.subtitle || '').trim();
  const membershipBenefits = useMemo(
    () => (membershipConfig.benefits || []).map((item) => String(item || '').trim()).filter(Boolean),
    [membershipConfig.benefits],
  );

  const handlePurchase = async (plan: BillingPlanItem) => {
    if (!loggedInCloud) {
      navigate('/login', { state: { from: { pathname: '/membership' } } });
      return;
    }
    const planCode = String(plan.code || '').trim();
    if (!planCode || purchasingPlanCode) return;
    const paymentWindow = window.open('', '_blank');
    if (paymentWindow) {
      paymentWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>支付宝支付</title></head><body style="font-family:system-ui,sans-serif;padding:24px">正在创建安全支付请求...</body></html>');
      paymentWindow.document.close();
    }
    setPurchasingPlanCode(planCode);
    setError(null);
    try {
      const order = await api.createBillingOrder(planCode, 'alipay');
      const payment = await api.initiateBillingPayment(String(order.id), 'alipay');
      if (payment.channel === 'manual') {
        paymentWindow?.close();
        setSnackbar({ open: true, message: payment.message || (isZh ? '订单已创建，等待后台确认支付' : 'Order created, waiting for manual confirmation'), severity: 'info' });
        await loadData(true);
        return;
      }
      submitPaymentForm(payment, paymentWindow);
      setSnackbar({ open: true, message: isZh ? '已打开支付宝收银台，完成支付后回到此页刷新状态。' : 'Alipay checkout opened. Return here and refresh after payment.', severity: 'success' });
      window.setTimeout(() => {
        void loadData(true);
      }, 2500);
    } catch (purchaseError) {
      paymentWindow?.close();
      const message = purchaseError instanceof ApiError || purchaseError instanceof Error
        ? purchaseError.message
        : (isZh ? '发起支付失败' : 'Payment failed');
      setSnackbar({ open: true, message, severity: 'error' });
      setError(message);
    } finally {
      setPurchasingPlanCode(null);
    }
  };

  const handleClaimPoints = async (kind: 'daily' | 'monthly') => {
    if (!loggedInCloud || claimingPointKind) {
      if (!loggedInCloud) navigate('/login', { state: { from: { pathname: '/membership' } } });
      return;
    }
    setClaimingPointKind(kind);
    try {
      const result = await api.claimBillingVipPoints(kind);
      setMembership((prev) => prev ? { ...prev, pointClaimStatus: result.pointClaimStatus } : prev);
      const balanceResult = await api.getAiBalance(undefined, { force: true });
      setAiBalance(balanceResult);
      setSnackbar({
        open: true,
        message: isZh ? `已领取 ${formatPoints(result.claim.amount)}` : `Claimed ${formatPoints(result.claim.amount)}`,
        severity: 'success',
      });
    } catch (claimError) {
      const message = claimError instanceof ApiError || claimError instanceof Error
        ? claimError.message
        : (isZh ? '领取点数失败' : 'Failed to claim points');
      setSnackbar({ open: true, message, severity: 'error' });
    } finally {
      setClaimingPointKind(null);
    }
  };

  const displayedSubscription = activeSubscription || latestSubscription;
  const currentMembershipName = displayedSubscription?.vipTierName || displayedSubscription?.planName || (isZh ? '免费用户' : 'Free user');
  const membershipExpired = !activeSubscription && Boolean(latestSubscription);
  const pointClaimStatus = membership?.pointClaimStatus || null;
  const dailyClaim = pointClaimStatus?.daily || null;
  const monthlyClaim = pointClaimStatus?.monthly || null;
  const pointClaimItems = [
    dailyClaim && Number(dailyClaim.amount || 0) > 0
      ? { kind: 'daily' as const, title: isZh ? '每日点数' : 'Daily points', description: isZh ? '每天可免费领取一次' : 'Free once per day', claim: dailyClaim }
      : null,
    monthlyClaim && Number(monthlyClaim.amount || 0) > 0
      ? { kind: 'monthly' as const, title: isZh ? '每月点数' : 'Monthly points', description: isZh ? '每月按当前会员等级领取一次' : 'Free once per month by membership tier', claim: monthlyClaim }
      : null,
  ].filter((item): item is { kind: 'daily' | 'monthly'; title: string; description: string; claim: NonNullable<typeof dailyClaim> } => Boolean(item));
  const availablePointClaimItems = pointClaimItems.filter((item) => !item.claim.claimed);
  const unavailablePointClaimItems = pointClaimItems.filter((item) => item.claim.claimed);
  const showPointPacks = pointPlans.length > 0 || pointClaimItems.length > 0;

  return (
    <Box
      sx={{
        p: { xs: 2, sm: 3 },
        pt: { xs: 1, sm: 2 },
        pb: { xs: 12, sm: 8 },
        maxWidth: 1180,
        mx: 'auto',
        '@keyframes membershipSheen': {
          '0%': { transform: 'translateX(-140%) skewX(-18deg)', opacity: 0 },
          '18%': { opacity: 0.42 },
          '100%': { transform: 'translateX(180%) skewX(-18deg)', opacity: 0 },
        },
        '@keyframes membershipRiseIn': {
          '0%': { opacity: 0, transform: 'translateY(8px) scale(0.985)' },
          '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
        '@keyframes membershipDownCue': {
          '0%': { opacity: 0.12, transform: 'translateY(-2px) scale(0.98)' },
          '42%': { opacity: 0.88, transform: 'translateY(1px) scale(1)' },
          '78%': { opacity: 0.36, transform: 'translateY(5px) scale(0.99)' },
          '100%': { opacity: 0.12, transform: 'translateY(7px) scale(0.98)' },
        },
      }}
    >
      <Stack spacing={{ xs: 3.25, sm: 4 }}>
        <LoadingLine loading={loading} />
        <Card
          variant="outlined"
          sx={{
            overflow: 'hidden',
            borderRadius: membershipRadius.pageCard,
            borderColor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.36 : 0.22),
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(18,18,18,0.96)' : 'rgba(255,255,255,0.94)',
            background: (theme) => theme.palette.mode === 'dark'
              ? `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.28)}, ${alpha(theme.palette.background.paper, 0.92)} 56%, ${alpha(theme.palette.success.dark, 0.16)}), ${theme.palette.background.paper}`
              : `linear-gradient(135deg, ${alpha(theme.palette.primary.light, 0.20)}, ${alpha(theme.palette.background.paper, 0.96)} 56%, ${alpha(theme.palette.success.light, 0.16)}), ${theme.palette.background.paper}`,
            boxShadow: (theme) => `0 20px 52px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.30 : 0.08)}`,
            position: 'relative',
          }}
        >
          <CardContent sx={{ p: { xs: 2, sm: 3 }, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.25fr 0.75fr' }, gap: 2.25, alignItems: 'stretch' }}>
            <Stack spacing={1.75} sx={{ justifyContent: 'center' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip icon={<WorkspacePremiumIcon />} label={isZh ? '会员中心' : 'Membership'} color="primary" size="small" />
                {membershipConfig.fulfillmentNote ? (
                  <Chip icon={<BoltIcon />} label={membershipConfig.fulfillmentNote} size="small" />
                ) : null}
              </Stack>
              <Box>
                <Typography variant="h4" sx={{ fontWeight: 950, letterSpacing: 0, fontSize: { xs: 29, sm: 40 }, lineHeight: 1.08, maxWidth: 720 }}>
                  {membershipConfig.title || (isZh ? '选择适合你的会员方案' : 'Choose your membership')}
                </Typography>
                {heroDescription ? (
                  <Typography color="text.secondary" sx={{ mt: 1.15, maxWidth: 690, lineHeight: 1.78, fontSize: { xs: 14.5, sm: 15.5 } }}>
                    {heroDescription}
                  </Typography>
                ) : null}
              </Box>
              {membershipBenefits.length > 0 ? (
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  {membershipBenefits.map((benefit) => (
                    <Chip
                      key={benefit}
                      size="small"
                      icon={<CheckCircleIcon />}
                      label={renderInlineMarkdown(benefit)}
                      sx={{ fontWeight: 800, maxWidth: '100%', '& .MuiChip-label': { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }}
                    />
                  ))}
                </Stack>
              ) : null}
            </Stack>
            <Box
              sx={{
                border: '1px solid',
                borderColor: (theme) => alpha(theme.palette.divider, 0.8),
                borderRadius: membershipRadius.card,
                p: 1.5,
                width: { xs: 'min(100%, 360px)', md: '100%' },
                justifySelf: { xs: 'start', md: 'stretch' },
                bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.62 : 0.74),
                backdropFilter: 'blur(16px)',
                transition: transition(['border-color', 'box-shadow', 'transform'], motion.durations.slow, motion.softOut),
                '&:hover': {
                  borderColor: (theme) => alpha(theme.palette.primary.main, 0.34),
                  boxShadow: (theme) => `0 14px 30px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.22 : 0.07)}`,
                  transform: 'translateY(-1px)',
                },
                ...refinedHoverSx,
                '&:hover .benefitRefresh': {
                  transform: 'rotate(28deg)',
                },
              }}
            >
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, minWidth: 0 }} noWrap>
                    {isZh ? '当前会员：' : 'Current membership: '}{currentMembershipName}
                  </Typography>
                  <IconButton
                    className="benefitRefresh"
                    size="small"
                    onClick={() => void loadData(true)}
                    disabled={loading || aiBalanceLoading}
                    aria-label={isZh ? '刷新权益状态' : 'Refresh benefits'}
                    sx={{ transition: transition(['transform', 'background-color'], motion.durations.slow, motion.gentleSpring) }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 1 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                    <Box
                      sx={{
                        p: 1.1,
                        borderRadius: membershipRadius.panel,
                        border: '1px solid',
                        borderColor: 'divider',
                        position: 'relative',
                        overflow: 'hidden',
                        transition: transition(['border-color', 'background-color', 'transform'], motion.durations.slow, motion.gentleSpring),
                        '&:hover': {
                          transform: 'translateY(-1px)',
                          borderColor: (theme) => alpha(theme.palette.primary.main, 0.36),
                          bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.035),
                        },
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>{isZh ? '有效期至' : 'Valid until'}</Typography>
                      <Typography sx={{ mt: 0.25, fontWeight: 900 }}>{formatDate(displayedSubscription?.currentPeriodEnd)}</Typography>
                      {membershipExpired ? <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.15, fontWeight: 800 }}>{isZh ? '已过期' : 'Expired'}</Typography> : null}
                    </Box>
                    <Box
                      sx={{
                        p: 1.1,
                        borderRadius: membershipRadius.panel,
                        border: '1px solid',
                        borderColor: 'divider',
                        position: 'relative',
                        overflow: 'hidden',
                        transition: transition(['border-color', 'background-color', 'transform'], motion.durations.slow, motion.gentleSpring),
                        '&:hover': {
                          transform: 'translateY(-1px)',
                          borderColor: (theme) => alpha(theme.palette.primary.main, 0.36),
                          bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.035),
                        },
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>{isZh ? 'AI点数' : 'AI points'}</Typography>
                      <Typography sx={{ mt: 0.25, fontWeight: 950 }}>{loggedInCloud ? formatAiPoints(aiBalance, aiBalanceLoading, isZh) : (isZh ? '登录后查看' : 'Sign in')}</Typography>
                    </Box>
                  </Box>
                </Box>
              </Stack>
            </Box>
          </CardContent>
        </Card>

        {error ? <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void loadData(true)}>{isZh ? '重试' : 'Retry'}</Button>}>{error}</Alert> : null}

        <Stack id="membership-plans" spacing={{ xs: 3.25, sm: 4.25 }} sx={membershipBlockSx}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: { xs: -1.75, sm: -2 } }}>
              <CircularProgress size={22} />
            </Box>
          ) : null}

          {plans.length === 0 && !loading ? <Alert severity="info">{isZh ? '暂无可购买套餐' : 'No plans available'}</Alert> : null}

          {vipPlans.length > 0 && vipTiers.length > 0 ? (
            <Stack spacing={{ xs: 1.55, sm: 1.85 }} sx={{ pt: { xs: 0.25, sm: 0.5 }, ...membershipBlockSx }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 950, lineHeight: 1.2 }}>{isZh ? '会员套餐' : 'Membership plans'}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, maxWidth: 620, lineHeight: 1.65 }}>
                  {isZh ? '从轻量体验到深度创作，选择适合当前节奏的会员权益。' : 'Pick the membership benefits that match your current creative pace.'}
                </Typography>
              </Box>
              <Box
                onScroll={() => {
                  setTierCardsScrolling(true);
                  if (tierScrollTimerRef.current !== null) window.clearTimeout(tierScrollTimerRef.current);
                  tierScrollTimerRef.current = window.setTimeout(() => setTierCardsScrolling(false), 650);
                }}
                sx={{
                  display: { xs: 'flex', md: 'grid' },
                  gridTemplateColumns: { md: tierGridTemplateColumns },
                  width: { md: 'fit-content' },
                  maxWidth: '100%',
                  mx: { md: 'auto' },
                  gridAutoRows: '1fr',
                  gap: 1.25,
                  alignItems: 'stretch',
                  overflowX: { xs: 'auto', md: 'visible' },
                  overflowY: { xs: 'hidden', md: 'visible' },
                  overscrollBehaviorX: 'contain',
                  pb: { xs: 0.5, md: 0 },
                  WebkitOverflowScrolling: 'touch',
                  scrollbarColor: tierCardsScrolling ? 'rgba(120,120,120,.65) transparent' : 'transparent transparent',
                  '&::-webkit-scrollbar': { height: 6 },
                  '&::-webkit-scrollbar-track': { background: 'transparent' },
                  '&::-webkit-scrollbar-thumb': { backgroundColor: tierCardsScrolling ? 'rgba(120,120,120,.65)' : 'transparent', borderRadius: 999 },
                }}
              >
                {displayTierOptions.map((tier, tierIndex) => {
                  const active = tier.code === selectedTierOption?.code;
                  const tierPlans = vipPlans.filter((plan) => planVipTierCode(plan) === tier.code);
                  const tierMinPlan = [...tierPlans].sort((a, b) => toNumber(a.price_amount) - toNumber(b.price_amount))[0];
                  const durationCount = new Set(tierPlans.map((plan) => Number(plan.duration_days || 0)).filter((days) => days > 0)).size;
                  const isFree = tier.code === 'free';
                  const benefitLines = markdownLines(tier.benefitsMarkdown);
                  return (
                    <Box ref={(node: HTMLDivElement | null) => { tierCardRefs.current[tier.code] = node; }} key={tier.code} sx={{ position: 'relative', minWidth: 0, display: 'flex', flex: { xs: '0 0 min(238px, 78vw)', md: 'initial' }, width: { xs: 'min(238px, 78vw)', md: 'auto' }, minWidth: { xs: 0, md: 0 }, maxWidth: { xs: 'min(238px, 78vw)', md: 'none' }, flexDirection: 'column' }}>
                    <Box
                      onClick={() => {
                        setSelectedVipTierCode(tier.code);
                        window.requestAnimationFrame(() => {
                          tierCardRefs.current[tier.code]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                        });
                      }}
                      sx={{
                        borderRadius: membershipRadius.card,
                        border: '1px solid',
                        cursor: 'pointer',
                        width: '100%',
                        height: '100%',
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.15,
                        p: 1.35,
                        position: 'relative',
                        overflow: 'hidden',
                        borderColor: (theme) => active ? alpha(theme.palette.primary.main, 0.64) : alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.10),
                        bgcolor: (theme) => active ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.10 : 0.035) : theme.palette.background.paper,
                        boxShadow: (theme) => active ? `0 14px 32px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.10)}` : `0 10px 26px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.20 : 0.055)}`,
                        animation: `membershipRiseIn 460ms ${motion.softOut} both`,
                        animationDelay: `${Math.min(tierIndex * 60, 180)}ms`,
                        transition: transition(['border-color', 'box-shadow', 'transform', 'background-color'], motion.durations.slow, motion.gentleSpring),
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          borderColor: (theme) => alpha(theme.palette.primary.main, 0.62),
                          boxShadow: (theme) => `0 14px 30px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.10)}`,
                          '& .tierDivider::after': {
                            transform: 'scaleX(1)',
                          },
                          '& .tierIcon': {
                            transform: 'translateY(-1px) rotate(-4deg)',
                          },
                          '& .tierBenefitMark': {
                            transform: 'scale(1.08)',
                          },
                        },
                        ...refinedHoverSx,
                      }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                          <Box
                            sx={{
                              width: 34,
                              height: 34,
                              borderRadius: membershipRadius.panel,
                              display: 'grid',
                              placeItems: 'center',
                              flex: '0 0 auto',
                              color: 'primary.main',
                              bgcolor: (theme) => alpha(theme.palette.primary.main, active ? (theme.palette.mode === 'dark' ? 0.18 : 0.10) : (theme.palette.mode === 'dark' ? 0.08 : 0.045)),
                              transition: transition(['background-color', 'color', 'transform'], motion.durations.base, motion.softOut),
                            }}
                            className="tierIcon"
                          >
                            {isFree ? <CheckCircleIcon sx={{ fontSize: 19 }} /> : <WorkspacePremiumIcon sx={{ fontSize: 19 }} />}
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 18, fontWeight: 950, minWidth: 0, lineHeight: 1.15 }} noWrap>{tier.name}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                              {isFree ? (isZh ? '先轻松体验' : 'Start free') : (isZh ? '解锁更自由的创作' : 'Unlock more freedom')}
                            </Typography>
                          </Box>
                        </Stack>
                        {active ? (
                          <Box
                            sx={{
                              width: 26,
                              height: 26,
                              borderRadius: 999,
                              display: 'grid',
                              placeItems: 'center',
                              flex: '0 0 auto',
                              color: 'primary.contrastText',
                              bgcolor: 'primary.main',
                              boxShadow: (theme) => `0 8px 18px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.26 : 0.18)}`,
                            }}
                          >
                            <CheckCircleIcon sx={{ fontSize: 17 }} />
                          </Box>
                        ) : null}
                      </Stack>
                      {String(tier.description || '').trim() ? (
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>{String(tier.description || '').trim()}</Typography>
                      ) : null}
                      <Stack spacing={0.65} sx={{ flex: 1 }}>
                        {benefitLines.map((line, lineIndex) => (
                          <Stack
                            key={line}
                            direction="row"
                            spacing={0.8}
                            sx={{
                              alignItems: 'flex-start',
                              animation: `membershipRiseIn 480ms ${motion.softOut} both`,
                              animationDelay: `${Math.min(lineIndex * 55, 220)}ms`,
                            }}
                          >
                            <Box
                              className="tierBenefitMark"
                              sx={{
                                width: 18,
                                height: '1.5em',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flex: '0 0 auto',
                                color: active ? 'primary.main' : 'success.main',
                                transition: transition(['color', 'transform'], motion.durations.base, motion.gentleSpring),
                              }}
                            >
                              <CheckCircleIcon sx={{ fontSize: 16 }} />
                            </Box>
                            <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{renderInlineMarkdown(line)}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                      <Stack
                        className="tierDivider"
                        direction="row"
                        spacing={0.75}
                        sx={{
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1,
                          mt: 0.25,
                          minHeight: 32,
                          boxSizing: 'border-box',
                          pt: 1,
                          borderTop: '1px solid',
                          borderColor: (theme) => alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.56 : 0.72),
                          position: 'relative',
                          '&::after': {
                            content: '""',
                            position: 'absolute',
                            top: -1,
                            left: 0,
                            right: 0,
                            height: 2,
                            borderRadius: 999,
                            bgcolor: 'primary.main',
                            transform: active ? 'scaleX(1)' : 'scaleX(0)',
                            transformOrigin: 'center',
                            transition: `transform 520ms ${motion.emphasized}`,
                            boxShadow: (theme) => active ? `0 0 18px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.30 : 0.18)}` : 'none',
                          },
                        }}
                      >
                        {isFree ? (
                          <Typography sx={{ fontWeight: 950, color: active ? 'primary.main' : 'text.primary' }}>{isZh ? '免费' : 'Free'}</Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                            {isZh ? `${durationCount || tierPlans.length} 个时长` : `${durationCount || tierPlans.length} durations`}
                          </Typography>
                        )}
                          {tierMinPlan ? (
                            <Typography sx={{ fontWeight: 950, color: active ? 'primary.main' : 'text.primary' }}>
                              {isZh ? (
                                <>
                                  {formatMoney(tierMinPlan.price_amount, tierMinPlan.currency)}
                                  <Box component="span" sx={{ ml: 0.25, fontSize: 12, color: 'text.secondary', fontWeight: 700 }}>起</Box>
                                </>
                              ) : (
                                <>
                                  <Box component="span" sx={{ mr: 0.35, fontSize: 12, color: 'text.secondary', fontWeight: 700 }}>from</Box>
                                  {formatMoney(tierMinPlan.price_amount, tierMinPlan.currency)}
                                </>
                              )}
                            </Typography>
                          ) : null}
                      </Stack>
                    </Box>
                    <Box sx={{ display: { xs: 'flex', md: 'none' }, justifyContent: 'center', height: 48, visibility: active ? 'visible' : 'hidden' }}>
                      {active ? <MembershipDownCue sx={{ height: 48 }} /> : null}
                    </Box>
                    </Box>
                  );
                })}
              </Box>
              {selectedTierOption?.code === 'free' ? (
                <Alert severity="info" sx={{ borderRadius: membershipRadius.card }}>
                  {isZh ? '免费用户无需购买会员，可直接领取可用点数包。' : 'Free tier does not require a purchase. Claim available point packs below.'}
                </Alert>
              ) : (
                <Box
                  sx={{
                    display: { xs: 'none', md: 'grid' },
                    gridTemplateColumns: { xs: '1fr', md: tierGridTemplateColumns },
                    width: { md: 'fit-content' },
                    maxWidth: '100%',
                    mx: { md: 'auto' },
                    gap: { xs: 0, md: 1.25 },
                    alignItems: 'center',
                    my: { xs: 0.25, sm: 0.5, md: 0.1 },
                    minHeight: { xs: 58, md: 62 },
                  }}
                >
                  {displayTierOptions.map((tier) => {
                    const active = tier.code === selectedTierOption?.code;
                    return (
                      <Box
                        key={`cue-${tier.code}`}
                        sx={{
                          display: { xs: active ? 'flex' : 'none', md: 'flex' },
                          justifyContent: 'center',
                          minWidth: 0,
                          visibility: active ? 'visible' : 'hidden',
                        }}
                      >
                        {active ? <MembershipDownCue /> : <Box sx={{ height: 58 }} />}
                      </Box>
                    );
                  })}
                </Box>
              )}
              {selectedTierOption?.code !== 'free' ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(auto-fit, minmax(min(100%, 188px), 238px))' }, gridAutoRows: '1fr', gap: 1.15, alignItems: 'stretch', justifyContent: { xs: 'start', md: durationCardsJustify } }}>
                {visibleVipPlans.map((plan, planIndex) => {
                  const highlightReason = getPlanMetaText(plan, 'highlightReason');
                  const originalPrice = getPlanMetaNumber(plan, 'originalPriceAmount');
                  const purchasing = purchasingPlanCode === plan.code;
                  return (
                    <Card
                      key={plan.code}
                      variant="outlined"
                      onClick={() => {
                        if (!purchasingPlanCode) void handlePurchase(plan);
                      }}
                      sx={{
                        borderRadius: membershipRadius.card,
                        height: '100%',
                        width: '100%',
                        cursor: purchasingPlanCode ? 'default' : 'pointer',
                        borderColor: (theme) => alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.28 : 0.18),
                        bgcolor: 'background.paper',
                        boxShadow: (theme) => `0 8px 18px ${alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.09 : 0.04)}`,
                        animation: `membershipRiseIn 420ms ${motion.softOut} both`,
                        animationDelay: `${Math.min(planIndex * 45, 180)}ms`,
                        overflow: 'hidden',
                        position: 'relative',
                        transition: transition(['background-color', 'box-shadow', 'transform', 'border-color'], motion.durations.slow, motion.gentleSpring),
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          inset: 1,
                          borderRadius: 'inherit',
                          pointerEvents: 'none',
                          background: (theme) => `radial-gradient(circle at 76% 18%, ${alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.20 : 0.14)}, transparent 34%), linear-gradient(135deg, transparent 0%, ${alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.11 : 0.06)} 100%)`,
                          opacity: 0,
                          transform: 'translate(18px, -14px) scale(0.86)',
                          transformOrigin: '76% 18%',
                          transition: transition(['opacity', 'transform'], motion.durations.slow, motion.emphasized),
                        },
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          borderColor: (theme) => alpha(theme.palette.warning.main, 0.78),
                          boxShadow: (theme) => `0 14px 28px ${alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.24 : 0.15)}`,
                          '&::before': {
                            opacity: 1,
                            transform: 'translate(0, 0) scale(1)',
                          },
                          '& .purchaseAction': {
                            bgcolor: 'warning.main',
                            borderColor: 'warning.main',
                            color: 'warning.contrastText',
                            boxShadow: (theme) => `0 12px 24px ${alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.28 : 0.22)}`,
                          },
                          '& .purchasePrice': {
                            color: 'warning.contrastText',
                          },
                          '& .purchaseOriginalPrice': {
                            color: 'warning.contrastText',
                            opacity: 0.7,
                          },
                          '& .durationPill': {
                            transform: 'translateX(2px)',
                          },
                        },
                        ...refinedHoverSx,
                      }}
                    >
                      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 0.9, p: 1.25, '&:last-child': { pb: 1.25 } }}>
                        <Stack direction="row" spacing={0.85} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 0.85 }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                              <Typography sx={{ fontWeight: 950, lineHeight: 1.2, minWidth: 0 }} noWrap>{plan.name}</Typography>
                              {planDurationLabel(plan, isZh) ? (
                                <Box
                                  sx={{
                                    px: 0.8,
                                    py: 0.3,
                                    borderRadius: 999,
                                    bgcolor: (theme) => alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.18 : 0.10),
                                    color: 'warning.main',
                                    fontSize: 11,
                                    lineHeight: 1,
                                    fontWeight: 900,
                                    flex: '0 0 auto',
                                    transition: transition(['transform', 'background-color'], motion.durations.base, motion.softOut),
                                  }}
                                  className="durationPill"
                                >
                                  {planDurationLabel(plan, isZh)}
                                </Box>
                              ) : null}
                            </Stack>
                          </Box>
                        </Stack>
                        {highlightReason || plan.description ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              display: '-webkit-box',
                              overflow: 'hidden',
                              WebkitBoxOrient: 'vertical',
                              WebkitLineClamp: 2,
                              lineHeight: 1.45,
                            }}
                          >
                            {highlightReason || plan.description}
                          </Typography>
                        ) : null}
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          {planGrantPoints(plan) > 0 ? <Chip icon={<BoltIcon />} label={formatPoints(planGrantPoints(plan))} size="small" color="success" sx={{ height: 24 }} /> : null}
                          {planStorageBytes(plan) > 0 ? <Chip icon={<CloudOutlinedIcon />} label={formatStorageCompact(planStorageBytes(plan))} size="small" color="info" sx={{ height: 24 }} /> : null}
                        </Stack>
                        <Button
                          className="purchaseAction"
                          variant="outlined"
                          startIcon={<PaymentIcon />}
                          disabled={Boolean(purchasingPlanCode)}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handlePurchase(plan);
                          }}
                          sx={{
                            fontWeight: 900,
                            mt: 'auto',
                            minHeight: 36,
                            py: 0.65,
                            position: 'relative',
                            overflow: 'hidden',
                            transition: transition(['background-color', 'border-color', 'color', 'box-shadow', 'transform'], motion.durations.base, motion.gentleSpring),
                            '&::before': {
                              content: '""',
                              position: 'absolute',
                              inset: '0 auto 0 0',
                              width: '42%',
                              pointerEvents: 'none',
                              background: (theme) => `linear-gradient(90deg, transparent, ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.22 : 0.34)}, transparent)`,
                              transform: 'translateX(-140%) skewX(-18deg)',
                              opacity: 0,
                            },
                            '&:hover': {
                              bgcolor: 'primary.main',
                              borderColor: 'primary.main',
                              color: 'primary.contrastText',
                              transform: 'translateY(-1px)',
                              boxShadow: (theme) => `0 12px 24px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.30 : 0.22)}`,
                              '&::before': {
                                animation: `membershipSheen 780ms ${motion.softOut}`,
                              },
                              '& .purchasePrice': {
                                color: 'primary.contrastText',
                              },
                              '& .purchaseOriginalPrice': {
                                color: 'primary.contrastText',
                                opacity: 0.7,
                              },
                            },
                          }}
                        >
                          {purchasing ? (isZh ? '正在发起支付' : 'Starting payment') : (
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                              <Box component="span" className="purchasePrice" sx={{ fontSize: 16 }}>{formatMoney(plan.price_amount, plan.currency)}</Box>
                              {originalPrice > 0 ? (
                                <Box
                                  component="span"
                                  className="purchaseOriginalPrice"
                                  sx={{
                                    color: 'text.disabled',
                                    textDecoration: 'line-through',
                                    fontSize: 12,
                                    fontWeight: 650,
                                    lineHeight: 1,
                                  }}
                                >
                                  {formatMoney(originalPrice, plan.currency)}
                                </Box>
                              ) : null}
                            </Box>
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </Box>
              ) : null}
            </Stack>
          ) : null}

          {showPointPacks ? (
            <Stack spacing={{ xs: 1.45, sm: 1.75 }} sx={{ pt: { xs: 0.5, sm: 0.75 }, ...membershipBlockSx }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 950, lineHeight: 1.2 }}>{isZh ? '点数包' : 'Point packs'}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, maxWidth: 620, lineHeight: 1.65 }}>
                  {isZh ? '点数用于官方 AI 调用，适合在灵感集中时补充更稳定的创作余量。' : 'Points power official AI calls when you need more room for focused creation.'}
                </Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(auto-fit, minmax(min(100%, 188px), 238px))' }, gridAutoRows: '1fr', gap: 1, alignItems: 'stretch', justifyContent: 'start' }}>
                {availablePointClaimItems.map((item, claimIndex) => {
                  const claiming = claimingPointKind === item.kind;
                  return (
                    <Card
                      key={`claim-${item.kind}`}
                      variant="outlined"
                      onClick={() => {
                        if (!claimingPointKind) void handleClaimPoints(item.kind);
                      }}
                      sx={{
                        borderRadius: membershipRadius.card,
                        height: '100%',
                        borderColor: (theme) => alpha(theme.palette.success.main, 0.52),
                        bgcolor: (theme) => alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
                        cursor: claimingPointKind ? 'default' : 'pointer',
                        animation: `membershipRiseIn 420ms ${motion.softOut} both`,
                        animationDelay: `${Math.min(claimIndex * 45, 120)}ms`,
                        overflow: 'hidden',
                        position: 'relative',
                        transition: transition(['border-color', 'box-shadow', 'transform', 'background-color'], motion.durations.base, motion.softOut),
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: -28,
                          right: -24,
                          width: 88,
                          height: 88,
                          borderRadius: 999,
                          pointerEvents: 'none',
                          background: (theme) => `radial-gradient(circle, ${alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.28 : 0.18)}, transparent 66%)`,
                          opacity: 0,
                          transform: 'translate(22px, -18px) scale(0.58)',
                          transformOrigin: '100% 0%',
                          transition: transition(['opacity', 'transform'], motion.durations.slow, motion.emphasized),
                        },
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: (theme) => `0 12px 24px ${alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.16 : 0.10)}`,
                          '&::before': {
                            opacity: 1,
                            transform: 'translate(0, 0) scale(1)',
                          },
                          '& .pointValue': {
                            transform: 'translateY(-1px) scale(1.035)',
                          },
                        },
                        ...refinedHoverSx,
                      }}
                    >
                      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 0.9, height: '100%', p: 1.25, '&:last-child': { pb: 1.25 } }}>
                        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
                          <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>{item.title}</Typography>
                          <Chip className="pointValue" icon={<BoltIcon />} label={formatPoints(item.claim.amount)} size="small" color="success" sx={{ transition: transition(['transform'], motion.durations.base, motion.gentleSpring) }} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{item.description}</Typography>
                        <Button
                          variant="contained"
                          startIcon={<BoltIcon />}
                          disabled={Boolean(claimingPointKind)}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleClaimPoints(item.kind);
                          }}
                          sx={{ fontWeight: 900 }}
                        >
                          {claiming ? (isZh ? '领取中' : 'Claiming') : (isZh ? '免费领取' : 'Claim free')}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
                {pointPlans.map((plan, pointIndex) => {
                  const purchasing = purchasingPlanCode === plan.code;
                  const description = String(plan.description || '').trim();
                  return (
                    <Card
                      key={plan.code}
                      variant="outlined"
                      onClick={() => {
                        if (!purchasingPlanCode) void handlePurchase(plan);
                      }}
                      sx={{
                        borderRadius: membershipRadius.card,
                        height: '100%',
                        cursor: purchasingPlanCode ? 'default' : 'pointer',
                        animation: `membershipRiseIn 420ms ${motion.softOut} both`,
                        animationDelay: `${Math.min((availablePointClaimItems.length + pointIndex) * 45, 220)}ms`,
                        overflow: 'hidden',
                        position: 'relative',
                        transition: transition(['box-shadow', 'transform', 'border-color', 'background-color'], motion.durations.base, motion.softOut),
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: -30,
                          right: -26,
                          width: 92,
                          height: 92,
                          borderRadius: 999,
                          pointerEvents: 'none',
                          background: (theme) => `radial-gradient(circle, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.20 : 0.11)}, transparent 68%)`,
                          opacity: 0,
                          transform: 'translate(22px, -18px) scale(0.58)',
                          transformOrigin: '100% 0%',
                          transition: transition(['opacity', 'transform'], motion.durations.slow, motion.emphasized),
                        },
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          borderColor: (theme) => alpha(theme.palette.primary.main, 0.44),
                          boxShadow: (theme) => `0 12px 24px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.22 : 0.08)}`,
                          '&::before': {
                            opacity: 1,
                            transform: 'translate(0, 0) scale(1)',
                          },
                          '& .pointValue': {
                            transform: 'translateY(-1px) scale(1.035)',
                          },
                          '& .purchaseAction': {
                            bgcolor: 'primary.main',
                            borderColor: 'primary.main',
                            color: 'primary.contrastText',
                            boxShadow: (theme) => `0 12px 24px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.26 : 0.20)}`,
                          },
                        },
                        ...refinedHoverSx,
                      }}
                    >
                      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 0.9, height: '100%', p: 1.25, '&:last-child': { pb: 1.25 } }}>
                        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
                          <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>{plan.name}</Typography>
                          <Chip className="pointValue" icon={<BoltIcon />} label={formatPoints(planGrantPoints(plan))} size="small" color="success" sx={{ transition: transition(['transform'], motion.durations.base, motion.gentleSpring) }} />
                        </Stack>
                        {description ? (
                          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{description}</Typography>
                        ) : null}
                        <Button
                          className="purchaseAction"
                          variant="outlined"
                          startIcon={<PaymentIcon />}
                          disabled={Boolean(purchasingPlanCode)}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handlePurchase(plan);
                          }}
                          sx={{ fontWeight: 900, transition: transition(['background-color', 'border-color', 'color', 'box-shadow'], motion.durations.base, motion.gentleSpring) }}
                        >
                          {purchasing ? (isZh ? '正在发起支付' : 'Starting payment') : formatMoney(plan.price_amount, plan.currency)}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
                {unavailablePointClaimItems.map((item) => (
                  <Card
                    key={`claim-${item.kind}`}
                    variant="outlined"
                    sx={{
                      borderRadius: membershipRadius.card,
                      height: '100%',
                      cursor: 'default',
                    }}
                  >
                    <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 0.9, height: '100%', p: 1.25, '&:last-child': { pb: 1.25 } }}>
                      <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
                        <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>{item.title}</Typography>
                        <Chip icon={<BoltIcon />} label={formatPoints(item.claim.amount)} size="small" />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{item.description}</Typography>
                      <Button variant="outlined" disabled>
                        {isZh ? '已领取' : 'Claimed'}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Stack>
          ) : null}
          {storagePlans.length > 0 ? (
            <Stack spacing={{ xs: 1.55, sm: 1.85 }} sx={membershipBlockSx}>
              <Box><Typography variant="h6" sx={{ fontWeight: 950 }}>{isZh ? '容量包' : 'Storage packs'}</Typography><Typography variant="body2" color="text.secondary">{isZh ? '容量包可叠加使用，并按套餐有效期自动到期。' : 'Storage packs stack and expire according to each plan.'}</Typography></Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(auto-fit, minmax(min(100%, 188px), 238px))' }, gridAutoRows: '1fr', gap: 1, alignItems: 'stretch', justifyContent: 'start' }}>
                {storagePlans.map((plan, planIndex) => (
                  <Card
                    key={plan.id}
                    variant="outlined"
                    onClick={() => {
                      if (!purchasingPlanCode) void handlePurchase(plan);
                    }}
                    sx={{
                      borderRadius: membershipRadius.card,
                      height: '100%',
                      borderColor: (theme) => alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.28 : 0.18),
                      bgcolor: 'background.paper',
                      cursor: purchasingPlanCode ? 'default' : 'pointer',
                      animation: `membershipRiseIn 420ms ${motion.softOut} both`,
                      animationDelay: `${Math.min(planIndex * 45, 120)}ms`,
                      overflow: 'hidden',
                      position: 'relative',
                      transition: transition(['border-color', 'box-shadow', 'transform'], motion.durations.base, motion.softOut),
                      '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: -30,
                        right: -26,
                        width: 92,
                        height: 92,
                        borderRadius: 999,
                        pointerEvents: 'none',
                        background: (theme) => `radial-gradient(circle, ${alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.20 : 0.11)}, transparent 68%)`,
                        opacity: 0,
                        transform: 'translate(22px, -18px) scale(0.58)',
                        transformOrigin: '100% 0%',
                        transition: transition(['opacity', 'transform'], motion.durations.slow, motion.emphasized),
                      },
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        borderColor: (theme) => alpha(theme.palette.info.main, 0.55),
                        boxShadow: (theme) => `0 12px 24px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.22 : 0.08)}`,
                        '&::before': {
                          opacity: 1,
                          transform: 'translate(0, 0) scale(1)',
                        },
                        '& .storageValue': {
                          transform: 'translateY(-1px) scale(1.035)',
                        },
                        '& .storagePurchaseAction': {
                          bgcolor: 'info.main',
                          borderColor: 'info.main',
                          color: 'info.contrastText',
                          boxShadow: (theme) => `0 12px 24px ${alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.26 : 0.20)}`,
                        },
                      },
                      ...refinedHoverSx,
                    }}
                  >
                    <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 0.9, height: '100%', p: 1.25, '&:last-child': { pb: 1.25 } }}>
                      <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
                        <Stack direction="row" spacing={0.7} sx={{ alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
                          <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>{plan.name}</Typography>
                          {planStorageDurationLabel(plan, isZh) ? <Box sx={{ px: 0.8, py: 0.3, borderRadius: 999, bgcolor: (theme) => alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.18 : 0.10), color: 'info.main', fontSize: 11, lineHeight: 1, fontWeight: 900, flex: '0 0 auto' }}>{planStorageDurationLabel(plan, isZh)}</Box> : null}
                        </Stack>
                        <Chip className="storageValue" icon={<CloudOutlinedIcon />} label={formatStorageCompact(planStorageBytes(plan))} color="info" size="small" sx={{ transition: transition(['transform'], motion.durations.base, motion.gentleSpring) }} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{plan.description || planDurationLabel(plan, isZh)}</Typography>
                      <Button className="storagePurchaseAction" color="info" variant="outlined" startIcon={<PaymentIcon />} onClick={(event) => { event.stopPropagation(); void handlePurchase(plan); }} disabled={Boolean(purchasingPlanCode)} sx={{ fontWeight: 900, transition: transition(['background-color', 'border-color', 'color', 'box-shadow'], motion.durations.base, motion.gentleSpring) }}>
                        {formatMoney(plan.price_amount, plan.currency)}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Stack>
          ) : null}
        </Stack>

        <Card variant="outlined" sx={{ borderRadius: 2, mt: { xs: 0.25, sm: 0.75 }, ...membershipBlockSx }}>
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <ReceiptLongIcon color="action" />
                <Typography variant="h6" sx={{ fontWeight: 900 }}>{isZh ? '最近订单' : 'Recent orders'}</Typography>
              </Stack>
              <Button size="small" startIcon={<RefreshIcon />} onClick={() => void loadData(true)}>{isZh ? '刷新' : 'Refresh'}</Button>
            </Stack>
            {!loggedInCloud ? (
              <Alert severity="info">{isZh ? '登录后可查看购买记录和会员状态。' : 'Sign in to view purchase history and membership status.'}</Alert>
            ) : recentOrders.length === 0 ? (
              <Typography color="text.secondary">{isZh ? '暂无订单' : 'No orders yet'}</Typography>
            ) : (
              <Stack divider={<Divider flexItem />} spacing={0}>
                {recentOrders.map((order) => (
                  <Box key={String(order.id)} sx={{ py: 1.2, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: 'minmax(0, 1fr) auto' }, gap: { xs: 1, sm: 2 }, alignItems: 'center' }}>
                    <Box sx={{ minWidth: 0, display: 'grid', gap: 0.15 }}>
                      <Typography noWrap sx={{ fontWeight: 800 }}>{orderPlanName(order)}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{orderNo(order)}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ opacity: 0.78, fontWeight: 500 }}>{formatDateTime(orderCreatedAt(order))}</Typography>
                    </Box>
                    <Box sx={{ display: 'grid', justifyItems: 'end', alignContent: 'center', gap: 0.65 }}>
                      <Typography sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{formatMoney(order.amount, order.currency)}</Typography>
                      <Chip size="small" color={orderStatusColor(order.status)} label={orderStatusLabel(order.status, isZh)} />
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Stack>

      <AppSnackbar
        open={snackbar.open}
        message={snackbar.message}
        severity={snackbar.severity}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      />
    </Box>
  );
}
