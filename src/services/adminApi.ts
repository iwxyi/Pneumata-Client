import { ApiError } from './api';

const ADMIN_BASE = '/admin';
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${ADMIN_BASE}${path}`, {
      method,
      headers: this.getHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '请求失败' }));
      if (response.status === 401 || response.status === 403) {
        this.setToken(null);
        this.notifyAuthRequired();
      }
      throw new ApiError(error.error || `HTTP ${response.status}`, { status: response.status, code: error.code });
    }
    return response.json();
  }

  private buildQuery(params: Record<string, string | undefined>) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
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

  getAiEntitlement(userId: string) {
    return this.request<{ entitlement: Record<string, unknown> | null; keys: Array<Record<string, unknown>> }>('GET', `/ai/entitlements${this.buildQuery({ userId })}`);
  }

  getAiBalance(userId: string) {
    return this.request<Record<string, unknown>>('GET', `/ai/entitlements/${encodeURIComponent(userId)}/balance`);
  }

  updateAiEntitlement(userId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/ai/entitlements/${encodeURIComponent(userId)}`, payload);
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
