import { describe, expect, it } from 'vitest';
import { formatParticipantScheduleStateLabel, summarizeParticipantStateCounts } from './worldCalendarPresentation';

describe('worldCalendarPresentation', () => {
  it('formats participant state labels', () => {
    expect(formatParticipantScheduleStateLabel('going', true)).toBe('确认参加');
    expect(formatParticipantScheduleStateLabel('going', false)).toBe('Going');
  });

  it('summarizes participant states into readable counts', () => {
    const summary = summarizeParticipantStateCounts({
      a: 'going',
      b: 'going',
      c: 'invited',
      d: 'maybe',
    }, true);
    expect(summary[0]).toBe('确认参加 ×2');
    expect(summary).toContain('已邀请 ×1');
    expect(summary).toContain('可能参加 ×1');
  });
});
