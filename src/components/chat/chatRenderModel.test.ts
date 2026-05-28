import { describe, expect, it } from 'vitest';
import type { Message } from '../../types/message';
import { buildChatRenderItems } from './chatRenderModel';

function message(overrides: Partial<Message>): Message {
  return {
    id: 'message-1',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'character-1',
    senderName: 'Character',
    content: 'hello',
    emotion: 0,
    timestamp: 1,
    isDeleted: false,
    ...overrides,
  };
}

describe('buildChatRenderItems', () => {
  it('keeps a single in-list streaming message pending', () => {
    const items = buildChatRenderItems([
      message({ id: 'stream-1', content: '正在说', isStreaming: true }),
      message({ id: 'event-1', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"relationship_shift","summary":"关系变化"}', timestamp: 2 }),
    ]);

    expect(items.map((item) => item.key)).toEqual(['chat-1:stream-1', 'chat-1:event-1']);
    expect(items.map((item) => item.pending)).toEqual([true, false]);
  });

  it('does not render a committed streamed message twice after server confirmation', () => {
    const items = buildChatRenderItems([
      message({
        id: 'local-stream-1',
        clientKey: 'local-stream-1',
        serverId: 'server-message-1',
        content: '完整内容',
        isStreaming: false,
      }),
      message({
        id: 'server-message-1',
        serverId: 'server-message-1',
        content: '完整内容',
        isStreaming: false,
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.message.id).toBe('local-stream-1');
  });

  it('does not let a stale streaming draft replace the committed bubble', () => {
    const items = buildChatRenderItems([
      message({
        id: 'local-stream-1',
        clientKey: 'local-stream-1',
        serverId: 'server-message-1',
        content: '完整内容，已经提交。',
        isStreaming: false,
      }),
      message({
        id: 'local-stream-1',
        clientKey: 'local-stream-1',
        content: '完整',
        isStreaming: true,
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.message.content).toBe('完整内容，已经提交。');
    expect(items[0]?.pending).toBe(false);
  });

  it('keeps event messages after normal messages when timestamps tie', () => {
    const items = buildChatRenderItems([
      message({ id: 'ai-1', timestamp: 10 }),
      message({ id: 'event-1', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"relationship_shift","summary":"关系变化"}', timestamp: 10 }),
    ]);

    expect(items.map((item) => item.message.type)).toEqual(['ai', 'event']);
  });

  it('preserves incoming order for multiple event messages with the same timestamp', () => {
    const items = buildChatRenderItems([
      message({ id: 'event-2', clientKey: 'event-2', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"conflict_focus_shift","summary":"矛盾"}', timestamp: 10 }),
      message({ id: 'event-1', clientKey: 'event-1', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"relationship_shift","summary":"关系"}', timestamp: 10 }),
    ]);

    expect(items.map((item) => item.message.id)).toEqual(['event-2', 'event-1']);
  });

  it('preserves incoming order for normal messages with the same timestamp', () => {
    const items = buildChatRenderItems([
      message({ id: 'user-1', type: 'user', senderId: 'user', senderName: 'User', timestamp: 10 }),
      message({ id: 'ai-1', type: 'ai', senderId: 'character-1', senderName: 'Character', timestamp: 10 }),
    ]);

    expect(items.map((item) => item.message.id)).toEqual(['user-1', 'ai-1']);
  });

  it('keeps repeated developer event hints visible when they are anchored to their source message', () => {
    const repeatedEvent = (sourceMessageId: string) => JSON.stringify({
      eventType: 'speaker_drift_shift',
      title: 'Linux之父Linus 出现人格偏移',
      summary: 'Linux之父Linus：敏感度+6，外向性-3',
      sourceMessageId,
    });
    const items = buildChatRenderItems([
      message({ id: 'ai-1', timestamp: 10, content: '不客气，去写代码吧。' }),
      message({ id: 'event-1', type: 'event', senderId: 'system', senderName: 'System', timestamp: 11, content: repeatedEvent('ai-1') }),
      message({ id: 'ai-2', timestamp: 12, content: '继续说。' }),
      message({ id: 'event-2', type: 'event', senderId: 'system', senderName: 'System', timestamp: 13, content: repeatedEvent('ai-2') }),
    ]);

    expect(items.map((item) => item.message.id)).toEqual(['ai-1', 'event-1', 'ai-2', 'event-2']);
  });

  it('places delayed developer event hints after the message that caused them', () => {
    const anchoredEvent = JSON.stringify({
      eventType: 'speaker_drift_shift',
      title: 'Linux之父Linus 出现人格偏移',
      summary: 'Linux之父Linus：敏感度+6，外向性-3',
      sourceMessageId: 'ai-1',
    });
    const items = buildChatRenderItems([
      message({ id: 'ai-1', timestamp: 10 }),
      message({ id: 'user-1', type: 'user', senderId: 'user', senderName: 'User', timestamp: 20 }),
      message({ id: 'event-1', type: 'event', senderId: 'system', senderName: 'System', timestamp: 30, content: anchoredEvent }),
    ]);

    expect(items.map((item) => item.message.id)).toEqual(['ai-1', 'event-1', 'user-1']);
  });
});
