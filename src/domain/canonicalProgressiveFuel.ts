/**
 * Canonical ROAD progressive fuel (Map V2 Step 29X).
 *
 * Production burns fuel as delivery progress advances. This module derives
 * that burn from server-owned game-time segments. It does not treat Step 29I
 * fixed-speed timing as production parity, and it does not trust client
 * progress, distance, elapsed time, or liters.
 * Pure. No React. No Firebase.
 */

import { realMsToGameHours } from '../config/balance';
import { advanceFuelConstrainedProgress } from '../utils/truckFuel';
import {
  CANONICAL_ROAD_EXECUTION_TIMING_POLICY_VERSION,
  deriveCanonicalExecutionInterval,
  deriveCompletionServerMs,
  isCanonicalExecutionTimingPolicy,
} from './canonicalRoadExecutionTiming';

export const PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY_STATUS =
  'PRODUCTION_PROGRESSIVE_FUEL_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const FUEL_PROGRESSIVE_READINESS_STATUS = 'FUEL_PROGRESSIVE_INTERNAL_ONLY' as const;

export const FUEL_PROGRESSIVE_PUBLIC_BLOCKER =
  'FUEL_PROGRESSIVE_BLOCKED_PUBLIC_REFUEL' as const;

export const CANONICAL_PROGRESSIVE_FUEL_ENV = 'CANONICAL_PROGRESSIVE_FUEL_AUTHORITY' as const;
export const CANONICAL_PROGRESSIVE_FUEL_POLICY_VERSION =
  'canonical-road-progressive-fuel-v1' as const;
export const CANONICAL_ROAD_PROGRESS_POLICY_VERSION = 'canonical-road-progress-internal-v1' as const;
export const CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION = 1 as const;

export const PROGRESSIVE_FUEL_MIN_GAME_SPEED = 0.25;
export const PROGRESSIVE_FUEL_MAX_GAME_SPEED = 8;
export const PROGRESSIVE_FUEL_DEFAULT_GAME_SPEED = 1;

const FUEL_EPSILON_L = 1e-6;

export function resolveCanonicalProgressiveFuelGate(options?: {
  envValue?: string | null;
}): 'OFF' | 'INTERNAL_TEST' {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_PROGRESSIVE_FUEL_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalProgressiveFuelAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalProgressiveFuelGate(options) === 'INTERNAL_TEST';
}

const FORBIDDEN_PROGRESS_KEYS = [
  'currentFuelL',
  'fuelBefore',
  'fuelAfter',
  'fuelConsumed',
  'fuelDelta',
  'distanceKm',
  'distanceDelta',
  'progress',
  'progressRatio',
  'elapsedMs',
  'travelHours',
  'gameSeconds',
  'lastTickAt',
  'serverTime',
  'fuelRequired',
  'fuelConsumptionRate',
  'startedAtDeviceMs',
  'progressedMs',
  'offlineMs',
  'offlineHours',
  'deviceNow',
  'completedAt',
  'lastActiveAt',
] as const;

export function hasOnlyCanonicalProgressiveAdvanceKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN_PROGRESS_KEYS.some((key) => key in data)) return false;
  return Object.keys(data).every((key) => ['deliveryId', 'canonicalSchemaVersion'].includes(key));
}

export function hasOnlyCanonicalProgressiveSpeedKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN_PROGRESS_KEYS.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['deliveryId', 'gameSpeed', 'canonicalSchemaVersion'].includes(key),
  );
}

export function hasOnlyCanonicalProgressivePauseKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN_PROGRESS_KEYS.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['deliveryId', 'paused', 'canonicalSchemaVersion'].includes(key),
  );
}

export function isSupportedCanonicalGameSpeed(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= PROGRESSIVE_FUEL_MIN_GAME_SPEED &&
    value <= PROGRESSIVE_FUEL_MAX_GAME_SPEED
  );
}

export type ProgressiveFuelAuditRow = {
  event: string;
  fn: string;
  progressSource: string;
  fuelFormula: string;
  serverDerivable: 'SERVER_DERIVABLE' | 'CLIENT_EXECUTION_STATE' | 'LOCAL_CLOCK_DERIVED' | 'NOT_PRESENT';
  canonicalStatus: string;
};

