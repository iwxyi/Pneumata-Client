import type { MemoryCandidate, MemoryEvidenceEntry, MemoryItem } from './memoryTypes';
import { sanitizeMemoryText } from './distillationText';
import { compactMemoryItems } from './memoryLifecycle';

const MAX_TRACKED_SOURCE_EVENT_IDS = 32;
const MAX_EVIDENCE_TRAIL_ITEMS = 8;

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

function normalizeEvidenceText(text: string | undefined) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => sanitizeMemoryText(line))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function evidenceEntryKey(entry: MemoryEvidenceEntry) {
  return normalizeEvidenceText(entry.text);
}

function scoreEvidenceEntry(entry: MemoryEvidenceEntry, index: number, total: number) {
  const weight = typeof entry.weight === 'number' && Number.isFinite(entry.weight) ? entry.weight : 0.6;
  const recencyBias = total > 1 ? index / (total - 1) * 0.08 : 0.08;
  return weight + recencyBias;
}

function candidateEvidenceEntry(candidate: MemoryCandidate, candidateText: string, score: number, now: number): MemoryEvidenceEntry | null {
  const text = normalizeEvidenceText(candidate.evidenceText || candidateText);
  if (!text) return null;
  return {
    text,
    sourceEventIds: candidate.sourceEventIds || [],
    sourceTag: candidate.sourceTag || null,
    origin: candidate.origin || 'runtime',
    memoryText: candidateText,
    weight: Math.max(0.1, Math.min(1, score)),
    createdAt: now,
    updatedAt: now,
  };
}

function existingPrimaryEvidenceEntry(item: MemoryItem): MemoryEvidenceEntry | null {
  const text = normalizeEvidenceText(item.evidenceText);
  if (!text) return null;
  return {
    text,
    sourceEventIds: item.sourceEventIds || [],
    sourceTag: item.sourceTag || null,
    origin: item.origin || 'runtime',
    memoryText: item.text,
    weight: Math.max(0.1, Math.min(1, item.salience || item.confidence || 0.6)),
    createdAt: item.updatedAt || item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
  };
}

function compactEvidenceTrail(entries: Array<MemoryEvidenceEntry | null | undefined>) {
  const byText = new Map<string, MemoryEvidenceEntry>();
  entries.forEach((entry) => {
    if (!entry) return;
    const text = normalizeEvidenceText(entry.text);
    if (!text) return;
    const normalized: MemoryEvidenceEntry = {
      ...entry,
      text,
      sourceEventIds: Array.from(new Set(entry.sourceEventIds || [])).slice(-MAX_TRACKED_SOURCE_EVENT_IDS),
    };
    const key = evidenceEntryKey(normalized);
    const existing = byText.get(key);
    if (!existing) {
      byText.set(key, normalized);
      return;
    }
    byText.set(key, {
      ...existing,
      ...normalized,
      sourceEventIds: Array.from(new Set([...(existing.sourceEventIds || []), ...(normalized.sourceEventIds || [])])).slice(-MAX_TRACKED_SOURCE_EVENT_IDS),
      weight: Math.max(existing.weight || 0, normalized.weight || 0),
      createdAt: Math.min(existing.createdAt || normalized.createdAt || 0, normalized.createdAt || existing.createdAt || 0) || undefined,
      updatedAt: Math.max(existing.updatedAt || 0, normalized.updatedAt || 0) || existing.updatedAt || normalized.updatedAt,
    });
  });
  const values = Array.from(byText.values());
  return values
    .map((entry, index) => ({ entry, score: scoreEvidenceEntry(entry, index, values.length) }))
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
      return (right.entry.updatedAt || right.entry.createdAt || 0) - (left.entry.updatedAt || left.entry.createdAt || 0);
    })
    .slice(0, MAX_EVIDENCE_TRAIL_ITEMS)
    .map(({ entry }) => entry);
}

function createMemoryItem(candidate: MemoryCandidate, score: number, now: number): MemoryItem {
  const text = sanitizeMemoryText(candidate.text);
  const evidenceText = normalizeEvidenceText(candidate.evidenceText || text);
  return {
    id: `${candidate.ownerId}-${candidate.kind}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    scope: candidate.scope,
    layer: candidate.layerHint,
    kind: candidate.kind,
    ownerId: candidate.ownerId,
    subjectIds: candidate.subjectIds || [],
    relatedConversationId: null,
    text,
    evidenceText,
    evidenceTrail: compactEvidenceTrail([candidateEvidenceEntry(candidate, text, score, now)]),
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
  const nextText = shouldRewriteText ? candidateText : item.text;
  const nextEvidenceText = shouldRewriteText
    ? normalizeEvidenceText(candidate.evidenceText || candidateText)
    : normalizeEvidenceText(candidate.evidenceText || item.evidenceText);
  return {
    ...item,
    text: nextText,
    evidenceText: nextEvidenceText,
    evidenceTrail: compactEvidenceTrail([
      ...(item.evidenceTrail || []),
      existingPrimaryEvidenceEntry(item),
      candidateEvidenceEntry(candidate, candidateText, score, now),
    ]),
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

  return compactMemoryItems(next, now);
}
