import { scopedStorageKey } from '../constants/brand';

export function readPersistentUiValue<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(scopedStorageKey(key));
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writePersistentUiValue<T>(key: string, value: T) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(scopedStorageKey(key), JSON.stringify(value));
  } catch {
    // Ignore storage failures so UI controls keep working in private modes.
  }
}
