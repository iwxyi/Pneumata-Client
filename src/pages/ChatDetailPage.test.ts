import { describe, expect, it } from 'vitest';
import { buildStoryChoicePendingKey, buildVisibleStoryBranchOptions, findVisibleStoryChoiceSourceMessage, getStoryTailStatus, isStoryChoicePending, shouldAutoStartStoryRoom } from './ChatDetailPage';

function buildPauseResumeMessages() {
  return [] as string[];
}

describe('ChatDetailPage pause/resume behavior', () => {
  it('does not add system messages for pause/resume', () => {
    expect(buildPauseResumeMessages()).toEqual([]);
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

  it('prioritizes story tail status for errors and choice submission only', () => {
    expect(getStoryTailStatus({
      hasRunLoopStatus: true,
      isStoryChoiceSubmitting: true,
    })).toBe('status');
    expect(getStoryTailStatus({
      hasRunLoopStatus: false,
      isStoryChoiceSubmitting: true,
    })).toBe('submitting_choice');
    expect(getStoryTailStatus({
      hasRunLoopStatus: false,
      isStoryChoiceSubmitting: false,
    })).toBeNull();
  });

  it('auto-starts story rooms only when the story is ready to keep running', () => {
    const base = {
      hasChat: true,
      hasChatId: true,
      canAutoRunConversation: true,
      isStoryRoom: true,
      isRunning: false,
      isPaused: false,
      isStoryWaitingForChoice: false,
      isStoryChoiceSubmitting: false,
      hasRunLoopError: false,
    };

    expect(shouldAutoStartStoryRoom(base)).toBe(true);
    expect(shouldAutoStartStoryRoom({ ...base, isStoryWaitingForChoice: true })).toBe(false);
    expect(shouldAutoStartStoryRoom({ ...base, isStoryChoiceSubmitting: true })).toBe(false);
    expect(shouldAutoStartStoryRoom({ ...base, isPaused: true })).toBe(false);
    expect(shouldAutoStartStoryRoom({ ...base, isRunning: true })).toBe(false);
    expect(shouldAutoStartStoryRoom({ ...base, hasRunLoopError: true })).toBe(false);
    expect(shouldAutoStartStoryRoom({ ...base, isStoryRoom: false })).toBe(false);
    expect(shouldAutoStartStoryRoom({ ...base, canAutoRunConversation: false })).toBe(false);
  });

  it('does not revive old story choices outside the active choice phase', () => {
    const choiceMessage = {
      id: 'choice-source',
      chatId: 'story-1',
      type: 'ai' as const,
      senderId: 'narrator',
      senderName: '旁白',
      content: '门后出现新线索。',
      emotion: 0,
      timestamp: 1,
      isDeleted: false,
      metadata: {
        storyChoices: [
          { label: '追问护士昨晚去向', prompt: '追问护士' },
          { label: '检查墙上血迹', prompt: '检查血迹' },
        ],
      },
    };
    const chat = {
      id: 'story-1',
      scenarioState: {
        phase: 'scene',
        choiceEpoch: 2,
        branches: [
          { branchId: 'ask', label: '追问护士昨晚去向', status: 'completed' as const, choiceEpoch: 2 },
          { branchId: 'search', label: '检查墙上血迹', status: 'completed' as const, choiceEpoch: 2 },
        ],
      },
    };

    expect(findVisibleStoryChoiceSourceMessage({
      isStoryRoom: true,
      phase: 'scene',
      messages: [choiceMessage],
    })).toBeNull();
    const params: Parameters<typeof buildVisibleStoryBranchOptions>[0] = {
      isStoryRoom: true,
      chat: chat as Parameters<typeof buildVisibleStoryBranchOptions>[0]['chat'],
      sourceMessage: choiceMessage,
    };
    expect(buildVisibleStoryBranchOptions({
      ...params,
    })).toEqual([]);
  });

  it('shows current branch fallback options when the choice source message has no storyChoices metadata', () => {
    const sourceMessage = {
      id: 'fallback-choice-source',
      chatId: 'story-1',
      type: 'ai' as const,
      senderId: 'narrator',
      senderName: '旁白',
      content: '走廊尽头的灯忽明忽暗，必须立刻决定下一步。',
      emotion: 0,
      timestamp: 2,
      isDeleted: false,
    };
    const chat = {
      id: 'story-1',
      scenarioState: {
        phase: 'choice',
        choiceEpoch: 4,
        branches: [
          { branchId: 'ask', label: '让林医生追问护士隐瞒的细节', prompt: '林医生追问护士', status: 'available' as const, choiceEpoch: 4 },
          { branchId: 'search', label: '让林医生检查旧医院走廊里的血迹', prompt: '林医生检查血迹', status: 'available' as const, choiceEpoch: 4 },
          { branchId: 'old', label: '旧选项', prompt: '旧选项', status: 'available' as const, choiceEpoch: 3 },
        ],
      },
    };

    expect(findVisibleStoryChoiceSourceMessage({
      isStoryRoom: true,
      phase: 'choice',
      messages: [sourceMessage],
    })).toBe(sourceMessage);
    expect(buildVisibleStoryBranchOptions({
      isStoryRoom: true,
      chat: chat as Parameters<typeof buildVisibleStoryBranchOptions>[0]['chat'],
      sourceMessage,
    })).toEqual([
      expect.objectContaining({ label: '让林医生追问护士隐瞒的细节', value: 'ask' }),
      expect.objectContaining({ label: '让林医生检查旧医院走廊里的血迹', value: 'search' }),
    ]);
  });
});
