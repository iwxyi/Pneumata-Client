import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CLIENT_STORE_SCHEMA_VERSION, migrateUiStoreState } from './storeMigrations';

interface UIStore {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  godModeActive: boolean;
  topicGuideOpen: boolean;
  speakAsCharacterId: string | null;
  rightPanelTab: 'members' | 'narrative' | 'world' | 'actions';

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelTab: (tab: 'members' | 'narrative' | 'world' | 'actions') => void;
  setGodModeActive: (active: boolean) => void;
  setTopicGuideOpen: (open: boolean) => void;
  setSpeakAsCharacter: (id: string | null) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      rightPanelOpen: false,
      godModeActive: false,
      topicGuideOpen: false,
      speakAsCharacterId: null,
      rightPanelTab: 'members',

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setGodModeActive: (active) => set({ godModeActive: active }),
      setTopicGuideOpen: (open) => set({ topicGuideOpen: open }),
      setSpeakAsCharacter: (id) => set({ speakAsCharacterId: id }),
    }),
    {
      name: 'mirageTea-ui',
      version: CLIENT_STORE_SCHEMA_VERSION,
      migrate: (persistedState) => migrateUiStoreState(persistedState as Partial<UIStore>) as UIStore,
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);

export default useUIStore;
