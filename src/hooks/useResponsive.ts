import { useMediaQuery } from '@mui/material';
import { BREAKPOINTS } from '../constants/defaults';
import { getResponsiveFlags, usePaneLayout } from '../components/layout/PaneLayoutContext';

export const useResponsive = () => {
  const pane = usePaneLayout();
  const isMobile = useMediaQuery(`(max-width:${BREAKPOINTS.mobile - 1}px)`);
  const isTablet = useMediaQuery(
    `(min-width:${BREAKPOINTS.mobile}px) and (max-width:${BREAKPOINTS.tablet - 1}px)`
  );
  const isDesktop = useMediaQuery(`(min-width:${BREAKPOINTS.tablet}px)`);
  const paneFlags = getResponsiveFlags(pane.width);

  if (paneFlags) return paneFlags;

  return {
    isMobile,
    isTablet,
    isDesktop,
    breakpoint: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
  } as const;
};
