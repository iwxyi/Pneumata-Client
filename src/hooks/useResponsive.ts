import { useMediaQuery } from '@mui/material';
import { BREAKPOINTS } from '../constants/defaults';

export const useResponsive = () => {
  const isMobile = useMediaQuery(`(max-width:${BREAKPOINTS.mobile - 1}px)`);
  const isTablet = useMediaQuery(
    `(min-width:${BREAKPOINTS.mobile}px) and (max-width:${BREAKPOINTS.tablet - 1}px)`
  );
  const isDesktop = useMediaQuery(`(min-width:${BREAKPOINTS.tablet}px)`);

  return {
    isMobile,
    isTablet,
    isDesktop,
    breakpoint: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
  } as const;
};
