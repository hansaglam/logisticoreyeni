/**
 * Canonical ROAD execution timing (Map V2 Step 29Y).
 *
 * Server-owned speed, pause, and offline cap. Device clocks are not authority.
 * Step 29I fixed-speed snapshots stay readable and are not reinterpreted.
 * Pure. No React. No Firebase. Does not move cash.
 */

import { getMsPerGameHour, realMsToGameHours } from '../config/balance';
import { ROAD_CRITICAL_LATE_MULTIPLIER } from './canonicalRoadEconomics';
import { classifyCanonicalRoadTimingBand } from './canonicalRoadTiming';
import {
  MAX_OFFLINE_PROGRESS_HOURS,
  MAX_OFFLINE_PROGRESS_MS,
  calculateOfflineSimulationHours,
} from '../simulation/offlineProgression';

export const PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY_STATUS =
  'PRODUCTION_ROAD_TIMING_OFFLINE_EXECUTION_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const ROAD_TIMING_READINESS_STATUS = 'ROAD_TIMING_INTERNAL_ONLY' as const;

export const PRODUCTION_OFFLINE_TIMING_STATUS =
  'PRODUCTION_OFFLINE_TIMING_BLOCKED_APP_STATE_AUTHORITY' as const;

export const PRODUCTION_TIMING_MULTI_DELIVERY_STATUS =
  'PRODUCTION_TIMING_BLOCKED_MULTI_DELIVERY_MODEL' as const;

/** Step 29AG: driver speed/tier frozen from the canonical driver snapshot (INTERNAL_TEST only). */
export const PRODUCTION_TIMING_DRIVER_STATUS =
  'PRODUCTION_TIMING_DRIVER_AUTHORITY_INTERNAL_SNAPSHOT_ONLY' as const;

export const CANONICAL_ROAD_EXECUTION_TIMING_ENV = 'CANONICAL_ROAD_TIMING_AUTHORITY' as const;

export const CANONICAL_ROAD_EXECUTION_TIMING_POLICY_VERSION =
  'canonical-road-execution-timing-internal-v1' as const;

export const CANONICAL_ROAD_EXECUTION_TIMING_SCHEMA_VERSION = 1 as const;

export function resolveCanonicalRoadExecutionTimingGate(options?: {
  envValue?: string | null;
}): 'OFF' | 'INTERNAL_TEST' {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_ROAD_TIMING_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalRoadExecutionTimingAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalRoadExecutionTimingGate(options) === 'INTERNAL_TEST';
}

export function isCanonicalExecutionTimingPolicy(policy: string | null | undefined): boolean {
  return policy === CANONICAL_ROAD_EXECUTION_TIMING_POLICY_VERSION;
}

export type RoadTimingAuditRow = {
  behavior: string;
  fn: string;
  clockSource: string;
  canonicalStatus: string;
};

export const ROAD_TIMING_AUDIT: readonly RoadTimingAuditRow[] = [
  {
    behavior: 'online-tick',
    fn: 'useGameLoop',
    clockSource: 'GAME_LOOP_TICK_MS while app active and not paused',
    canonicalStatus: 'SERVER_ELAPSED_SMALL_INTERVAL',
  },
  {
    behavior: 'game-speed',
    fn: 'setGameSpeed',
    clockSource: 'account gameSpeed 0.25–8, getMsPerGameHour buckets',
    canonicalStatus: 'SERVER_TIMESTAMPED_REQUEST',
  },
  {
    behavior: 'manual-pause-online',
    fn: 'advanceTime',
    clockSource: 'isPaused stops ticks unless offline catch-up is running',
    canonicalStatus: 'MANUAL_PAUSE_ZERO_HOURS',
  },
  {
    behavior: 'offline-catch-up',
    fn: 'applyOfflineProgress',
    clockSource: 'device lastSimulatedRealTimeMs',
    canonicalStatus: 'SERVER_ELAPSED_WITH_PRODUCTION_CAP',
  },
  {
    behavior: 'offline-cap',
    fn: 'calculateOfflineElapsed + calculateOfflineSimulationHours',
    clockSource: '24 real hours then 24 game hours',
    canonicalStatus: 'CURSOR_JUMPS_TO_SERVER_NOW',
  },
  {
    behavior: 'paused-offline',
    fn: 'advanceTime',
    clockSource: 'offlineProgressionActive bypasses isPaused',
    canonicalStatus: 'PRODUCTION_OFFLINE_TIMING_BLOCKED_APP_STATE_AUTHORITY',
  },
  {
    behavior: 'multi-delivery',
    fn: 'activeDeliveries',
    clockSource: 'one global gameSpeed for every truck',
    canonicalStatus: 'PRODUCTION_TIMING_BLOCKED_MULTI_DELIVERY_MODEL',
  },
  {
    behavior: 'driver-duration',
    fn: 'calculateContractDurationHours',
    clockSource: 'driver speed and tier',
    canonicalStatus: 'PRODUCTION_TIMING_DRIVER_AUTHORITY_INTERNAL_SNAPSHOT_ONLY',
  },
  {
    behavior: '29I-fixed-speed',
    fn: 'deriveCanonicalRoadTiming',
    clockSource: 'server wall clock at speed 1',
    canonicalStatus: 'COMPATIBILITY_ONLY',
  },
];

export function roadTimingAuditHasUnknown(): boolean {
  return ROAD_TIMING_AUDIT.some((row) => row.canonicalStatus === 'UNKNOWN');
}

export type ExecutionIntervalDerivation = {
  gameHours: number;
  capped: boolean;
  appliedRealMs: number;
};

/**
 * Small gaps convert fully. Large gaps use the production offline caps.
 * Manual or system pause contributes zero hours. The caller still moves the cursor to now.
 */
export function deriveCanonicalExecutionInterval(input: {
  elapsedRealMs: number;
  gameSpeed: number;
  manualPaused: boolean;
  systemPaused: boolean;
}): ExecutionIntervalDerivation {
  if (input.manualPaused || input.systemPaused || input.elapsedRealMs <= 0) {
    return { gameHours: 0, capped: false, appliedRealMs: 0 };
  }
  const rawHours = realMsToGameHours(input.elapsedRealMs, input.gameSpeed);
  if (rawHours <= MAX_OFFLINE_PROGRESS_HOURS && input.elapsedRealMs <= MAX_OFFLINE_PROGRESS_MS) {
    return { gameHours: rawHours, capped: false, appliedRealMs: input.elapsedRealMs };
  }
  const appliedRealMs = Math.min(input.elapsedRealMs, MAX_OFFLINE_PROGRESS_MS);
  const simulation = calculateOfflineSimulationHours(appliedRealMs, input.gameSpeed);
  return {
    gameHours: simulation.appliedSimulationHours,
    capped: true,
    appliedRealMs,
  };
}

export function deriveCompletionServerMs(input: {
  segmentStartServerMs: number;
  gameSpeed: number;
  gameHoursNeeded: number;
}): number {
  const ms = Math.max(0, input.gameHoursNeeded) * getMsPerGameHour(input.gameSpeed);
  return input.segmentStartServerMs + Math.round(ms);
}

export function classifyExecutionDeadline(input: {
  actualTravelHours: number;
  deadlineHours: number;
  plannedTravelGameHours: number;
  outcome: 'COMPLETED' | 'FAILED';
}): ReturnType<typeof classifyCanonicalRoadTimingBand> {
  return classifyCanonicalRoadTimingBand(input);
}

export function isServerDerivedTooLate(actualTravelHours: number, deadlineHours: number): boolean {
  return actualTravelHours > deadlineHours * ROAD_CRITICAL_LATE_MULTIPLIER;
}
