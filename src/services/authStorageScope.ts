import { storageKey } from '../constants/brand';

const AUTH_TOKEN_KEY = storageKey('token');
const AUTH_USER_KEY = storageKey('user');
const AUTH_MODE_KEY = storageKey('auth-mode');
const LAST_CLOUD_USER_ID_KEY = storageKey('last-cloud-user-id');

export function rememberCloudUserId(user: { id?: string | null } | null | undefined) {
  if (!user?.id || typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_CLOUD_USER_ID_KEY, user.id);
}

export function getStoredAuthUserId() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    const id = raw ? (JSON.parse(raw) as { id?: unknown }).id : null;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export function getLocalDataUserId() {
  if (typeof localStorage === 'undefined') return 'guest';
  const currentUserId = getStoredAuthUserId();
  if (currentUserId) return currentUserId;
  const authMode = localStorage.getItem(AUTH_MODE_KEY);
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const lastCloudUserId = localStorage.getItem(LAST_CLOUD_USER_ID_KEY);
  if ((token || authMode === 'cloud') && lastCloudUserId) return lastCloudUserId;
  return 'guest';
}
