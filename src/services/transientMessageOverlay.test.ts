import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { overlayTransientMessages, releaseConfirmedTransientMessages, removeTransientMessage, upsertTransientMessage } from './transientMessageOverlay';

function message(id: string, content: string, timestamp: number, isStreaming = false): Message {
  return { id, clientKey: id, chatId: 'chat-1', type: 'ai', senderId: 'char-1', senderName: '甲', content, emotion: 0, timestamp, isDeleted: false, isStreaming };
}

describe('transientMessageOverlay', () => {
  it('replaces only the matching provisional bubble and keeps history intact', () => {
    const first = message('first', '第一条', 1);
    const second = message('second', '', 2, true);
    const updatedSecond = message('second', '第二条正在显示', 2, true);
    const transient = upsertTransientMessage([second], updatedSecond);

    expect(overlayTransientMessages([first], transient).map((item) => item.content)).toEqual(['第一条', '第二条正在显示']);
    expect(removeTransientMessage(transient, updatedSecond)).toEqual([]);
  });

  it('hands a completed message to history without changing the visible item identity or count', () => {
    const history = [message('earlier', '上一条历史', 1)];
    const provisional = message('reply', '正在逐字显示', 2, true);
    const committed = message('reply', '完整正式回复', 2);

    const duringReveal = overlayTransientMessages(history, [provisional]);
    const duringHandoff = overlayTransientMessages([...history, committed], [provisional]);
    const afterHandoff = overlayTransientMessages([...history, committed], releaseConfirmedTransientMessages([committed], [...history, committed]));

    expect(duringReveal.map((item) => item.id)).toEqual(['earlier', 'reply']);
    expect(duringHandoff.map((item) => item.id)).toEqual(['earlier', 'reply']);
    expect(afterHandoff.map((item) => item.id)).toEqual(['earlier', 'reply']);
    expect(duringHandoff[1]).toMatchObject({ id: 'reply', content: '正在逐字显示', isStreaming: true });
    expect(afterHandoff[1]).toMatchObject({ id: 'reply', content: '完整正式回复', isStreaming: false });
  });

  it('keeps each completed segment visible until its own history record is confirmed', () => {
    const first = message('first', '第一条', 1);
    const second = message('second', '第二条', 2, true);

    expect(overlayTransientMessages([], [first, second]).map((item) => item.id)).toEqual(['first', 'second']);
    expect(releaseConfirmedTransientMessages([first, second], [])).toEqual([first, second]);
    expect(releaseConfirmedTransientMessages([first, second], [first])).toEqual([second]);
  });
});
