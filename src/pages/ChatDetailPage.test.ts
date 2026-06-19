import { describe, expect, it } from 'vitest';
import { buildStoryChoicePendingKey, getStoryTailStatus, isStoryChoicePending, shouldShowStoryContinueButton } from './ChatDetailPage';

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
    expect(shouldShowStoryContinueButton({ ...base, isStoryChoiceSubmitting: true })).toBe(false);
    expect(shouldShowStoryContinueButton({ ...base, isStoryRoom: false })).toBe(false);
    expect(shouldShowStoryContinueButton({ ...base, isRemoteDeletedChat: true })).toBe(false);
    expect(shouldShowStoryContinueButton({ ...base, hasChat: false })).toBe(false);
  });

  it('locks a whole story choice epoch instead of a single branch value', () => {
    const key = buildStoryChoicePendingKey({
      chatId: 'story-1',
      choiceEpoch: 3,
      sourceMessageId: 'choice-message',
    });

    expect(key).toBe('story-1:3:choice-message');
    expect(buildStoryChoicePendingKey({
      chatId: 'story-1',
      choiceEpoch: 3,
      sourceMessageId: 'choice-message',
    })).toBe(key);
    expect(buildStoryChoicePendingKey({
      chatId: 'story-1',
      choiceEpoch: 4,
      sourceMessageId: 'choice-message',
    })).not.toBe(key);
  });

  it('detects when the visible story choice group is submitting', () => {
    const pendingKey = buildStoryChoicePendingKey({
      chatId: 'story-1',
      choiceEpoch: 3,
      sourceMessageId: 'choice-message',
    });

    expect(isStoryChoicePending({
      pendingKey,
      chatId: 'story-1',
      choiceEpoch: 3,
      sourceMessageId: 'choice-message',
    })).toBe(true);
    expect(isStoryChoicePending({
      pendingKey,
      chatId: 'story-1',
      choiceEpoch: 3,
      sourceMessageId: 'other-choice-message',
    })).toBe(false);
    expect(isStoryChoicePending({
      pendingKey: null,
      chatId: 'story-1',
      choiceEpoch: 3,
      sourceMessageId: 'choice-message',
    })).toBe(false);
  });

  it('prioritizes story tail status for errors, choice submission, and continue entry', () => {
    expect(getStoryTailStatus({
      hasRunLoopStatus: true,
      canContinueStory: true,
      isStoryChoiceSubmitting: true,
    })).toBe('status');
    expect(getStoryTailStatus({
      hasRunLoopStatus: false,
      canContinueStory: true,
      isStoryChoiceSubmitting: true,
    })).toBe('submitting_choice');
    expect(getStoryTailStatus({
      hasRunLoopStatus: false,
      canContinueStory: true,
      isStoryChoiceSubmitting: false,
    })).toBe('continue');
    expect(getStoryTailStatus({
      hasRunLoopStatus: false,
      canContinueStory: false,
      isStoryChoiceSubmitting: false,
    })).toBeNull();
  });
});