export const PROGRESSIVE_FUEL_AUDIT: readonly ProgressiveFuelAuditRow[] = [
  {
    event: 'delivery-tick',
    fn: 'updateDeliveryProgressWithFuel',
    progressSource: 'game hours / travelHours',
    fuelFormula: 'advanceFuelConstrainedProgress',
    serverDerivable: 'CLIENT_EXECUTION_STATE',
    canonicalStatus: 'INTERNAL_SERVER_SEGMENTS_ONLY',
  },
  {
    event: 'fuel-step',
    fn: 'advanceFuelConstrainedProgress',
    progressSource: 'requested progress delta',
    fuelFormula: 'fuelLitersTotal * processedProgress',
    serverDerivable: 'SERVER_DERIVABLE',
    canonicalStatus: 'REUSED_EXACT',
  },
  {
    event: 'accept-gate',
    fn: 'evaluateDeliveryReadiness',
    progressSource: 'none',
    fuelFormula: 'tank >= economics.fuelLiters',
    serverDerivable: 'SERVER_DERIVABLE',
    canonicalStatus: 'FULL_TRIP_REQUIRED_TO_START',
  },
  {
    event: 'manual-pause',
    fn: 'pauseGame',
    progressSource: 'isPaused stops advanceTime',
    fuelFormula: 'no burn while paused',
    serverDerivable: 'CLIENT_EXECUTION_STATE',
    canonicalStatus: 'INTERNAL_PAUSE_REQUEST_SERVER_TIMESTAMP',
  },
  {
    event: 'out-of-fuel',
    fn: 'advanceFuelConstrainedProgress',
    progressSource: 'reachable progress from tank',
    fuelFormula: 'clamp to zero tank',
    serverDerivable: 'SERVER_DERIVABLE',
    canonicalStatus: 'OUT_OF_FUEL_SERVER_DERIVED',
  },
  {
    event: 'game-speed',
    fn: 'setGameSpeed',
    progressSource: '0.25–8 clamped; getMsPerGameHour buckets',
    fuelFormula: 'speed changes game-time rate, not liters per km',
    serverDerivable: 'CLIENT_EXECUTION_STATE',
    canonicalStatus: 'INTERNAL_SPEED_REQUEST_SERVER_TIMESTAMP',
  },
  {
    event: 'offline-catch-up',
    fn: 'applyOfflineProgressionIfNeeded',
    progressSource: 'device lastSimulatedRealTimeMs + last speed',
    fuelFormula: 'same progressive burn inside capped catch-up',
    serverDerivable: 'LOCAL_CLOCK_DERIVED',
    canonicalStatus: 'SERVER_CAP_ON_EXECUTION_TIMING_POLICY',
  },
  {
    event: 'background',
    fn: 'applyOfflineProgressionIfNeeded',
    progressSource: 'same device baseline on foreground',
    fuelFormula: 'same progressive burn',
    serverDerivable: 'LOCAL_CLOCK_DERIVED',
    canonicalStatus: 'SERVER_CAP_ON_EXECUTION_TIMING_POLICY',
  },
  {
    event: 'cancel',
    fn: 'cancel delivery',
    progressSource: 'progress already travelled',
    fuelFormula: 'consumed liters stay consumed',
    serverDerivable: 'SERVER_DERIVABLE',
    canonicalStatus: 'NO_REFUND',
  },
  {
    event: 'client-failure',
    fn: 'reportCanonicalRoadDeliveryCompleted FAILED',
    progressSource: 'client outcome',
    fuelFormula: 'do not invent extra distance',
    serverDerivable: 'CLIENT_EXECUTION_STATE',
    canonicalStatus: 'CLIENT_REPORTED_UNVERIFIED',
  },
  {
    event: 'completion',
    fn: 'updateDeliveryProgressWithFuel',
    progressSource: 'progress reaches 1',
    fuelFormula: 'no extra completion burn and no fuel cash',
    serverDerivable: 'SERVER_DERIVABLE',
    canonicalStatus: 'CUMULATIVE_AT_PROGRESS_1',
  },
  {
    event: 'roadside',
    fn: 'validateRoadsideFuelPurchase',
    progressSource: 'local paused job',
    fuelFormula: 'local liters and surcharge',
    serverDerivable: 'CLIENT_EXECUTION_STATE',
    canonicalStatus: 'ROADSIDE_FUEL_AUTHORITY_BLOCKED_LOCAL_PURCHASE',
  },
  {
    event: 'incident-liters',
    fn: 'discount_fuel fuelLitersDelta',
    progressSource: 'local incident choice',
    fuelFormula: '+28 L tank, separate from fuelCostDelta cash',
    serverDerivable: 'CLIENT_EXECUTION_STATE',
    canonicalStatus: 'FUEL_AUTHORITY_BLOCKED_INCIDENT_FUEL_DELTA',
  },
  {
    event: 'driver-fuel-saving',
    fn: 'calculateContractEconomics',
    progressSource: 'driver.fuelSaving',
    fuelFormula: 'getFuelDriverMultiplier',
    serverDerivable: 'SERVER_DERIVABLE',
    canonicalStatus: 'CANONICAL_DRIVER_FUEL_SAVING_INTERNAL_SNAPSHOT_ONLY',
  },
];

