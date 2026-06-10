import { useCallback, useRef, useState } from 'react';

const SHOW_THRESHOLD = 20;
const HIDE_THRESHOLD = 56;
const MIN_DELTA = 8;
const MIN_HIDE_SCROLL_RANGE = 80;
const MIN_HIDE_BOTTOM_SLACK = 72;

type AutoHideHeaderMetrics = {
  scrollHeight: number;
  clientHeight: number;
};

export function useAutoHideHeader(disabled = false) {
  const lastScrollTopRef = useRef(0);
  const [hidden, setHidden] = useState(false);

  const reset = useCallback(() => {
    lastScrollTopRef.current = 0;
    setHidden(false);
  }, []);

  const handleScrollTop = useCallback((nextTop: number, metrics?: AutoHideHeaderMetrics) => {
    if (disabled) return;
    const previousTop = lastScrollTopRef.current;
    const delta = nextTop - previousTop;
    lastScrollTopRef.current = nextTop;

    const scrollRange = metrics ? Math.max(0, metrics.scrollHeight - metrics.clientHeight) : Number.POSITIVE_INFINITY;
    const bottomSlack = Math.max(0, scrollRange - nextTop);
    if (scrollRange < MIN_HIDE_SCROLL_RANGE) {
      setHidden(false);
      return;
    }
    if (!hidden && bottomSlack < MIN_HIDE_BOTTOM_SLACK) {
      setHidden(false);
      return;
    }

    if (nextTop <= SHOW_THRESHOLD) {
      setHidden(false);
      return;
    }

    if (Math.abs(delta) < MIN_DELTA) return;

    if (delta > 0) {
      if (!hidden && nextTop >= HIDE_THRESHOLD) setHidden(true);
      return;
    }

    if (hidden) setHidden(false);
  }, [disabled, hidden]);

  return { hidden: disabled ? false : hidden, reset, handleScrollTop };
}
