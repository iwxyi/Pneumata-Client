import { storageKey } from '../../constants/brand';

export const DETAIL_COLLAPSED_STORAGE_KEY = storageKey('master-detail-detail-collapsed');
export const DETAIL_COLLAPSED_CHANGE_EVENT = 'pneumata-master-detail-detail-collapsed-change';

export function readDetailCollapsedState() {
  return typeof localStorage !== 'undefined' && localStorage.getItem(DETAIL_COLLAPSED_STORAGE_KEY) === '1';
}

export function writeDetailCollapsedState(collapsed: boolean) {
  localStorage.setItem(DETAIL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  window.dispatchEvent(new CustomEvent(DETAIL_COLLAPSED_CHANGE_EVENT, { detail: { collapsed } }));
}
