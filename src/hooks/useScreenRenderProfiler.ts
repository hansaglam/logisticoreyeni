import { useEffect, useRef } from 'react';

import { PERF_DIAGNOSTICS_ENABLED } from '../utils/performanceDiagnostics';

const RENDER_WARN_THRESHOLD = 10;
const RENDER_SERIOUS_THRESHOLD = 20;
const RENDER_BLOCKER_THRESHOLD = 40;
const PROFILE_WINDOW_MS = 2_000;

export function useScreenRenderProfiler(screenName: string): void {
  const renderCount = useRef(0);
  const mountedAt = useRef<number | null>(null);

  renderCount.current += 1;

  useEffect(() => {
    mountedAt.current = Date.now();
    renderCount.current = 1;
    const timer = setTimeout(() => {
      const count = renderCount.current;
      if (!PERF_DIAGNOSTICS_ENABLED && count < RENDER_SERIOUS_THRESHOLD) {
        return;
      }
      const severity =
        count >= RENDER_BLOCKER_THRESHOLD
          ? 'blocker'
          : count >= RENDER_SERIOUS_THRESHOLD
            ? 'serious'
            : count >= RENDER_WARN_THRESHOLD
              ? 'warning'
              : 'ok';
      if (severity !== 'ok') {
        console.info('[perf-render-storm]', {
          screen: screenName,
          renderCount: count,
          windowMs: PROFILE_WINDOW_MS,
          severity,
        });
      }
    }, PROFILE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [screenName]);
}
