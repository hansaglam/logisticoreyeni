/**
 * Phase 7 Step 5 — Entitlement materialization + claim unit tests (no emulator).
 * Full transaction coverage lives in seasonRewards.emulator.test.ts when Java is available.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { SEASON_CLOSE_SNAPSHOT_VERSION } from '../src/seasonCloseTypes';
import { buildSeasonRewardEntitlementDraft } from '../src/seasonRewardResolve';
import {
  claimSeasonRewardTransaction,
  getSeasonRewardEntitlementForUid,
  materializeSeasonRewardEntitlements,
} from '../src/seasonRewards';

const fakeDb = {} as Firestore;

test('materialize fail-closed when SEASON_REWARDS_ENABLED off', async () => {
  const previous = process.env.SEASON_REWARDS_ENABLED;
  delete process.env.SEASON_REWARDS_ENABLED;
  const result = await materializeSeasonRewardEntitlements(fakeDb, '2026-W36');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'feature-disabled');
  assert.equal(result.entitlementsCreated, 0);
  if (previous === undefined) delete process.env.SEASON_REWARDS_ENABLED;
  else process.env.SEASON_REWARDS_ENABLED = previous;
});

test('claim fail-closed when SEASON_REWARDS_ENABLED off', async () => {
  const previous = process.env.SEASON_REWARDS_ENABLED;
  delete process.env.SEASON_REWARDS_ENABLED;
  const result = await claimSeasonRewardTransaction(fakeDb, 'uid-a', {
    seasonKey: '2026-W36',
    idempotencyKey: 'idem-key-01',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'feature-disabled');
  assert.equal(result.cashAmount, null);
  if (previous === undefined) delete process.env.SEASON_REWARDS_ENABLED;
  else process.env.SEASON_REWARDS_ENABLED = previous;
});

test('get entitlement fail-closed when flag off', async () => {
  const previous = process.env.SEASON_REWARDS_ENABLED;
  delete process.env.SEASON_REWARDS_ENABLED;
  const result = await getSeasonRewardEntitlementForUid(fakeDb, 'uid-a', '2026-W36');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'feature-disabled');
  if (previous === undefined) delete process.env.SEASON_REWARDS_ENABLED;
  else process.env.SEASON_REWARDS_ENABLED = previous;
});

test('claim rejects short idempotency key without Firestore', async () => {
  process.env.SEASON_REWARDS_ENABLED = 'true';
  const result = await claimSeasonRewardTransaction(fakeDb, 'uid-a', {
    seasonKey: '2026-W36',
    idempotencyKey: 'short',
  });
  assert.equal(result.reason, 'invalid-request');
  delete process.env.SEASON_REWARDS_ENABLED;
});

test('claim rejects invalid season key', async () => {
  process.env.SEASON_REWARDS_ENABLED = 'true';
  const result = await claimSeasonRewardTransaction(fakeDb, 'uid-a', {
    seasonKey: 'not-a-season',
    idempotencyKey: 'idem-key-01',
  });
  assert.equal(result.reason, 'invalid-season-key');
  delete process.env.SEASON_REWARDS_ENABLED;
});

test('materialize rejects invalid season key', async () => {
  process.env.SEASON_REWARDS_ENABLED = 'true';
  const result = await materializeSeasonRewardEntitlements(fakeDb, 'W34');
  assert.equal(result.reason, 'invalid-season-key');
  delete process.env.SEASON_REWARDS_ENABLED;
});

test('W34-style insufficient participants → no draft entitlement', () => {
  const draft = buildSeasonRewardEntitlementDraft({
    uid: 'canary-uid',
    seasonKey: '2026-W34',
    finalRank: 1,
    participantCount: 3,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    rewardCatalogVersion: 1,
    nowMs: 1,
  });
  assert.equal(draft.ok, false);
  if (!draft.ok) {
    assert.equal(draft.resolve.reason, 'insufficient-participants');
  }
});

test('tier boundary drafts match catalog', () => {
  const cases: Array<[number, string, number]> = [
    [1, 'rank_1', 60_000],
    [2, 'rank_2', 40_000],
    [3, 'rank_3', 25_000],
    [4, 'rank_4_10', 12_000],
    [10, 'rank_4_10', 12_000],
    [11, 'rank_11_25', 7_500],
    [25, 'rank_11_25', 7_500],
    [26, 'rank_26_50', 4_000],
    [50, 'rank_26_50', 4_000],
  ];
  for (const [rank, tierId, cash] of cases) {
    const draft = buildSeasonRewardEntitlementDraft({
      uid: `u-${rank}`,
      seasonKey: '2026-W36',
      finalRank: rank,
      participantCount: 50,
      snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
      nowMs: 1,
    });
    assert.equal(draft.ok, true, `rank ${rank}`);
    if (draft.ok) {
      assert.equal(draft.entitlement.tierId, tierId);
      assert.equal(draft.entitlement.cashAmount, cash);
    }
  }
});
