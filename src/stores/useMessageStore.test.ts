import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  readonly length: number;
}

function createStorageMock(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function buildMessage(index: number, chatId = 'chat-1'): Message {
  return {
    id: `message-${index}`,
    chatId,
    type: 'ai',
    senderId: 'character-1',
    senderName: '角色',
    content: `消息 ${index}`,
    emotion: 0,
    timestamp: index,
    isDeleted: false,
  };
}

describe('useMessageStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorageMock());
    localStorage.setItem('miragetea-auth-mode', 'local');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('caps active chat messages during repeated upserts', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const existingMessages = Array.from({ length: 400 }, (_, index) => buildMessage(index, chatId));
    const cachedMessages = existingMessages.slice(-120);

    useMessageStore.setState({
      messages: existingMessages,
      messageWindowsByChatId: {
        [chatId]: {
          messages: cachedMessages,
          lastSyncedAt: 0,
          updatedAt: cachedMessages.at(-1)?.timestamp ?? 0,
        },
      },
      pendingOperations: [],
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    useMessageStore.getState().upsertMessage(buildMessage(400, chatId));

    const state = useMessageStore.getState();
    expect(state.messages).toHaveLength(400);
    expect(state.messages[0]?.id).toBe('message-1');
    expect(state.messages.at(-1)?.id).toBe('message-400');
    expect(state.messageWindowsByChatId[chatId]?.messages).toHaveLength(120);
    expect(state.messageWindowsByChatId[chatId]?.messages[0]?.id).toBe('message-281');
    expect(state.messageWindowsByChatId[chatId]?.messages.at(-1)?.id).toBe('message-400');
  });

  it('strips non-message fields when merging fetched and persisted messages', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const bloatedMessage = {
      ...buildMessage(1, chatId),
      debugPayload: { text: 'server-only' },
      rawResponse: Array.from({ length: 8 }, (_, index) => ({ index })),
    } as unknown as Message;

    useMessageStore.setState({
      messages: [bloatedMessage],
      messageWindowsByChatId: {
        [chatId]: {
          messages: [bloatedMessage],
          lastSyncedAt: 0,
          updatedAt: 1,
        },
      },
      pendingOperations: [],
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    useMessageStore.getState().upsertMessage(buildMessage(2, chatId));

    const state = useMessageStore.getState();
    const activeMessage = state.messages.find((message) => message.id === 'message-1') as unknown as Record<string, unknown>;
    const cachedMessage = state.messageWindowsByChatId[chatId]?.messages.find((message) => message.id === 'message-1') as unknown as Record<string, unknown>;
    expect(activeMessage.debugPayload).toBeUndefined();
    expect(activeMessage.rawResponse).toBeUndefined();
    expect(cachedMessage.debugPayload).toBeUndefined();
    expect(cachedMessage.rawResponse).toBeUndefined();
  });

  it('keeps rich message metadata and caller timestamps for local messages', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const created = await useMessageStore.getState().addMessage({
      chatId,
      type: 'ai',
      senderId: 'character-1',
      senderName: '角色',
      content: '给你看这张照片',
      emotion: 0,
      timestamp: 12345,
      metadata: {
        attachments: [{
          id: 'image-1',
          kind: 'image',
          status: 'queued',
          altText: '自拍照',
          createdAt: 12345,
          updatedAt: 12345,
        }],
      },
    });

    expect(created.timestamp).toBe(12345);
    expect(created.metadata?.attachments?.[0]?.kind).toBe('image');
    expect(useMessageStore.getState().messageWindowsByChatId[chatId]?.messages[0]?.metadata?.attachments?.[0]?.altText).toBe('自拍照');
  });
});
