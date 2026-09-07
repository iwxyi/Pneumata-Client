import { useEffect, useMemo, useRef, useState } from 'react';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Alert, Autocomplete, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Switch, Tooltip, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { AdminMetricGrid, AdminSection, AdminTableFrame, type AdminMetricItem } from '../../components/admin/AdminSurface';
import { ADMIN_PERMISSION_CODES, adminHasPermission } from '../../constants/adminPermissions';
import { adminApi } from '../../services/adminApi';
import { useAdminAuthStore } from '../../stores/useAdminAuthStore';
import { readPersistentUiValue, writePersistentUiValue } from '../../utils/persistentUiState';
import { copyTextToClipboard } from '../../utils/clipboard';
import AdminAIPage from './AdminAIPage';

type FieldDef = {
  key: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  type?: 'text' | 'number' | 'boolean';
  required?: boolean;
  placeholder?: string;
  defaultTemplate?: string;
};

const CATEGORY_TABS = [
  { value: 'ai', label: 'AI' },
  { value: 'payment', label: '支付' },
  { value: 'captcha', label: '验证码' },
  { value: 'sms', label: '短信' },
  { value: 'email', label: '邮箱' },
  { value: 'search', label: '搜索' },
  { value: 'other', label: '其余接口' },
  { value: 'tts', label: '文字转语音 TTS' },
  { value: 'stt', label: '语音转文字 STT' },
] as const;

type PlatformTab = typeof CATEGORY_TABS[number]['value'];
const PLATFORM_TAB_STORAGE_KEY = 'admin.platform.tab';

function isPlatformTab(value: unknown): value is PlatformTab {
  return CATEGORY_TABS.some((item) => item.value === value);
}

const PROVIDER_POPULARITY: Record<string, number> = {
  'payment:alipay': 10,
  'payment:wechatpay': 20,
  'payment:aggregate': 30,
  'payment:epay': 40,
  'payment:payjs': 50,
  'payment:hupijiao': 60,
  'payment:manual': 90,
  'captcha:local': 10,
  'captcha:tencentcloud': 20,
  'captcha:geetest-v4': 30,
  'captcha:yidun': 40,
  'captcha:turnstile': 50,
  'captcha:hcaptcha': 60,
  'captcha:aliyun': 70,
  'sms:aliyun': 10,
  'sms:tencentcloud': 20,
  'sms:huaweicloud': 30,
  'sms:volcengine': 40,
  'sms:yunpian': 50,
  'sms:mock': 90,
  'email:smtp': 10,
  'email:aliyundm': 20,
  'email:sendgrid': 30,
  'email:mailgun': 40,
  'email:awsses': 50,
  'email:console': 90,
  'search:bocha': 10,
  'other:alapi': 10,
  'tts:minimax': 10,
  'tts:volcengine': 20,
  'tts:openai': 30,
  'tts:azure-speech': 40,
  'tts:elevenlabs': 50,
  'stt:volcengine': 10,
  'stt:aliyun': 20,
  'stt:openai': 30,
  'stt:whisper-local': 40,
};

const DEFAULT_ALIPAY_NOTIFY_URL = '${domain}/api/billing/payments/alipay/notify';
const DEFAULT_ALIPAY_RETURN_URL = '${domain}/membership';

const SPEECH_PRICING_FIELDS: FieldDef[] = [
  { key: 'pricePerUnit', label: '上游价格（元 / 计费单位）', type: 'number' },
  { key: 'billingMultiplier', label: '点数扣费倍率', type: 'number' },
  { key: 'pointValueCny', label: '每点价值（元）', type: 'number' },
  { key: 'minimumCharge', label: '单次最低扣点（P）', type: 'number' },
];

const SPEECH_CLIENT_MODEL_FIELDS: FieldDef[] = [
  { key: 'clientModelId', label: '用户侧模型 ID', required: true, placeholder: '例如：companion-tts' },
  { key: 'clientModelName', label: '用户侧模型名称', required: true, placeholder: '例如：陪伴语音' },
];

