import { describe, expect, it } from 'vitest';
import type { Message } from '../types/message';
import { projectCurrentChatMessages } from './currentChatMessages';

function message(patch: Partial<Message>): Message {
  return {
    id: patch.id || 'm1',
    chatId: patch.chatId || 'chat-1',
    type: patch.type || 'ai',
    senderId: patch.senderId || 'a',
    senderName: patch.senderName || '甲',
    content: patch.content || '内容',
    emotion: 0,
    timestamp: patch.timestamp ?? 1,
    isDeleted: false,
    ...patch,
  };
}

describe('projectCurrentChatMessages', () => {
  it('renders current chat messages from the cached window even when active messages are empty', () => {
    const projected = projectCurrentChatMessages({
      chatId: 'chat-1',
      activeMessages: [],
      cachedWindow: {
        messages: [
          message({ id: 'user-1', type: 'user', senderId: 'user', senderName: 'User', content: '我刚发的消息' }),
        ],
      },
    });

    expect(projected).toHaveLength(1);
    expect(projected[0]?.content).toBe('我刚发的消息');
  });

  it('merges active streaming messages with cached messages for the same chat', () => {
    const projected = projectCurrentChatMessages({
      chatId: 'chat-1',
      activeMessages: [
        message({ id: 'stream-1', content: '正在说', timestamp: 2, isStreaming: true }),
      ],
      cachedWindow: {
        messages: [
          message({ id: 'user-1', type: 'user', senderId: 'user', senderName: 'User', content: '先说一句', timestamp: 1 }),
        ],
      },
    });

    expect(projected.map((item) => item.id)).toEqual(['user-1', 'stream-1']);
  });

  it('ignores messages from other chats', () => {
    const projected = projectCurrentChatMessages({
      chatId: 'chat-1',
      activeMessages: [message({ id: 'other', chatId: 'chat-2' })],
      cachedWindow: { messages: [message({ id: 'current', chatId: 'chat-1' })] },
    });

    expect(projected.map((item) => item.id)).toEqual(['current']);
  });
});

