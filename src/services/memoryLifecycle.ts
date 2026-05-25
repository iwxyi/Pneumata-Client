import type { MemoryItem } from './memoryTypes';

const ACTIVE_MEMORY_LIMIT = 32;
const ANCHOR_MEMORY_LIMIT = 16;
const ARCHIVED_MEMORY_LIMIT = 32;
const TOTAL_MEMORY_LIMIT = 80;

function memoryTime(item: MemoryItem) {
  return item.updatedAt || item.distilledAt || item.createdAt || item.archivedAt || 0;
}

function newestFirst(left: MemoryItem, right: MemoryItem) {
  return memoryTime(right) - memoryTime(left);
}

function chronological(left: MemoryItem, right: MemoryItem) {
  return memoryTime(left) - memoryTime(right);
}

export function isColdArchiveMemory(item: MemoryItem) {
  return Boolean(item.archivedAt);
}

export function isMemoryAnchorCandidate(item: MemoryItem) {
  if (isColdArchiveMemory(item)) return false;
  if (item.layer !== 'long_term') return false;
  return item.origin === 'distilled' || item.reinforcementCount >= 3 || item.salience >= 0.78 || item.confidence >= 0.86;
}

function archiveMemoryItem(item: MemoryItem, now: number): MemoryItem {
  return {
    ...item,
    recency: Math.min(item.recency, 0.35),
    archivedAt: item.archivedAt || now,
  };
}

export function compactMemoryItems(items: MemoryItem[], now = Date.now()) {
  const active = items.filter((item) => !isColdArchiveMemory(item));
  const archived = items.filter(isColdArchiveMemory);
  const anchors = active.slice().sort(newestFirst).filter(isMemoryAnchorCandidate).slice(0, ANCHOR_MEMORY_LIMIT);
  const anchorIds = new Set(anchors.map((item) => item.id));
  const activeRecent = active
    .filter((item) => !anchorIds.has(item.id))
    .sort(newestFirst)
    .slice(0, ACTIVE_MEMORY_LIMIT);
  const activeRecentIds = new Set(activeRecent.map((item) => item.id));
  const overflowArchive = active
    .filter((item) => !anchorIds.has(item.id) && !activeRecentIds.has(item.id))
    .map((item) => archiveMemoryItem(item, now));
  const coldArchive = [...archived, ...overflowArchive]
    .sort(newestFirst)
    .slice(0, ARCHIVED_MEMORY_LIMIT);

  return [...anchors, ...activeRecent, ...coldArchive]
    .sort(chronological)
    .slice(-TOTAL_MEMORY_LIMIT);
}
