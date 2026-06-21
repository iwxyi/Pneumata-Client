import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CLIENT_STORE_SCHEMA_VERSION, migrateUiStoreState } from './storeMigrations';
import { scopedStorageKey } from '../constants/brand';

interface UIStore {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelGestureOffset: number | null;
  rightPanelGestureDragging: boolean;
  godModeActive: boolean;
  topicGuideOpen: boolean;
  speakAsCharacterId: string | null;
  rightPanelTab: 'members' | 'narrative' | 'chapters' | 'world' | 'actions';

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelGestureOffset: (offset: number | null) => void;
  setRightPanelGestureDragging: (dragging: boolean) => void;
  setRightPanelTab: (tab: 'members' | 'narrative' | 'chapters' | 'world' | 'actions') => void;
  setGodModeActive: (active: boolean) => void;
  setTopicGuideOpen: (open: boolean) => void;
  setSpeakAsCharacter: (id: string | null) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      rightPanelOpen: false,
      rightPanelGestureOffset: null,
      rightPanelGestureDragging: false,
      godModeActive: false,
      topicGuideOpen: false,
      speakAsCharacterId: null,
      rightPanelTab: 'members',

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      setRightPanelGestureOffset: (offset) => set({ rightPanelGestureOffset: offset }),
      setRightPanelGestureDragging: (dragging) => set({ rightPanelGestureDragging: dragging }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setGodModeActive: (active) => set({ godModeActive: active }),
      setTopicGuideOpen: (open) => set({ topicGuideOpen: open }),
      setSpeakAsCharacter: (id) => set({ speakAsCharacterId: id }),
    }),
    {
      name: scopedStorageKey('ui'),
      version: CLIENT_STORE_SCHEMA_VERSION,
      migrate: (persistedState) => migrateUiStoreState(persistedState as Partial<UIStore>) as UIStore,
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        rightPanelOpen: state.rightPanelOpen,
        rightPanelTab: state.rightPanelTab,
      }),
    }
  )
);

export default useUIStore;
