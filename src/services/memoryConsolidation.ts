import type { MemoryCandidate, MemoryItem } from './memoryTypes';
import { sanitizeMemoryText } from './distillationText';

const MAX_TRACKED_SOURCE_EVENT_IDS = 32;

function scoreCandidate(candidate: MemoryCandidate) {
  const s = candidate.scoreBreakdown;
  return s.stability * 0.25 + s.recurrence * 0.2 + s.impact * 0.25 + s.specificity * 0.15 + s.durability * 0.15;
}

function normalizeIds(ids: string[] = []) {
  return [...ids].filter(Boolean).sort();
}

function sameBucket(item: MemoryItem, candidate: MemoryCandidate) {
  const sameSubjects = JSON.stringify(normalizeIds(item.subjectIds || [])) === JSON.stringify(normalizeIds(candidate.subjectIds || []));
  return item.scope === candidate.scope && item.kind === candidate.kind && item.ownerId === candidate.ownerId && sameSubjects;
}

function sameOwnerScope(item: MemoryItem, candidate: MemoryCandidate) {
  return item.scope === candidate.scope && item.ownerId === candidate.ownerId;
}

function findMergeTargetIndex(items: MemoryItem[], candidate: MemoryCandidate) {
  const sameBucketIndex = items.findIndex((item) => sameBucket(item, candidate));
  if (sameBucketIndex >= 0) return sameBucketIndex;
  if (candidate.decision !== 'merge') return -1;
  const candidateSubjects = new Set(candidate.subjectIds || []);
  return items.findIndex((item) => {
    if (!sameOwnerScope(item, candidate)) return false;
    if (item.kind !== candidate.kind) return false;
    if (!candidateSubjects.size) return true;
    return (item.subjectIds || []).some((id) => candidateSubjects.has(id));
  });
}

function shouldArchiveByCandidate(item: MemoryItem, candidate: MemoryCandidate) {
  if (candidate.decision !== 'archive') return false;
  return sameBucket(item, candidate) || (
    sameOwnerScope(item, candidate)
    && item.kind === candidate.kind
    && normalizeIds(item.subjectIds || []).some((id) => normalizeIds(candidate.subjectIds || []).includes(id))
  );
}

function nextLayerForCandidate(candidate: MemoryCandidate, reinforcementCount: number) {
  if (candidate.origin !== 'distilled' && candidate.sourceTag === 'interaction') {
    return reinforcementCount >= 4 ? 'episodic' as const : candidate.layerHint;
  }
  if (candidate.layerHint === 'working' && reinforcementCount >= 2) return 'episodic' as const;
  if (candidate.layerHint === 'episodic' && reinforcementCount >= 3) return 'long_term' as const;
  return candidate.layerHint;
}

function decayExistingMemory(item: MemoryItem): MemoryItem {
  return {
    ...item,
    recency: Math.max(0.1, item.recency * 0.92),
    archivedAt: item.recency < 0.12 && item.layer === 'working' ? (item.archivedAt || Date.now()) : item.archivedAt,
  };
}

function hasNovelSourceEvidence(item: MemoryItem, candidate: MemoryCandidate) {
  const current = new Set(item.sourceEventIds || []);
  return (candidate.sourceEventIds || []).some((id) => id && !current.has(id));
}

function shouldRefreshUpdatedAt(item: MemoryItem, candidate: MemoryCandidate) {
  if (candidate.origin === 'distilled') return true;
  return hasNovelSourceEvidence(item, candidate);
}

function mergeSourceEventIds(item: MemoryItem, candidate: MemoryCandidate) {
  return Array.from(new Set([...(item.sourceEventIds || []), ...(candidate.sourceEventIds || [])])).slice(-MAX_TRACKED_SOURCE_EVENT_IDS);
}

function mergeDistilledFromIds(item: MemoryItem, candidate: MemoryCandidate) {
  return Array.from(new Set([...(item.distilledFromIds || []), ...(candidate.distilledFromIds || [])])).slice(-24);
}

function createMemoryItem(candidate: MemoryCandidate, score: number, now: number): MemoryItem {
  const text = sanitizeMemoryText(candidate.text);
  return {
    id: `${candidate.ownerId}-${candidate.kind}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    scope: candidate.scope,
    layer: candidate.layerHint,
    kind: candidate.kind,
    ownerId: candidate.ownerId,
    subjectIds: candidate.subjectIds || [],
    relatedConversationId: null,
    text,
    evidenceText: candidate.evidenceText,
    salience: score,
    confidence: 0.7,
    recency: 1,
    reinforcementCount: 1,
    sourceEventIds: candidate.sourceEventIds,
    sourceTag: candidate.sourceTag || null,
    origin: candidate.origin || 'runtime',
    distilledFromIds: candidate.distilledFromIds || [],
    distilledAt: candidate.distilledAt || null,
    distillationVersion: candidate.distillationVersion || null,
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: null,
    archivedAt: null,
  };
}

function mergeMemoryItem(item: MemoryItem, candidate: MemoryCandidate, score: number, now: number): MemoryItem {
  const candidateText = sanitizeMemoryText(candidate.text);
  const refresh = shouldRefreshUpdatedAt(item, candidate);
  const reinforcementCount = refresh ? item.reinforcementCount + 1 : item.reinforcementCount;
  const shouldRewriteText = candidate.origin === 'distilled'
    || candidate.decision === 'revise'
    || candidate.decision === 'merge'
    || candidateText.length >= item.text.length;
  return {
    ...item,
    text: shouldRewriteText ? candidateText : item.text,
    evidenceText: candidate.evidenceText || item.evidenceText,
    salience: Math.max(item.salience, score),
    confidence: refresh ? Math.min(1, (item.confidence || 0.5) + 0.08) : item.confidence,
    recency: refresh ? 1 : Math.max(item.recency, 0.88),
    reinforcementCount,
    layer: nextLayerForCandidate(candidate, reinforcementCount),
    sourceEventIds: mergeSourceEventIds(item, candidate),
    sourceTag: candidate.sourceTag || item.sourceTag || null,
    origin: candidate.origin || item.origin || 'runtime',
    distilledFromIds: mergeDistilledFromIds(item, candidate),
    distilledAt: candidate.distilledAt || item.distilledAt || null,
    distillationVersion: candidate.distillationVersion || item.distillationVersion || null,
    updatedAt: refresh ? now : item.updatedAt,
    archivedAt: null,
  };
}

export function consolidateMemoryCandidates(existing: MemoryItem[], candidates: MemoryCandidate[]) {
  const next = existing.map((item) => decayExistingMemory(item));
  const now = Date.now();

  for (const candidate of candidates) {
    if (candidate.decision === 'ignore') continue;
    if (candidate.decision === 'archive') {
      next.forEach((item, index) => {
        if (shouldArchiveByCandidate(item, candidate)) {
          next[index] = { ...item, archivedAt: item.archivedAt || now, updatedAt: now };
        }
      });
      continue;
    }
    const score = scoreCandidate(candidate);
    if (score < 0.55) continue;

    const existingIndex = findMergeTargetIndex(next, candidate);
    if (existingIndex >= 0) {
      next[existingIndex] = mergeMemoryItem(next[existingIndex], candidate, score, now);
      continue;
    }

    next.push(createMemoryItem(candidate, score, now));
  }

  return next.slice(-24);
}
