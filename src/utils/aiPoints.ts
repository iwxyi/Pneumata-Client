export type OfficialAiProviderCode = 'api2d' | 'deepseek' | string;

type FormatAiAmountOptions = {
  compact?: boolean;
  empty?: string;
  suffix?: string;
};

function normalizeProviderCode(provider: unknown) {
  const value = String(provider || '').toLowerCase();
  if (value === 'official' || value === 'official-gpt' || value === 'gpt') return 'api2d';
  if (value === 'official-deepseek' || value === 'ds') return 'deepseek';
  return value;
}

function getMaximumFractionDigits(provider: unknown, compact?: boolean) {
  if (compact) return 0;
  const code = normalizeProviderCode(provider);
  if (code === 'api2d') return 0;
  if (code === 'deepseek') return 2;
  return 2;
}

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatAiAmount(value: unknown, provider: OfficialAiProviderCode, options: FormatAiAmountOptions = {}) {
  const amount = toFiniteNumber(value);
  if (amount == null) return options.empty ?? '-';
  const maximumFractionDigits = getMaximumFractionDigits(provider, options.compact);
  const rounded = Number(amount.toFixed(maximumFractionDigits));
  const displayAmount = Object.is(rounded, -0) ? 0 : rounded;
  const formatted = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
    useGrouping: false,
  }).format(displayAmount);
  return `${formatted}${options.suffix ?? 'P'}`;
}

export function formatAiBalanceAmount(balance: Record<string, unknown> | null | undefined, provider?: unknown, options: FormatAiAmountOptions = {}) {
  if (!balance) return options.empty ?? '-';
  const raw = balance.availableBalance ?? balance.available_balance;
  const providerCode = String(provider || balance.provider || balance.providerCode || balance.provider_code || '');
  const currencyUnit = String(balance.currencyUnit ?? balance.currency_unit ?? '').toLowerCase();
  if (currencyUnit === 'cny' || currencyUnit === 'rmb') {
    return formatAiAmount(raw, providerCode || 'deepseek', { ...options, suffix: '元' });
  }
  return formatAiAmount(raw, providerCode || 'api2d', options);
}
