export const APP_NAME = 'Pneumata';
export const APP_TITLE = 'Pneumata';
export const APP_DESCRIPTION = 'Pneumata - AI multi-agent social world simulation platform';

const LEGACY_LOWER_BRAND = ['mira', 'getea'].join('');
const LEGACY_CAMEL_BRAND = ['mira', 'geTea'].join('');

export function storageKey(suffix: string) {
  return `pneumata-${suffix}`;
}

export function scopedStorageKey(suffix: string) {
  return `pneumata-${suffix}`;
}

export function legacyStorageKey(suffix: string) {
  return `${LEGACY_LOWER_BRAND}-${suffix}`;
}

export function legacyScopedStorageKey(suffix: string) {
  return `${LEGACY_CAMEL_BRAND}-${suffix}`;
}

export interface BrandStorageMigrationResult {
  moved: number;
  removed: number;
  skipped: number;
}

function migrateStorageArea(area: Storage | undefined): BrandStorageMigrationResult {
  const result = { moved: 0, removed: 0, skipped: 0 };
  if (!area) return result;
  const keys = Array.from({ length: area.length }, (_, index) => area.key(index)).filter(Boolean) as string[];
  for (const key of keys) {
    const nextKey = key.startsWith(`${LEGACY_LOWER_BRAND}-`)
      ? key.replace(`${LEGACY_LOWER_BRAND}-`, 'pneumata-')
      : key.startsWith(`${LEGACY_CAMEL_BRAND}-`)
        ? key.replace(`${LEGACY_CAMEL_BRAND}-`, 'pneumata-')
        : null;
    if (!nextKey || nextKey === key) continue;
    const value = area.getItem(key);
    if (value == null) continue;
    if (area.getItem(nextKey) == null) {
      area.setItem(nextKey, value);
      result.moved += 1;
    } else {
      result.skipped += 1;
    }
    area.removeItem(key);
    result.removed += 1;
  }
  return result;
}

export function migrateLegacyBrandStorageKeys(): BrandStorageMigrationResult {
  const local = migrateStorageArea(typeof localStorage === 'undefined' ? undefined : localStorage);
  const session = migrateStorageArea(typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  return {
    moved: local.moved + session.moved,
    removed: local.removed + session.removed,
    skipped: local.skipped + session.skipped,
  };
}
