import { create } from 'zustand';
import type { AICharacter } from '../types/character';
import { api } from '../services/api';

interface CharacterStore {
  characters: AICharacter[];
  isLoading: boolean;

  loadCharacters: () => Promise<void>;
  addCharacter: (char: Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>) => Promise<AICharacter>;
  updateCharacter: (id: string, updates: Partial<AICharacter>) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  getCharacter: (id: string) => AICharacter | undefined;
  getPresets: () => AICharacter[];
  getCustom: () => AICharacter[];
  importCharacters: (chars: AICharacter[]) => Promise<void>;
  initializePresets: () => Promise<void>;
}

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  characters: [],
  isLoading: false,

  loadCharacters: async () => {
    set({ isLoading: true });
    try {
      const characters = await api.getCharacters() as unknown as AICharacter[];
      set({ characters, isLoading: false });
    } catch (error) {
      console.error('Failed to load characters:', error);
      set({ isLoading: false });
    }
  },

  addCharacter: async (charData) => {
    const result = await api.createCharacter({
      name: charData.name,
      avatar: charData.avatar,
      personality: charData.personality,
      expertise: charData.expertise,
      speakingStyle: charData.speakingStyle,
      background: charData.background,
      modelProfileId: charData.modelProfileId,
    });
    const character = result as unknown as AICharacter;
    set((state) => ({ characters: [...state.characters, character] }));
    return character;
  },

  updateCharacter: async (id, updates) => {
    const result = await api.updateCharacter(id, updates);
    const updatedChar = result as unknown as AICharacter;
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
        personality: c.personality,
        expertise: c.expertise,
        speakingStyle: c.speakingStyle,
        background: c.background,
        modelProfileId: c.modelProfileId,
      });
      created.push(result as unknown as AICharacter);
    }
    set((state) => ({ characters: [...state.characters, ...created] }));
  },

  // Presets are now initialized server-side, this just loads from API
  initializePresets: async () => {
    await get().loadCharacters();
  },
}));
