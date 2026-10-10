/**
 * Canonical ROAD timing authority (Map V2 Step 29I).
 *
 * INTERNAL_TEST fixed-speed wall-clock. Client actualTravelHours is not authority.
 * Pure. No React. No Firebase. Does not mutate money.
 *
 * Production ROAD still uses local gameSpeed / pause / offline catch-up.
 */

import { getMsPerGameHour, realMsToGameHours } from '../config/balance';
import { classifyDeliveryPunctuality } from '../simulation/reputationSettlement';
import type { CanonicalRoadCompletionBand } from './canonicalRoadExecutionEconomics';

export const CANONICAL_ROAD_TIMING_AUTHORITY_STATUS =
  'CANONICAL_ROAD_TIMING_AUTHORITY_PASS_INTERNAL_FIXED_SPEED_ONLY' as const;

export const CANONICAL_ROAD_TIMING_POLICY_VERSION =
  'canonical-road-timing-internal-fixed-v1' as const;

export const ROAD_GAME_TIME_POLICY_VERSION = 'road-game-time-policy-v1' as const;

export const CANONICAL_ROAD_TIMING_AUTHORITY_MODE =
  'INTERNAL_FIXED_SPEED_WALL_CLOCK' as const;

export const CANONICAL_ROAD_TIMING_ENV_KEY = 'EXPO_PUBLIC_CANONICAL_ROAD_TIMING' as const;

export const CANONICAL_ROAD_FIXED_GAME_SPEED = 1 as const;

export const CANONICAL_ROAD_FAILURE_EXECUTION_AUTHORITY =
  'FAILURE_EXECUTION_AUTHORITY_CLIENT_REPORTED' as const;

export type CanonicalRoadTimingGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalRoadTimingGate(options?: {
  envValue?: string | null;
}): CanonicalRoadTimingGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.EXPO_PUBLIC_CANONICAL_ROAD_TIMING ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export const CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR = getMsPerGameHour(
  CANONICAL_ROAD_FIXED_GAME_SPEED,
);

export type CanonicalRoadTimingSegment = {
  segmentId: string;
  startedAtServerMs: number;
  endedAtServerMs: number | null;
  gameSpeedMultiplier: typeof CANONICAL_ROAD_FIXED_GAME_SPEED;
  msPerGameHour: number;
};

export type CanonicalRoadTimingSnapshot = {
  timingPolicyVersion: typeof CANONICAL_ROAD_TIMING_POLICY_VERSION;
  gameTimePolicyVersion: typeof ROAD_GAME_TIME_POLICY_VERSION;
  timingAuthorityMode: typeof CANONICAL_ROAD_TIMING_AUTHORITY_MODE;
  acceptedAtServerMs: number;
  startedAtServerMs: number;
  frozenGameSpeed: typeof CANONICAL_ROAD_FIXED_GAME_SPEED;
  msPerGameHour: number;
  plannedTravelGameHours: number;
  deadlineHours: number;
  segments: CanonicalRoadTimingSegment[];
  completedAtServerMs: number | null;
  derivedActualTravelGameSeconds: number | null;
  derivedActualTravelHours: number | null;
  derivedTimingClassification: CanonicalRoadCompletionBand | null;
};

export type CanonicalRoadTimingDerivation = {
  completedAtServerMs: number;
  elapsedRealMs: number;
  derivedActualTravelGameSeconds: number;
  derivedActualTravelHours: number;
  timingClassification: CanonicalRoadCompletionBand;
};

export function freezeCanonicalRoadTimingSnapshot(input: {
  startedAtServerMs: number;
  plannedTravelGameHours: number;
  deadlineHours: number;
}): CanonicalRoadTimingSnapshot {
  return {
    timingPolicyVersion: CANONICAL_ROAD_TIMING_POLICY_VERSION,
    gameTimePolicyVersion: ROAD_GAME_TIME_POLICY_VERSION,
    timingAuthorityMode: CANONICAL_ROAD_TIMING_AUTHORITY_MODE,
    acceptedAtServerMs: input.startedAtServerMs,
    startedAtServerMs: input.startedAtServerMs,
    frozenGameSpeed: CANONICAL_ROAD_FIXED_GAME_SPEED,
    msPerGameHour: CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR,
    plannedTravelGameHours: input.plannedTravelGameHours,
    deadlineHours: input.deadlineHours,
    segments: [
      {
        segmentId: 'seg_0',
        startedAtServerMs: input.startedAtServerMs,
        endedAtServerMs: null,
        gameSpeedMultiplier: CANONICAL_ROAD_FIXED_GAME_SPEED,
        msPerGameHour: CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR,
      },
    ],
    completedAtServerMs: null,
    derivedActualTravelGameSeconds: null,
    derivedActualTravelHours: null,
    derivedTimingClassification: null,
  };
}

