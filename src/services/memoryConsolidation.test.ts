import { describe, expect, it } from 'vitest';
import type { MemoryCandidate } from './memoryTypes';
import { consolidateMemoryCandidates } from './memoryConsolidation';

function buildInteractionCandidate(index: number, subjectIds = ['char-a', 'char-b']): MemoryCandidate {
  return {
    scope: 'relationship',
    layerHint: 'episodic',
    kind: 'resentment',
    ownerId: 'char-a',
    subjectIds,
    text: `对 乙 的关系倾向：表现出挑衅、防备、嘲弄或不满；证据 ${index}`,
    sourceEventIds: [`interaction-${index}`],
    sourceTag: 'interaction',
    scoreBreakdown: { stability: 0.65, recurrence: 0.55, impact: 0.8, specificity: 0.7, durability: 0.65 },
  };
}

function buildDistilledCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    scope: 'relationship',
    layerHint: 'long_term',
    kind: 'resentment',
    ownerId: 'char-a',
    subjectIds: ['char-a', 'char-b'],
    text: '乙长期让甲感到被轻视，但这种戒备开始从玩笑升级为稳定印象。',
    sourceEventIds: ['llm-1'],
    sourceTag: 'llm_memory_relationship_imprint',
    origin: 'distilled',
    decision: 'revise',
    scoreBreakdown: { stability: 0.9, recurrence: 0.8, impact: 0.85, specificity: 0.85, durability: 0.95 },
    ...overrides,
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

  it('revises an existing memory when a distilled candidate updates the interpretation', () => {
    const initial = consolidateMemoryCandidates([], [buildInteractionCandidate(1)]);
    const revised = consolidateMemoryCandidates(initial, [buildDistilledCandidate()]);

    expect(revised).toHaveLength(1);
    expect(revised[0]?.text).toContain('稳定印象');
    expect(revised[0]?.origin).toBe('distilled');
    expect(revised[0]?.sourceEventIds).toEqual(expect.arrayContaining(['interaction-1', 'llm-1']));
  });

  it('merges a related memory with overlapping subjects instead of appending another item', () => {
    const existing = consolidateMemoryCandidates([], [
      buildDistilledCandidate({
        text: '甲对乙保持戒备。',
        sourceEventIds: ['old-1'],
        subjectIds: ['char-a', 'char-b'],
        decision: 'create',
      }),
    ]);
    const merged = consolidateMemoryCandidates(existing, [
      buildDistilledCandidate({
        text: '甲把乙的多次调侃整合成一种稳定的被轻视感。',
        sourceEventIds: ['new-1'],
        subjectIds: ['char-b'],
        decision: 'merge',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toContain('被轻视感');
    expect(merged[0]?.sourceEventIds).toEqual(expect.arrayContaining(['old-1', 'new-1']));
  });

  it('archives matching memories when the analysis decides the thread is no longer active', () => {
    const existing = consolidateMemoryCandidates([], [buildDistilledCandidate({ decision: 'create' })]);
    const archived = consolidateMemoryCandidates(existing, [
      buildDistilledCandidate({
        text: '这条旧关系线已经被新的长期结论吸收。',
        decision: 'archive',
      }),
    ]);

    expect(archived[0]?.archivedAt).toBeTruthy();
  });

  it('keeps overflow memories as cold archive instead of dropping them outright', () => {
    const memories = Array.from({ length: 46 }, (_, index) => index + 1).reduce(
      (items, index) => consolidateMemoryCandidates(items, [
        buildInteractionCandidate(index, [`char-a`, `char-${index}`]),
      ]),
      [] as ReturnType<typeof consolidateMemoryCandidates>,
    );

    expect(memories.length).toBeGreaterThan(32);
    expect(memories.some((item) => item.archivedAt)).toBe(true);
  });

  it('keeps distilled long-term anchors active while older ordinary memories cool down', () => {
    const withAnchor = consolidateMemoryCandidates([], [
      buildDistilledCandidate({
        text: '乙对甲造成过一次很重的公开羞辱，这成了甲之后回避乙的长期锚点。',
        sourceEventIds: ['anchor-1'],
        subjectIds: ['char-a', 'char-anchor'],
        decision: 'create',
      }),
    ]);
    const memories = Array.from({ length: 46 }, (_, index) => index + 1).reduce(
      (items, index) => consolidateMemoryCandidates(items, [
        buildInteractionCandidate(index, [`char-a`, `char-${index}`]),
      ]),
      withAnchor,
    );
    const anchor = memories.find((item) => item.sourceEventIds.includes('anchor-1'));

    expect(anchor).toBeTruthy();
    expect(anchor?.archivedAt).toBeFalsy();
  });
});
