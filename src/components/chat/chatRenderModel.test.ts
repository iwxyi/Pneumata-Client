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

  it('keeps event messages after normal messages when timestamps tie', () => {
    const items = buildChatRenderItems([
      message({ id: 'ai-1', timestamp: 10 }),
      message({ id: 'event-1', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"relationship_shift","summary":"关系变化"}', timestamp: 10 }),
    ]);

    expect(items.map((item) => item.message.type)).toEqual(['ai', 'event']);
  });

  it('keeps a stable order for multiple event messages with the same timestamp', () => {
    const items = buildChatRenderItems([
      message({ id: 'event-2', clientKey: 'event-2', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"conflict_focus_shift","summary":"矛盾"}', timestamp: 10 }),
      message({ id: 'event-1', clientKey: 'event-1', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"relationship_shift","summary":"关系"}', timestamp: 10 }),
    ]);

    expect(items.map((item) => item.message.id)).toEqual(['event-1', 'event-2']);
  });
});
