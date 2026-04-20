import type { MemoryCandidate, MemoryItem } from './memoryTypes';

function scoreCandidate(candidate: MemoryCandidate) {
  const s = candidate.scoreBreakdown;
  return s.stability * 0.25 + s.recurrence * 0.2 + s.impact * 0.25 + s.specificity * 0.15 + s.durability * 0.15;
}

function sameBucket(item: MemoryItem, candidate: MemoryCandidate) {
  const sameSubjects = JSON.stringify(item.subjectIds || []) === JSON.stringify(candidate.subjectIds || []);
  return item.scope === candidate.scope && item.kind === candidate.kind && item.ownerId === candidate.ownerId && sameSubjects;
}

export function consolidateMemoryCandidates(existing: MemoryItem[], candidates: MemoryCandidate[]) {
  const next = [...existing];
  const now = Date.now();

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (score < 0.55) continue;

    const existingIndex = next.findIndex((item) => sameBucket(item, candidate));
    if (existingIndex >= 0) {
      const item = next[existingIndex];
      next[existingIndex] = {
        ...item,
        text: candidate.text.length >= item.text.length ? candidate.text : item.text,
        salience: Math.max(item.salience, score),
        confidence: Math.min(1, (item.confidence || 0.5) + 0.08),
        recency: 1,
        reinforcementCount: item.reinforcementCount + 1,
        sourceEventIds: Array.from(new Set([...item.sourceEventIds, ...candidate.sourceEventIds])).slice(-8),
        updatedAt: now,
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
      createdAt: now,
      updatedAt: now,
      lastActivatedAt: null,
      archivedAt: null,
    });
  }

  return next.slice(-24);
}
