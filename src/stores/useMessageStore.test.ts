import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/message';
import { storageKey } from '../constants/brand';

const getMessagesMock = vi.hoisted(() => vi.fn());
const getSyncChangesMock = vi.hoisted(() => vi.fn());

vi.mock('../services/api', () => ({
  api: {
    getSyncChanges: getSyncChangesMock,
    getMessages: getMessagesMock,
    createMessage: vi.fn(),
    deleteMessage: vi.fn(),
  },
}));

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
    getMessagesMock.mockReset();
    getSyncChangesMock.mockReset();
    vi.stubGlobal('localStorage', createStorageMock());
    localStorage.setItem(storageKey('auth-mode'), 'local');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('caps active chat messages during repeated upserts', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const existingMessages = Array.from({ length: 1000 }, (_, index) => buildMessage(index, chatId));
    const cachedMessages = existingMessages;

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

    useMessageStore.getState().upsertMessage(buildMessage(1000, chatId));

    const state = useMessageStore.getState();
    expect(state.messages).toHaveLength(1000);
    expect(state.messages[0]?.id).toBe('message-1');
    expect(state.messages.at(-1)?.id).toBe('message-1000');
    expect(state.messageWindowsByChatId[chatId]?.messages).toHaveLength(1000);
    expect(state.messageWindowsByChatId[chatId]?.messages[0]?.id).toBe('message-1');
    expect(state.messageWindowsByChatId[chatId]?.messages.at(-1)?.id).toBe('message-1000');
  });

  it('keeps message windows with pending operations during cache eviction', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const pendingChatId = 'chat-pending';
    const ordinaryChatId = 'chat-ordinary-old';
    const windows = Object.fromEntries([
      [pendingChatId, {
        messages: [buildMessage(1, pendingChatId)],
        lastSyncedAt: 0,
        updatedAt: 1,
      }],
      [ordinaryChatId, {
        messages: [buildMessage(2, ordinaryChatId)],
        lastSyncedAt: 0,
        updatedAt: 2,
      }],
      ...Array.from({ length: 10 }, (_, index) => {
        const chatId = `chat-recent-${index}`;
        return [chatId, {
          messages: [buildMessage(index + 10, chatId)],
          lastSyncedAt: 0,
          updatedAt: 100 + index,
        }];
      }),
    ]);

    useMessageStore.setState({
      messages: [],
      messageWindowsByChatId: windows,
      pendingOperations: [{
        id: 'pending-message-create',
        kind: 'create',
        chatId: pendingChatId,
        localMessageId: 'message-1',
        messageId: 'message-1',
        payload: buildMessage(1, pendingChatId),
        createdAt: Date.now(),
        attemptCount: 0,
        status: 'pending',
      }],
      activeChatId: null,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    useMessageStore.getState().upsertMessage(buildMessage(999, 'chat-new'));

    const cache = useMessageStore.getState().messageWindowsByChatId;
    expect(Object.keys(cache)).toHaveLength(12);
    expect(cache[pendingChatId]).toBeDefined();
    expect(cache[ordinaryChatId]).toBeUndefined();
    expect(cache['chat-new']).toBeDefined();
  });

  it('keeps cloud-backed windows scrollable when local cache is only a partial window', async () => {
    localStorage.setItem(storageKey('auth-mode'), 'cloud');
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const cachedMessages = Array.from({ length: 100 }, (_, index) => buildMessage(index + 901, chatId));

    useMessageStore.setState({
      messages: [],
      messageWindowsByChatId: {
        [chatId]: {
          messages: cachedMessages,
          lastSyncedAt: Date.now(),
          updatedAt: cachedMessages.at(-1)?.timestamp ?? 0,
        },
      },
      pendingOperations: [],
      activeChatId: null,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: false,
    });

    await useMessageStore.getState().hydrateMessagesFromCache(chatId);

    expect(useMessageStore.getState().messages[0]?.id).toBe('message-961');
    expect(useMessageStore.getState().hasMore).toBe(true);
  });

  it('reopens cloud chat windows with a partial persisted page even if remoteExhausted was persisted', async () => {
    localStorage.setItem(storageKey('auth-mode'), 'cloud');
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const persistedMessages = Array.from({ length: 7 }, (_, index) => buildMessage(index + 994, chatId));
    const fetchedMessages = Array.from({ length: 40 }, (_, index) => buildMessage(index + 961, chatId));
    getMessagesMock.mockResolvedValueOnce(fetchedMessages);

    useMessageStore.setState({
      messages: [],
      messageWindowsByChatId: {
        [chatId]: {
          messages: persistedMessages,
          lastSyncedAt: Date.now(),
          updatedAt: persistedMessages.at(-1)?.timestamp ?? 0,
          remoteExhausted: true,
        },
      },
      pendingOperations: [],
      activeChatId: null,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: false,
    });

    await useMessageStore.getState().openChatWindow(chatId, { limit: 40, revalidate: true });

    const state = useMessageStore.getState();
    expect(getMessagesMock).toHaveBeenCalledWith(chatId, { limit: 40, before: undefined });
    expect(state.messages[0]?.id).toBe('message-961');
    expect(state.messages).toHaveLength(40);
    expect(state.hasMore).toBe(true);
  });

  it('loads older cloud messages past the local cache window', async () => {
    localStorage.setItem(storageKey('auth-mode'), 'cloud');
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const cachedMessages = Array.from({ length: 100 }, (_, index) => buildMessage(index + 901, chatId));
    const olderMessages = Array.from({ length: 40 }, (_, index) => buildMessage(index + 861, chatId));
    getMessagesMock.mockResolvedValueOnce(olderMessages);

    useMessageStore.setState({
      messages: cachedMessages.slice(-40),
      messageWindowsByChatId: {
        [chatId]: {
          messages: cachedMessages,
          lastSyncedAt: Date.now(),
          updatedAt: cachedMessages.at(-1)?.timestamp ?? 0,
        },
      },
      pendingOperations: [],
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    await useMessageStore.getState().loadMessages(chatId, { append: true, before: 961, limit: 40 });

    const state = useMessageStore.getState();
    expect(getMessagesMock).toHaveBeenCalledWith(chatId, { limit: 40, before: 961 });
    expect(state.messages[0]?.id).toBe('message-861');
    expect(state.messages.at(-1)?.id).toBe('message-1000');
    expect(state.messages).toHaveLength(80);
    expect(state.hasMore).toBe(true);
  });

  it('uses paged message API when cloud window probe is modified without inline changes', async () => {
    localStorage.setItem(storageKey('auth-mode'), 'cloud');
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const fetchedMessages = Array.from({ length: 40 }, (_, index) => buildMessage(index + 1, chatId));
    getSyncChangesMock.mockResolvedValueOnce({
      status: 'modified',
      scope: `messages.window:${chatId}`,
      cursor: 'messages.window:rev-1',
      revision: 'messages.window:rev-1',
      changes: [],
    });
    getMessagesMock.mockResolvedValueOnce(fetchedMessages);

    useMessageStore.setState({
      messages: [],
      messageWindowsByChatId: {
        [chatId]: {
          messages: Array.from({ length: 40 }, (_, index) => buildMessage(index + 41, chatId)),
          lastSyncedAt: Date.now() - 60_000,
          updatedAt: 80,
        },
      },
      pendingOperations: [],
      activeChatId: null,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    await useMessageStore.getState().loadMessages(chatId, { limit: 40 });

    expect(getSyncChangesMock).toHaveBeenCalledWith({ scope: `messages.window:${chatId}`, since: null });
    expect(getMessagesMock).toHaveBeenCalledWith(chatId, { limit: 40, before: undefined });
    expect(useMessageStore.getState().messages).toHaveLength(40);
    expect(useMessageStore.getState().messageWindowsByChatId[chatId]?.messages).toHaveLength(80);
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

  it('keeps committed streamed text when a stale streaming frame is upserted later', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const committed: Message = {
      id: 'local-stream-1',
      clientKey: 'local-stream-1',
      serverId: 'server-message-1',
      chatId,
      type: 'ai',
      senderId: 'character-1',
      senderName: '角色',
      content: '完整正式内容，不能被后到的短流式帧覆盖。',
      emotion: 0,
      timestamp: 123,
      isDeleted: false,
      isStreaming: false,
    };
    const staleStreaming: Message = {
      ...committed,
      serverId: undefined,
      content: '完整正式',
      isStreaming: true,
    };

    useMessageStore.setState({
      messages: [committed],
      messageWindowsByChatId: {
        [chatId]: {
          messages: [committed],
          lastSyncedAt: 0,
          updatedAt: committed.timestamp,
        },
      },
      pendingOperations: [],
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    useMessageStore.getState().upsertMessage(staleStreaming);

    const state = useMessageStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.content).toBe(committed.content);
    expect(state.messages[0]?.isStreaming).toBe(false);
    expect(state.messageWindowsByChatId[chatId]?.messages).toHaveLength(1);
    expect(state.messageWindowsByChatId[chatId]?.messages[0]?.content).toBe(committed.content);
  });

  it('does not merge a new streaming turn into the previous same-speaker message by content', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const previous: Message = {
      id: 'previous-message-1',
      chatId,
      type: 'ai',
      senderId: 'character-1',
      senderName: '角色',
      content: '上一条刚说过的话',
      emotion: 0,
      timestamp: 1000,
      isDeleted: false,
      isStreaming: false,
    };
    const streaming: Message = {
      id: 'streaming-message-2',
      clientKey: 'streaming-message-2',
      chatId,
      type: 'ai',
      senderId: 'character-1',
      senderName: '角色',
      content: previous.content,
      emotion: 0,
      timestamp: 2000,
      isDeleted: false,
      isStreaming: true,
    };

    useMessageStore.setState({
      messages: [previous],
      messageWindowsByChatId: {
        [chatId]: {
          messages: [previous],
          lastSyncedAt: 0,
          updatedAt: previous.timestamp,
        },
      },
      pendingOperations: [],
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    useMessageStore.getState().upsertMessage(streaming);

    const state = useMessageStore.getState();
    expect(state.messages.map((message) => message.id)).toEqual(['previous-message-1', 'streaming-message-2']);
    expect(state.messages[0]?.isStreaming).toBe(false);
    expect(state.messages[1]?.isStreaming).toBe(true);
    expect(state.messageWindowsByChatId[chatId]?.messages.map((message) => message.id)).toEqual(['previous-message-1', 'streaming-message-2']);
  });

  it('keeps repeated committed same-speaker content as distinct messages', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const first = {
      ...buildMessage(1, chatId),
      id: 'repeat-1',
      content: '好',
      timestamp: 1000,
    };
    const second = {
      ...buildMessage(2, chatId),
      id: 'repeat-2',
      content: '好',
      timestamp: 1200,
    };

    useMessageStore.setState({
      messages: [first],
      messageWindowsByChatId: {
        [chatId]: {
          messages: [first],
          lastSyncedAt: 0,
          updatedAt: first.timestamp,
        },
      },
      pendingOperations: [],
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    useMessageStore.getState().upsertMessage(second);

    const state = useMessageStore.getState();
    expect(state.messages.map((message) => message.id)).toEqual(['repeat-1', 'repeat-2']);
    expect(state.messageWindowsByChatId[chatId]?.messages.map((message) => message.id)).toEqual(['repeat-1', 'repeat-2']);
  });

  it('merges local streamed messages with server confirmations by shared server id', async () => {
    const { useMessageStore } = await import('./useMessageStore');
    const chatId = 'chat-1';
    const local: Message = {
      id: 'local-stream-1',
      clientKey: 'local-stream-1',
      serverId: 'server-message-1',
      chatId,
      type: 'ai',
      senderId: 'character-1',
      senderName: '角色',
      content: '逐字显示完整内容',
      emotion: 0,
      timestamp: 123,
      isDeleted: false,
      isStreaming: false,
    };
    const remote: Message = {
      ...local,
      id: 'server-message-1',
      clientKey: undefined,
      timestamp: 999,
    };

    useMessageStore.setState({
      messages: [local],
      messageWindowsByChatId: {
        [chatId]: {
          messages: [local],
          lastSyncedAt: 0,
          updatedAt: local.timestamp,
        },
      },
      pendingOperations: [],
      activeChatId: chatId,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,
    });

    useMessageStore.getState().upsertMessage(remote);

    const state = useMessageStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('local-stream-1');
    expect(state.messages[0]?.clientKey).toBe('local-stream-1');
    expect(state.messages[0]?.serverId).toBe('server-message-1');
    expect(state.messageWindowsByChatId[chatId]?.messages).toHaveLength(1);
  });

  it('keeps first message pending until a newly created local chat is synced', async () => {
    localStorage.setItem(storageKey('auth-mode'), 'cloud');
    const { useMessageStore } = await import('./useMessageStore');
    const { useChatStore } = await import('./useChatStore');
    useChatStore.setState({
      chats: [{
        id: 'local-chat-12345678',
        type: 'direct',
        mode: 'open_chat',
        modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
        modeState: { phase: 'free' },
        name: '新单聊',
        topic: '',
        style: 'free',
        runtimeEvolutionIntensity: 'balanced',
        memberIds: ['char-1'],
        speed: 1,
        isActive: false,
        allowIntervention: true,
        showRoleActions: true,
        topicSeed: '',
        runtimeSeed: { notes: [], artifacts: [] },
        createdAt: 1,
        updatedAt: 1,
        lastMessageAt: 1,
      } as never],
      currentChatId: 'local-chat-12345678',
      lastSyncedAt: 1,
      pendingOperations: [{
        id: 'chat-create-op',
        kind: 'create',
        entityId: 'local-chat-12345678',
        patch: { id: 'local-chat-12345678' },
        targetIds: ['local-chat-12345678'],
        clientTimestamp: Date.now(),
        attemptCount: 0,
        status: 'pending',
      } as never],
      pendingEditSyncCount: 1,
      pendingEditSyncError: null,
      remoteDeletedChatIds: [],
      remoteDeletedChats: [],
      fieldConflicts: [],
      chatSummaryLoadedAt: 1,
      isLoading: false,
    });

    await useMessageStore.getState().addMessage({
      chatId: 'local-chat-12345678',
      type: 'ai',
      senderId: 'char-1',
      senderName: '角色',
      content: '第一句',
      emotion: 0,
    });

    expect(useMessageStore.getState().pendingOperations).toHaveLength(1);
    expect(useMessageStore.getState().pendingOperations[0]?.chatId).toBe('local-chat-12345678');
    expect(useMessageStore.getState().messageWindowsByChatId['local-chat-12345678']?.messages[0]?.chatId).toBe('local-chat-12345678');
    expect(useChatStore.getState().pendingOperations[0]?.kind).toBe('create');
  });

});
