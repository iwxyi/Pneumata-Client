import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GroupChat } from '../types/chat';
import { api } from '../services/api';

interface PersistedChatState {
  chats: GroupChat[];
  currentChatId: string | null;
  lastSyncedAt: number;
}

function getUserId() {
  const userRaw = localStorage.getItem('miragetea-user');
  return userRaw ? JSON.parse(userRaw).id : 'guest';
}

function getChatStorageKey() {
  return `mirageTea-chats-${getUserId()}`;
}

function createChatStorage() {
  return {
    getItem: (name: string) => {
      const scopedName = getChatStorageKey();
      return localStorage.getItem(name === 'mirageTea-chats' ? scopedName : name);
    },
    setItem: (name: string, value: string) => {
      const scopedName = getChatStorageKey();
      localStorage.setItem(name === 'mirageTea-chats' ? scopedName : name, value);
    },
    removeItem: (name: string) => {
      const scopedName = getChatStorageKey();
      localStorage.removeItem(name === 'mirageTea-chats' ? scopedName : name);
    },
  };
}

function mergeChats(localChats: GroupChat[], remoteChats: GroupChat[]) {
  const merged = new Map<string, GroupChat>();

  for (const chat of localChats) {
    merged.set(chat.id, chat);
  }

  for (const remote of remoteChats) {
    const local = merged.get(remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      merged.set(remote.id, remote);
    }
  }

  return Array.from(merged.values())
    .filter((chat) => remoteChats.some((remote) => remote.id === chat.id))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function clearPersistedChatStore() {
  localStorage.removeItem(getChatStorageKey());
}

const chatStorage = createChatStorage();

interface ChatStore extends PersistedChatState {
  isLoading: boolean;

  loadChats: () => Promise<void>;
  addChat: (chat: Omit<GroupChat, 'id' | 'createdAt' | 'updatedAt' | 'lastMessageAt'>) => Promise<GroupChat>;
  updateChat: (id: string, updates: Partial<GroupChat>) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  setCurrentChat: (id: string | null) => void;
  getCurrentChat: () => GroupChat | undefined;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      chats: [],
      currentChatId: null,
      lastSyncedAt: 0,
      isLoading: false,

      loadChats: async () => {
        set((state) => ({ isLoading: state.chats.length === 0 }));
        try {
          const remoteChats = await api.getChats() as unknown as GroupChat[];
          set((state) => ({
            chats: mergeChats(state.chats, remoteChats),
            isLoading: false,
            lastSyncedAt: Date.now(),
          }));
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
          showRoleActions: chatData.showRoleActions,
          topicSeed: chatData.topicSeed,
        });
        const chat = result as unknown as GroupChat;
        set((state) => ({
          chats: [chat, ...state.chats.filter((item) => item.id !== chat.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
        }));
        return chat;
      },

      updateChat: async (id, updates) => {
        const result = await api.updateChat(id, updates as Record<string, unknown>);
        const updatedChat = result as unknown as GroupChat;
        set((state) => ({
          chats: state.chats
            .map((c) => (c.id === id ? updatedChat : c))
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
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
    }),
    {
      name: 'mirageTea-chats',
      storage: chatStorage,
      partialize: (state) => ({
        chats: state.chats,
        currentChatId: state.currentChatId,
        lastSyncedAt: state.lastSyncedAt,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<PersistedChatState>),
      }),
    }
  )
);
