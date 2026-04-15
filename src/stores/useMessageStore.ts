import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from '../types/message';
import { api } from '../services/api';

const MAX_CACHED_MESSAGES_PER_CHAT = 40;
const MAX_CACHED_CHATS = 12;

interface CachedMessageWindow {
  messages: Message[];
  lastSyncedAt: number;
  updatedAt: number;
}

interface PendingMessageOperation {
  kind: 'create' | 'delete';
  chatId: string;
  messageId?: string;
  payload?: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>;
  createdAt: number;
}

function getUserId() {
  const userRaw = localStorage.getItem('miragetea-user');
  return userRaw ? JSON.parse(userRaw).id : 'guest';
}

function getMessageStorageKey() {
  return `mirageTea-messages-${getUserId()}`;
}

function createMessageStorage() {
  return {
    getItem: (name: string) => {
      const scopedName = getMessageStorageKey();
      return localStorage.getItem(name === 'mirageTea-messages' ? scopedName : name);
    },
    setItem: (name: string, value: string) => {
      const scopedName = getMessageStorageKey();
      localStorage.setItem(name === 'mirageTea-messages' ? scopedName : name, value);
    },
    removeItem: (name: string) => {
      const scopedName = getMessageStorageKey();
      localStorage.removeItem(name === 'mirageTea-messages' ? scopedName : name);
    },
  };
}

export function clearPersistedMessageStore() {
  localStorage.removeItem(getMessageStorageKey());
}

function dedupeMessages(messages: Message[]) {
  return messages.filter((message, index, array) => array.findIndex((item) => item.id === message.id) === index);
}

