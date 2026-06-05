export interface SyncDiffPreviewItem {
  field: string;
  value: string;
}

interface PendingPatchLike {
  patch?: Record<string, unknown>;
}

const HIDDEN_FIELDS = new Set(['updatedAt', 'fieldVersions']);

function compactPreviewValue(value: unknown, max = 96) {
  if (value == null) return 'null';
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '""';
    return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  } catch {
    return String(value);
  }
}

export function buildPatchDiffPreview(patch: Record<string, unknown> | undefined, options: { maxFields?: number; maxValueLength?: number } = {}): SyncDiffPreviewItem[] {
  const maxFields = options.maxFields ?? 8;
  const maxValueLength = options.maxValueLength ?? 96;
  return Object.entries(patch || {})
    .filter(([field]) => !HIDDEN_FIELDS.has(field))
    .slice(0, maxFields)
    .map(([field, value]) => ({
      field,
      value: compactPreviewValue(value, maxValueLength),
    }));
}

export function buildOperationsDiffPreview(operations: PendingPatchLike[], options: { maxFields?: number; maxValueLength?: number } = {}) {
  const byField = new Map<string, SyncDiffPreviewItem>();
  for (const operation of operations) {
    for (const item of buildPatchDiffPreview(operation.patch, options)) {
      byField.set(item.field, item);
    }
  }
  return Array.from(byField.values()).slice(0, options.maxFields ?? 8);
}

