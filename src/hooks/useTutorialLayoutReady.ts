import { useCallback, useRef, useState } from 'react';

/**
 * Stable layout-ready flag for tutorial auto-start.
 * onLayout may fire on every parent render; markLayoutReady is a no-op after the first call.
 */
export function useTutorialLayoutReady() {
  const [layoutReady, setLayoutReady] = useState(false);
  const readyRef = useRef(false);

  const markLayoutReady = useCallback(() => {
    if (readyRef.current) {
      return;
    }
    readyRef.current = true;
    setLayoutReady(true);
  }, []);

  const resetLayoutReady = useCallback(() => {
    if (!readyRef.current) {
      return;
    }
    readyRef.current = false;
    setLayoutReady(false);
  }, []);

  return { layoutReady, markLayoutReady, resetLayoutReady };
}