function mergeMessages(localMessages: Message[], remoteMessages: Message[]) {
  const merged = new Map<string, Message>();

  for (const message of localMessages) {
    merged.set(message.id, message);
  }

  for (const remote of remoteMessages) {
    const local = merged.get(remote.id);
    if (!local || remote.timestamp >= local.timestamp || remote.isDeleted !== local.isDeleted) {
      merged.set(remote.id, remote);
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function trimMessages(messages: Message[]) {
  return dedupeMessages(messages).slice(-MAX_CACHED_MESSAGES_PER_CHAT);
}

function trimCache(cache: Record<string, CachedMessageWindow>) {
  const entries = Object.entries(cache).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(
    entries
      .slice(0, MAX_CACHED_CHATS)
      .map(([chatId, window]) => [chatId, { ...window, messages: trimMessages(window.messages) }])
  );
}

const messageStorage = createMessageStorage();

interface MessageStore {
  messages: Message[];
  messageWindowsByChatId: Record<string, CachedMessageWindow>;
  pendingOperations: PendingMessageOperation[];
  activeChatId: string | null;
  isLoading: boolean;
  isLoadingOlder: boolean;
  hasMore: boolean;

  hydrateMessagesFromCache: (chatId: string) => void;
  loadMessages: (chatId: string, options?: { append?: boolean; before?: number; limit?: number }) => Promise<void>;
  addMessage: (msg: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) => Promise<Message>;
  deleteMessage: (id: string) => Promise<void>;
  deleteLastNMessages: (chatId: string, n: number) => Promise<void>;
  clearMessages: () => void;
  getRecentMessages: (n: number) => Message[];
}

export const useMessageStore = create<MessageStore>()(
  persist(
    (set, get) => ({
      messages: [],
      messageWindowsByChatId: {},
      pendingOperations: [],
      activeChatId: null,
      isLoading: false,
      isLoadingOlder: false,
      hasMore: true,

      hydrateMessagesFromCache: (chatId) => {
        const cachedWindow = get().messageWindowsByChatId[chatId];
        const cachedMessages = cachedWindow?.messages || [];
        set({
          activeChatId: chatId,
          messages: cachedMessages,
          hasMore: cachedMessages.length >= 20,
        });
      },

      loadMessages: async (chatId, options) => {
        const isAppend = Boolean(options?.append);
        set({ isLoading: !isAppend, isLoadingOlder: isAppend, activeChatId: chatId });
        try {
          const limit = options?.limit ?? 20;
          const fetched = await api.getMessages(chatId, { limit, before: options?.before }) as unknown as Message[];
          set((state) => {
            const currentWindow = state.messageWindowsByChatId[chatId];
            const current = currentWindow?.messages || [];
            const merged = isAppend
              ? mergeMessages(current, fetched)
              : mergeMessages(current, fetched);
            const trimmed = trimMessages(merged);
            const nextCache = trimCache({
              ...state.messageWindowsByChatId,
              [chatId]: {
                messages: trimmed,
                lastSyncedAt: Date.now(),
                updatedAt: trimmed.at(-1)?.timestamp || currentWindow?.updatedAt || Date.now(),
              },
            });
            return {
              messages: state.activeChatId === chatId ? merged : state.messages,
              activeChatId: chatId,
              messageWindowsByChatId: nextCache,
              isLoading: false,
              isLoadingOlder: false,
              hasMore: fetched.length === limit,
            };
          });
        } catch (error) {
          console.error('Failed to load messages:', error);
          set({ isLoading: false, isLoadingOlder: false });
        }
      },

      addMessage: async (msgData) => {
        const result = await api.createMessage(msgData.chatId, {
          type: msgData.type,
          senderId: msgData.senderId,
          senderName: msgData.senderName,
          content: msgData.content,
          emotion: msgData.emotion,
        });
        const message = result as unknown as Message;
        set((state) => {
          const currentWindow = state.messageWindowsByChatId[msgData.chatId];
          const current = currentWindow?.messages || [];
          const nextChatMessages = trimMessages([...current, message]);
          return {
            messages: state.activeChatId === msgData.chatId ? mergeMessages(state.messages, [message]) : state.messages,
            messageWindowsByChatId: trimCache({
              ...state.messageWindowsByChatId,
              [msgData.chatId]: {
                messages: nextChatMessages,
                lastSyncedAt: Date.now(),
                updatedAt: message.timestamp,
              },
            }),
          };
        });
        return message;
      },

      deleteMessage: async (id) => {
        await api.deleteMessage(id);
        set((state) => {
          const nextWindows = Object.fromEntries(
            Object.entries(state.messageWindowsByChatId).map(([chatId, window]) => {
              const nextMessages = window.messages.map((message) => (message.id === id ? { ...message, isDeleted: true } : message));
              return [chatId, { ...window, messages: nextMessages }];
            })
          );
          return {
            messages: state.messages.map((m) => (m.id === id ? { ...m, isDeleted: true } : m)),
            messageWindowsByChatId: trimCache(nextWindows),
          };
        });
      },

      deleteLastNMessages: async (chatId, n) => {
        const msgs = get().messages.filter((m) => m.chatId === chatId && !m.isDeleted).slice(-n);
        for (const msg of msgs) {
          await api.deleteMessage(msg.id);
        }
        set((state) => {
          const nextMessages = state.messages.map((m) => (
            msgs.find((dm) => dm.id === m.id) ? { ...m, isDeleted: true } : m
          ));
          const currentWindow = state.messageWindowsByChatId[chatId];
          const nextChatMessages = (currentWindow?.messages || []).map((m) => (
            msgs.find((dm) => dm.id === m.id) ? { ...m, isDeleted: true } : m
          ));
          return {
            messages: nextMessages,
            messageWindowsByChatId: trimCache({
              ...state.messageWindowsByChatId,
              [chatId]: {
                messages: nextChatMessages,
                lastSyncedAt: Date.now(),
                updatedAt: nextChatMessages.at(-1)?.timestamp || currentWindow?.updatedAt || Date.now(),
              },
            }),
          };
        });
      },

      clearMessages: () => set({ messages: [], activeChatId: null, hasMore: true }),

      getRecentMessages: (n) => {
        return get().messages.filter((m) => !m.isDeleted).slice(-n);
      },
    }),
    {
      name: 'mirageTea-messages',
      storage: messageStorage,
      partialize: (state) => ({
        messageWindowsByChatId: state.messageWindowsByChatId,
        pendingOperations: state.pendingOperations,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        messageWindowsByChatId: trimCache((persistedState as Partial<MessageStore>)?.messageWindowsByChatId || {}),
        pendingOperations: (persistedState as Partial<MessageStore>)?.pendingOperations || [],
      }),
    }
  )
);
