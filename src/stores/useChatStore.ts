import { create } from 'zustand';
import type { GroupChat } from '../types/chat';
import { api } from '../services/api';

interface ChatStore {
  chats: GroupChat[];
  currentChatId: string | null;
  isLoading: boolean;

  loadChats: () => Promise<void>;
  addChat: (chat: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) => Promise<GroupChat>;
  updateChat: (id: string, updates: Partial<GroupChat>) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  setCurrentChat: (id: string | null) => void;
  getCurrentChat: () => GroupChat | undefined;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  currentChatId: null,
  isLoading: false,

  loadChats: async () => {
    set({ isLoading: true });
    try {
      const chats = await api.getChats() as unknown as GroupChat[];
      set({ chats, isLoading: false });
    } catch (error) {
      console.error('Failed to load chats:', error);
      set({ isLoading: false });
    }
  },

  addChat: async (chatData) => {
    const result = await api.createChat({
      name: chatData.name,
      topic: chatData.topic,
      style: chatData.style,
      memberIds: chatData.memberIds,
      speed: chatData.speed,
      isActive: chatData.isActive,
      allowIntervention: chatData.allowIntervention,
      topicSeed: chatData.topicSeed,
    });
    const chat = result as unknown as GroupChat;
    set((state) => ({ chats: [chat, ...state.chats] }));
    return chat;
  },

  updateChat: async (id, updates) => {
    const result = await api.updateChat(id, updates as Record<string, unknown>);
    const updatedChat = result as unknown as GroupChat;
    set((state) => ({
      chats: state.chats.map((c) => (c.id === id ? updatedChat : c)),
    }));
  },

  deleteChat: async (id) => {
    await api.deleteChat(id);
    set((state) => ({
      chats: state.chats.filter((c) => c.id !== id),
      currentChatId: state.currentChatId === id ? null : state.currentChatId,
    }));
  },

  setCurrentChat: (id) => set({ currentChatId: id }),

  getCurrentChat: () => {
    const { chats, currentChatId } = get();
    return chats.find((c) => c.id === currentChatId);
  },
}));
