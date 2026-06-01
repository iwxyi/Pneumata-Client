import { describe, expect, it } from 'vitest';
import type { MessageMetadata } from '../types/message';
import { buildWithdrawnNotice, maybeAutoWithdrawMessage, shouldAutoWithdrawMessage } from './messageWithdrawal';

function buildMetadata(overrides: Partial<NonNullable<MessageMetadata['runtimeDecision']>['innerLife']> = {}): MessageMetadata {
  return {
    runtimeDecision: {
      innerLife: {
        impulse: 'repair',
        tone: 'vulnerable',
        reason: '前面的刺留下了关系修复压力。',
        pressure: 0.8,
        state: {
          shame: 78,
          repression: 72,
        },
        expressionPlan: {
          allowWithdraw: true,
        },
        ...overrides,
      },
    },
  };
}

describe('messageWithdrawal', () => {
  it('builds localized withdrawn notice', () => {
    expect(buildWithdrawnNotice('小灰灰', 'zh')).toBe('小灰灰撤回了一条消息');
    expect(buildWithdrawnNotice('Wang', 'en')).toBe('Wang withdrew a message');
  });

  it('withdraws only when inner life allows it and pressure wins', () => {
    expect(shouldAutoWithdrawMessage({ metadata: buildMetadata(), random: () => 0 })).toBe(true);
    expect(shouldAutoWithdrawMessage({ metadata: buildMetadata(), random: () => 0.99 })).toBe(false);
    expect(shouldAutoWithdrawMessage({ metadata: buildMetadata({ expressionPlan: { allowWithdraw: false } }), random: () => 0 })).toBe(false);
  });

  it('keeps original content in metadata when withdrawn', () => {
    const message = maybeAutoWithdrawMessage({
      chatId: 'chat-a',
      type: 'ai' as const,
      senderId: 'char-a',
      senderName: '小灰灰',
      content: '刚才话重了点。',
      metadata: buildMetadata(),
      emotion: 0,
    }, { random: () => 0, now: 123, language: 'zh' });

    expect(message.content).toBe('小灰灰撤回了一条消息');
    expect(message.metadata?.withdrawal?.originalContent).toBe('刚才话重了点。');
    expect(message.metadata?.withdrawal?.withdrawnAt).toBe(123);
  });

  it('treats withdrawnAt=0 as a valid timestamp', () => {
    const message = maybeAutoWithdrawMessage({
      chatId: 'chat-a',
      type: 'ai' as const,
      senderId: 'char-a',
      senderName: '小灰灰',
      content: '我先撤回一下。',
      metadata: buildMetadata(),
      emotion: 0,
    }, { random: () => 0, now: 0, language: 'zh' });

    expect(message.metadata?.withdrawal?.withdrawnAt).toBe(0);
  });
});