const FIELD_DEFS: Record<string, FieldDef[]> = {
  'tts:minimax': [
    { key: 'apiBaseUrl', label: 'API Base URL' }, { key: 'endpoint', label: 'TTS Endpoint' }, { key: 'groupId', label: 'Group ID', required: true },
    { key: 'model', label: '模型 ID', required: true }, { key: 'defaultVoice', label: '默认音色 Voice ID' }, { key: 'language', label: '语言' }, { key: 'outputFormat', label: '输出格式' }, { key: 'sampleRate', label: '采样率', type: 'number' }, { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'tts:volcengine': [
    { key: 'endpoint', label: 'V3 WebSocket Endpoint' }, { key: 'resourceId', label: 'Resource ID' }, { key: 'defaultVoice', label: '默认音色' }, { key: 'language', label: '语言' }, { key: 'outputFormat', label: '输出格式' }, { key: 'listSpeakersEndpoint', label: '音色目录 OpenAPI Endpoint' }, { key: 'openApiRegion', label: 'OpenAPI Region' }, { key: 'apiKey', label: 'TTS API Key', secret: true, required: true }, { key: 'accessKeyId', label: 'IAM Access Key ID（同步音色）', secret: true }, { key: 'secretAccessKey', label: 'IAM Secret Access Key（同步音色）', secret: true },
  ],
  'tts:openai': [
    { key: 'apiBaseUrl', label: 'API Base URL' }, { key: 'model', label: '模型 ID', required: true }, { key: 'defaultVoice', label: '默认音色' }, { key: 'outputFormat', label: '输出格式' }, { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'tts:azure-speech': [
    { key: 'endpoint', label: 'Speech Endpoint', required: true }, { key: 'region', label: 'Region' }, { key: 'defaultVoice', label: '默认音色' }, { key: 'language', label: '语言' }, { key: 'outputFormat', label: '输出格式' }, { key: 'subscriptionKey', label: 'Subscription Key', secret: true, required: true },
  ],
  'tts:elevenlabs': [
    { key: 'apiBaseUrl', label: 'API Base URL' }, { key: 'model', label: '模型 ID' }, { key: 'defaultVoice', label: '默认 Voice ID', required: true }, { key: 'outputFormat', label: '输出格式' }, { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'stt:volcengine': [
    { key: 'endpoint', label: 'V3 WebSocket Endpoint' }, { key: 'resourceId', label: 'Resource ID' }, { key: 'language', label: '语言' }, { key: 'timeoutMs', label: '超时毫秒', type: 'number' }, { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'stt:aliyun': [
    { key: 'apiBaseUrl', label: 'API Base URL' }, { key: 'endpoint', label: 'Transcription Endpoint' }, { key: 'model', label: '模型 ID' }, { key: 'language', label: '语言' }, { key: 'timeoutMs', label: '超时毫秒', type: 'number' }, { key: 'apiKey', label: 'API Key', secret: true },
  ],
  'stt:openai': [
    { key: 'apiBaseUrl', label: 'API Base URL' }, { key: 'model', label: '模型 ID', required: true }, { key: 'language', label: '语言' }, { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'stt:whisper-local': [
    { key: 'endpoint', label: 'Transcription Endpoint', required: true }, { key: 'model', label: '模型 ID' }, { key: 'language', label: '语言' }, { key: 'apiKey', label: 'API Key', secret: true },
  ],
  'payment:alipay': [
    { key: 'appId', label: 'App ID', required: true },
    { key: 'gatewayUrl', label: '网关地址' },
    {
      key: 'notifyUrl',
      label: '异步通知地址',
      defaultTemplate: DEFAULT_ALIPAY_NOTIFY_URL,
    },
    {
      key: 'returnUrl',
      label: '支付完成返回地址',
      defaultTemplate: DEFAULT_ALIPAY_RETURN_URL,
    },
    { key: 'productCode', label: '产品码' },
    { key: 'signType', label: '签名方式' },
    { key: 'appPrivateKey', label: '应用私钥', secret: true, multiline: true, required: true },
    { key: 'alipayPublicKey', label: '支付宝公钥', secret: true, multiline: true, required: true },
  ],
  'payment:manual': [
    { key: 'note', label: '说明' },
  ],
  'payment:wechatpay': [
    { key: 'apiBaseUrl', label: 'API Base URL' },
    { key: 'appId', label: 'App ID', required: true },
    { key: 'mchId', label: '商户号', required: true },
    { key: 'notifyUrl', label: '异步通知地址' },
    { key: 'certSerialNo', label: '商户证书序列号', required: true },
    { key: 'apiV3Key', label: 'API v3 密钥', secret: true, required: true },
    { key: 'merchantPrivateKey', label: '商户私钥', secret: true, multiline: true, required: true },
    { key: 'platformCertificate', label: '平台证书', secret: true, multiline: true, required: true },
  ],
  'payment:aggregate': [
    { key: 'gatewayUrl', label: '网关地址', required: true },
    { key: 'merchantId', label: '商户号', required: true },
    { key: 'appId', label: '应用 ID' },
    { key: 'notifyUrl', label: '异步通知地址' },
    { key: 'returnUrl', label: '支付完成返回地址' },
    { key: 'signType', label: '签名方式' },
    { key: 'productCode', label: '产品码/通道码' },
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
    { key: 'apiSecret', label: 'API Secret', secret: true },
    { key: 'privateKey', label: '私钥', secret: true, multiline: true },
    { key: 'publicKey', label: '公钥', secret: true, multiline: true },
  ],
  'payment:epay': [
    { key: 'gatewayUrl', label: '网关地址', required: true },
    { key: 'pid', label: '商户 PID', required: true },
    { key: 'notifyUrl', label: '异步通知地址' },
    { key: 'returnUrl', label: '支付完成返回地址' },
    { key: 'paymentTypes', label: '启用支付方式' },
    { key: 'merchantKey', label: '商户密钥', secret: true, required: true },
  ],
  'payment:payjs': [
    { key: 'apiBaseUrl', label: 'API Base URL' },
    { key: 'mchId', label: '商户号', required: true },
    { key: 'notifyUrl', label: '异步通知地址' },
    { key: 'signType', label: '签名方式' },
    { key: 'key', label: '通信密钥', secret: true, required: true },
  ],
  'payment:hupijiao': [
    { key: 'apiBaseUrl', label: 'API Base URL' },
    { key: 'appId', label: 'App ID', required: true },
    { key: 'notifyUrl', label: '异步通知地址' },
    { key: 'returnUrl', label: '支付完成返回地址' },
    { key: 'appSecret', label: 'App Secret', secret: true, required: true },
  ],
  'captcha:local': [
    { key: 'note', label: '说明' },
  ],
  'captcha:turnstile': [
    { key: 'siteKey', label: 'Site Key', required: true },
    { key: 'verifyUrl', label: '服务端校验地址' },
    { key: 'secretKey', label: 'Secret Key', secret: true, required: true },
  ],
  'captcha:hcaptcha': [
    { key: 'siteKey', label: 'Site Key', required: true },
    { key: 'verifyUrl', label: '服务端校验地址' },
    { key: 'secretKey', label: 'Secret Key', secret: true, required: true },
  ],
  'captcha:geetest-v4': [
    { key: 'captchaId', label: 'Captcha ID', required: true },
    { key: 'verifyUrl', label: '服务端校验地址' },
    { key: 'captchaKey', label: 'Captcha Key', secret: true, required: true },
  ],
  'captcha:tencentcloud': [
    { key: 'captchaAppId', label: 'CaptchaAppId', required: true },
    { key: 'verifyUrl', label: '服务端校验地址' },
    { key: 'appSecretKey', label: 'App Secret Key', secret: true, required: true },
  ],
  'captcha:yidun': [
    { key: 'captchaId', label: 'Captcha ID', required: true },
    { key: 'verifyUrl', label: '服务端校验地址' },
    { key: 'version', label: '协议版本' },
    { key: 'secretId', label: 'Secret ID', secret: true, required: true },
    { key: 'secretKey', label: 'Secret Key', secret: true, required: true },
  ],
  'captcha:aliyun': [
    { key: 'sceneId', label: '场景 ID', required: true },
    { key: 'regionId', label: 'Region ID' },
    { key: 'endpoint', label: 'Endpoint' },
    { key: 'accessKeyId', label: 'AccessKey ID', secret: true, required: true },
    { key: 'accessKeySecret', label: 'AccessKey Secret', secret: true, required: true },
  ],
  'sms:aliyun': [
    { key: 'endpoint', label: '接口地址' },
    { key: 'regionId', label: 'Region ID' },
    { key: 'signName', label: '短信签名', required: true },
    { key: 'templateCodeLogin', label: '登录模板 Code', required: true },
    { key: 'templateCodeRegister', label: '注册模板 Code' },
    { key: 'templateCodeForgotPassword', label: '找回密码模板 Code' },
    { key: 'templateCodeChangePhone', label: '换绑手机号模板 Code' },
    { key: 'templateParamName', label: '验证码参数名' },
    { key: 'accessKeyId', label: 'AccessKey ID', secret: true, required: true },
    { key: 'accessKeySecret', label: 'AccessKey Secret', secret: true, required: true },
  ],
  'sms:tencentcloud': [
    { key: 'endpoint', label: '接口地址' },
    { key: 'region', label: 'Region' },
    { key: 'sdkAppId', label: '短信 SdkAppId', required: true },
    { key: 'signName', label: '短信签名', required: true },
    { key: 'templateCodeLogin', label: '登录模板 ID', required: true },
    { key: 'templateCodeRegister', label: '注册模板 ID' },
    { key: 'templateCodeForgotPassword', label: '找回密码模板 ID' },
    { key: 'templateCodeChangePhone', label: '换绑手机号模板 ID' },
    { key: 'templateParamName', label: '验证码参数名' },
    { key: 'secretId', label: 'SecretId', secret: true, required: true },
    { key: 'secretKey', label: 'SecretKey', secret: true, required: true },
  ],
  'sms:huaweicloud': [
    { key: 'endpoint', label: '接口地址', required: true },
    { key: 'appKey', label: 'AppKey', required: true },
    { key: 'sender', label: '通道号', required: true },
    { key: 'signature', label: '短信签名', required: true },
    { key: 'templateCodeLogin', label: '登录模板 ID', required: true },
    { key: 'templateCodeRegister', label: '注册模板 ID' },
    { key: 'templateCodeForgotPassword', label: '找回密码模板 ID' },
    { key: 'templateCodeChangePhone', label: '换绑手机号模板 ID' },
    { key: 'templateParamName', label: '验证码参数名' },
    { key: 'appSecret', label: 'AppSecret', secret: true, required: true },
  ],
  'sms:volcengine': [
    { key: 'endpoint', label: '接口地址' },
    { key: 'region', label: 'Region' },
    { key: 'smsAccount', label: '短信账号', required: true },
    { key: 'signName', label: '短信签名', required: true },
    { key: 'templateCodeLogin', label: '登录模板 ID', required: true },
    { key: 'templateCodeRegister', label: '注册模板 ID' },
    { key: 'templateCodeForgotPassword', label: '找回密码模板 ID' },
    { key: 'templateCodeChangePhone', label: '换绑手机号模板 ID' },
    { key: 'templateParamName', label: '验证码参数名' },
    { key: 'accessKeyId', label: 'AccessKey ID', secret: true, required: true },
    { key: 'secretAccessKey', label: 'SecretAccessKey', secret: true, required: true },
  ],
  'sms:yunpian': [
    { key: 'endpoint', label: '接口地址' },
    { key: 'signName', label: '短信签名' },
    { key: 'templateText', label: '模板文本', multiline: true, required: true },
    { key: 'templateParamName', label: '验证码参数名' },
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'sms:mock': [
    { key: 'code', label: '固定验证码' },
  ],
  'email:smtp': [
    { key: 'host', label: 'SMTP Host', required: true },
    { key: 'port', label: 'SMTP 端口', type: 'number' },
    { key: 'secure', label: 'SSL/TLS', type: 'boolean' },
    { key: 'fromEmail', label: '发件邮箱', required: true },
    { key: 'fromName', label: '发件名称' },
    { key: 'username', label: '用户名', secret: true },
    { key: 'password', label: '密码/授权码', secret: true },
  ],
  'email:sendgrid': [
    { key: 'apiBaseUrl', label: 'API Base URL' },
    { key: 'fromEmail', label: '发件邮箱', required: true },
    { key: 'fromName', label: '发件名称' },
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'email:mailgun': [
    { key: 'apiBaseUrl', label: 'API Base URL' },
    { key: 'domain', label: 'Domain', required: true },
    { key: 'fromEmail', label: '发件邮箱', required: true },
    { key: 'fromName', label: '发件名称' },
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'email:aliyundm': [
    { key: 'endpoint', label: '接口地址' },
    { key: 'regionId', label: 'Region ID' },
    { key: 'accountName', label: '发信地址', required: true },
    { key: 'fromAlias', label: '发信人昵称' },
    { key: 'tagName', label: '标签' },
    { key: 'accessKeyId', label: 'AccessKey ID', secret: true, required: true },
    { key: 'accessKeySecret', label: 'AccessKey Secret', secret: true, required: true },
  ],
  'email:awsses': [
    { key: 'region', label: 'Region' },
    { key: 'fromEmail', label: '发件邮箱', required: true },
    { key: 'fromName', label: '发件名称' },
    { key: 'accessKeyId', label: 'AccessKey ID', secret: true, required: true },
    { key: 'secretAccessKey', label: 'SecretAccessKey', secret: true, required: true },
  ],
  'email:console': [],
  'search:bocha': [
    { key: 'apiBaseUrl', label: 'API Base URL', required: true },
    { key: 'webSearchPath', label: '网页搜索路径' },
    { key: 'freshness', label: '时间范围' },
    { key: 'count', label: '默认结果数', type: 'number' },
    { key: 'summary', label: '返回摘要', type: 'boolean' },
    { key: 'include', label: '限定网站范围' },
    { key: 'exclude', label: '排除网站范围' },
    { key: 'pointCost', label: '单次搜索扣点', type: 'number' },
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
  ],
  'other:alapi': [
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
    { key: 'doutuEnabled', label: '启用表情包搜索', type: 'boolean' },
    { key: 'doutuPointCost', label: '表情包搜索单次扣点（P）', type: 'number' },
  ],
};

function integrationKey(item: Record<string, unknown>) {
  return `${String(item.category || '')}:${String(item.providerCode || '')}`;
}

function integrationCapabilities(item: Record<string, unknown> | null) {
  const capabilities = item?.capabilities;
  if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
    const record = capabilities as Record<string, unknown>;
    return {
      runtimeSupported: Boolean(record.runtimeSupported),
      testSupported: Boolean(record.testSupported),
      configurationOnly: Boolean(record.configurationOnly),
      note: String(record.note || ''),
    };
  }
  return {
    runtimeSupported: true,
    testSupported: true,
    configurationOnly: false,
    note: '',
  };
}

function valueFrom(item: Record<string, unknown>, field: FieldDef) {
  const source = field.secret ? item.secrets : item.config;
  return source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>)[field.key]
    : '';
}

function normalizeFieldValue(field: FieldDef, value: unknown) {
  if (field.type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (field.type === 'boolean') return Boolean(value);
  return String(value ?? '');
}

function fieldUsesDomainTemplate(value: unknown) {
  const text = String(value ?? '');
  return text.includes('${domain}') || text.includes('{domain}');
}

function effectiveFieldValue(field: FieldDef, value: unknown) {
  const text = String(value ?? '').trim();
  return text || field.defaultTemplate || '';
}

function resolveDomainTemplate(value: unknown, requestOrigin: string) {
  const origin = requestOrigin.replace(/\/+$/, '');
  return String(value ?? '')
    .trim()
    .replace(/\$\{domain\}/g, origin)
    .replace(/\{domain\}/g, origin);
}

function toEditorState(item: Record<string, unknown>) {
  const state: Record<string, unknown> = {};
  const category = String(item.category || '');
  const fields = [
    ...(FIELD_DEFS[integrationKey(item)] || []),
    ...((category === 'tts' || category === 'stt') ? SPEECH_CLIENT_MODEL_FIELDS : []),
    ...((category === 'tts' || category === 'stt') ? SPEECH_PRICING_FIELDS : []),
  ];
  for (const field of fields) {
    const config = item.config && typeof item.config === 'object' && !Array.isArray(item.config) ? item.config as Record<string, unknown> : {};
    const nestedPricing = config.pricing && typeof config.pricing === 'object' && !Array.isArray(config.pricing) ? config.pricing as Record<string, unknown> : {};
    const value = SPEECH_PRICING_FIELDS.some((pricingField) => pricingField.key === field.key)
      ? (config[field.key] ?? nestedPricing[field.key])
      : valueFrom(item, field);
    state[field.key] = String(value ?? '').trim() || field.defaultTemplate || '';
  }
  return state;
}

function statusLabel(value: unknown) {
  return String(value || '') === 'active' ? '启用' : '停用';
}

function sortGroup(item: Record<string, unknown>) {
  if (item.isDefault) return 0;
  if (integrationKey(item) === 'payment:manual') return 2;
  if (String(item.status || '') === 'active') return 1;
  return 3;
}

function comparePlatformIntegration(left: Record<string, unknown>, right: Record<string, unknown>) {
  const leftGroup = sortGroup(left);
  const rightGroup = sortGroup(right);
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;

  const leftKey = integrationKey(left);
  const rightKey = integrationKey(right);
  const leftPopularity = PROVIDER_POPULARITY[leftKey] ?? 999;
  const rightPopularity = PROVIDER_POPULARITY[rightKey] ?? 999;
  if (leftPopularity !== rightPopularity) return leftPopularity - rightPopularity;
  return String(left.displayName || leftKey).localeCompare(String(right.displayName || rightKey), 'zh-CN');
}

function formatCnyAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} 元`
    : '-';
}

export default function AdminPlatformPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const admin = useAdminAuthStore((s) => s.admin);
  const canReadAi = adminHasPermission(admin, ADMIN_PERMISSION_CODES.aiRead);
  const canReadPlatform = adminHasPermission(admin, ADMIN_PERMISSION_CODES.platformRead);
  const [category, setCategory] = useState<PlatformTab>(() => {
    const tab = searchParams.get('tab');
    if (isPlatformTab(tab)) return tab;
    return readPersistentUiValue<PlatformTab>(PLATFORM_TAB_STORAGE_KEY, 'ai', isPlatformTab);
  });
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [requestOrigin, setRequestOrigin] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<Record<string, unknown>>({});
  const [testDraft, setTestDraft] = useState<Record<string, string>>({ phone: '', code: '123456', to: '' });
  const [testResult, setTestResult] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceResult, setBalanceResult] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);
  const [searchBalances, setSearchBalances] = useState<Record<string, { remaining: number | null; fetchedAt: number }>>({});
  const [searchBalanceLoading, setSearchBalanceLoading] = useState<Record<string, boolean>>({});
  const [searchBalanceErrors, setSearchBalanceErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('inactive');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<Array<{ id: string; name: string; language?: string; gender?: string }>>([]);
  const [ttsVoicesLoading, setTtsVoicesLoading] = useState(false);
  const [ttsVoicesError, setTtsVoicesError] = useState<string | null>(null);
  const [copiedSecretField, setCopiedSecretField] = useState<string | null>(null);
  const [secretCopyFallback, setSecretCopyFallback] = useState<{ label: string; value: string } | null>(null);
  const secretCopyFallbackRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleTabs = useMemo(
    () => CATEGORY_TABS.filter((item) => (item.value === 'ai' ? canReadAi : canReadPlatform)),
    [canReadAi, canReadPlatform],
  );

  const visibleItems = useMemo(
    () => items
      .filter((item) => String(item.category || '') === category)
      .slice()
      .sort(comparePlatformIntegration),
    [items, category],
  );
  const categoryLabel = useMemo(() => CATEGORY_TABS.find((item) => item.value === category)?.label || '平台', [category]);
  const integrationMetrics = useMemo<AdminMetricItem[]>(() => {
    const activeCount = visibleItems.filter((item) => String(item.status || '') === 'active').length;
    const defaultCount = visibleItems.filter((item) => Boolean(item.isDefault)).length;
    const configurationOnlyCount = visibleItems.filter((item) => integrationCapabilities(item).configurationOnly).length;
    return [
      { key: 'total', label: '服务商', value: visibleItems.length, tone: 'primary' },
      { key: 'active', label: '启用中', value: activeCount, tone: 'success' },
      { key: 'default', label: '默认通道', value: defaultCount, tone: defaultCount ? 'info' : 'default' },
      { key: 'configuration-only', label: '仅配置', value: configurationOnlyCount, tone: configurationOnlyCount ? 'warning' : 'default' },
    ];
  }, [visibleItems]);
  const selected = useMemo(() => items.find((item) => integrationKey(item) === selectedKey) || null, [items, selectedKey]);
  const selectedCapabilities = useMemo(() => integrationCapabilities(selected), [selected]);
  const isAlapi = selected?.category === 'other' && selected?.providerCode === 'alapi';
  const alapiDoutuCallCount = Number((selected?.usage as Record<string, unknown> | undefined)?.doutuCallCount || 0);
  const fields = selected
    ? [
      ...(FIELD_DEFS[integrationKey(selected)] || []),
      ...((selected.category === 'tts' || selected.category === 'stt') ? SPEECH_CLIENT_MODEL_FIELDS : []),
      ...((selected.category === 'tts' || selected.category === 'stt') ? SPEECH_PRICING_FIELDS : []),
    ]
    : [];

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getPlatformIntegrations();
      setItems(result.items || []);
      setRequestOrigin(String(result.requestOrigin || ''));
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canReadPlatform) void load();
    else setItems([]);
  }, [canReadPlatform]);

  useEffect(() => {
    if (!secretCopyFallback) return;
    const timer = window.setTimeout(() => {
      secretCopyFallbackRef.current?.focus();
      secretCopyFallbackRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [secretCopyFallback]);

  const copySecretField = async (key: string, label: string, value: unknown) => {
    const text = String(value ?? '');
    if (!text) return;

    try {
      const copied = await copyTextToClipboard(text);
      if (copied) {
        setCopiedSecretField(key);
        return;
      }
    } catch {
      setSecretCopyFallback({ label, value: text });
      return;
    }

    setSecretCopyFallback({ label, value: text });
  };

  const refreshSearchBalance = async (item: Record<string, unknown>) => {
    const key = integrationKey(item);
    setSearchBalanceLoading((prev) => ({ ...prev, [key]: true }));
    setSearchBalanceErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const result = await adminApi.getPlatformIntegrationBalance(String(item.category || ''), String(item.providerCode || ''));
      const remaining = Number(result.remaining);
      setSearchBalances((prev) => ({
        ...prev,
        [key]: {
          remaining: Number.isFinite(remaining) ? remaining : null,
          fetchedAt: typeof result.fetchedAt === 'number' ? result.fetchedAt : Date.now(),
        },
      }));
      setSearchBalanceErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return result;
    } catch (balanceError) {
      setSearchBalanceErrors((prev) => ({ ...prev, [key]: getAdminErrorMessage(balanceError) }));
      throw balanceError;
    } finally {
      setSearchBalanceLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  useEffect(() => {
    if (category !== 'search' || !canReadPlatform || !visibleItems.length) return;
    for (const item of visibleItems) {
      void refreshSearchBalance(item).catch(() => undefined);
    }
  }, [category, canReadPlatform, visibleItems]);

  useEffect(() => {
    if (searchParams.get('tab') === 'global') {
      navigate('/admin/global-config', { replace: true });
      return;
    }
    const tab = searchParams.get('tab');
    if (visibleTabs.some((item) => item.value === tab) && tab !== category) {
      setCategory(tab as PlatformTab);
      writePersistentUiValue(PLATFORM_TAB_STORAGE_KEY, tab as PlatformTab);
    }
  }, [category, navigate, searchParams, visibleTabs]);

  useEffect(() => {
    if (!visibleTabs.length || visibleTabs.some((item) => item.value === category)) return;
    const nextCategory = visibleTabs[0].value;
    setCategory(nextCategory);
    writePersistentUiValue(PLATFORM_TAB_STORAGE_KEY, nextCategory);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('tab', nextCategory);
    setSearchParams(nextSearchParams, { replace: true });
  }, [category, searchParams, setSearchParams, visibleTabs]);

  const loadTtsVoices = async (providerCode: string) => {
    setTtsVoicesLoading(true);
    setTtsVoicesError(null);
    try {
      const result = await adminApi.getPlatformTtsVoices(providerCode);
      setTtsVoices(result.voices || []);
    } catch (voiceError) {
      setTtsVoices([]);
      setTtsVoicesError(getAdminErrorMessage(voiceError));
    } finally {
      setTtsVoicesLoading(false);
    }
  };

  const openEditor = (item: Record<string, unknown>) => {
    const capabilities = integrationCapabilities(item);
    setSelectedKey(integrationKey(item));
    setStatus(capabilities.runtimeSupported ? String(item.status || 'inactive') : 'inactive');
    setIsDefault(capabilities.runtimeSupported ? Boolean(item.isDefault) : false);
    setEditor(toEditorState(item));
    setTestResult(null);
    setBalanceResult(null);
    setCopiedSecretField(null);
    setEditorOpen(true);
    setTtsVoices([]);
    setTtsVoicesError(null);
    if (String(item.category || '') === 'tts') void loadTtsVoices(String(item.providerCode || ''));
  };

  const buildEditorPayload = () => {
    const config: Record<string, unknown> = {};
    const secrets: Record<string, unknown> = {};
    for (const field of fields) {
      const value = normalizeFieldValue(field, editor[field.key]);
      if (field.secret) secrets[field.key] = value;
      else config[field.key] = value;
    }
    return {
      status,
      isDefault,
      config,
      secrets,
    };
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.updatePlatformIntegration(String(selected.category || ''), String(selected.providerCode || ''), {
        ...buildEditorPayload(),
      });
      await load();
      setEditorOpen(false);
    } catch (saveError) {
      setError(getAdminErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!selected) return;
    setTesting(true);
    setTestResult(null);
    try {
      await adminApi.updatePlatformIntegration(String(selected.category || ''), String(selected.providerCode || ''), {
        ...buildEditorPayload(),
      });
      const result = await adminApi.testPlatformIntegration(
        String(selected.category || ''),
        String(selected.providerCode || ''),
        testDraft,
      );
      await load();
      setTestResult({
        severity: 'success',
        message: String(result.message || '测试成功'),
      });
    } catch (testError) {
      setTestResult({
        severity: 'error',
        message: getAdminErrorMessage(testError),
      });
    } finally {
      setTesting(false);
    }
  };

  const queryBalance = async () => {
    if (!selected) return;
    setBalanceLoading(true);
    setBalanceResult(null);
    try {
      await adminApi.updatePlatformIntegration(String(selected.category || ''), String(selected.providerCode || ''), {
        ...buildEditorPayload(),
      });
      const result = await refreshSearchBalance(selected);
      await load();
      const remaining = Number(result.remaining);
      setBalanceResult({
        severity: 'success',
        message: Number.isFinite(remaining)
          ? `账户余额：${formatCnyAmount(remaining)}`
          : '余额查询成功，但接口未返回可识别的余额',
      });
    } catch (balanceError) {
      setBalanceResult({ severity: 'error', message: getAdminErrorMessage(balanceError) });
    } finally {
      setBalanceLoading(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Tabs
          value={category}
          onChange={(_event, value) => {
            setCategory(value);
            writePersistentUiValue(PLATFORM_TAB_STORAGE_KEY, value);
            setEditorOpen(false);
            setSelectedKey('');
            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.set('tab', value);
            setSearchParams(nextSearchParams, { replace: true });
          }}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {visibleTabs.map((item) => <Tab key={item.value} value={item.value} label={item.label} />)}
        </Tabs>
        {category !== 'ai' && canReadPlatform ? (
          <Button variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={() => void load()}>
            刷新
          </Button>
        ) : null}
      </Stack>
      {category === 'ai' ? (
        canReadAi ? <AdminAIPage /> : <Alert severity="warning">当前管理员没有访问 AI 供应商配置的权限。</Alert>
      ) : (
        <Stack spacing={2}>
          <AdminRequestState loading={loading} error={error} onRetry={() => void load()} />
          <AdminSection title={`${categoryLabel}概览`}>
            <AdminMetricGrid items={integrationMetrics} compact minWidth={132} />
          </AdminSection>
          <AdminSection title={`${categoryLabel}服务商`} subtitle={category === 'captcha' ? '只会使用一个启用且设为默认的验证码通道，点击服务商行可以编辑配置。' : category === 'search' ? '搜索平台用于聊天按需搜索；真实搜索会按后台配置扣除 AI 点数。' : '点击服务商行可以编辑配置、保存并测试。'} bodySx={{ p: 0 }}>
            <AdminTableFrame minWidth={760}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>服务商</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>默认</TableCell>
                    <TableCell>{category === 'search' ? '余额' : '配置概览'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleItems.map((item) => (
                    <TableRow
                      key={integrationKey(item)}
                      hover
                      selected={editorOpen && integrationKey(item) === selectedKey}
                      onClick={() => openEditor(item)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>{String(item.displayName || '')}</Typography>
                          <Typography variant="caption" color="text.secondary">{integrationKey(item)}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Chip size="small" label={statusLabel(item.status)} color={String(item.status || '') === 'active' ? 'success' : 'default'} />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={integrationCapabilities(item).runtimeSupported ? '已接入' : '仅保存配置'}
                            color={integrationCapabilities(item).runtimeSupported ? 'primary' : 'warning'}
                          />
                        </Stack>
                      </TableCell>
                      <TableCell>{item.isDefault ? '是' : '-'}</TableCell>
                      <TableCell>
                        {category === 'search' ? (() => {
                          const key = integrationKey(item);
                          const balance = searchBalances[key];
                          const isBalanceLoading = Boolean(searchBalanceLoading[key]);
                          const balanceError = searchBalanceErrors[key];
                          return (
                            <Stack spacing={0.25} sx={{ minWidth: 140 }}>
                              {balance ? (
                                <>
                                  <Typography variant="body2" sx={{ fontWeight: 800 }}>{formatCnyAmount(balance.remaining)}</Typography>
                                  <Typography variant="caption" color="text.secondary">{new Date(balance.fetchedAt).toLocaleString('zh-CN')}</Typography>
                                </>
                              ) : (
                                <Typography variant="caption" color={balanceError ? 'error' : 'text.secondary'}>{balanceError || (isBalanceLoading ? '查询中' : '未查询')}</Typography>
                              )}
                            </Stack>
                          );
                        })() : (
                          <Typography variant="caption" color="text.secondary">
                            {integrationCapabilities(item).note || Object.keys((item.config as Record<string, unknown>) || {}).slice(0, 4).join(' / ') || '-'}
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!visibleItems.length ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                          暂无可配置服务商。
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </AdminTableFrame>
          </AdminSection>
        </Stack>
      )}

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{selected ? `配置：${String(selected.displayName || '')}` : '配置'}</DialogTitle>
        <DialogContent>
          {selected ? (
            <Stack spacing={1.25} sx={{ pt: 1 }}>
              {selectedCapabilities.configurationOnly ? (
                <Alert severity="warning">
                  {selectedCapabilities.note || '该服务商当前仅保存配置，后端尚未接入真实调用链，不能启用、设为默认或测试。'}
                </Alert>
              ) : (
                <Alert severity="success">
                  {selectedCapabilities.note || '该服务商已接入真实调用链。'}
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <TextField select label="状态" value={status} onChange={(event) => setStatus(event.target.value)} fullWidth>
                  <MenuItem value="active" disabled={!selectedCapabilities.runtimeSupported}>启用</MenuItem>
                  <MenuItem value="inactive">停用</MenuItem>
                </TextField>
                <FormControlLabel
                  control={<Switch checked={isDefault} disabled={!selectedCapabilities.runtimeSupported} onChange={(event) => setIsDefault(event.target.checked)} />}
                  label="设为默认"
                  sx={{ minWidth: 120 }}
                />
              </Stack>
              {selected.category === 'tts' || selected.category === 'stt' ? (() => {
                const unit = selected.category === 'tts' ? '字符' : '秒音频';
                const price = Number(editor.pricePerUnit || 0);
                const multiplier = Number(editor.billingMultiplier || 0);
                const pointValue = Number(editor.pointValueCny || 0);
                const estimatedPoints = price > 0 && multiplier > 0 && pointValue > 0 ? price * multiplier / pointValue : 0;
                return (
                  <Alert severity="info">
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>语音计费</Typography>
                    <Typography variant="body2">按{unit}计费；当前估算 {estimatedPoints.toFixed(4)}P / {unit}。实际扣点 = 上游价格 × 倍率 ÷ 每点价值，并受最低扣点约束。</Typography>
                  </Alert>
                );
              })() : null}
              {fields.filter((field) => !isAlapi || (field.key !== 'doutuEnabled' && field.key !== 'doutuPointCost')).length ? fields.filter((field) => !isAlapi || (field.key !== 'doutuEnabled' && field.key !== 'doutuPointCost')).map((field) => (
                field.key === 'defaultVoice' && String(selected.category || '') === 'tts' ? (
                  <Stack key={field.key} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
                    <Autocomplete
                      freeSolo
                      fullWidth
                      loading={ttsVoicesLoading}
                      options={ttsVoices}
                      value={ttsVoices.find((voice) => voice.id === String(editor[field.key] || '')) || String(editor[field.key] || '') || null}
                      getOptionLabel={(option) => typeof option === 'string' ? option : `${option.name}（${option.id}）`}
                      isOptionEqualToValue={(option, value) => typeof value !== 'string' && option.id === value.id}
                      onChange={(_event, value) => setEditor((prev) => ({ ...prev, [field.key]: typeof value === 'string' ? value : value?.id || '' }))}
                      onInputChange={(_event, value, reason) => {
                        if (reason === 'input') setEditor((prev) => ({ ...prev, [field.key]: value }));
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="默认发音人"
                          required={field.required}
                          placeholder="选择平台音色或直接填写 Voice ID"
                          helperText={ttsVoicesError || (ttsVoicesLoading ? '正在读取当前平台的音色目录…' : '列表来自当前 TTS Provider；也可以直接填写自定义 Voice ID')}
                          error={Boolean(ttsVoicesError)}
                        />
                      )}
                    />
                    <Button variant="outlined" startIcon={<RefreshIcon />} disabled={ttsVoicesLoading || !selected} onClick={() => void loadTtsVoices(String(selected.providerCode || ''))} sx={{ minWidth: 112, height: 56 }}>
                      {ttsVoicesLoading ? '读取中' : '刷新音色'}
                    </Button>
                  </Stack>
                ) : field.type === 'boolean' ? (
                  <FormControlLabel
                    key={field.key}
                    control={<Switch checked={Boolean(editor[field.key])} onChange={(event) => setEditor((prev) => ({ ...prev, [field.key]: event.target.checked }))} />}
                    label={field.label}
                  />
                ) : (() => {
                  const fieldValue = editor[field.key];
                  const effectiveValue = effectiveFieldValue(field, fieldValue);
                  const isUsingDefaultTemplate = !String(fieldValue ?? '').trim() && Boolean(field.defaultTemplate);
                  const usesDomainTemplate = fieldUsesDomainTemplate(effectiveValue);
                  const resolvedUrl = usesDomainTemplate && requestOrigin ? resolveDomainTemplate(effectiveValue, requestOrigin) : '';
                  const textField = (
                    <TextField
                      key={field.key}
                      label={field.label}
                      required={field.required}
                      placeholder={field.placeholder}
                      value={String(fieldValue ?? '')}
                      onChange={(event) => setEditor((prev) => ({ ...prev, [field.key]: event.target.value }))}
                      type={field.type === 'number' ? 'number' : field.secret && !field.multiline ? 'password' : 'text'}
                      multiline={field.multiline}
                      minRows={field.multiline ? 4 : undefined}
                      slotProps={field.secret ? {
                        input: {
                          endAdornment: (
                            <Tooltip title={copiedSecretField === field.key ? '已复制' : '复制'}>
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label={`复制${field.label}`}
                                  disabled={!String(fieldValue ?? '')}
                                  onClick={() => void copySecretField(field.key, field.label, fieldValue)}
                                  edge="end"
                                >
                                  <ContentCopyIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          ),
                        },
                      } : undefined}
                      sx={field.secret && field.multiline ? {
                        '& textarea': { WebkitTextSecurity: 'disc' },
                      } : undefined}
                      helperText={isUsingDefaultTemplate ? '留空时后端会使用默认地址，悬浮查看实际 URL' : usesDomainTemplate ? '悬浮查看后端实际解析后的 URL' : undefined}
                      fullWidth
                    />
                  );
                  return (
                    <Tooltip
                      key={field.key}
                      title={usesDomainTemplate ? (
                        <Stack spacing={0.5}>
                          <Typography variant="caption" sx={{ fontWeight: 800 }}>模板变量解析</Typography>
                          {isUsingDefaultTemplate ? <Typography variant="caption">当前为空，将使用默认模板：{field.defaultTemplate}</Typography> : null}
                          <Typography variant="caption">后端识别域名：{requestOrigin || '未获取到'}</Typography>
                          <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>实际 URL：{resolvedUrl || '无法解析，请检查反向代理 Host/Proto 头'}</Typography>
                        </Stack>
                      ) : ''}
                      placement="top"
                      arrow
                      disableHoverListener={!usesDomainTemplate}
                    >
                      <span>{textField}</span>
                    </Tooltip>
                  );
                })()
              )) : <Alert severity="info">该服务商暂无额外配置项。</Alert>}
              {isAlapi ? (
                <Stack spacing={0.75}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>功能配置</Typography>
                  <AdminTableFrame minWidth={560}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>功能</TableCell>
                          <TableCell>开关</TableCell>
                          <TableCell>单次扣点</TableCell>
                          <TableCell align="right">调用总次数</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell>表情包搜索</TableCell>
                          <TableCell>
                            <Switch
                              size="small"
                              checked={Boolean(editor.doutuEnabled)}
                              onChange={(event) => setEditor((prev) => ({ ...prev, doutuEnabled: event.target.checked }))}
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 148 }}>
                            <TextField
                              size="small"
                              type="number"
                              value={String(editor.doutuPointCost ?? '')}
                              onChange={(event) => setEditor((prev) => ({ ...prev, doutuPointCost: event.target.value }))}
                            />
                          </TableCell>
                          <TableCell align="right">{Number.isFinite(alapiDoutuCallCount) ? alapiDoutuCallCount.toLocaleString('zh-CN') : 0}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </AdminTableFrame>
                  <Typography variant="caption" color="text.secondary">仅成功返回可用图片的搜索会计入次数；保存后立即生效。</Typography>
                </Stack>
              ) : null}
              <Stack spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>连接测试</Typography>
                {selected.category === 'payment' ? (
                  <Alert severity="info">支付测试会生成一组支付宝 Page Pay 请求参数；真实入账仍以订单支付和异步回调为准。</Alert>
                ) : null}
                {selected.category === 'sms' ? (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                    <TextField
                      label="测试手机号"
                      required
                      value={testDraft.phone || ''}
                      onChange={(event) => setTestDraft((prev) => ({ ...prev, phone: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      label="验证码"
                      value={testDraft.code || ''}
                      onChange={(event) => setTestDraft((prev) => ({ ...prev, code: event.target.value }))}
                      sx={{ minWidth: 140 }}
                    />
                  </Stack>
                ) : null}
                {selected.category === 'captcha' ? (
                  <Alert severity="info">验证码服务会在用户发送短信验证码前由真实浏览器触发，请在登录页或换绑手机号流程中验证实际效果。</Alert>
                ) : null}
                {selected.category === 'email' ? (
                  <TextField
                    label="测试收件邮箱"
                    required
                    value={testDraft.to || ''}
                    onChange={(event) => setTestDraft((prev) => ({ ...prev, to: event.target.value }))}
                    fullWidth
                  />
                ) : null}
                {selected.category === 'search' ? (
                  <Stack spacing={1}>
                    <Alert severity="info">聊天按需搜索会在用户会员权益允许时触发；每次成功搜索按“单次搜索扣点”写入 AI 点数流水。</Alert>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
                      <Button variant="outlined" startIcon={<RefreshIcon />} disabled={saving || balanceLoading || !selected} onClick={() => void queryBalance()}>
                        {balanceLoading ? '查询中' : '查询博查余额'}
                      </Button>
                      {balanceResult ? <Alert severity={balanceResult.severity} sx={{ flex: 1 }}>{balanceResult.message}</Alert> : null}
                    </Stack>
                  </Stack>
                ) : null}
                {selectedCapabilities.configurationOnly ? (
                  <Alert severity="warning">{selectedCapabilities.note || '该服务商当前仅保存配置，暂不支持连接测试。'}</Alert>
                ) : null}
                {testResult ? <Alert severity={testResult.severity}>{testResult.message}</Alert> : null}
              </Stack>
            </Stack>
          ) : <Alert severity="info">暂无服务商配置。</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void runTest()} disabled={saving || testing || !selected || !selectedCapabilities.testSupported}>{testing ? '测试中' : '保存并测试'}</Button>
          <Button onClick={() => setEditorOpen(false)} disabled={saving}>取消</Button>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={saving || !selected} onClick={() => void save()}>保存配置</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={Boolean(secretCopyFallback)} onClose={() => setSecretCopyFallback(null)} maxWidth="sm" fullWidth>
        <DialogTitle>手动复制敏感内容</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            当前访问方式不允许网页直接写入系统剪贴板。内容仅在此窗口中临时显示，请按 <strong>Ctrl/Cmd + C</strong> 复制后立即关闭。
          </Alert>
          <TextField
            inputRef={secretCopyFallbackRef}
            label={secretCopyFallback?.label || '敏感内容'}
            value={secretCopyFallback?.value || ''}
            onFocus={(event) => event.target.select()}
            multiline
            minRows={3}
            fullWidth
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSecretCopyFallback(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
