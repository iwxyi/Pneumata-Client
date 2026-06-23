import { storageKey } from '../constants/brand';

export const AUTH_SESSION_EXPIRED_EVENT = 'pneumata:auth-session-expired';

const LAST_CLOUD_PHONE_KEY = storageKey('last-cloud-phone');
const AUTH_USER_KEY = storageKey('user');
const AUTH_EXPIRED_DISPATCH_THROTTLE_MS = 1500;

let lastAuthExpiredDispatchAt = 0;

export interface AuthSessionExpiredDetail {
  from?: string;
  status?: number;
  path?: string;
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
  const now = Date.now();
  if (now - lastAuthExpiredDispatchAt < AUTH_EXPIRED_DISPATCH_THROTTLE_MS) return;
  lastAuthExpiredDispatchAt = now;
  window.dispatchEvent(new CustomEvent<AuthSessionExpiredDetail>(AUTH_SESSION_EXPIRED_EVENT, {
    detail: {
      from: detail.from || `${window.location.pathname}${window.location.search}${window.location.hash}`,
      status: detail.status,
      path: detail.path,
    },
  }));
}
