import { describe, expect, it } from 'vitest';
import { shouldShowStoryContinueButton } from './ChatDetailPage';

function buildPauseResumeMessages() {
  return [] as string[];
}

describe('ChatDetailPage pause/resume behavior', () => {
  it('does not add system messages for pause/resume', () => {
    expect(buildPauseResumeMessages()).toEqual([]);
  });

  it('shows the story continue entry only when a story room is paused without pending choices', () => {
    const base = {
      isStoryRoom: true,
      isStoryWaitingForChoice: false,
      isRemoteDeletedChat: false,
      hasChat: true,
      isRunning: false,
      isPaused: false,
    };

    expect(shouldShowStoryContinueButton(base)).toBe(true);
    expect(shouldShowStoryContinueButton({ ...base, isRunning: true, isPaused: true })).toBe(true);
    expect(shouldShowStoryContinueButton({ ...base, isRunning: true, isPaused: false })).toBe(false);
    expect(shouldShowStoryContinueButton({ ...base, isStoryWaitingForChoice: true })).toBe(false);
    expect(shouldShowStoryContinueButton({ ...base, isStoryRoom: false })).toBe(false);
    expect(shouldShowStoryContinueButton({ ...base, isRemoteDeletedChat: true })).toBe(false);
    expect(shouldShowStoryContinueButton({ ...base, hasChat: false })).toBe(false);
  });
});
