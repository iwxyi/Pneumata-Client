import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BREAKPOINTS } from '../../constants/defaults';

type PaneRole = 'master' | 'detail' | null;

interface PaneLayoutContextValue {
  role: PaneRole;
  width: number | null;
  isSplit: boolean;
}

const PaneLayoutContext = createContext<PaneLayoutContextValue>({
  role: null,
  width: null,
  isSplit: false,
});

export function usePaneLayout() {
  return useContext(PaneLayoutContext);
}

export function PaneLayoutProvider({ role, children }: { role: Exclude<PaneRole, null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const updateWidth = () => setWidth(Math.round(element.getBoundingClientRect().width));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const value = useMemo(() => ({ role, width, isSplit: true }), [role, width]);

  return (
    <PaneLayoutContext.Provider value={value}>
      <div
        ref={ref}
        style={{
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </PaneLayoutContext.Provider>
  );
}

export function getResponsiveFlags(width: number | null) {
  if (width == null) return null;
  const isMobile = width < BREAKPOINTS.mobile;
  const isTablet = width >= BREAKPOINTS.mobile && width < BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.tablet;
  return {
    isMobile,
    isTablet,
    isDesktop,
    breakpoint: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
  } as const;
}
