/**
 * Runtime performance diagnostics — works in release/internal when enabled.
 * Enable: EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=true
 * Dev builds always log warnings for serious thresholds.
 */

export const PERF_DIAGNOSTICS_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true';

export type PerfLongTaskSeverity = 'warning' | 'serious' | 'blocker';

let activeScreen: string | null = null;

export function setPerfActiveScreen(screen: string | null): void {
  activeScreen = screen;
}

export function getPerfActiveScreen(): string | null {
  return activeScreen;
}

export function readPerfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function classifyLongTask(durationMs: number): PerfLongTaskSeverity | null {
  if (durationMs < 50) return null;
  if (durationMs >= 250) return 'blocker';
  if (durationMs >= 100) return 'serious';
  return 'warning';
}

export function measureSyncTask<T>(
  name: string,
  fn: () => T,
  reason?: string,
): T {
  const started = readPerfNow();
  try {
    return fn();
  } finally {
    const durationMs = Math.max(0, readPerfNow() - started);
    const severity = classifyLongTask(durationMs);
    if (severity && (PERF_DIAGNOSTICS_ENABLED || severity !== 'warning')) {
      console.info('[perf-long-task]', {
        name,
        durationMs: Math.round(durationMs * 10) / 10,
        screen: activeScreen,
        reason: reason ?? name,
        severity,
      });
    }
  }
}

export async function measureAsyncTask<T>(
  name: string,
  fn: () => Promise<T>,
  reason?: string,
): Promise<T> {
  const started = readPerfNow();
  try {
    return await fn();
  } finally {
    const durationMs = Math.max(0, readPerfNow() - started);
    const severity = classifyLongTask(durationMs);
    if (severity && (PERF_DIAGNOSTICS_ENABLED || severity !== 'warning')) {
      console.info('[perf-long-task]', {
        name,
        durationMs: Math.round(durationMs * 10) / 10,
        screen: activeScreen,
        reason: reason ?? name,
        severity,
      });
    }
  }
}

export type PerfNavigationEvent = {
  from: string;
  to: string;
  pressAt: number;
  dispatchAt?: number;
  mountAt?: number;
  layoutAt?: number;
};

const pendingNavigation: {
  event: PerfNavigationEvent | null;
} = { event: null };

export function beginPerfNavigation(from: string, to: string, pressAt: number): void {
  pendingNavigation.event = { from, to, pressAt };
}

export function markPerfNavigationDispatch(): void {
  if (!pendingNavigation.event || pendingNavigation.event.dispatchAt != null) return;
  pendingNavigation.event.dispatchAt = readPerfNow();
}

export function markPerfNavigationMount(screen: string): void {
  const pending = pendingNavigation.event;
  if (!pending || pending.to !== screen || pending.mountAt != null) return;
  pending.mountAt = readPerfNow();
}

export function markPerfNavigationLayout(screen: string): void {
  const pending = pendingNavigation.event;
  if (!pending || pending.to !== screen || pending.layoutAt != null) return;
  pending.layoutAt = readPerfNow();
  flushPerfNavigationLog(pending);
  pendingNavigation.event = null;
}

function flushPerfNavigationLog(event: PerfNavigationEvent): void {
  if (!PERF_DIAGNOSTICS_ENABLED && typeof __DEV__ === 'undefined') {
    return;
  }
  const dispatchAt = event.dispatchAt ?? event.pressAt;
  const mountAt = event.mountAt ?? dispatchAt;
  const layoutAt = event.layoutAt ?? mountAt;
  const payload = {
    from: event.from,
    to: event.to,
    pressToDispatchMs: Math.round((dispatchAt - event.pressAt) * 10) / 10,
    dispatchToMountMs: Math.round((mountAt - dispatchAt) * 10) / 10,
    mountToLayoutMs: Math.round((layoutAt - mountAt) * 10) / 10,
    totalMs: Math.round((layoutAt - event.pressAt) * 10) / 10,
  };
  if (PERF_DIAGNOSTICS_ENABLED || payload.totalMs > 100) {
    console.info('[perf-navigation]', payload);
  }
  if (payload.totalMs > 250) {
    console.warn('[perf-navigation] slow transition', payload);
  }
}

