import { useEffect } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { useCharacterStore } from '../stores/useCharacterStore';

interface UsePageBootstrapOptions {
  chats?: boolean;
  characters?: boolean;
  settings?: boolean;
  loadSettings?: () => void | Promise<void>;
}

export function usePageBootstrap({ chats = false, characters = false, settings = false, loadSettings }: UsePageBootstrapOptions) {
  const prefetchChats = useChatStore((state) => state.prefetchChats);
  const markChatsWarm = useChatStore((state) => state.markChatsWarm);
  const prefetchCharacters = useCharacterStore((state) => state.prefetchCharacters);
  const markCharactersWarm = useCharacterStore((state) => state.markCharactersWarm);

  useEffect(() => {
    if (chats) {
      markChatsWarm();
      void prefetchChats();
    }
    if (characters) {
      markCharactersWarm();
      void prefetchCharacters();
    }
    if (settings && loadSettings) {
      void loadSettings();
    }
  }, [chats, characters, settings, loadSettings, markChatsWarm, prefetchChats, markCharactersWarm, prefetchCharacters]);
}
