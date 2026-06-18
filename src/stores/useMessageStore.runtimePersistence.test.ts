import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';

function createStorageMock() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type: 'ai',
    senderId: 'char-1',
    senderName: '苏苏',
    content: '发来一张图',
    emotion: 0,
    timestamp: 1,
    metadata: {},
    isDeleted: false,
    ...overrides,
  };
}

describe('message runtime persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
  });

  it('strips inline data url media from pending message payloads', async () => {
    const { __messageRuntimePersistenceForTests } = await import('./useMessageStore');
    const { buildPersistedMessageState } = __messageRuntimePersistenceForTests;
    const dataUrl = `data:image/png;base64,${'a'.repeat(6000)}`;
    const persisted = buildPersistedMessageState({
      messageWindowsByChatId: {},
      pendingOperations: [{
        id: 'op-1',
        kind: 'create',
        chatId: 'chat-1',
        localMessageId: 'msg-1',
        payload: message({
          metadata: {
            attachments: [{
              id: 'att-1',
              kind: 'image',
              status: 'ready',
              url: dataUrl,
              altText: '测试图片',
              createdAt: 1,
              updatedAt: 1,
            }],
          },
        }),
        createdAt: 1,
        attemptCount: 0,
        status: 'pending',
      }],
    });

    expect(JSON.stringify(persisted)).not.toContain('data:image/png;base64');
    expect(persisted.pendingOperations[0]?.payload?.metadata).toMatchObject({
      attachments: [{ altText: '测试图片', kind: 'image', status: 'ready' }],
    });
  });
});
