import { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import AdminDetailCard from '../../components/admin/AdminDetailCard';
import AdminResponsiveTable from '../../components/admin/AdminResponsiveTable';
import AdminRequestState, { getAdminErrorMessage } from '../../components/admin/AdminRequestState';
import { adminApi } from '../../services/adminApi';

type QuotaPackageForm = {
  code: string;
  name: string;
  points: string;
  price: string;
  dailyQuota: string;
  monthlyQuota: string;
};

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

function formatBalance(balance: Record<string, unknown> | null) {
  const raw = balance?.availableBalance ?? balance?.available_balance;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return '未获取';
  return `${raw}P`;
}

export default function AdminAIProviderPage() {
  const { providerCode: routeProviderCode } = useParams();
  const providerCode = routeProviderCode || 'api2d';
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
  });
  const [loadedSecrets, setLoadedSecrets] = useState({ adminToken: '', forwardKey: '' });
  const [quotaPackages, setQuotaPackages] = useState<QuotaPackageForm[]>([]);
  const [keys, setKeys] = useState<Array<Record<string, unknown>>>([]);
  const [keySearch, setKeySearch] = useState({ typeId: '', keyword: '' });
  const [keyCreate, setKeyCreate] = useState({ typeId: '', note: '', grantAmount: '', dailyQuota: '', monthlyQuota: '' });
  const [keyAction, setKeyAction] = useState({ externalKeyId: '', dailyQuota: '', monthlyQuota: '', minuteTimes: '', note: '', enabled: true });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);
  const [accountBalance, setAccountBalance] = useState<Record<string, unknown> | null>(null);
  const [accountBalanceLoading, setAccountBalanceLoading] = useState(false);
  const [accountBalanceError, setAccountBalanceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

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
      });
      setQuotaPackages(Array.isArray(config.quotaPackages) ? (config.quotaPackages as Array<Record<string, unknown>>).map(toPackageForm) : []);
      if (config.forwardKeyConfigured) void loadAccountBalance();
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
  }, [providerCode]);

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
        <Tab label="Key 查询" />
      </Tabs>
      <AdminRequestState loading={loading || saving || keyLoading} error={error || keyError} onRetry={tab === 0 ? () => void loadConfig() : () => void loadKeys()} />

      {tab === 0 ? (
        <Stack spacing={1.25}>
          <AdminDetailCard title="主账号配置">
            <Stack spacing={1.25}>
              <Alert severity={providerConfig?.adminTokenConfigured ? 'success' : 'warning'}>
                管理 Token：{providerConfig?.adminTokenConfigured ? String(providerConfig.adminToken || '') : '未配置'}
              </Alert>
              <Alert severity={providerConfig?.forwardKeyConfigured ? 'success' : 'warning'}>
                主账号 ForwardKey：{providerConfig?.forwardKeyConfigured ? String(providerConfig.forwardKey || '') : '未配置'}
              </Alert>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.25}
                sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">主账号总余额</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                    {accountBalanceLoading ? '查询中' : formatBalance(accountBalance)}
                  </Typography>
                  {accountBalanceError ? <Typography variant="caption" color="error">{accountBalanceError}</Typography> : null}
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => void loadAccountBalance()}
                  disabled={!providerConfig?.forwardKeyConfigured || accountBalanceLoading}
                >
                  刷新余额
                </Button>
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <TextField label="名称" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} fullWidth />
                <TextField select label="状态" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} sx={{ minWidth: 140 }}>
                  <MenuItem value="active">启用</MenuItem>
                  <MenuItem value="inactive">停用</MenuItem>
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <TextField label="AI 调用 Base URL" value={form.baseUrl} onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))} fullWidth />
                <TextField
                  label="管理 API Base URL"
                  value={form.adminBaseUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, adminBaseUrl: e.target.value }))}
                  helperText="API2D 开发者计划 custom_key 管理接口，例如 https://api.api2d.com"
                  fullWidth
                />
              </Stack>
                <TextField
                  label="API2D 主账号管理 Token（不是模型调用 Key）"
                  value={form.adminToken}
                  onChange={(e) => setForm((prev) => ({ ...prev, adminToken: e.target.value }))}
                  fullWidth
                />
                <TextField
                  label="API2D 主账号 ForwardKey（用于余额查询）"
                  value={form.forwardKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, forwardKey: e.target.value }))}
                  fullWidth
                />
              </Stack>
          </AdminDetailCard>

          <AdminDetailCard title="新用户自动分配 Key">
            <Stack spacing={1.25}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <FormControlLabel control={<Switch checked={form.autoProvisionEnabled} onChange={(e) => setForm((prev) => ({ ...prev, autoProvisionEnabled: e.target.checked }))} />} label="新用户自动生成 Key" />
                <TextField
                  label="默认 Key 分组 ID"
                  value={form.defaultKeyTypeId}
                  onChange={(e) => setForm((prev) => ({ ...prev, defaultKeyTypeId: e.target.value }))}
                  helperText={providerCode === 'api2d' ? '填写 custom_key_type/search 返回的数字 id，例如 1219，不要带 CK 前缀' : undefined}
                />
                <TextField label="默认点数" value={form.defaultGrantAmount} onChange={(e) => setForm((prev) => ({ ...prev, defaultGrantAmount: e.target.value }))} />
              </Stack>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25}>
                <TextField label="每日重置额度" value={form.defaultDailyQuota} onChange={(e) => setForm((prev) => ({ ...prev, defaultDailyQuota: e.target.value }))} />
                <TextField label="每月最高额度（0 表示不限制）" value={form.defaultMonthlyQuota} onChange={(e) => setForm((prev) => ({ ...prev, defaultMonthlyQuota: e.target.value }))} />
              </Stack>
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
                    <TableCell>{String(item.point ?? '')}</TableCell>
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
