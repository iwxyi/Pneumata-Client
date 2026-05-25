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

  it('keeps committed streamed content when a delayed streaming frame arrives', () => {
    const projected = projectCurrentChatMessages({
      chatId: 'chat-1',
      activeMessages: [
        message({
          id: 'local-stream-1',
          clientKey: 'local-stream-1',
          serverId: 'server-message-1',
          content: '完整正式内容，已经提交。',
          timestamp: 10,
          isStreaming: false,
        }),
        message({
          id: 'local-stream-1',
          clientKey: 'local-stream-1',
          content: '完整',
          timestamp: 10,
          isStreaming: true,
        }),
      ],
      cachedWindow: null,
    });

    expect(projected).toHaveLength(1);
    expect(projected[0]?.content).toBe('完整正式内容，已经提交。');
    expect(projected[0]?.isStreaming).toBe(false);
  });

  it('merges a local streamed message with its later server id', () => {
    const projected = projectCurrentChatMessages({
      chatId: 'chat-1',
      activeMessages: [
        message({
          id: 'server-message-1',
          serverId: 'server-message-1',
          content: '逐字显示完整内容',
          timestamp: 12,
          isStreaming: false,
        }),
      ],
      cachedWindow: {
        messages: [
          message({
            id: 'local-stream-1',
            clientKey: 'local-stream-1',
            serverId: 'server-message-1',
            content: '逐字显示完整内容',
            timestamp: 10,
            isStreaming: false,
          }),
        ],
      },
    });

    expect(projected).toHaveLength(1);
    expect(projected[0]?.id).toBe('local-stream-1');
    expect(projected[0]?.serverId).toBe('server-message-1');
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