export function progressiveFuelAuditHasUnknown(): boolean {
  return PROGRESSIVE_FUEL_AUDIT.some((row) => row.canonicalStatus === 'UNKNOWN');
}

export type CanonicalProgressivePauseReason = 'MANUAL' | 'OUT_OF_FUEL' | null;

export type CanonicalProgressiveFuelState = {
  progressPolicyVersion: typeof CANONICAL_ROAD_PROGRESS_POLICY_VERSION;
  fuelPolicyVersion: typeof CANONICAL_PROGRESSIVE_FUEL_POLICY_VERSION;
  schemaVersion: typeof CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION;
  progressRevision: number;
  progressDistanceKm: number;
  progressGameSeconds: number;
  accumulatedGameHours: number;
  openSegmentStartServerMs: number;
  lastProgressedAtServerMs: number;
  gameSpeed: number;
  paused: boolean;
  pauseReason: CanonicalProgressivePauseReason;
  cumulativeFuelConsumedL: number;
  fuelLitersAtStart: number;
  fuelLitersTotal: number;
  fuelCapacityL: number;
  distanceKm: number;
  travelHours: number;
  progress: number;
  timingPolicyVersion?: typeof CANONICAL_ROAD_EXECUTION_TIMING_POLICY_VERSION;
  timingRevision?: number;
  completedAtServerMs?: number | null;
};

export function createInitialCanonicalProgressiveFuelState(input: {
  nowMs: number;
  distanceKm: number;
  travelHours: number;
  fuelLitersTotal: number;
  fuelLitersAtStart: number;
  fuelCapacityL: number;
  executionTiming?: boolean;
}): CanonicalProgressiveFuelState {
  return {
    progressPolicyVersion: CANONICAL_ROAD_PROGRESS_POLICY_VERSION,
    fuelPolicyVersion: CANONICAL_PROGRESSIVE_FUEL_POLICY_VERSION,
    schemaVersion: CANONICAL_PROGRESSIVE_FUEL_SCHEMA_VERSION,
    progressRevision: 0,
    progressDistanceKm: 0,
    progressGameSeconds: 0,
    accumulatedGameHours: 0,
    openSegmentStartServerMs: input.nowMs,
    lastProgressedAtServerMs: input.nowMs,
    gameSpeed: PROGRESSIVE_FUEL_DEFAULT_GAME_SPEED,
    paused: false,
    pauseReason: null,
    cumulativeFuelConsumedL: 0,
    fuelLitersAtStart: input.fuelLitersAtStart,
    fuelLitersTotal: input.fuelLitersTotal,
    fuelCapacityL: input.fuelCapacityL,
    distanceKm: input.distanceKm,
    travelHours: input.travelHours,
    progress: 0,
    ...(input.executionTiming
      ? {
          timingPolicyVersion: CANONICAL_ROAD_EXECUTION_TIMING_POLICY_VERSION,
          timingRevision: 0,
          completedAtServerMs: null,
        }
      : {}),
  };
}

export type ProgressiveFuelDerivation = {
  progress: number;
  progressDistanceKm: number;
  cumulativeFuelConsumedL: number;
  currentFuelL: number;
  outOfFuel: boolean;
  gameHoursApplied: number;
};

/**
 * One cumulative application of the production fuel step from progress 0.
 * Call frequency does not change the result for the same game hours and tank baseline.
 */
