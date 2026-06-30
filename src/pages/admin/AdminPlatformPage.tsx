import { useEffect, useMemo, useState } from 'react';
import SaveIcon from '@mui/icons-material/Save';
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Switch, Typography } from '@mui/material';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

type FieldDef = {
  key: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  type?: 'text' | 'number' | 'boolean';
  required?: boolean;
};

const CATEGORY_TABS = [
  { value: 'payment', label: '支付' },
  { value: 'sms', label: '短信' },
  { value: 'email', label: '邮箱' },
] as const;

const PROVIDER_POPULARITY: Record<string, number> = {
  'payment:alipay': 10,
  'payment:wechatpay': 20,
  'payment:aggregate': 30,
  'payment:epay': 40,
  'payment:payjs': 50,
  'payment:hupijiao': 60,
  'payment:manual': 90,
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
};

const FIELD_DEFS: Record<string, FieldDef[]> = {
  'payment:alipay': [
    { key: 'appId', label: 'App ID', required: true },
    { key: 'gatewayUrl', label: '网关地址' },
    { key: 'notifyUrl', label: '异步通知地址' },
    { key: 'returnUrl', label: '支付完成返回地址' },
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
};

function integrationKey(item: Record<string, unknown>) {
  return `${String(item.category || '')}:${String(item.providerCode || '')}`;
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

function toEditorState(item: Record<string, unknown>) {
  const state: Record<string, unknown> = {};
  const fields = FIELD_DEFS[integrationKey(item)] || [];
  for (const field of fields) state[field.key] = valueFrom(item, field) ?? '';
  return state;
}

function statusLabel(value: unknown) {
  return String(value || '') === 'active' ? '启用' : '停用';
}

function sortGroup(item: Record<string, unknown>) {
  if (Boolean(item.isDefault)) return 0;
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

export default function AdminPlatformPage() {
  const [category, setCategory] = useState<'payment' | 'sms' | 'email'>('payment');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<Record<string, unknown>>({});
  const [testDraft, setTestDraft] = useState<Record<string, string>>({ phone: '', code: '123456', to: '' });
  const [testResult, setTestResult] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);
  const [status, setStatus] = useState('inactive');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => items
      .filter((item) => String(item.category || '') === category)
      .slice()
      .sort(comparePlatformIntegration),
    [items, category],
  );
  const selected = useMemo(() => items.find((item) => integrationKey(item) === selectedKey) || null, [items, selectedKey]);
  const fields = selected ? FIELD_DEFS[integrationKey(selected)] || [] : [];

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.getPlatformIntegrations();
      setItems(result.items || []);
    } catch (loadError) {
      setError(getAdminErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openEditor = (item: Record<string, unknown>) => {
    setSelectedKey(integrationKey(item));
    setStatus(String(item.status || 'inactive'));
    setIsDefault(Boolean(item.isDefault));
    setEditor(toEditorState(item));
    setTestResult(null);
    setEditorOpen(true);
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

  return (
    <Stack spacing={2}>
      <Tabs
        value={category}
        onChange={(_event, value) => {
          setCategory(value);
          setEditorOpen(false);
          setSelectedKey('');
        }}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {CATEGORY_TABS.map((item) => <Tab key={item.value} value={item.value} label={item.label} />)}
      </Tabs>
      <AdminRequestState loading={loading} error={error} onRetry={() => void load()} />
      <AdminResponsiveTable minWidth={760}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>服务商</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>默认</TableCell>
              <TableCell>配置概览</TableCell>
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
                  <Chip size="small" label={statusLabel(item.status)} color={String(item.status || '') === 'active' ? 'success' : 'default'} />
                </TableCell>
                <TableCell>{item.isDefault ? '是' : '-'}</TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {Object.keys((item.config as Record<string, unknown>) || {}).slice(0, 4).join(' / ') || '-'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminResponsiveTable>

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{selected ? `配置：${String(selected.displayName || '')}` : '配置'}</DialogTitle>
        <DialogContent>
          {selected ? (
            <Stack spacing={1.25} sx={{ pt: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <TextField select label="状态" value={status} onChange={(event) => setStatus(event.target.value)} fullWidth>
                  <MenuItem value="active">启用</MenuItem>
                  <MenuItem value="inactive">停用</MenuItem>
                </TextField>
                <FormControlLabel
                  control={<Switch checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />}
                  label="设为默认"
                  sx={{ minWidth: 120 }}
                />
              </Stack>
              {fields.length ? fields.map((field) => (
                field.type === 'boolean' ? (
                  <FormControlLabel
                    key={field.key}
                    control={<Switch checked={Boolean(editor[field.key])} onChange={(event) => setEditor((prev) => ({ ...prev, [field.key]: event.target.checked }))} />}
                    label={field.label}
                  />
                ) : (
                  <TextField
                    key={field.key}
                    label={field.label}
                    required={field.required}
                    value={String(editor[field.key] ?? '')}
                    onChange={(event) => setEditor((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    type={field.type === 'number' ? 'number' : field.secret && !field.multiline ? 'password' : 'text'}
                    multiline={field.multiline}
                    minRows={field.multiline ? 4 : undefined}
                    fullWidth
                  />
                )
              )) : <Alert severity="info">该服务商暂无额外配置项。</Alert>}
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
                {selected.category === 'email' ? (
                  <TextField
                    label="测试收件邮箱"
                    required
                    value={testDraft.to || ''}
                    onChange={(event) => setTestDraft((prev) => ({ ...prev, to: event.target.value }))}
                    fullWidth
                  />
                ) : null}
                {testResult ? <Alert severity={testResult.severity}>{testResult.message}</Alert> : null}
              </Stack>
            </Stack>
          ) : <Alert severity="info">暂无服务商配置。</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void runTest()} disabled={saving || testing || !selected}>{testing ? '测试中' : '保存并测试'}</Button>
          <Button onClick={() => setEditorOpen(false)} disabled={saving}>取消</Button>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={saving || !selected} onClick={() => void save()}>保存配置</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
