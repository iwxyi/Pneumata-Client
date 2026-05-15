import { describe, expect, it } from 'vitest';
import { createDefaultConflictAxes, evolveConflictAxes, summarizeConflictAxes } from './conflictAxisEngine';

describe('conflictAxisEngine', () => {
  it('does not summarize neutral conflict axes as the negative pole', () => {
    const axes = createDefaultConflictAxes({
      topic: '',
      style: 'free',
      dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    });

    expect(summarizeConflictAxes(axes)).toBe('');
  });

  it('decays stale conflict tilt back toward neutral across later messages', () => {
    const chat = {
      style: 'free',
      dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
      worldState: {
        conflictAxes: [{ title: '归属/身份冲突', poles: ['默认认同', '公开争夺'] as [string, string], currentTilt: -26 }],
      },
    };

    const nextAxes = evolveConflictAxes(chat as never, '这句只是普通接话，没有继续争归属。');
    expect(nextAxes[0]?.currentTilt).toBeGreaterThan(-26);
    expect(nextAxes[0]?.currentTilt).toBe(-18);
  });
});
