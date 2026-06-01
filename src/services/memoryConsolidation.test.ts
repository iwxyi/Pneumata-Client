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

  it('does not keep stale evidence when a rewritten memory has no separate evidence field', () => {
    const existing = consolidateMemoryCandidates([], [
      buildDistilledCandidate({
        text: '甲对乙保持戒备；证据是近期发言“旧证据”。',
        evidenceText: '旧证据',
        sourceEventIds: ['old-1'],
        decision: 'create',
      }),
    ]);
    const merged = consolidateMemoryCandidates(existing, [
      buildDistilledCandidate({
        text: '甲对乙开始愿意配合；证据是近期发言“新证据”。',
        evidenceText: undefined,
        sourceEventIds: ['new-1'],
        decision: 'revise',
      }),
    ]);

    expect(merged[0]?.text).toContain('新证据');
    expect(merged[0]?.evidenceText).toContain('新证据');
    expect(merged[0]?.evidenceText).not.toContain('旧证据');
  });

  it('keeps old evidence in a bounded evidence trail without replacing the primary evidence', () => {
    const existing = consolidateMemoryCandidates([], [
      buildDistilledCandidate({
        text: '甲对乙保持戒备。',
        evidenceText: '旧证据：甲被乙顶撞后保持距离。',
        sourceEventIds: ['old-1'],
        decision: 'create',
      }),
    ]);
    const merged = consolidateMemoryCandidates(existing, [
      buildDistilledCandidate({
        text: '甲对乙的戒备开始松动，愿意在具体事务上配合。',
        evidenceText: '新证据：甲主动接住乙的提议。',
        sourceEventIds: ['new-1'],
        decision: 'revise',
      }),
    ]);

    expect(merged[0]?.evidenceText).toBe('新证据：甲主动接住乙的提议。');
    expect(merged[0]?.evidenceTrail?.map((item) => item.text)).toEqual(expect.arrayContaining([
      '旧证据：甲被乙顶撞后保持距离。',
      '新证据：甲主动接住乙的提议。',
    ]));
    expect(merged[0]?.evidenceTrail?.length).toBeLessThanOrEqual(8);
  });

  it('preserves separate evidence lines when creating a distilled memory', () => {
    const created = consolidateMemoryCandidates([], [
      buildDistilledCandidate({
        text: '甲对乙保持戒备。',
        evidenceText: '1. 乙公开反驳甲。\n2. 甲绕开乙做决定。',
        decision: 'create',
      }),
    ]);

    expect(created[0]?.evidenceText).toContain('\n');
    expect(created[0]?.evidenceTrail?.[0]?.text).toContain('\n');
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

  it('drops malformed candidates with invalid score schema', () => {
    const malformed = {
      ...buildInteractionCandidate(1),
      scoreBreakdown: {
        stability: Number.NaN,
        recurrence: 0.55,
        impact: 0.8,
        specificity: 0.7,
        durability: 0.65,
      },
    } as MemoryCandidate;
    const result = consolidateMemoryCandidates([], [malformed]);
    expect(result).toHaveLength(0);
  });

  it('requires explicit evidence for distilled/long-term candidates', () => {
    const result = consolidateMemoryCandidates([], [
      buildDistilledCandidate({
        sourceEventIds: [],
        evidenceText: '',
      }),
    ]);
    expect(result).toHaveLength(0);
  });

  it('dedupes candidates with overlapping source event ids into the same memory item', () => {
    const first = consolidateMemoryCandidates([], [
      buildDistilledCandidate({
        text: '甲对乙保持戒备。',
        sourceEventIds: ['evt-1'],
        decision: 'create',
      }),
    ]);
    const second = consolidateMemoryCandidates(first, [
      buildDistilledCandidate({
        text: '甲对乙的戒备仍在，但语气开始缓和。',
        sourceEventIds: ['evt-1'],
        decision: 'create',
      }),
    ]);

    expect(second).toHaveLength(1);
    expect(second[0]?.sourceEventIds.filter((id) => id === 'evt-1')).toHaveLength(1);
  });

  it('generates deterministic memory ids with the same input and timestamp', () => {
    const candidate = buildDistilledCandidate({
      text: '甲对乙保持戒备，但愿意先观察后判断。',
      sourceEventIds: ['stable-1'],
      decision: 'create',
    });
    const first = consolidateMemoryCandidates([], [candidate], { now: 1_717_000_000_000 });
    const second = consolidateMemoryCandidates([], [candidate], { now: 1_717_000_000_000 });

    expect(first[0]?.id).toBe(second[0]?.id);
  });
});