export function logPerfSave(entry: {
  reason: string;
  serializeMs: number;
  checksumMs: number;
  storageWriteMs: number;
  totalMs: number;
  payloadBytes?: number;
}): void {
  if (!PERF_DIAGNOSTICS_ENABLED && entry.totalMs < 100) {
    return;
  }
  console.info('[perf-save]', entry);
  if (entry.totalMs >= 250) {
    console.warn('[perf-save] slow save', entry);
  }
}

export function logPerfStoreUpdate(entry: {
  action: string;
  changedSlices?: string[];
  durationMs: number;
}): void {
  if (!PERF_DIAGNOSTICS_ENABLED || entry.durationMs < 16) {
    return;
  }
  console.info('[perf-store-update]', entry);
}

export function logPerfMapAsset(entry: {
  phase: 'preload' | 'decode' | 'mount';
  durationMs: number;
  cached?: boolean;
}): void {
  if (!PERF_DIAGNOSTICS_ENABLED && entry.durationMs < 100) {
    return;
  }
  console.info('[perf-map-asset]', entry);
}

let navigationInteractionUntil = 0;
let advanceTimeDeferredCleanup = false;

export function beginNavigationInteraction(durationMs = 400): void {
  navigationInteractionUntil = Date.now() + durationMs;
}

export function extendNavigationInteraction(durationMs = 250): void {
  navigationInteractionUntil = Math.max(
    navigationInteractionUntil,
    Date.now() + durationMs,
  );
}

export function isNavigationInteractionActive(): boolean {
  return Date.now() < navigationInteractionUntil;
}

export function logPerfAdvanceTimeStage(stage: string, startedMs: number): void {
  const durationMs = Math.max(0, readPerfNow() - startedMs);
  if (!PERF_DIAGNOSTICS_ENABLED && durationMs < 50) {
    return;
  }
  if (durationMs >= 5 || PERF_DIAGNOSTICS_ENABLED) {
    console.info('[perf-advance-time]', {
      stage,
      durationMs: Math.round(durationMs * 10) / 10,
      screen: activeScreen,
      navigationActive: isNavigationInteractionActive(),
    });
  }
}

/** Sub-stage profiler for contract-schedule refresh spikes (diagnostics or ≥20ms only). */
const CONTRACT_SCHEDULE_SPIKE_MS = 20;

export function logContractScheduleStage(
  stage: string,
  startedMs: number,
  detail?: Record<string, unknown>,
): void {
  const durationMs = Math.max(0, readPerfNow() - startedMs);
  if (!PERF_DIAGNOSTICS_ENABLED && durationMs < CONTRACT_SCHEDULE_SPIKE_MS) {
    return;
  }
  console.info('[perf-contract-schedule]', {
    stage,
    durationMs: Math.round(durationMs * 10) / 10,
    screen: activeScreen,
    ...detail,
  });
}

export function measureContractScheduleStage<T>(
  stage: string,
  fn: () => T,
  detail?: Record<string, unknown>,
): T {
  const started = readPerfNow();
  try {
    return fn();
  } finally {
    logContractScheduleStage(stage, started, detail);
  }
}

export function shouldDeferAdvanceTimeMaintenance(): boolean {
  return isNavigationInteractionActive();
}

export function takeDeferredAdvanceTimeCleanup(): boolean {
  if (!advanceTimeDeferredCleanup) {
    return false;
  }
  advanceTimeDeferredCleanup = false;
  return true;
}

export function markAdvanceTimeCleanupDeferred(): void {
  advanceTimeDeferredCleanup = true;
}

export function logPerfCollision(kind: string, detail?: Record<string, unknown>): void {
  if (!PERF_DIAGNOSTICS_ENABLED) {
    return;
  }
  console.info('[perf-collision]', {
    kind,
    screen: activeScreen,
    navigationActive: isNavigationInteractionActive(),
    ...detail,
  });
}
