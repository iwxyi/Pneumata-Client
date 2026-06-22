const HIGH_RISK_PRIVATE_RUNTIME_PATTERN = /(不要公开|不能公开|别公开|只告诉|秘密|暗号|住址|地址|电话|手机号|微信|QQ|私下称呼|私下约定|私密|隐私)/;
const PHONE_LIKE_PRIVATE_PATTERN = /\b1[3-9]\d{9}\b/;

export function hasHighRiskPrivateRuntimeText(text: string | undefined | null) {
  const value = text || '';
  return HIGH_RISK_PRIVATE_RUNTIME_PATTERN.test(value) || PHONE_LIKE_PRIVATE_PATTERN.test(value);
}

export function safeRuntimePrivateText(text: string | undefined | null, fallback = '有一条私域内容已隐藏原文') {
  const value = (text || '').trim();
  if (!value) return '';
  return hasHighRiskPrivateRuntimeText(value) ? fallback : value;
}

export function sanitizeRuntimePrivateItems(items: string[], fallback = '有一条私域内容已隐藏原文') {
  return items.map((item) => safeRuntimePrivateText(item, fallback)).filter(Boolean);
}
