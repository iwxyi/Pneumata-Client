import type { MemoryCandidate, MemoryItem } from './memoryTypes';

function scoreCandidate(candidate: MemoryCandidate) {
  const s = candidate.scoreBreakdown;
  return s.stability * 0.25 + s.recurrence * 0.2 + s.impact * 0.25 + s.specificity * 0.15 + s.durability * 0.15;
}

function sameBucket(item: MemoryItem, candidate: MemoryCandidate) {
  const sameSubjects = JSON.stringify(item.subjectIds || []) === JSON.stringify(candidate.subjectIds || []);
  return item.scope === candidate.scope && item.kind === candidate.kind && item.ownerId === candidate.ownerId && sameSubjects;
}

function nextLayerForCandidate(candidate: MemoryCandidate, reinforcementCount: number) {
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

export function consolidateMemoryCandidates(existing: MemoryItem[], candidates: MemoryCandidate[]) {
  const next = existing.map((item) => decayExistingMemory(item));
  const now = Date.now();

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (score < 0.55) continue;

    const existingIndex = next.findIndex((item) => sameBucket(item, candidate));
    if (existingIndex >= 0) {
      const item = next[existingIndex];
      const reinforcementCount = item.reinforcementCount + 1;
      next[existingIndex] = {
        ...item,
        text: candidate.text.length >= item.text.length || candidate.origin === 'distilled' ? candidate.text : item.text,
        salience: Math.max(item.salience, score),
        confidence: Math.min(1, (item.confidence || 0.5) + 0.08),
        recency: 1,
        reinforcementCount,
        layer: nextLayerForCandidate(candidate, reinforcementCount),
        sourceEventIds: Array.from(new Set([...item.sourceEventIds, ...candidate.sourceEventIds])).slice(-8),
        sourceTag: candidate.sourceTag || item.sourceTag || null,
        origin: candidate.origin || item.origin || 'runtime',
        distilledFromIds: Array.from(new Set([...(item.distilledFromIds || []), ...(candidate.distilledFromIds || [])])).slice(-12),
        distilledAt: candidate.distilledAt || item.distilledAt || null,
        distillationVersion: candidate.distillationVersion || item.distillationVersion || null,
        updatedAt: now,
        archivedAt: null,
      };
      continue;
    }

    next.push({
      id: `${candidate.ownerId}-${candidate.kind}-${now}-${Math.random().toString(36).slice(2, 8)}`,
      scope: candidate.scope,
      layer: candidate.layerHint,
      kind: candidate.kind,
      ownerId: candidate.ownerId,
      subjectIds: candidate.subjectIds || [],
      relatedConversationId: null,
      text: candidate.text,
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
    });
  }

  return next.slice(-24);
}
