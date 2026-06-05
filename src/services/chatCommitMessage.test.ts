import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';
import { createCommittedLocalMessage, createStreamingLocalMessage, persistLocalFirstMessage } from './chatCommitMessage';

const queueMessageSyncMock = vi.fn();

vi.mock('../stores/useMessageStore', () => ({
  useMessageStore: {
    getState: () => ({
      queueMessageSync: queueMessageSyncMock,
    }),
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

    expect(queueMessageSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      id: localMessage.id,
      chatId: 'chat-1',
      content: '{"eventType":"relationship_shift"}',
      timestamp: 123456,
    }));
    expect(upserts).toHaveLength(1);
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

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.id).toBe(existingLocalMessage.id);
    expect(upserts[0]?.content).toBe('真正完成');
    expect(queueMessageSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      id: existingLocalMessage.id,
      content: '真正完成',
    }));
  });

  it('keeps the fuller streamed text when final commit content is a suffix', async () => {
    const upserts: Message[] = [];
    const existingLocalMessage: Message = {
      id: 'local-stream-3',
      clientKey: 'local-stream-3',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'char-1',
      senderName: '甲',
      content: '我先说结论，这里不能再靠本地规则截断，否则流式结束后就会丢前半句。',
      emotion: 0,
      timestamp: 444444,
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
        content: '这里不能再靠本地规则截断，否则流式结束后就会丢前半句。',
        emotion: 0,
      },
      upsertMessage: (message) => {
        upserts.push(message);
      },
    });

    expect(localMessage.content).toBe(existingLocalMessage.content);
    expect(upserts[0]?.content).toBe(existingLocalMessage.content);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queueMessageSyncMock).toHaveBeenLastCalledWith(expect.objectContaining({
      content: existingLocalMessage.content,
    }));
  });

  it('does not treat punctuation differences as permission to crop streamed text', async () => {
    const upserts: Message[] = [];
    const existingLocalMessage: Message = {
      id: 'local-stream-4',
      clientKey: 'local-stream-4',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'char-1',
      senderName: '甲',
      content: '我先说结论，这个点不是不能聊，只是你们现在全在绕开真正的问题，要不先把谁负责讲清楚？',
      emotion: 0,
      timestamp: 555555,
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
        content: '这个点不是不能聊只是你们现在全在绕开真正的问题要不先把谁负责讲清楚',
        emotion: 0,
      },
      upsertMessage: (message) => {
        upserts.push(message);
      },
    });

    expect(localMessage.content).toBe(existingLocalMessage.content);
    expect(upserts[0]?.content).toBe(existingLocalMessage.content);
  });

  it('briefly reveals the original text before writing the withdrawn notice', async () => {
    const upserts: Message[] = [];
    const delays: number[] = [];
    const existingLocalMessage: Message = {
      id: 'local-stream-2',
      clientKey: 'local-stream-2',
      chatId: 'chat-1',
      type: 'ai',
      senderId: 'char-1',
      senderName: '甲',
      content: '原文',
      emotion: 0,
      timestamp: 333333,
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
        content: '甲撤回了一条消息',
        metadata: {
          withdrawal: {
            withdrawn: true,
            originalContent: '刚才话重了点。',
            reason: '前面的刺留下了关系修复压力。',
            withdrawnAt: 123,
          },
        },
        emotion: 0,
      },
      upsertMessage: (message) => {
        upserts.push(message);
      },
      withdrawalRevealDelayMs: 50,
      delay: async (ms) => {
        delays.push(ms);
      },
    });

    expect(localMessage.content).toBe('甲撤回了一条消息');
    expect(delays).toEqual([50]);
    expect(upserts[0]?.content).toBe('刚才话重了点。');
    expect(upserts[0]?.metadata?.withdrawal?.visiblePending).toBe(true);
    expect(upserts[1]?.content).toBe('甲撤回了一条消息');
    expect(upserts[1]?.metadata?.withdrawal?.visiblePending).toBeUndefined();
  });

  it('builds deterministic local ids for identical payload + timestamp', () => {
    const payload = {
      chatId: 'chat-1',
      type: 'ai' as const,
      senderId: 'char-1',
      senderName: '甲',
      content: '同一条消息',
      emotion: 0,
    };
    const first = createCommittedLocalMessage(payload, { timestamp: 123456 });
    const second = createCommittedLocalMessage(payload, { timestamp: 123456 });
    expect(first.id).toBe(second.id);
  });

  it('builds unique ids for repeated streaming placeholders with the same speaker and timestamp', () => {
    const payload = {
      chatId: 'chat-1',
      type: 'ai' as const,
      senderId: 'char-1',
      senderName: '甲',
      content: '',
      emotion: 0,
    };
    const first = createStreamingLocalMessage(payload, { timestamp: 123456 });
    const second = createStreamingLocalMessage(payload, { timestamp: 123456 });
    expect(first.id).not.toBe(second.id);
  });
});
