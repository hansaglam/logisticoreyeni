/**
 * Canonical ROAD execution timing — in-memory tests (Step 29Y).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getMsPerGameHour } from '../../src/config/balance';
import { MAX_OFFLINE_PROGRESS_HOURS } from '../../src/simulation/offlineProgression';
import { REPUTATION_EARLY_TRAVEL_RATIO } from '../../src/config/reputationRules';
import {
  createInitialCanonicalProgressiveFuelState,
  hasOnlyCanonicalProgressiveAdvanceKeys,
  settleCanonicalProgressiveFuelState,
} from '../../src/domain/canonicalProgressiveFuel';
import {
  classifyExecutionDeadline,
  deriveCanonicalExecutionInterval,
  deriveCompletionServerMs,
  isCanonicalRoadExecutionTimingAllowed,
  isServerDerivedTooLate,
  roadTimingAuditHasUnknown,
} from '../../src/domain/canonicalRoadExecutionTiming';
import { CANONICAL_ROAD_TIMING_POLICY_VERSION } from '../../src/domain/canonicalRoadTiming';

test('gate, buckets, pause, offline cap, completion time, old policy', () => {
  assert.equal(isCanonicalRoadExecutionTimingAllowed({ envValue: null }), false);
  assert.equal(isCanonicalRoadExecutionTimingAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(roadTimingAuditHasUnknown(), false);
  assert.equal(
    hasOnlyCanonicalProgressiveAdvanceKeys({
      deliveryId: 'd',
      canonicalSchemaVersion: 1,
      elapsedMs: 9,
      offlineMs: 9,
      deviceNow: 9,
      completedAt: 9,
      progress: 1,
    }),
    false,
  );
  assert.equal(getMsPerGameHour(1.49), 15_000);
  assert.equal(getMsPerGameHour(1.5), 7_500);
  assert.equal(getMsPerGameHour(5.99), 7_500);
  assert.equal(getMsPerGameHour(6), 1_000);
  assert.equal(getMsPerGameHour(0.25), getMsPerGameHour(1));
  assert.equal(getMsPerGameHour(8), 1_000);

  const week = 7 * 24 * 60 * 60 * 1000;
  const capped = deriveCanonicalExecutionInterval({
    elapsedRealMs: week,
    gameSpeed: 1,
    manualPaused: false,
    systemPaused: false,
  });
  assert.equal(capped.capped, true);
  assert.equal(capped.gameHours, MAX_OFFLINE_PROGRESS_HOURS);
  const paused = deriveCanonicalExecutionInterval({
    elapsedRealMs: week,
    gameSpeed: 8,
    manualPaused: true,
    systemPaused: false,
  });
  assert.equal(paused.gameHours, 0);

  const state = createInitialCanonicalProgressiveFuelState({
    nowMs: 1_000,
    distanceKm: 400,
    travelHours: 100,
    fuelLitersTotal: 80,
    fuelLitersAtStart: 200,
    fuelCapacityL: 400,
    executionTiming: true,
  });
  const first = settleCanonicalProgressiveFuelState(state, 1_000 + week, 200);
  assert.equal(first.state.accumulatedGameHours, MAX_OFFLINE_PROGRESS_HOURS);
  const replay = settleCanonicalProgressiveFuelState(first.state, 1_000 + week, first.currentFuelL);
  assert.equal(replay.changed, false);
  assert.equal(replay.state.accumulatedGameHours, MAX_OFFLINE_PROGRESS_HOURS);
  const nudge = settleCanonicalProgressiveFuelState(first.state, 1_000 + week + 1_000, first.currentFuelL);
  assert.ok(nudge.state.accumulatedGameHours < MAX_OFFLINE_PROGRESS_HOURS + 1);

  const held = setPause(first.state);
  const whilePaused = settleCanonicalProgressiveFuelState(held, held.lastProgressedAtServerMs + week, first.currentFuelL);
  assert.equal(whilePaused.state.accumulatedGameHours, first.state.accumulatedGameHours);

  const short = createInitialCanonicalProgressiveFuelState({
    nowMs: 0,
    distanceKm: 40,
    travelHours: 2,
    fuelLitersTotal: 20,
    fuelLitersAtStart: 40,
    fuelCapacityL: 100,
    executionTiming: true,
  });
  const done = settleCanonicalProgressiveFuelState(short, getMsPerGameHour(1) * 5, 40);
  assert.equal(done.state.progress, 1);
  assert.equal(done.state.completedAtServerMs, deriveCompletionServerMs({
    segmentStartServerMs: 0,
    gameSpeed: 1,
    gameHoursNeeded: 2,
  }));
  assert.ok((done.state.completedAtServerMs ?? 0) < getMsPerGameHour(1) * 5);

  const dry = createInitialCanonicalProgressiveFuelState({
    nowMs: 0,
    distanceKm: 100,
    travelHours: 10,
    fuelLitersTotal: 50,
    fuelLitersAtStart: 10,
    fuelCapacityL: 100,
    executionTiming: true,
  });
  const stranded = settleCanonicalProgressiveFuelState(dry, week, 10);
  assert.equal(stranded.state.pauseReason, 'OUT_OF_FUEL');
  assert.equal(stranded.currentFuelL, 0);
  assert.ok(stranded.state.progress < 1);
  const again = settleCanonicalProgressiveFuelState(stranded.state, week + week, 0);
  assert.equal(again.state.progress, stranded.state.progress);

  const legacy = createInitialCanonicalProgressiveFuelState({
    nowMs: 0,
    distanceKm: 100,
    travelHours: 30,
    fuelLitersTotal: 10,
    fuelLitersAtStart: 100,
    fuelCapacityL: 200,
  });
  assert.equal(legacy.timingPolicyVersion, undefined);
  const legacyAdvance = settleCanonicalProgressiveFuelState(legacy, getMsPerGameHour(1) * 30, 100);
  assert.ok(legacyAdvance.state.accumulatedGameHours > MAX_OFFLINE_PROGRESS_HOURS);
  assert.equal(CANONICAL_ROAD_TIMING_POLICY_VERSION, 'canonical-road-timing-internal-fixed-v1');

  assert.equal(isServerDerivedTooLate(20, 10), false);
  assert.equal(isServerDerivedTooLate(20.001, 10), true);
  assert.equal(
    classifyExecutionDeadline({
      actualTravelHours: 2 * REPUTATION_EARLY_TRAVEL_RATIO,
      deadlineHours: 10,
      plannedTravelGameHours: 2,
      outcome: 'COMPLETED',
    }),
    'EARLY',
  );
  assert.equal(
    classifyExecutionDeadline({
      actualTravelHours: 10.5,
      deadlineHours: 10,
      plannedTravelGameHours: 4,
      outcome: 'COMPLETED',
    }),
    'LATE_MINOR',
  );
});

function setPause(
  state: ReturnType<typeof createInitialCanonicalProgressiveFuelState>,
): ReturnType<typeof createInitialCanonicalProgressiveFuelState> {
  return { ...state, paused: true, pauseReason: 'MANUAL' };
}
