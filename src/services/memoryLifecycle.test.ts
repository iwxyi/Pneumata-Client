import { describe, expect, it } from 'vitest';
import { compactMemoryItems, isMemoryAnchorCandidate } from './memoryLifecycle';
import type { MemoryItem } from './memoryTypes';

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: overrides.id || 'memory-1',
    scope: overrides.scope || 'relationship',
    layer: overrides.layer || 'long_term',
    kind: overrides.kind || 'bond',
    ownerId: overrides.ownerId || 'char-a',
    subjectIds: overrides.subjectIds || ['char-b'],
    text: overrides.text || '甲记住了一段重要关系。',
    salience: overrides.salience ?? 0.6,
    confidence: overrides.confidence ?? 0.7,
    recency: overrides.recency ?? 0.2,
    reinforcementCount: overrides.reinforcementCount ?? 1,
    sourceEventIds: overrides.sourceEventIds || ['event-1'],
    sourceTag: overrides.sourceTag || 'memory_distillation',
    origin: overrides.origin || 'runtime',
    createdAt: overrides.createdAt || 1,
    updatedAt: overrides.updatedAt || 1,
    archivedAt: overrides.archivedAt ?? null,
    ...overrides,
  };
}

describe('memoryLifecycle', () => {
  it('uses one anchor-candidate rule for lifecycle and presentation', () => {
    expect(isMemoryAnchorCandidate(memory({ layer: 'episodic', origin: 'distilled', salience: 0.95 }))).toBe(false);
    expect(isMemoryAnchorCandidate(memory({ layer: 'long_term', archivedAt: 10, origin: 'distilled' }))).toBe(false);
    expect(isMemoryAnchorCandidate(memory({ layer: 'long_term', confidence: 0.88, origin: 'runtime' }))).toBe(true);
  });

  it('preserves heavier old anchors before newer weaker anchor candidates', () => {
    const oldHeavyAnchor = memory({
      id: 'old-heavy-anchor',
      text: '甲把乙在雨夜失约这件事当作长期旧伤。',
      origin: 'distilled',
      salience: 0.97,
      confidence: 0.96,
      reinforcementCount: 8,
      recency: 0.12,
      createdAt: 1,
      updatedAt: 1,
    });
    const newerWeakAnchors = Array.from({ length: 18 }, (_, index) => memory({
      id: `new-weak-anchor-${index}`,
      text: `新近形成但还很轻的长期印象 ${index}`,
      origin: 'distilled',
      salience: 0.42,
      confidence: 0.52,
      reinforcementCount: 1,
      recency: 0.95,
      createdAt: 100 + index,
      updatedAt: 100 + index,
    }));
    const recentOrdinaryMemories = Array.from({ length: 40 }, (_, index) => memory({
      id: `recent-ordinary-${index}`,
      layer: 'episodic',
      text: `新近普通流水记忆 ${index}`,
      origin: 'runtime',
      salience: 0.35,
      confidence: 0.45,
      reinforcementCount: 1,
      recency: 0.98,
      createdAt: 1000 + index,
      updatedAt: 1000 + index,
    }));

    const result = compactMemoryItems([oldHeavyAnchor, ...newerWeakAnchors, ...recentOrdinaryMemories], 2000);
    const retainedHeavy = result.find((item) => item.id === oldHeavyAnchor.id);
    const activeWeakAnchors = result.filter((item) => item.id.startsWith('new-weak-anchor') && !item.archivedAt);

    expect(retainedHeavy).toBeTruthy();
    expect(retainedHeavy?.archivedAt).toBeFalsy();
    expect(activeWeakAnchors.length).toBeLessThan(newerWeakAnchors.length);
    expect(result.some((item) => item.id.startsWith('new-weak-anchor') && item.archivedAt)).toBe(true);
  });
});
