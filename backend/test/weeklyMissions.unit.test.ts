/**
 * Weekly Missions backend foundation — unit tests (no emulator).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  getLeaderboardSeasonBoundsFromKey,
  getLeaderboardSeasonKey,
} from '../src/leaderboardSeason';
import { getWeeklyPeriod } from '../src/seasonPeriods';
import { isValidCanonicalDeliveryId } from '../src/canonicalDeliveryCompletion';
import {
  WEEKLY_MISSION_CATALOG,
  WEEKLY_MISSION_DIFFICULTY_CASH,
  getEnabledWeeklyMissionTemplates,
  validateWeeklyMissionRotationSnapshots,
} from '../src/weeklyMissionCatalog';
import {
  WEEKLY_MISSION_WEEKLY_CASH_CAP,
  isWeeklyMissionsBackendEnabled,
} from '../src/weeklyMissionTypes';
import {
  claimWeeklyMissionRewardTransaction,
  ensureWeeklyMissionRotation,
  getWeeklyMissionsState,
  selectWeeklyMissionRotation,
} from '../src/weeklyMissions';
import {
  getWeeklyMissionPeriod,
  getWeeklyMissionWeekKey,
  isValidWeeklyMissionWeekKey,
} from '../src/weeklyMissionWeek';
import type { WeeklyMissionTemplate } from '../src/weeklyMissionTypes';

const fakeDb = {} as Firestore;

test('weekly mission week key matches leaderboard and season periods', () => {
  const monday = Date.UTC(2026, 8, 7, 0, 0, 0, 0);
  assert.equal(getWeeklyMissionWeekKey(monday), '2026-W37');
  assert.equal(getWeeklyMissionWeekKey(monday), getLeaderboardSeasonKey(monday));
  assert.equal(getWeeklyMissionWeekKey(monday), getWeeklyPeriod(monday).key);
  assert.equal(isValidWeeklyMissionWeekKey('weekly_2026-W37'), false);
  assert.equal(isValidWeeklyMissionWeekKey('2026-W37'), true);
});

test('Monday 00:00 UTC is a week boundary', () => {
  const sunday = Date.UTC(2026, 8, 6, 23, 59, 59, 999);
  const monday = Date.UTC(2026, 8, 7, 0, 0, 0, 0);
  assert.equal(getWeeklyMissionWeekKey(sunday), '2026-W36');
  assert.equal(getWeeklyMissionWeekKey(monday), '2026-W37');
  const period = getWeeklyMissionPeriod(monday);
  assert.equal(period.startsAt, monday);
  assert.equal(getLeaderboardSeasonKey(period.startsAt), period.weekKey);
});

test('ISO year boundary and week 53', () => {
  const nye = Date.UTC(2025, 11, 31, 12);
  assert.equal(getWeeklyMissionWeekKey(nye), '2026-W01');
  assert.equal(getWeeklyMissionWeekKey(nye), getLeaderboardSeasonKey(nye));
  const w53 = getLeaderboardSeasonBoundsFromKey('2020-W53');
  assert.ok(w53);
  assert.equal(getWeeklyMissionWeekKey(w53!.startsAt), '2020-W53');
  assert.equal(getWeeklyMissionWeekKey(w53!.endsAt), '2021-W01');
});

test('feature flag defaults off', () => {
  const previous = process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
  delete process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
  assert.equal(isWeeklyMissionsBackendEnabled(), false);
  process.env.WEEKLY_MISSIONS_BACKEND_ENABLED = 'false';
  assert.equal(isWeeklyMissionsBackendEnabled(), false);
  process.env.WEEKLY_MISSIONS_BACKEND_ENABLED = 'true';
  assert.equal(isWeeklyMissionsBackendEnabled(), true);
  if (previous === undefined) delete process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
  else process.env.WEEKLY_MISSIONS_BACKEND_ENABLED = previous;
});

test('get and claim fail closed when flag off', async () => {
  const previous = process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
  delete process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
  const getResult = await getWeeklyMissionsState(fakeDb, { uid: 'u1', linkedAccount: true });
  assert.equal(getResult.ok, false);
  if (!getResult.ok) assert.equal(getResult.reason, 'feature-disabled');
  const claim = await claimWeeklyMissionRewardTransaction(fakeDb, 'u1', {
    weekKey: '2026-W37',
    missionId: 'wm_deliveries_5',
    idempotencyKey: 'idem-key-01',
  });
  assert.equal(claim.ok, false);
  if (!claim.ok) assert.equal(claim.reason, 'feature-disabled');
  const seeded = await ensureWeeklyMissionRotation(fakeDb);
  assert.equal(seeded.ok, false);
  if (!seeded.ok) assert.equal(seeded.reason, 'feature-disabled');
  if (previous === undefined) delete process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
  else process.env.WEEKLY_MISSIONS_BACKEND_ENABLED = previous;
});

test('claim rejects invalid week / short idempotency without Firestore', async () => {
  process.env.WEEKLY_MISSIONS_BACKEND_ENABLED = 'true';
  const invalidWeek = await claimWeeklyMissionRewardTransaction(fakeDb, 'u1', {
    weekKey: 'weekly_2026-W37',
    missionId: 'wm_deliveries_5',
    idempotencyKey: 'idem-key-01',
  });
  assert.equal(invalidWeek.ok, false);
  if (!invalidWeek.ok) assert.equal(invalidWeek.reason, 'invalid-request');
  const shortKey = await claimWeeklyMissionRewardTransaction(fakeDb, 'u1', {
    weekKey: '2026-W37',
    missionId: 'wm_deliveries_5',
    idempotencyKey: 'short',
  });
  assert.equal(shortKey.ok, false);
  if (!shortKey.ok) assert.equal(shortKey.reason, 'invalid-request');
  delete process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
});

test('historical week is rejected as week-not-current', async () => {
  process.env.WEEKLY_MISSIONS_BACKEND_ENABLED = 'true';
  const nowMs = Date.UTC(2026, 8, 9, 12);
  const claim = await claimWeeklyMissionRewardTransaction(
    fakeDb,
    'u1',
    {
      weekKey: '2026-W36',
      missionId: 'wm_deliveries_5',
      idempotencyKey: 'idem-key-01',
    },
    nowMs,
  );
  assert.equal(claim.ok, false);
  if (!claim.ok) assert.equal(claim.reason, 'week-not-current');
  delete process.env.WEEKLY_MISSIONS_BACKEND_ENABLED;
});

test('catalog is cash-only with one band per difficulty and cap headroom', () => {
  const enabled = getEnabledWeeklyMissionTemplates();
  assert.equal(enabled.every((item) => item.type === 'weekly_completed_deliveries'), true);
  assert.equal(enabled.every((item) => !('xp' in item.reward) && !('reputation' in item.reward)), true);
  assert.equal(enabled.filter((item) => item.difficulty === 'easy').length >= 1, true);
  assert.equal(enabled.filter((item) => item.difficulty === 'medium').length >= 1, true);
  assert.equal(enabled.filter((item) => item.difficulty === 'hard').length >= 1, true);
  assert.equal(WEEKLY_MISSION_DIFFICULTY_CASH.easy, 2_000);
  assert.equal(WEEKLY_MISSION_DIFFICULTY_CASH.medium, 4_000);
  assert.equal(WEEKLY_MISSION_DIFFICULTY_CASH.hard, 6_500);
  assert.equal(2_000 + 4_000 + 6_500, 12_500);
  assert.ok(12_500 <= WEEKLY_MISSION_WEEKLY_CASH_CAP);
});

test('rotation is exactly one easy, one medium, one hard and deterministic', () => {
  const first = selectWeeklyMissionRotation('2026-W38');
  const again = selectWeeklyMissionRotation('2026-W38');
  assert.equal(first.ok, true);
  assert.deepEqual(first, again);
  if (!first.ok) return;
  assert.equal(first.missionIds.length, 3);
  assert.equal(new Set(first.missionIds).size, 3);
  const difficulties = first.missions.map((mission) => mission.difficulty).sort();
  assert.deepEqual(difficulties, ['easy', 'hard', 'medium']);
  assert.equal(
    first.missions.reduce((sum, mission) => sum + mission.reward.cash, 0),
    12_500,
  );
  assert.equal(validateWeeklyMissionRotationSnapshots(first.missions).ok, true);
});

test('different weeks may rotate while disabled templates are excluded', () => {
  const weeks = Array.from({ length: 40 }, (_, index) => {
    const selected = selectWeeklyMissionRotation(`2026-W${String(index + 1).padStart(2, '0')}`);
    assert.equal(selected.ok, true);
    return selected.ok ? selected.missionIds.join('|') : '';
  });
  assert.equal(new Set(weeks).size > 1, true);

  const disabledHard: WeeklyMissionTemplate[] = WEEKLY_MISSION_CATALOG.map((item) =>
    item.difficulty === 'hard' ? { ...item, enabled: false } : { ...item },
  );
  const failed = selectWeeklyMissionRotation('2026-W38', 1, disabledHard);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.reason, 'invalid-catalog');

  const onlyOneEasy: WeeklyMissionTemplate[] = WEEKLY_MISSION_CATALOG.map((item) =>
    item.id === 'wm_deliveries_6' ? { ...item, enabled: false } : { ...item },
  );
  for (let week = 1; week <= 20; week += 1) {
    const selected = selectWeeklyMissionRotation(
      `2026-W${String(week).padStart(2, '0')}`,
      1,
      onlyOneEasy,
    );
    assert.equal(selected.ok, true);
    if (selected.ok) {
      assert.equal(selected.missions.find((m) => m.difficulty === 'easy')?.id, 'wm_deliveries_5');
    }
  }
});

test('canonical delivery id validation rejects malformed identities', () => {
  assert.equal(isValidCanonicalDeliveryId('delivery-1'), true);
  assert.equal(isValidCanonicalDeliveryId('event_delivery_complete_abc'), true);
  assert.equal(isValidCanonicalDeliveryId(''), false);
  assert.equal(isValidCanonicalDeliveryId('bad id'), false);
  assert.equal(isValidCanonicalDeliveryId('x'.repeat(200)), false);
  assert.equal(isValidCanonicalDeliveryId(1), false);
});