export function deriveCanonicalProgressiveFuel(input: {
  gameHours: number;
  travelHours: number;
  distanceKm: number;
  fuelLitersAtStart: number;
  fuelLitersTotal: number;
  currentFuelL: number;
  cumulativeFuelConsumedL: number;
  fuelCapacityL: number;
}): ProgressiveFuelDerivation {
  const travel = Math.max(input.travelHours, 0.1);
  const requestedProgress = Math.min(1, Math.max(0, input.gameHours) / travel);
  const total = Math.max(0, input.fuelLitersTotal);
  const start = Math.max(0, input.fuelLitersAtStart);
  const already = Math.max(0, input.cumulativeFuelConsumedL);
  const capacity = Math.max(0, input.fuelCapacityL);
  const rawTank = Math.max(0, input.currentFuelL);
  const tank = capacity > 0 ? Math.min(capacity, rawTank) : rawTank;
  const baselineRemaining = Math.max(0, start - already);
  const external = Math.max(0, tank - baselineRemaining);
  const effectiveStart = start + external;

  if (total <= FUEL_EPSILON_L) {
    const progress = requestedProgress;
    return {
      progress,
      progressDistanceKm: Math.max(0, input.distanceKm) * progress,
      cumulativeFuelConsumedL: 0,
      currentFuelL: Math.min(capacity, tank),
      outOfFuel: false,
      gameHoursApplied: Math.max(0, input.gameHours),
    };
  }

  const affordableProgress = Math.min(1, (already + tank) / total);
  const progress = Math.min(requestedProgress, affordableProgress);
  const stepped = advanceFuelConstrainedProgress({
    currentProgress: 0,
    requestedProgressDelta: progress,
    fuelLitersAtStart: effectiveStart,
    fuelLitersTotal: total,
    currentFuelL: effectiveStart,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    distanceKm: Math.max(0, input.distanceKm),
    distanceTraveledKm: 0,
  });
  const currentFuelL = Math.max(0, capacity > 0 ? Math.min(capacity, stepped.currentFuelL) : stepped.currentFuelL);
  const outOfFuel =
    currentFuelL <= FUEL_EPSILON_L &&
    stepped.progress < 1 - 1e-9 &&
    requestedProgress > stepped.progress + 1e-9;
  return {
    progress: stepped.progress,
    progressDistanceKm: stepped.distanceTraveledKm,
    cumulativeFuelConsumedL: stepped.fuelConsumedL,
    currentFuelL,
    outOfFuel,
    gameHoursApplied: stepped.progress * travel,
  };
}

