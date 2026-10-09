import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';
import { createStreamingMessageDisplay } from './streamingMessageDisplay';
import { STREAMING_DISPLAY_TICK_MS } from './streamingDisplayBuffer';

function message(id: string, content: string): Message {
  return { id, clientKey: id, chatId: 'chat', type: 'ai', senderId: 'speaker', senderName: '甲', content, emotion: 0, timestamp: 1, isDeleted: false, isStreaming: true };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('shared streaming display', () => {
  it('buffers successive model chunks without resetting already displayed text', async () => {
    const upsertMessage = vi.fn<(message: Message) => void>();
    const display = createStreamingMessageDisplay({ upsertMessage, isAnimationEnabled: () => true });
    display.update(message('first', ''), { immediate: true });
    display.update(message('first', '先等等'));
    await vi.advanceTimersByTimeAsync(STREAMING_DISPLAY_TICK_MS);
    expect(display.getDisplayed()?.content).toBe('先');
    display.update(message('first', '先等等，我还没有说完。'));
    await vi.runAllTimersAsync();
    const lengths = upsertMessage.mock.calls.map(([write]) => write.content.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
    expect(display.getDisplayed()?.content).toBe('先等等，我还没有说完。');
  });

  it('freezes the old model timer before committing or revealing later bubbles', async () => {
    const upsertMessage = vi.fn();
    const display = createStreamingMessageDisplay({ upsertMessage, isAnimationEnabled: () => true });
    display.update(message('first', '先等等，我还没有说完。'));
    await vi.advanceTimersByTimeAsync(STREAMING_DISPLAY_TICK_MS);
    display.freeze();
    const count = upsertMessage.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(upsertMessage).toHaveBeenCalledTimes(count);
    expect(display.getDisplayed()?.content).not.toBe('先等等，我还没有说完。');
  });

  it('starts a new identity from empty, not from the previous bubble', async () => {
    const upsertMessage = vi.fn();
    const display = createStreamingMessageDisplay({ upsertMessage, isAnimationEnabled: () => true });
    display.update(message('first', '以前的话'), { immediate: true });
    display.update(message('second', '这是一条新消息'));
    expect(display.getDisplayed()).toMatchObject({ id: 'second', content: '' });
    await vi.advanceTimersByTimeAsync(STREAMING_DISPLAY_TICK_MS);
    expect(upsertMessage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'second', content: '这' }));
    display.clear();
    await vi.runAllTimersAsync();
    expect(display.getDisplayed()).toBeNull();
  });

  it('shares the immediate path for disabled animation and explicit immediate updates', () => {
    const upsertMessage = vi.fn();
    const display = createStreamingMessageDisplay({ upsertMessage, isAnimationEnabled: () => false });
    display.update(message('first', '完整显示'));
    expect(upsertMessage).toHaveBeenLastCalledWith(expect.objectContaining({ content: '完整显示' }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
