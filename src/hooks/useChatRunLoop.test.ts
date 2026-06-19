import { describe, expect, it } from 'vitest';
import { getConversationLoopStartBlockReason, shouldSkipConversationLoopStart, shouldStartConversationLoop } from './useChatRunLoop';

describe('useChatRunLoop start guard', () => {
  it('reports the root reason that blocks loop start', () => {
    expect(getConversationLoopStartBlockReason({
      conversationType: 'direct',
      isRunning: false,
      isPaused: false,
      isStoryChoiceBlocked: false,
      hasActiveLoop: false,
    })).toBe('direct_chat');

    expect(getConversationLoopStartBlockReason({
      conversationType: 'group',
      isRunning: false,
      isPaused: false,
      isStoryChoiceBlocked: true,
      hasActiveLoop: false,
    })).toBe('waiting_story_choice');

    expect(getConversationLoopStartBlockReason({
      conversationType: 'group',
      isRunning: true,
      isPaused: false,
      isStoryChoiceBlocked: false,
      hasActiveLoop: true,
    })).toBe('already_active');

    expect(getConversationLoopStartBlockReason({
      conversationType: 'group',
      isRunning: true,
      isPaused: false,
      isStoryChoiceBlocked: false,
      hasActiveLoop: false,
    })).toBeNull();
  });

  it('only skips starting when a real active loop is already running', () => {
    expect(shouldSkipConversationLoopStart({
      isRunning: true,
      isPaused: false,
      isStoryChoiceBlocked: false,
      hasActiveLoop: true,
    })).toBe(true);

    expect(shouldSkipConversationLoopStart({
      isRunning: true,
      isPaused: false,
      isStoryChoiceBlocked: false,
      hasActiveLoop: false,
    })).toBe(false);

    expect(shouldSkipConversationLoopStart({
      isRunning: true,
      isPaused: true,
      isStoryChoiceBlocked: false,
      hasActiveLoop: true,
    })).toBe(false);

    expect(shouldSkipConversationLoopStart({
      isRunning: true,
      isPaused: false,
      isStoryChoiceBlocked: true,
      hasActiveLoop: true,
    })).toBe(false);
  });

  it('does not start while a story choice is waiting, but recovers false running state without an active loop', () => {
    expect(shouldStartConversationLoop({
      conversationType: 'group',
      isRunning: false,
      isPaused: false,
      isStoryChoiceBlocked: true,
      hasActiveLoop: false,
    })).toBe(false);

    expect(shouldStartConversationLoop({
      conversationType: 'group',
      isRunning: true,
      isPaused: false,
      isStoryChoiceBlocked: true,
      hasActiveLoop: false,
    })).toBe(false);

    expect(shouldStartConversationLoop({
      conversationType: 'group',
      isRunning: true,
      isPaused: false,
      isStoryChoiceBlocked: false,
      hasActiveLoop: false,
    })).toBe(true);
  });
});
