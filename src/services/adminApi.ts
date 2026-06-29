import { ApiError } from './api';

const ADMIN_BASE = '/api/admin';
const ADMIN_TOKEN_KEY = 'pneumata-admin-token';
const ADMIN_LOGIN_EVENT = 'pneumata-admin-auth-required';

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roleCodes: string[];
  permissions: string[];
};

class AdminApiClient {
  getToken() {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  }

  setToken(token: string | null) {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  }

  notifyAuthRequired() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(ADMIN_LOGIN_EVENT, {
      detail: { from: `${window.location.pathname}${window.location.search}${window.location.hash}` },
    }));
  }

  private getHeaders() {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    }
    const text = await response.text().catch(() => '');
    const normalized = text.trimStart().toLowerCase();
    const isHtml = normalized.startsWith('<!doctype') || normalized.startsWith('<html');
    throw new ApiError(
      isHtml ? '后台接口返回了前端页面，请检查后端服务或开发代理配置' : '后台接口返回了非 JSON 响应',
      { status: response.status, code: 'INVALID_ADMIN_API_RESPONSE' },
    );
  }

  private async parseErrorResponse(response: Response): Promise<{ error: string; code?: string }> {
    try {
      const error = await this.parseJsonResponse<{ error?: string; code?: string; detail?: string }>(response);
      const detail = typeof error.detail === 'string' && error.detail ? `（${error.detail}）` : '';
      return {
        error: `${error.error || `HTTP ${response.status}`}${detail}`,
        code: error.code,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return { error: `${error.message}（HTTP ${response.status}）`, code: error.code };
      }
      return { error: `后台请求失败（HTTP ${response.status}）` };
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${ADMIN_BASE}${path}`, {
        method,
        headers: this.getHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (requestError) {
      console.error('Admin API network error', { method, path, error: requestError });
      throw new ApiError('无法连接后台接口，请检查后端服务或开发代理配置', { code: 'ADMIN_API_NETWORK_ERROR' });
    }
    if (!response.ok) {
      const error = await this.parseErrorResponse(response);
      console.error('Admin API request failed', {
        method,
        path,
        status: response.status,
        error: error.error,
        code: error.code,
      });
      if (response.status === 401) {
        this.setToken(null);
        this.notifyAuthRequired();
      }
      throw new ApiError(error.error, { status: response.status, code: error.code });
    }
    return this.parseJsonResponse<T>(response);
  }

  private buildQuery(params: Record<string, string | number | undefined>) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const encoded = query.toString();
    return encoded ? `?${encoded}` : '';
  }

  login(email: string, password: string) {
    return this.request<{ token: string; admin: AdminUser }>('POST', '/auth/login', { email, password });
  }

  me() {
    return this.request<AdminUser>('GET', '/auth/me');
  }

  getDashboardStats() {
    return this.request<{ metrics: Record<string, number>; recentOrders: Array<Record<string, unknown>>; recentReviews: Array<Record<string, unknown>>; recentAudits: Array<Record<string, unknown>> }>('GET', '/dashboard/stats');
  }

  getUsers(search = '') {
    return this.request<{ items: Array<{ id: string; phone: string; nickname: string; avatar: string; created_at: number; updated_at: number }> }>('GET', `/users${this.buildQuery({ search })}`);
  }

  getUser(userId: string) {
    return this.request<Record<string, unknown>>('GET', `/users/${encodeURIComponent(userId)}`);
  }

  getAiProviders() {
    return this.request<{ items: Array<Record<string, unknown>>; runtime: Array<Record<string, unknown>> }>('GET', '/ai/providers');
  }

  getAiProviderConfig(providerCode: string) {
    return this.request<Record<string, unknown>>('GET', `/ai/providers/${encodeURIComponent(providerCode)}/config`);
  }

  getAiProviderAccountBalance(providerCode: string) {
    return this.request<Record<string, unknown>>('POST', `/ai/providers/${encodeURIComponent(providerCode)}/account-balance`);
  }

  getAiProviderPublicModels(providerCode: string, params?: { search?: string; page?: number; limit?: number; all?: boolean }) {
    return this.request<{ items: Array<Record<string, unknown>>; page: number; limit: number; total: number }>('GET', `/ai/providers/${encodeURIComponent(providerCode)}/public-models${this.buildQuery({ search: params?.search, page: params?.page, limit: params?.limit, all: params?.all ? 'true' : undefined })}`);
  }

  updateAiProviderConfig(providerCode: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/ai/providers/${encodeURIComponent(providerCode)}/config`, payload);
  }

  getAiProviderKeys(providerCode: string, params?: { typeId?: string; keyword?: string }) {
    return this.request<{ items: Array<Record<string, unknown>>; raw?: Record<string, unknown> }>('GET', `/ai/providers/${encodeURIComponent(providerCode)}/keys${this.buildQuery({ typeId: params?.typeId, keyword: params?.keyword })}`);
  }

  createAiProviderKey(providerCode: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('POST', `/ai/providers/${encodeURIComponent(providerCode)}/keys`, payload);
  }

  updateAiProviderKey(providerCode: string, externalKeyId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/ai/providers/${encodeURIComponent(providerCode)}/keys/${encodeURIComponent(externalKeyId)}`, payload);
  }

  transferAiProviderKeyPoints(providerCode: string, externalKeyId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('POST', `/ai/providers/${encodeURIComponent(providerCode)}/keys/${encodeURIComponent(externalKeyId)}/points`, payload);
  }

  getAiProviderUserBalances(providerCode: string, params?: { search?: string; page?: number; limit?: number }) {
    return this.request<{ items: Array<Record<string, unknown>>; page: number; limit: number; total: number }>('GET', `/ai/providers/${encodeURIComponent(providerCode)}/user-balances${this.buildQuery({ search: params?.search, page: params?.page, limit: params?.limit })}`);
  }

  getAiProviderUserUsage(providerCode: string, userId: string, params?: { invocationPage?: number; invocationLimit?: number; ledgerPage?: number; ledgerLimit?: number }) {
    return this.request<{
      user: Record<string, unknown>;
      invocations: Array<Record<string, unknown>>;
      totals: Record<string, unknown>;
      invocationsPage?: Record<string, unknown>;
      quotaLedger: Array<Record<string, unknown>>;
      quotaLedgerPage?: Record<string, unknown>;
      monthly?: Array<Record<string, unknown>>;
    }>('GET', `/ai/providers/${encodeURIComponent(providerCode)}/users/${encodeURIComponent(userId)}/usage${this.buildQuery({
      invocationPage: params?.invocationPage,
      invocationLimit: params?.invocationLimit,
      ledgerPage: params?.ledgerPage,
      ledgerLimit: params?.ledgerLimit,
    })}`);
  }

  getAiProviderUsageStats(providerCode: string, params?: {
    userId?: string;
    groupBy?: string;
    from?: number;
    to?: number;
    usageType?: string;
    model?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    return this.request<{
      providerCode: string;
      groupBy: string;
      page: number;
      limit: number;
      total: number;
      totals: Record<string, unknown>;
      items: Array<Record<string, unknown>>;
    }>('GET', `/ai/providers/${encodeURIComponent(providerCode)}/usage-stats${this.buildQuery({
      userId: params?.userId,
      groupBy: params?.groupBy,
      from: params?.from,
      to: params?.to,
      usageType: params?.usageType,
      model: params?.model,
      status: params?.status,
      search: params?.search,
      page: params?.page,
      limit: params?.limit,
    })}`);
  }

  transferAiProviderUserPoints(providerCode: string, userId: string, payload: { amount: number }) {
    return this.request<Record<string, unknown>>('POST', `/ai/providers/${encodeURIComponent(providerCode)}/users/${encodeURIComponent(userId)}/points`, payload);
  }

  getAiEntitlement(userId: string) {
    return this.request<{ entitlement: Record<string, unknown> | null; keys: Array<Record<string, unknown>>; quotaLedger?: Array<Record<string, unknown>> }>('GET', `/ai/entitlements${this.buildQuery({ userId })}`);
  }

  getAiBalance(userId: string) {
    return this.request<Record<string, unknown>>('GET', `/ai/entitlements/${encodeURIComponent(userId)}/balance`);
  }

  updateAiEntitlement(userId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/ai/entitlements/${encodeURIComponent(userId)}`, payload);
  }

  createAiUserKey(userId: string, providerCode = 'api2d') {
    return this.request<Record<string, unknown>>('POST', `/ai/entitlements/${encodeURIComponent(userId)}/keys/auto`, { providerCode });
  }

  setAiUserKey(userId: string, payload: { providerCode?: string; apiKey: string; externalKeyId?: string; isPrimary?: boolean }) {
    return this.request<Record<string, unknown>>('POST', `/ai/entitlements/${encodeURIComponent(userId)}/keys/manual`, payload);
  }

  updateAiUserKeySecret(userId: string, providerKeyId: string, payload: { apiKey: string; externalKeyId?: string }) {
    return this.request<Record<string, unknown>>('PUT', `/ai/entitlements/${encodeURIComponent(userId)}/keys/${encodeURIComponent(providerKeyId)}/secret`, payload);
  }

  updateAiUserKeyStatus(userId: string, providerKeyId: string, payload: { enabled?: boolean; status?: string }) {
    return this.request<Record<string, unknown>>('PUT', `/ai/entitlements/${encodeURIComponent(userId)}/keys/${encodeURIComponent(providerKeyId)}/status`, payload);
  }

  updateAiUserKeyLimits(userId: string, providerKeyId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/ai/entitlements/${encodeURIComponent(userId)}/keys/${encodeURIComponent(providerKeyId)}/limits`, payload);
  }

  transferAiUserKeyPoints(userId: string, providerKeyId: string, payload: { amount: number }) {
    return this.request<Record<string, unknown>>('POST', `/ai/entitlements/${encodeURIComponent(userId)}/keys/${encodeURIComponent(providerKeyId)}/points`, payload);
  }

  getAiUserKeyUsage(userId: string, providerKeyId: string) {
    return this.request<{ invocations: Array<Record<string, unknown>>; quotaLedger: Array<Record<string, unknown>> }>('GET', `/ai/entitlements/${encodeURIComponent(userId)}/keys/${encodeURIComponent(providerKeyId)}/usage`);
  }

  getAuditLogs(params?: { action?: string; result?: string }) {
    return this.request<{ items: Array<Record<string, unknown>> }>('GET', `/audit${this.buildQuery({ action: params?.action, result: params?.result })}`);
  }

  getNotificationTemplates() {
    return this.request<{ items: Array<Record<string, unknown>> }>('GET', '/notifications/templates');
  }

  getNotificationJobs(params?: { status?: string; channel?: string }) {
    return this.request<{ items: Array<Record<string, unknown>> }>('GET', `/notifications/jobs${this.buildQuery({ status: params?.status, channel: params?.channel })}`);
  }

  getOrders(params?: { status?: string; userId?: string }) {
    return this.request<{ items: Array<Record<string, unknown>> }>('GET', `/billing/orders${this.buildQuery({ status: params?.status, userId: params?.userId })}`);
  }

  markOrderPaid(orderId: string, payload?: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('POST', `/billing/orders/${encodeURIComponent(orderId)}/pay`, payload || {});
  }

  getShareReviewCases(params?: { status?: string; ownerUserId?: string }) {
    return this.request<{ items: Array<Record<string, unknown>> }>('GET', `/moderation/shares${this.buildQuery({ status: params?.status, ownerUserId: params?.ownerUserId })}`);
  }

  claimShareReviewCase(caseId: string) {
    return this.request<Record<string, unknown>>('POST', `/moderation/shares/${encodeURIComponent(caseId)}/claim`, {});
  }

  decideShareReviewCase(caseId: string, decision: 'approved' | 'rejected' | 'escalated', reason: string) {
    return this.request<Record<string, unknown>>('POST', `/moderation/shares/${encodeURIComponent(caseId)}/decision`, { decision, reason });
  }

  getUserRestrictions(userId: string) {
    return this.request<{ items: Array<Record<string, unknown>> }>('GET', `/risk/users/${encodeURIComponent(userId)}/restrictions`);
  }

  upsertUserRestriction(userId: string, restrictionType: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/risk/users/${encodeURIComponent(userId)}/restrictions/${encodeURIComponent(restrictionType)}`, payload);
  }
}

export const adminApi = new AdminApiClient();
export { ADMIN_LOGIN_EVENT, ADMIN_TOKEN_KEY };
