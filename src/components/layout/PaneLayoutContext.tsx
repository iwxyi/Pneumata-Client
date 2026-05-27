import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BREAKPOINTS } from '../../constants/defaults';

type PaneRole = 'master' | 'detail' | null;

interface PaneBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface PaneLayoutContextValue {
  role: PaneRole;
  width: number | null;
  bounds: PaneBounds | null;
  isSplit: boolean;
}

const PaneLayoutContext = createContext<PaneLayoutContextValue>({
  role: null,
  width: null,
  bounds: null,
  isSplit: false,
});

export function usePaneLayout() {
  return useContext(PaneLayoutContext);
}

export function PaneLayoutProvider({ role, children }: { role: Exclude<PaneRole, null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [bounds, setBounds] = useState<PaneBounds | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const updateBounds = () => {
      const rect = element.getBoundingClientRect();
      const nextBounds = {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      setBounds(nextBounds);
      setWidth(nextBounds.width);
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    window.addEventListener('resize', updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, []);

  const value = useMemo(() => ({ role, width, bounds, isSplit: true }), [bounds, role, width]);

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
