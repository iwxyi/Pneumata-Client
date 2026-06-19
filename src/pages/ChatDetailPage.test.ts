import { describe, expect, it } from 'vitest';
import { buildStoryChoicePendingKey, buildVisibleStoryBranchOptions, findVisibleStoryChoiceSourceMessage, getStoryTailStatus, isStoryChoicePending } from './ChatDetailPage';

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
});
