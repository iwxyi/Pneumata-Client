import { storageKey } from '../constants/brand';

export const AUTH_SESSION_EXPIRED_EVENT = 'pneumata:auth-session-expired';

const LAST_CLOUD_PHONE_KEY = storageKey('last-cloud-phone');
const AUTH_USER_KEY = storageKey('user');
const AUTH_TOKEN_KEY = storageKey('token');
const AUTH_MODE_KEY = storageKey('auth-mode');
const AUTH_EXPIRED_DISPATCH_THROTTLE_MS = 1500;

let lastAuthExpiredDispatchAt = 0;

export interface AuthSessionExpiredDetail {
  from?: string;
  status?: number;
  refreshStatus?: number;
  path?: string;
  reason?: 'access_token_rejected' | 'refresh_token_missing' | 'refresh_rejected' | 'refresh_network_error' | 'refresh_response_invalid' | 'unknown';
  diagnostic?: string;
}

function hasActiveCloudSession() {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(AUTH_MODE_KEY) === 'cloud' && Boolean(localStorage.getItem(AUTH_TOKEN_KEY));
}

export function rememberLastCloudPhone(phone?: string | null) {
  const normalized = (phone || '').trim();
  if (!normalized || typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_CLOUD_PHONE_KEY, normalized);
}

export function getLastCloudPhone() {
  if (typeof localStorage === 'undefined') return '';
  const remembered = localStorage.getItem(LAST_CLOUD_PHONE_KEY) || '';
  if (remembered) return remembered;
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    const phone = raw ? (JSON.parse(raw) as { phone?: unknown }).phone : null;
    return typeof phone === 'string' ? phone : '';
  } catch {
    return '';
  }
}

export function dispatchAuthSessionExpired(detail: AuthSessionExpiredDetail = {}) {
  if (typeof window === 'undefined') return;
  if (!hasActiveCloudSession()) return;
  const now = Date.now();
  if (now - lastAuthExpiredDispatchAt < AUTH_EXPIRED_DISPATCH_THROTTLE_MS) return;
  lastAuthExpiredDispatchAt = now;
  const eventDetail: AuthSessionExpiredDetail = {
    from: detail.from || `${window.location.pathname}${window.location.search}${window.location.hash}`,
    status: detail.status,
    refreshStatus: detail.refreshStatus,
    path: detail.path,
    reason: detail.reason || 'access_token_rejected',
    diagnostic: detail.diagnostic,
  };
  // Keep the user-facing message generic, but leave a safe, actionable reason
  // in the console. Tokens and response bodies are intentionally excluded.
  console.warn('[auth] cloud session expired', {
    reason: eventDetail.reason,
    status: eventDetail.status,
    refreshStatus: eventDetail.refreshStatus,
    diagnostic: eventDetail.diagnostic,
  });
  window.dispatchEvent(new CustomEvent<AuthSessionExpiredDetail>(AUTH_SESSION_EXPIRED_EVENT, {
    detail: eventDetail,
  }));
}
