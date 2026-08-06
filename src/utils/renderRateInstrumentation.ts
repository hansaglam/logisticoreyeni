declare const __DEV__: boolean | undefined;

const WINDOW_MS = 2000;
const RENDER_THRESHOLD = 25;
const WARNING_COOLDOWN_MS = 10_000;

type RenderRateTracker = {
  timestamps: number[];
  lastWarningAt: number;
  totalRenderCount: number;
};

const trackers = new Map<string, RenderRateTracker>();

function isInstrumentationEnabled(): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return false;
  }
  return true;
}

function trackerKey(component: string, context?: Record<string, unknown>): string {
  const tutorialId = context?.tutorialId;
  return typeof tutorialId === 'string' ? `${component}:${tutorialId}` : component;
}

/**
 * Rolling-window render rate monitor. Total lifetime render count alone is not a loop signal.
 */
export function trackRenderRate(
  component: string,
  context?: Record<string, unknown>,
): void {
  if (!isInstrumentationEnabled()) {
    return;
  }

  const now = Date.now();
  const key = trackerKey(component, context);
  let tracker = trackers.get(key);
  if (!tracker) {
    tracker = { timestamps: [], lastWarningAt: 0, totalRenderCount: 0 };
    trackers.set(key, tracker);
  }

  tracker.totalRenderCount += 1;
  tracker.timestamps.push(now);
  tracker.timestamps = tracker.timestamps.filter((timestamp) => now - timestamp <= WINDOW_MS);

  if (tracker.timestamps.length <= RENDER_THRESHOLD) {
    return;
  }
  if (now - tracker.lastWarningAt < WARNING_COOLDOWN_MS) {
    return;
  }

  tracker.lastWarningAt = now;
  console.warn('[render-loop-suspected]', {
    component,
    ...context,
    rendersInWindow: tracker.timestamps.length,
    windowMs: WINDOW_MS,
    totalRenderCount: tracker.totalRenderCount,
    reason: 'render-rate-threshold-exceeded',
  });
}

export function resetRenderRateTrackers(): void {
  trackers.clear();
}

export function __getRenderRateTrackerForTest(
  component: string,
  context?: Record<string, unknown>,
): RenderRateTracker | undefined {
  return trackers.get(trackerKey(component, context));
}

export const RENDER_RATE_WINDOW_MS = WINDOW_MS;
export const RENDER_RATE_THRESHOLD = RENDER_THRESHOLD;
export const RENDER_RATE_WARNING_COOLDOWN_MS = WARNING_COOLDOWN_MS;
