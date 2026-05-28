import type { MemoryItem } from './memoryTypes';

const RUNTIME_EVIDENCE_SOURCE_TAGS = new Set([
  'room_shift',
  'relationship_delta',
  'emotional_state',
  'personality_drift',
]);

export function isRuntimeEvidenceMemory(item: MemoryItem) {
  if (item.scope === 'system_runtime') return true;
  if (item.layer === 'working' && item.origin !== 'distilled') return true;
  if (item.sourceTag && RUNTIME_EVIDENCE_SOURCE_TAGS.has(item.sourceTag) && (
    item.origin !== 'distilled'
    || item.sourceTag === 'emotional_state'
    || item.sourceTag === 'personality_drift'
  )) return true;
  return false;
}

export function isUserFacingMemoryItem(item: MemoryItem) {
  if (item.archivedAt) return false;
  return !isRuntimeEvidenceMemory(item);
}
