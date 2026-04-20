import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AICharacter } from '../types/character';
import { normalizeCharacter, normalizeCharacterGroup } from '../types/character';
import { api } from '../services/api';

interface PersistedCharacterState {
  characters: AICharacter[];
  lastSyncedAt: number;
}

function getUserId() {
  const userRaw = localStorage.getItem('miragetea-user');
  return userRaw ? JSON.parse(userRaw).id : 'guest';
}

function getCharacterStorageKey() {
  return `mirageTea-characters-${getUserId()}`;
}

function createCharacterStorage() {
  return {
    getItem: (name: string) => {
      const scopedName = getCharacterStorageKey();
      return localStorage.getItem(name === 'mirageTea-characters' ? scopedName : name);
    },
    setItem: (name: string, value: string) => {
      const scopedName = getCharacterStorageKey();
      localStorage.setItem(name === 'mirageTea-characters' ? scopedName : name, value);
    },
    removeItem: (name: string) => {
      const scopedName = getCharacterStorageKey();
      localStorage.removeItem(name === 'mirageTea-characters' ? scopedName : name);
    },
  };
}

function mergeCharacters(localCharacters: AICharacter[], remoteCharacters: AICharacter[]) {
  const merged = new Map<string, AICharacter>();

  for (const character of localCharacters.map((item) => normalizeCharacter(item))) {
    merged.set(character.id, character);
  }

  for (const remote of remoteCharacters.map((item) => normalizeCharacter(item))) {
    const local = merged.get(remote.id);
    if (!local || remote.updatedAt >= local.updatedAt) {
      merged.set(remote.id, remote);
    }
  }

  return Array.from(merged.values())
    .filter((character) => remoteCharacters.some((remote) => remote.id === character.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export function clearPersistedCharacterStore() {
  localStorage.removeItem(getCharacterStorageKey());
}

const characterStorage = createCharacterStorage();

interface CharacterStore extends PersistedCharacterState {
  isLoading: boolean;

  loadCharacters: () => Promise<void>;
  addCharacter: (char: Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>) => Promise<AICharacter>;
  updateCharacter: (id: string, updates: Partial<AICharacter>) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  deleteCharacters: (ids: string[]) => Promise<void>;
  updateCharactersGroup: (ids: string[], group: string | null) => Promise<void>;
  getCharacter: (id: string) => AICharacter | undefined;
  getPresets: () => AICharacter[];
  getCustom: () => AICharacter[];
  importCharacters: (chars: AICharacter[]) => Promise<void>;
  initializePresets: () => Promise<void>;
}

export const useCharacterStore = create<CharacterStore>()(
  persist(
    (set, get) => ({
      characters: [],
      lastSyncedAt: 0,
      isLoading: false,

      loadCharacters: async () => {
        set((state) => ({ isLoading: state.characters.length === 0 }));
        try {
          const remoteCharacters = await api.getCharacters() as unknown as AICharacter[];
          set((state) => ({
            characters: mergeCharacters(state.characters, remoteCharacters),
            isLoading: false,
            lastSyncedAt: Date.now(),
          }));
        } catch (error) {
          console.error('Failed to load characters:', error);
          set({ isLoading: false });
        }
      },

      addCharacter: async (charData) => {
        console.log('[store:addCharacter:input]', charData);
        const result = await api.createCharacter({
          name: charData.name,
          avatar: charData.avatar,
          personality: charData.personality as unknown as Record<string, number>,
          behavior: charData.behavior,
          expertise: charData.expertise,
          speakingStyle: charData.speakingStyle,
          background: charData.background,
          group: normalizeCharacterGroup(charData.group),
          relationships: charData.relationships,
          memory: charData.memory,
          layeredMemories: charData.layeredMemories,
          intervention: charData.intervention,
          runtimeTimeline: charData.runtimeTimeline,
          modelProfileId: charData.modelProfileId,
          bubbleStyleId: charData.bubbleStyleId,
        });
        const character = normalizeCharacter(result as unknown as AICharacter);
        set((state) => ({
          characters: mergeCharacters(state.characters, [character, ...state.characters]),
        }));
        return character;
      },

      updateCharacter: async (id, updates) => {
        const result = await api.updateCharacter(id, updates);
        const updatedChar = normalizeCharacter(result as unknown as AICharacter);
        set((state) => ({
          characters: state.characters.map((c) => (c.id === id ? updatedChar : c)),
        }));
      },

      deleteCharacter: async (id) => {
        await api.deleteCharacter(id);
        set((state) => ({
          characters: state.characters.filter((c) => c.id !== id),
        }));
      },

      deleteCharacters: async (ids) => {
        const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
        if (!normalizedIds.length) return;
        await api.bulkDeleteCharacters(normalizedIds);
        set((state) => ({
          characters: state.characters.filter((c) => !normalizedIds.includes(c.id)),
        }));
      },

      updateCharactersGroup: async (ids, group) => {
        const normalizedIds = Array.from(new Set(ids.filter(Boolean)));
        if (!normalizedIds.length) return;
        const result = await api.bulkUpdateCharacters(normalizedIds, { group: normalizeCharacterGroup(group) });
        const updatedCharacters = Array.isArray(result.characters)
          ? result.characters.map((item) => normalizeCharacter(item as unknown as AICharacter))
          : [];
        set((state) => ({
          characters: updatedCharacters.length ? mergeCharacters(state.characters, updatedCharacters) : state.characters,
        }));
      },

      getCharacter: (id) => {
        return get().characters.find((c) => c.id === id);
      },

      getPresets: () => {
        return get().characters.filter((c) => c.isPreset);
      },

      getCustom: () => {
        return get().characters.filter((c) => !c.isPreset);
      },

      importCharacters: async (chars) => {
        const created: AICharacter[] = [];
        for (const c of chars) {
          const result = await api.createCharacter({
            name: c.name,
            avatar: c.avatar,
            personality: c.personality as unknown as Record<string, number>,
            behavior: c.behavior,
            expertise: c.expertise,
            speakingStyle: c.speakingStyle,
            background: c.background,
            group: normalizeCharacterGroup(c.group),
            relationships: c.relationships,
            memory: c.memory,
            layeredMemories: c.layeredMemories,
            intervention: c.intervention,
            runtimeTimeline: c.runtimeTimeline,
            modelProfileId: c.modelProfileId,
            bubbleStyleId: c.bubbleStyleId,
          });
          created.push(result as unknown as AICharacter);
        }
        set((state) => ({
          characters: mergeCharacters(state.characters, [...created, ...state.characters]),
        }));
      },

      initializePresets: async () => {
        await get().loadCharacters();
      },
    }),
    {
      name: 'mirageTea-characters',
      storage: characterStorage as never,
      partialize: ((state: CharacterStore) => ({
        characters: state.characters,
        lastSyncedAt: state.lastSyncedAt,
      })) as never,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<PersistedCharacterState>),
      }),
    }
  )
);
