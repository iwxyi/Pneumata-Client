import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { resolveUserInputHold } from './userInputBuffer';

function userMessage(content: string, timestamp: number): Message {
  return {
    id: `u-${timestamp}`,
    chatId: 'chat-1',
    type: 'user',
    senderId: 'user',
    senderName: '用户',
    content,
    emotion: 0,
    timestamp,
    isDeleted: false,
  };
}

describe('resolveUserInputHold', () => {
  it('briefly holds after a short open user message', () => {
    const decision = resolveUserInputHold({
      messages: [userMessage('等下', 1000)],
      now: 1400,
    });

    expect(decision.shouldHold).toBe(true);
    expect(decision.reason).toBe('short_open_user_turn');
  });

  it('holds when the input box has a recent unsent draft', () => {
    const decision = resolveUserInputHold({
      messages: [userMessage('嗯？', 1000)],
      draft: { hasDraft: true, updatedAt: 2200, focused: true },
      now: 2600,
    });

    expect(decision.shouldHold).toBe(true);
    expect(decision.reason).toBe('active_unsent_draft');
  });

  it('releases after the maximum post-message window to avoid deadlock', () => {
    const decision = resolveUserInputHold({
      messages: [userMessage('等下', 1000)],
      draft: { hasDraft: true, updatedAt: 1100, focused: true },
      now: 4200,
    });

    expect(decision.shouldHold).toBe(false);
    expect(decision.reason).toBe('outside_hold_window');
  });
});
