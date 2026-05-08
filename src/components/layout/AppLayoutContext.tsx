import { createContext, useContext, type ReactNode } from 'react';

export const FLOATING_HEADER_OFFSET = { xs: 0, sm: 0, md: 0 };

export const LayoutHeaderActionsContext = createContext<{
  setHeaderActions: (actions: ReactNode) => void;
  setHeaderTitle: (title: ReactNode | null) => void;
  setHeaderBackAction: (action: (() => void) | null) => void;
  setHideMobileBottomNav: (hidden: boolean) => void;
} | null>(null);

export function useLayoutHeaderActions() {
  const context = useContext(LayoutHeaderActionsContext);
  if (!context) {
    throw new Error('useLayoutHeaderActions must be used within AppLayout');
  }
  return context;
}
