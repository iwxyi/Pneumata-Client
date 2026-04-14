import { create } from 'zustand';
import type { Message } from '../types/message';
import { api } from '../services/api';

interface MessageStore {
  messages: Message[];
  isLoading: boolean;

  loadMessages: (chatId: string) => Promise<void>;
  addMessage: (msg: Omit<Message, 'id' | 'timestamp' | 'isDeleted'>) => Promise<Message>;
  deleteMessage: (id: string) => Promise<void>;
  deleteLastNMessages: (chatId: string, n: number) => Promise<void>;
  clearMessages: () => void;
  getRecentMessages: (n: number) => Message[];
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: [],
  isLoading: false,

  loadMessages: async (chatId) => {
    set({ isLoading: true });
    try {
      const messages = await api.getMessages(chatId) as unknown as Message[];
      set({ messages, isLoading: false });
    } catch (error) {
      console.error('Failed to load messages:', error);
      set({ isLoading: false });
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
    set((state) => ({ messages: [...state.messages, message] }));
    return message;
  },

  deleteMessage: async (id) => {
    await api.deleteMessage(id);
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, isDeleted: true } : m)),
    }));
  },

  deleteLastNMessages: async (chatId, n) => {
    const msgs = get()
      .messages.filter((m) => m.chatId === chatId && !m.isDeleted)
      .slice(-n);
    for (const msg of msgs) {
      await api.deleteMessage(msg.id);
    }
    set((state) => ({
      messages: state.messages.map((m) =>
        msgs.find((dm) => dm.id === m.id) ? { ...m, isDeleted: true } : m
      ),
    }));
  },

  clearMessages: () => set({ messages: [] }),

  getRecentMessages: (n) => {
    return get()
      .messages.filter((m) => !m.isDeleted)
      .slice(-n);
  },
}));
