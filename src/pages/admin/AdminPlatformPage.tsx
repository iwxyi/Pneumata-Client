import { useEffect, useMemo, useState } from 'react';
import SaveIcon from '@mui/icons-material/Save';
import { Alert, Button, Chip, FormControlLabel, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Switch, Typography } from '@mui/material';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

type FieldDef = {
  key: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  type?: 'text' | 'number' | 'boolean';
};

const CATEGORY_TABS = [
  { value: 'payment', label: '支付' },
  { value: 'sms', label: '短信' },
  { value: 'email', label: '邮箱' },
] as const;

const FIELD_DEFS: Record<string, FieldDef[]> = {
  'payment:alipay': [
    { key: 'appId', label: 'App ID' },
    { key: 'gatewayUrl', label: '网关地址' },
    { key: 'notifyUrl', label: '异步通知地址' },
    { key: 'returnUrl', label: '支付完成返回地址' },
    { key: 'productCode', label: '产品码' },
    { key: 'signType', label: '签名方式' },
    { key: 'appPrivateKey', label: '应用私钥', secret: true, multiline: true },
    { key: 'alipayPublicKey', label: '支付宝公钥', secret: true, multiline: true },
  ],
  'payment:manual': [
    { key: 'note', label: '说明' },
  ],
  'sms:aliyun': [
    { key: 'endpoint', label: '接口地址' },
    { key: 'regionId', label: 'Region ID' },
    { key: 'signName', label: '短信签名' },
    { key: 'templateCodeLogin', label: '登录模板 Code' },
    { key: 'templateCodeRegister', label: '注册模板 Code' },
    { key: 'templateCodeForgotPassword', label: '找回密码模板 Code' },
    { key: 'templateCodeChangePhone', label: '换绑手机号模板 Code' },
    { key: 'templateParamName', label: '验证码参数名' },
    { key: 'accessKeyId', label: 'AccessKey ID', secret: true },
    { key: 'accessKeySecret', label: 'AccessKey Secret', secret: true },
  ],
  'sms:mock': [
    { key: 'code', label: '固定验证码' },
  ],
  'email:smtp': [
    { key: 'host', label: 'SMTP Host' },
    { key: 'port', label: 'SMTP 端口', type: 'number' },
    { key: 'secure', label: 'SSL/TLS', type: 'boolean' },
    { key: 'fromEmail', label: '发件邮箱' },
    { key: 'fromName', label: '发件名称' },
    { key: 'username', label: '用户名', secret: true },
    { key: 'password', label: '密码/授权码', secret: true },
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

export default function AdminPlatformPage() {
  const [category, setCategory] = useState<'payment' | 'sms' | 'email'>('payment');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [editor, setEditor] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState('inactive');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleItems = useMemo(() => items.filter((item) => String(item.category || '') === category), [items, category]);
  const selected = useMemo(() => visibleItems.find((item) => integrationKey(item) === selectedKey) || visibleItems[0] || null, [selectedKey, visibleItems]);
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

  useEffect(() => {
    if (!selected) return;
    setSelectedKey(integrationKey(selected));
    setStatus(String(selected.status || 'inactive'));
    setIsDefault(Boolean(selected.isDefault));
    setEditor(toEditorState(selected));
  }, [selected?.id]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const config: Record<string, unknown> = {};
      const secrets: Record<string, unknown> = {};
      for (const field of fields) {
        const value = normalizeFieldValue(field, editor[field.key]);
        if (field.secret) secrets[field.key] = value;
        else config[field.key] = value;
      }
      await adminApi.updatePlatformIntegration(String(selected.category || ''), String(selected.providerCode || ''), {
        status,
        isDefault,
        config,
        secrets,
      });
      await load();
    } catch (saveError) {
      setError(getAdminErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Tabs value={category} onChange={(_event, value) => setCategory(value)} variant="scrollable" allowScrollButtonsMobile>
        {CATEGORY_TABS.map((item) => <Tab key={item.value} value={item.value} label={item.label} />)}
      </Tabs>
      <AdminRequestState loading={loading} error={error} onRetry={() => void load()} />
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Stack spacing={1.25} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <AdminResponsiveTable minWidth={720}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>服务商</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>默认</TableCell>
                  <TableCell>配置概览</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleItems.map((item) => (
                  <TableRow key={integrationKey(item)} hover selected={integrationKey(item) === selectedKey}>
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
                    <TableCell align="right">
                      <Button size="small" onClick={() => setSelectedKey(integrationKey(item))}>编辑</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AdminResponsiveTable>
        </Stack>

        <AdminDetailCard title={selected ? `配置：${String(selected.displayName || '')}` : '配置'}>
          {selected ? (
            <Stack spacing={1.25} sx={{ width: { xs: '100%', lg: 460 } }}>
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
                    value={String(editor[field.key] ?? '')}
                    onChange={(event) => setEditor((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    type={field.type === 'number' ? 'number' : field.secret && !field.multiline ? 'password' : 'text'}
                    multiline={field.multiline}
                    minRows={field.multiline ? 4 : undefined}
                    fullWidth
                  />
                )
              )) : <Alert severity="info">该服务商暂无额外配置项。</Alert>}
              <Button variant="contained" startIcon={<SaveIcon />} disabled={saving} onClick={() => void save()}>保存配置</Button>
            </Stack>
          ) : <Alert severity="info">暂无服务商配置。</Alert>}
        </AdminDetailCard>
      </Stack>
    </Stack>
  );
}
