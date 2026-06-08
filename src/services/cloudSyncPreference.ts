import { storageKey } from '../constants/brand';

const CLOUD_SYNC_ENABLED_KEY = storageKey('cloud-sync-enabled');

export function isCloudSyncEnabled() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(CLOUD_SYNC_ENABLED_KEY) !== '0';
}

export function setCloudSyncEnabled(enabled: boolean) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CLOUD_SYNC_ENABLED_KEY, enabled ? '1' : '0');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pneumata-cloud-sync-preference-changed', { detail: { enabled } }));
  }
}
