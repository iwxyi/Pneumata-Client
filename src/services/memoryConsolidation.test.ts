import { describe, expect, it } from 'vitest';
import type { MemoryCandidate } from './memoryTypes';
import { consolidateMemoryCandidates } from './memoryConsolidation';

function buildInteractionCandidate(index: number): MemoryCandidate {
  return {
    scope: 'relationship',
    layerHint: 'episodic',
    kind: 'resentment',
    ownerId: 'char-a',
    subjectIds: ['char-a', 'char-b'],
    text: `对 乙 的关系倾向：表现出挑衅、防备、嘲弄或不满；证据 ${index}`,
    sourceEventIds: [`interaction-${index}`],
    sourceTag: 'interaction',
    scoreBreakdown: { stability: 0.65, recurrence: 0.55, impact: 0.8, specificity: 0.7, durability: 0.65 },
  };
}

describe('consolidateMemoryCandidates', () => {
  it('does not promote raw interaction evidence to long-term memory directly', () => {
    const memories = [1, 2, 3, 4, 5].reduce(
      (items, index) => consolidateMemoryCandidates(items, [buildInteractionCandidate(index)]),
      [] as ReturnType<typeof consolidateMemoryCandidates>,
    );

    expect(memories[0]?.reinforcementCount).toBe(5);
    expect(memories[0]?.layer).toBe('episodic');
  });
});
