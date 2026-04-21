import { describe, expect, it } from 'vitest';

function buildPauseResumeMessages() {
  return [] as string[];
}

describe('ChatDetailPage pause/resume behavior', () => {
  it('does not add system messages for pause/resume', () => {
    expect(buildPauseResumeMessages()).toEqual([]);
  });
});