export function settleCanonicalProgressiveFuelState(
  state: CanonicalProgressiveFuelState,
  nowMs: number,
  currentFuelL: number,
): { state: CanonicalProgressiveFuelState; changed: boolean; currentFuelL: number } {
  const now = Math.max(state.lastProgressedAtServerMs, nowMs);
  const elapsed = Math.max(0, now - state.openSegmentStartServerMs);
  const resumeFromFuel =
    state.pauseReason === 'OUT_OF_FUEL' && currentFuelL > FUEL_EPSILON_L;
  const moving = (!state.paused || resumeFromFuel) && state.pauseReason !== 'MANUAL';
  const executionTiming = isCanonicalExecutionTimingPolicy(state.timingPolicyVersion);
  const interval = executionTiming
    ? deriveCanonicalExecutionInterval({
        elapsedRealMs: elapsed,
        gameSpeed: state.gameSpeed,
        manualPaused: state.pauseReason === 'MANUAL' || (state.paused && !resumeFromFuel),
        systemPaused: state.pauseReason === 'OUT_OF_FUEL' && !resumeFromFuel,
      })
    : {
        gameHours: moving ? realMsToGameHours(elapsed, state.gameSpeed) : 0,
        capped: false,
        appliedRealMs: moving ? elapsed : 0,
      };
  const addedHours = executionTiming ? interval.gameHours : moving ? realMsToGameHours(elapsed, state.gameSpeed) : 0;
  const derived = deriveCanonicalProgressiveFuel({
    gameHours: state.accumulatedGameHours + addedHours,
    travelHours: state.travelHours,
    distanceKm: state.distanceKm,
    fuelLitersAtStart: state.fuelLitersAtStart,
    fuelLitersTotal: state.fuelLitersTotal,
    currentFuelL,
    cumulativeFuelConsumedL: state.cumulativeFuelConsumedL,
    fuelCapacityL: state.fuelCapacityL,
  });
  const fuelChanged =
    Math.abs(derived.cumulativeFuelConsumedL - state.cumulativeFuelConsumedL) > FUEL_EPSILON_L ||
    Math.abs(derived.currentFuelL - currentFuelL) > FUEL_EPSILON_L;
  const progressChanged = Math.abs(derived.progress - state.progress) > 1e-9 || elapsed > 0;
  if (!fuelChanged && !progressChanged && !resumeFromFuel) {
    return { state, changed: false, currentFuelL };
  }
  const outOfFuel = derived.outOfFuel;
  const reachedEnd = derived.progress >= 1 - 1e-9;
  const hoursThisStep = Math.max(0, derived.gameHoursApplied - state.accumulatedGameHours);
  const completedAtServerMs = !executionTiming
    ? state.completedAtServerMs
    : state.completedAtServerMs ??
      (reachedEnd
        ? deriveCompletionServerMs({
            segmentStartServerMs: state.openSegmentStartServerMs,
            gameSpeed: state.gameSpeed,
            gameHoursNeeded: hoursThisStep,
          })
        : null);
  const next: CanonicalProgressiveFuelState = {
    ...state,
    progressRevision: state.progressRevision + 1,
    timingRevision: executionTiming ? (state.timingRevision ?? 0) + 1 : state.timingRevision,
    progress: derived.progress,
    progressDistanceKm: derived.progressDistanceKm,
    progressGameSeconds: derived.gameHoursApplied * 3600,
    accumulatedGameHours: derived.gameHoursApplied,
    openSegmentStartServerMs: now,
    lastProgressedAtServerMs: now,
    paused: outOfFuel ? true : resumeFromFuel ? false : state.paused,
    pauseReason: outOfFuel ? 'OUT_OF_FUEL' : resumeFromFuel ? null : state.pauseReason,
    cumulativeFuelConsumedL: derived.cumulativeFuelConsumedL,
    completedAtServerMs,
  };
  return { state: next, changed: true, currentFuelL: derived.currentFuelL };
}

export function setCanonicalProgressiveGameSpeed(
  state: CanonicalProgressiveFuelState,
  gameSpeed: number,
  nowMs: number,
  currentFuelL: number,
): { ok: true; state: CanonicalProgressiveFuelState; currentFuelL: number } | { ok: false; reason: string } {
  if (!isSupportedCanonicalGameSpeed(gameSpeed)) {
    return { ok: false, reason: 'UNSUPPORTED_GAME_SPEED' };
  }
  const settled = settleCanonicalProgressiveFuelState(state, nowMs, currentFuelL);
  const at = Math.max(settled.state.lastProgressedAtServerMs, nowMs);
  return {
    ok: true,
    state: {
      ...settled.state,
      gameSpeed,
      openSegmentStartServerMs: at,
      lastProgressedAtServerMs: at,
    },
    currentFuelL: settled.currentFuelL,
  };
}

export function setCanonicalProgressivePaused(
  state: CanonicalProgressiveFuelState,
  paused: boolean,
  nowMs: number,
  currentFuelL: number,
): { ok: true; state: CanonicalProgressiveFuelState; currentFuelL: number } | { ok: false; reason: string } {
  if (state.pauseReason === 'OUT_OF_FUEL' && paused === false && currentFuelL <= FUEL_EPSILON_L) {
    return { ok: false, reason: 'OUT_OF_FUEL_REQUIRES_REFUEL' };
  }
  const settled = settleCanonicalProgressiveFuelState(state, nowMs, currentFuelL);
  const at = Math.max(settled.state.lastProgressedAtServerMs, nowMs);
  const stillOut = settled.state.pauseReason === 'OUT_OF_FUEL' && settled.currentFuelL <= FUEL_EPSILON_L;
  return {
    ok: true,
    state: {
      ...settled.state,
      paused: paused || stillOut,
      pauseReason: paused ? 'MANUAL' : stillOut ? 'OUT_OF_FUEL' : null,
      openSegmentStartServerMs: at,
      lastProgressedAtServerMs: at,
    },
    currentFuelL: settled.currentFuelL,
  };
}