export function deriveCanonicalRoadElapsedGameHours(input: {
  startedAtServerMs: number;
  completedAtServerMs: number;
  msPerGameHour?: number;
}): { elapsedRealMs: number; actualTravelHours: number; actualTravelGameSeconds: number } {
  const elapsedRealMs = Math.max(0, input.completedAtServerMs - input.startedAtServerMs);
  const msPerGameHour = input.msPerGameHour ?? CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR;
  const actualTravelHours = realMsToGameHours(elapsedRealMs, CANONICAL_ROAD_FIXED_GAME_SPEED);
  const actualTravelGameSeconds = Math.floor((elapsedRealMs * 3600) / msPerGameHour);
  return { elapsedRealMs, actualTravelHours, actualTravelGameSeconds };
}

export function classifyCanonicalRoadTimingBand(input: {
  outcome: 'COMPLETED' | 'FAILED';
  actualTravelHours: number;
  deadlineHours: number;
  plannedTravelGameHours: number;
}): CanonicalRoadCompletionBand {
  const punctuality = classifyDeliveryPunctuality({
    actualTravelHours: input.actualTravelHours,
    deadlineHours: input.deadlineHours,
    estimatedTravelHours: input.plannedTravelGameHours,
    failed: input.outcome === 'FAILED',
  });
  switch (punctuality) {
    case 'failed':
      return 'FAILED';
    case 'early':
      return 'EARLY';
    case 'on-time':
      return 'ON_TIME';
    case 'late-minor':
      return 'LATE_MINOR';
    case 'late-major':
      return 'LATE_MAJOR';
    default:
      return 'ON_TIME';
  }
}

export function deriveCanonicalRoadTiming(input: {
  timing: CanonicalRoadTimingSnapshot;
  completedAtServerMs: number;
  outcome: 'COMPLETED' | 'FAILED';
}): CanonicalRoadTimingDerivation {
  const elapsed = deriveCanonicalRoadElapsedGameHours({
    startedAtServerMs: input.timing.startedAtServerMs,
    completedAtServerMs: input.completedAtServerMs,
    msPerGameHour: input.timing.msPerGameHour,
  });
  const timingClassification = classifyCanonicalRoadTimingBand({
    outcome: input.outcome,
    actualTravelHours: elapsed.actualTravelHours,
    deadlineHours: input.timing.deadlineHours,
    plannedTravelGameHours: input.timing.plannedTravelGameHours,
  });
  return {
    completedAtServerMs: input.completedAtServerMs,
    elapsedRealMs: elapsed.elapsedRealMs,
    derivedActualTravelGameSeconds: elapsed.actualTravelGameSeconds,
    derivedActualTravelHours: elapsed.actualTravelHours,
    timingClassification,
  };
}

export function closeCanonicalRoadTimingSnapshot(
  timing: CanonicalRoadTimingSnapshot,
  derivation: CanonicalRoadTimingDerivation,
): CanonicalRoadTimingSnapshot {
  const open = timing.segments[0];
  return {
    ...timing,
    segments: open
      ? [
          {
            ...open,
            endedAtServerMs: derivation.completedAtServerMs,
          },
        ]
      : timing.segments,
    completedAtServerMs: derivation.completedAtServerMs,
    derivedActualTravelGameSeconds: derivation.derivedActualTravelGameSeconds,
    derivedActualTravelHours: derivation.derivedActualTravelHours,
    derivedTimingClassification: derivation.timingClassification,
  };
}

export function realMsForCanonicalGameHours(gameHours: number): number {
  return Math.round(Math.max(0, gameHours) * CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR);
}
