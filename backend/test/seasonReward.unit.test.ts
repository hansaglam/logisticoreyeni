/**
 * Phase 7 Step 4 — Season reward policy unit tests (pure; no Firestore).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SEASON_CLOSE_SNAPSHOT_VERSION } from '../src/seasonCloseTypes';
import {
  SEASON_REWARD_CATALOG_V1,
  SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT,
  getSeasonRewardCatalog,
} from '../src/seasonRewardCatalog';
import {
  buildSeasonRewardEntitlementDraft,
  resolveSeasonReward,
} from '../src/seasonRewardResolve';
import {
  isSeasonRewardsEnabled,
  SEASON_REWARD_CATALOG_VERSION,
  type SeasonRewardResolveInput,
} from '../src/seasonRewardTypes';
import {
  frozenEntitlementFieldsMatch,
  parseSeasonRewardEntitlementDocument,
  SEASON_REWARD_ENTITLEMENT_SCHEMA_VERSION,
} from '../src/seasonRewards';

const PARTICIPANTS = 50;

function resolve(rank: number, participantCount = PARTICIPANTS) {
  return resolveSeasonReward({
    finalRank: rank,
    participantCount,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
  });
}

test('catalog version is 1 and deterministic', () => {
  assert.equal(SEASON_REWARD_CATALOG_VERSION, 1);
  assert.equal(getSeasonRewardCatalog(1), SEASON_REWARD_CATALOG_V1);
  assert.equal(getSeasonRewardCatalog(2), null);
  assert.deepEqual(
    SEASON_REWARD_CATALOG_V1.map((t) => [t.id, t.minRank, t.maxRank, t.cashAmount]),
    [
      ['rank_1', 1, 1, 60_000],
      ['rank_2', 2, 2, 40_000],
      ['rank_3', 3, 3, 25_000],
      ['rank_4_10', 4, 10, 12_000],
      ['rank_11_25', 11, 25, 7_500],
      ['rank_26_50', 26, 50, 4_000],
    ],
  );
});

test('minimum participant count is 10', () => {
  assert.equal(SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT, 10);
});

test('rank 1 eligible', () => {
  const r = resolve(1);
  assert.equal(r.eligible, true);
  assert.equal(r.tierId, 'rank_1');
  assert.equal(r.cashAmount, 60_000);
  assert.equal(r.reason, 'eligible');
});

test('rank 2 eligible', () => {
  const r = resolve(2);
  assert.equal(r.tierId, 'rank_2');
  assert.equal(r.cashAmount, 40_000);
});

test('rank 3 eligible', () => {
  const r = resolve(3);
  assert.equal(r.tierId, 'rank_3');
  assert.equal(r.cashAmount, 25_000);
});

test('rank 4 boundary', () => {
  const r = resolve(4);
  assert.equal(r.tierId, 'rank_4_10');
  assert.equal(r.cashAmount, 12_000);
});

test('rank 10 boundary', () => {
  const r = resolve(10);
  assert.equal(r.tierId, 'rank_4_10');
  assert.equal(r.cashAmount, 12_000);
});

test('rank 11 boundary', () => {
  const r = resolve(11);
  assert.equal(r.tierId, 'rank_11_25');
  assert.equal(r.cashAmount, 7_500);
});

test('rank 25 boundary', () => {
  const r = resolve(25);
  assert.equal(r.tierId, 'rank_11_25');
  assert.equal(r.cashAmount, 7_500);
});

test('rank 26 boundary', () => {
  const r = resolve(26);
  assert.equal(r.tierId, 'rank_26_50');
  assert.equal(r.cashAmount, 4_000);
});

test('rank 50 boundary', () => {
  const r = resolve(50);
  assert.equal(r.tierId, 'rank_26_50');
  assert.equal(r.cashAmount, 4_000);
});

test('rank 51 no reward', () => {
  const r = resolve(51, 100);
  assert.equal(r.eligible, false);
  assert.equal(r.tierId, null);
  assert.equal(r.cashAmount, 0);
  assert.equal(r.reason, 'rank-outside-reward-range');
});

test('invalid rank rejected', () => {
  assert.equal(resolve(0).reason, 'invalid-rank');
  assert.equal(resolve(-1).reason, 'invalid-rank');
  assert.equal(resolve(1.5 as number).reason, 'invalid-rank');
  assert.equal(resolve(11, 10).reason, 'invalid-rank');
});

test('minimum participant threshold enforced', () => {
  const r = resolveSeasonReward({
    finalRank: 1,
    participantCount: 9,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
  });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'insufficient-participants');
  assert.equal(r.cashAmount, 0);
});

test('participant threshold boundary at 10', () => {
  const under = resolveSeasonReward({
    finalRank: 1,
    participantCount: 9,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
  });
  const at = resolveSeasonReward({
    finalRank: 1,
    participantCount: 10,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
  });
  assert.equal(under.reason, 'insufficient-participants');
  assert.equal(at.eligible, true);
  assert.equal(at.tierId, 'rank_1');
});

test('W34-sized board (3 participants) yields no cash reward', () => {
  const r = resolveSeasonReward({
    finalRank: 2,
    participantCount: 3,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
  });
  assert.equal(r.reason, 'insufficient-participants');
  assert.equal(r.eligible, false);
});

test('unsupported snapshot / catalog versions', () => {
  assert.equal(
    resolveSeasonReward({
      finalRank: 1,
      participantCount: 10,
      snapshotVersion: 999,
    }).reason,
    'unsupported-snapshot-version',
  );
  assert.equal(
    resolveSeasonReward({
      finalRank: 1,
      participantCount: 10,
      snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
      rewardCatalogVersion: 99,
    }).reason,
    'unsupported-catalog-version',
  );
});

test('resolver is pure / deterministic', () => {
  const input: SeasonRewardResolveInput = {
    finalRank: 7,
    participantCount: 40,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
  };
  assert.deepEqual(resolveSeasonReward(input), resolveSeasonReward(input));
});

test('entitlement draft builder for eligible rank', () => {
  const draft = buildSeasonRewardEntitlementDraft({
    uid: 'uid-a',
    seasonKey: '2026-W40',
    finalRank: 1,
    participantCount: 12,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    nowMs: 1_700_000_000_000,
  });
  assert.equal(draft.ok, true);
  if (draft.ok) {
    assert.equal(draft.entitlement.status, 'unclaimed');
    assert.equal(draft.entitlement.claimedAt, null);
    assert.equal(draft.entitlement.cashAmount, 60_000);
    assert.equal(draft.entitlement.rewardCatalogVersion, 1);
  }
});

test('feature flag defaults off', () => {
  const previous = process.env.SEASON_REWARDS_ENABLED;
  delete process.env.SEASON_REWARDS_ENABLED;
  assert.equal(isSeasonRewardsEnabled(), false);
  process.env.SEASON_REWARDS_ENABLED = 'false';
  assert.equal(isSeasonRewardsEnabled(), false);
  process.env.SEASON_REWARDS_ENABLED = 'true';
  assert.equal(isSeasonRewardsEnabled(), true);
  if (previous === undefined) delete process.env.SEASON_REWARDS_ENABLED;
  else process.env.SEASON_REWARDS_ENABLED = previous;
});

test('parse entitlement rejects corrupt docs', () => {
  assert.equal(parseSeasonRewardEntitlementDocument(null), null);
  assert.equal(parseSeasonRewardEntitlementDocument({ uid: 'x' }), null);
});

test('parse + frozen match for valid entitlement', () => {
  const doc = {
    uid: 'uid-1',
    seasonKey: '2026-W36',
    resultSnapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    rewardCatalogVersion: SEASON_REWARD_CATALOG_VERSION,
    finalRank: 1,
    participantCount: 12,
    tierId: 'rank_1' as const,
    cashAmount: 60_000,
    status: 'unclaimed' as const,
    createdAt: 1,
    claimedAt: null,
    claimIdempotencyKey: null,
    version: SEASON_REWARD_ENTITLEMENT_SCHEMA_VERSION,
  };
  const parsed = parseSeasonRewardEntitlementDocument(doc);
  assert.ok(parsed);
  assert.equal(frozenEntitlementFieldsMatch(parsed!, doc), true);
  assert.equal(
    frozenEntitlementFieldsMatch(parsed!, { ...doc, cashAmount: 99_000 }),
    false,
  );
});

test('rank 51 draft yields no entitlement', () => {
  const draft = buildSeasonRewardEntitlementDraft({
    uid: 'uid-z',
    seasonKey: '2026-W36',
    finalRank: 51,
    participantCount: 100,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    nowMs: 1,
  });
  assert.equal(draft.ok, false);
});

test('participantCount 9 draft yields no entitlement', () => {
  const draft = buildSeasonRewardEntitlementDraft({
    uid: 'uid-z',
    seasonKey: '2026-W36',
    finalRank: 1,
    participantCount: 9,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    nowMs: 1,
  });
  assert.equal(draft.ok, false);
});

test('catalog version frozen into draft', () => {
  const draft = buildSeasonRewardEntitlementDraft({
    uid: 'uid-a',
    seasonKey: '2026-W36',
    finalRank: 2,
    participantCount: 10,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    rewardCatalogVersion: 1,
    nowMs: 42,
  });
  assert.equal(draft.ok, true);
  if (draft.ok) {
    assert.equal(draft.entitlement.rewardCatalogVersion, 1);
    assert.equal(draft.entitlement.cashAmount, 40_000);
    assert.equal(draft.entitlement.tierId, 'rank_2');
  }
});
