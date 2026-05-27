import { useCallback, useRef, useState } from 'react';

export function useAutoHideHeader(disabled = false) {
  const lastScrollTopRef = useRef(0);
  const [hidden, setHidden] = useState(false);

  const reset = useCallback(() => {
    lastScrollTopRef.current = 0;
    setHidden(false);
  }, []);

  const handleScrollTop = useCallback((nextTop: number) => {
    if (disabled) return;
    const previousTop = lastScrollTopRef.current;
    const delta = nextTop - previousTop;
    lastScrollTopRef.current = nextTop;
    if (nextTop < 28) {
      setHidden(false);
      return;
    }
    if (Math.abs(delta) < 8) return;
    setHidden(delta > 0);
  }, [disabled]);

  return { hidden: disabled ? false : hidden, reset, handleScrollTop };
}
