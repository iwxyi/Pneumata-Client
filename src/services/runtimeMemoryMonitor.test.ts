import { describe, expect, it } from 'vitest';
import { sizePendingOperationEntry, summarizeMessages } from './runtimeMemoryMonitor';

describe('runtimeMemoryMonitor forensics', () => {
  it('summarizes active messages', () => {
    const summary = summarizeMessages([
      {
        id: 'm1',
        chatId: 'chat-1',
        type: 'event',
        senderId: 'speaker-1',
        senderName: '说话者',
        content: 'hello',
        timestamp: 1,
        isDeleted: false,
      },
      {
        id: 'm2',
        chatId: 'chat-1',
        type: 'ai',
        senderId: 'speaker-2',
        senderName: '角色',
        content: 'world',
        timestamp: 2,
        isDeleted: false,
        isStreaming: true,
      },
    ]);

    expect(summary).toMatchObject({
      count: 2,
      event: 1,
      streaming: 1,
      totalContentChars: 10,
      uniqueIds: 2,
    });
  });

  it('summarizes pending operations', () => {
    const entry = sizePendingOperationEntry({
      id: 'op-1',
      kind: 'patch',
      status: 'pending',
      attemptCount: 3,
      patch: { foo: 1, bar: true },
      payload: { baz: 'x' },
    }, 0);

    expect(entry).toMatchObject({
      id: 'op-1',
      label: 'patch',
      counts: {
        patchKeys: 2,
        payloadKeys: 1,
        attemptCount: 3,
      },
    });
  });
});
