import { describe, expect, it } from 'vitest';
import { extractMemoryCandidate } from './memoryEngine';

describe('memoryEngine', () => {
  it('does not turn rhetorical questions into artifact seeds', () => {
    expect(extractMemoryCandidate('计划：哪里不靠谱了')).toBeNull();
    expect(extractMemoryCandidate('那这个计划是不是也要你批准呀')).toBeNull();
  });

  it('extracts explicit artifact records only when they look like records', () => {
    expect(extractMemoryCandidate('计划：明天先核对线索，再整理公开时间线')).toMatchObject({
      kind: 'artifact',
      text: '计划：明天先核对线索，再整理公开时间线',
    });
  });
});
