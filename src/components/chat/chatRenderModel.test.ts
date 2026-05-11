import { describe, expect, it } from 'vitest';
import type { Message } from '../../types/message';
import { buildChatRenderItems, type LiveChatMessage } from './chatRenderModel';

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
  it('keeps a committed live message in place so following event hints stay below it', () => {
    const liveMessage: LiveChatMessage = {
      key: 'live-1',
      chatId: 'chat-1',
      senderId: 'character-1',
      senderName: 'Character',
      content: 'hello',
      startedAt: 1,
    };

    const items = buildChatRenderItems([
      message({ id: 'committed-1', content: 'hello' }),
      message({ id: 'event-1', type: 'event', senderId: 'system', senderName: 'System', content: '{"eventType":"relationship_shift","summary":"关系变化"}', timestamp: 2 }),
    ], liveMessage);

    expect(items.map((item) => item.key)).toEqual(['live-1', 'chat-1:event-1']);
    expect(items.map((item) => item.message.type)).toEqual(['ai', 'event']);
    expect(items[0].pending).toBe(true);
  });

  it('appends live messages that do not have a committed match yet', () => {
    const liveMessage: LiveChatMessage = {
      key: 'live-2',
      chatId: 'chat-1',
      senderId: 'character-1',
      senderName: 'Character',
      content: 'streaming',
      startedAt: 2,
    };

    const items = buildChatRenderItems([
      message({ id: 'existing-1', content: 'previous' }),
    ], liveMessage);

    expect(items.map((item) => item.key)).toEqual(['chat-1:existing-1', 'live-2']);
  });
});
