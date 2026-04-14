import { create } from 'zustand';

interface UIStore {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  godModeActive: boolean;
  topicGuideOpen: boolean;
  speakAsCharacterId: string | null;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setGodModeActive: (active: boolean) => void;
  setTopicGuideOpen: (open: boolean) => void;
  setSpeakAsCharacter: (id: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: false,
  rightPanelOpen: true,
  godModeActive: false,
  topicGuideOpen: false,
  speakAsCharacterId: null,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setGodModeActive: (active) => set({ godModeActive: active }),
  setTopicGuideOpen: (open) => set({ topicGuideOpen: open }),
  setSpeakAsCharacter: (id) => set({ speakAsCharacterId: id }),
}));
