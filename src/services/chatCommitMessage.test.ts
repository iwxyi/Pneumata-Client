import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';
import { persistLocalFirstMessage } from './chatCommitMessage';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    createMessage: vi.fn(async (chatId: string, data: { type: string; senderId: string; senderName: string; content: string; emotion?: number }) => ({
      id: 'server-message-1',
      chatId,
      type: data.type,
      senderId: data.senderId,
      senderName: data.senderName,
      content: data.content,
      emotion: data.emotion ?? 0,
      timestamp: 999999,
      isDeleted: false,
      relationshipDebug: { large: 'payload' },
      rawResponse: Array.from({ length: 8 }, (_, index) => ({ index, text: 'server-only metadata' })),
    })),
  },
}));

describe('persistLocalFirstMessage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the local timestamp and identity when the server confirmation arrives', async () => {
    const upserts: Message[] = [];

    const localMessage = await persistLocalFirstMessage({
      timestamp: 123456,
      message: {
        chatId: 'chat-1',
        type: 'event',
        senderId: 'system',
        senderName: 'System',
        content: '{"eventType":"relationship_shift"}',
        emotion: 0,
      },
      upsertMessage: (message) => {
        upserts.push(message);
      },
    });

    expect(localMessage.timestamp).toBe(123456);
    expect(upserts[0]?.timestamp).toBe(123456);
    expect(upserts[0]?.id).toBe(localMessage.id);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.createMessage).toHaveBeenCalledWith('chat-1', {
      type: 'event',
      senderId: 'system',
      senderName: 'System',
      content: '{"eventType":"relationship_shift"}',
      emotion: 0,
    });
    expect(upserts).toHaveLength(2);
    expect(upserts[1]?.id).toBe(localMessage.id);
    expect(upserts[1]?.serverId).toBe('server-message-1');
    expect(upserts[1]?.timestamp).toBe(123456);
    expect(upserts[1]?.isOptimistic).toBe(false);
    expect('relationshipDebug' in (upserts[1] as unknown as Record<string, unknown>)).toBe(false);
    expect('rawResponse' in (upserts[1] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('reuses an existing local streaming message instead of creating a second bubble', async () => {
    const upserts: Message[] = [];
    const existingLocalMessage: Message = {
      id: 'local-stream-1',
      clientKey: 'local-stream-1',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'char-1',
      senderName: '甲',
      content: '正',
      emotion: 0,
      timestamp: 222222,
      isDeleted: false,
      isStreaming: true,
    };

    const localMessage = await persistLocalFirstMessage({
      existingLocalMessage,
      message: {
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'char-1',
        senderName: '甲',
        content: '真正完成',
        emotion: 0,
      },
      upsertMessage: (message) => {
        upserts.push(message);
      },
    });

    expect(localMessage.id).toBe(existingLocalMessage.id);
    expect(localMessage.timestamp).toBe(existingLocalMessage.timestamp);
    expect(localMessage.content).toBe('真正完成');
    expect(localMessage.isStreaming).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(upserts).toHaveLength(2);
    expect(upserts[0]?.id).toBe(existingLocalMessage.id);
    expect(upserts[0]?.content).toBe('真正完成');
    expect(upserts[1]?.id).toBe(existingLocalMessage.id);
    expect(upserts[1]?.serverId).toBe('server-message-1');
  });
});
