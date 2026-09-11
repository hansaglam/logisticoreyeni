/**
 * Phase 7 Step 5 — Season reward entitlement + claim emulator tests.
 * Requires Firestore emulator + Java. Skipped/failed locally when Java unavailable.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { getPreviousLeaderboardSeasonKey } from '../src/leaderboardSeason';
import { LEADERBOARD_SCORE_VERSION } from '../src/leaderboardScore';
import { buildDefaultServerState } from '../src/serverState';
import { SEASON_CLOSE_SNAPSHOT_VERSION } from '../src/seasonCloseTypes';
import type { MarketplacePlayerState } from '../src/vehicleMarketplaceTypes';
import {
  claimSeasonRewardTransaction,
  deleteSeasonRewardDataForUid,
  getSeasonRewardEntitlementForUid,
  materializeSeasonRewardEntitlements,
  seasonRewardClaimRef,
  seasonRewardEntitlementRef,
} from '../src/seasonRewards';

const PROJECT_ID = 'logisticore-season-rewards-emulator';
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.SEASON_REWARDS_ENABLED = 'true';

const NOW_MS = Date.UTC(2026, 8, 9, 12, 0, 0, 0); // mid 2026-W37
const SEASON_KEY = getPreviousLeaderboardSeasonKey(NOW_MS); // 2026-W36

let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'season-rewards-tests');
const firestore = getFirestore(adminApp);
firestore.settings({ host: '127.0.0.1:8080', ssl: false });

async function seedClosedSeason(opts: {
  rewardsEnabled: boolean;
  rewardCatalogVersion?: number | null;
  participants: Array<{ uid: string; rank: number; score: number }>;
}): Promise<void> {
  const n = opts.participants.length;
  await firestore.doc(`seasons/${SEASON_KEY}`).set({
    seasonKey: SEASON_KEY,
    startsAt: 0,
    endsAt: NOW_MS - 86_400_000,
    status: 'closed',
    participantCount: n,
    processedCount: n,
    snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    scoreVersion: LEADERBOARD_SCORE_VERSION,
    closeCursor: null,
    closeStartedAt: NOW_MS - 1000,
    closedAt: NOW_MS - 500,
    rewardsEnabled: opts.rewardsEnabled,
    rewardCatalogVersion: opts.rewardCatalogVersion ?? null,
    rewardMaterializationComplete: false,
    rewardMaterializationCursorUid: null,
  });
  for (const p of opts.participants) {
    await firestore.doc(`seasons/${SEASON_KEY}/results/${p.uid}`).set({
      uid: p.uid,
      seasonKey: SEASON_KEY,
      finalScore: p.score,
      finalRank: p.rank,
      participantCount: n,
      snapshottedAt: NOW_MS - 500,
      snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
      scoreVersion: LEADERBOARD_SCORE_VERSION,
      rewardTier: null,
      rewardAmount: null,
      rewardStatus: null,
    });
  }
}

async function seedPlayer(uid: string, cash: number): Promise<void> {
  const now = Timestamp.fromMillis(NOW_MS);
  const marketplace: MarketplacePlayerState = {
    ownerUid: uid,
    canonicalCash: cash,
    fleetLimit: 10,
    stateVersion: 1,
    sourceSaveVersion: 1,
    ownedTruckSnapshots: [],
    activeListingIds: [],
    soldTruckTombstones: [],
  };
  await firestore.doc(`users/${uid}`).set({ uid });
  await firestore.doc(`users/${uid}/marketplaceState/current`).set(marketplace);
  await firestore
    .doc(`users/${uid}/serverState/current`)
    .set({ ...buildDefaultServerState(uid, now), cash });
}

before(async () => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  rulesTesting = await import('@firebase/rules-unit-testing');
  rulesEnvironment = await rulesTesting.initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await rulesEnvironment.clearFirestore();
  process.env.SEASON_REWARDS_ENABLED = 'true';
});

after(async () => {
  await rulesEnvironment.cleanup();
  await deleteApp(adminApp);
  delete process.env.SEASON_REWARDS_ENABLED;
});

function tenParticipants(): Array<{ uid: string; rank: number; score: number }> {
  return Array.from({ length: 10 }, (_, i) => ({
    uid: `uid_${String(i + 1).padStart(2, '0')}`,
    rank: i + 1,
    score: 100_000 - i * 1000,
  }));
}

test('W34-style rewardsEnabled=false → no entitlements', async () => {
  await seedClosedSeason({
    rewardsEnabled: false,
    rewardCatalogVersion: null,
    participants: [
      { uid: 'a', rank: 1, score: 89110 },
      { uid: 'b', rank: 2, score: 45031 },
      { uid: 'c', rank: 3, score: 25408 },
    ],
  });
  const result = await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, {
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rewards-disabled-for-season');
  const ent = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'a').get();
  assert.equal(ent.exists, false);
});

test('materialize rank tiers and skip ineligible', async () => {
  const board = Array.from({ length: 51 }, (_, i) => ({
    uid: `uid_${String(i + 1).padStart(2, '0')}`,
    rank: i + 1,
    score: 200_000 - i,
  }));
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: board,
  });
  const first = await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, {
    nowMs: NOW_MS,
  });
  assert.equal(first.ok, true);
  assert.equal(first.complete, true);
  assert.equal(first.entitlementsCreated, 50);

  const rank1 = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_01').get();
  assert.equal(rank1.data()?.cashAmount, 60_000);
  assert.equal(rank1.data()?.tierId, 'rank_1');
  assert.equal(rank1.data()?.status, 'unclaimed');

  const rank2 = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_02').get();
  assert.equal(rank2.data()?.cashAmount, 40_000);

  const rank4 = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_04').get();
  assert.equal(rank4.data()?.cashAmount, 12_000);

  const rank11 = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_11').get();
  assert.equal(rank11.data()?.cashAmount, 7_500);

  const rank26 = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_26').get();
  assert.equal(rank26.data()?.cashAmount, 4_000);

  const rank51 = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_51').get();
  assert.equal(rank51.exists, false);

  const second = await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, {
    nowMs: NOW_MS,
  });
  assert.equal(second.reason, 'already-complete');
  assert.equal(second.entitlementsCreated, 0);
});

test('participantCount 9 → no entitlements; 10 → allowed', async () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({
    uid: `n${i + 1}`,
    rank: i + 1,
    score: 1000 - i,
  }));
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: nine,
  });
  const under = await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, {
    nowMs: NOW_MS,
  });
  assert.equal(under.ok, true);
  assert.equal(under.entitlementsCreated, 0);
  assert.equal((await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'n1').get()).exists, false);

  await rulesEnvironment.clearFirestore();
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: tenParticipants(),
  });
  const at = await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, {
    nowMs: NOW_MS,
  });
  assert.equal(at.entitlementsCreated, 10);
});

test('conflicting entitlement → integrity error', async () => {
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: tenParticipants(),
  });
  await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_01').set({
    uid: 'uid_01',
    seasonKey: SEASON_KEY,
    resultSnapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    rewardCatalogVersion: 1,
    finalRank: 1,
    participantCount: 10,
    tierId: 'rank_1',
    cashAmount: 99_999,
    status: 'unclaimed',
    createdAt: 1,
    claimedAt: null,
    claimIdempotencyKey: null,
    version: 1,
  });
  const result = await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, {
    nowMs: NOW_MS,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'integrity-conflict');
});

test('claim pays exact cash once; idempotent; second key blocked', async () => {
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: tenParticipants(),
  });
  await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, { nowMs: NOW_MS });
  await seedPlayer('uid_01', 10_000);

  const first = await claimSeasonRewardTransaction(
    firestore,
    'uid_01',
    { seasonKey: SEASON_KEY, idempotencyKey: 'claim-key-aaaa' },
    NOW_MS,
  );
  assert.equal(first.ok, true);
  assert.equal(first.cashAmount, 60_000);
  assert.equal(first.cashAfter, 70_000);

  const replay = await claimSeasonRewardTransaction(
    firestore,
    'uid_01',
    { seasonKey: SEASON_KEY, idempotencyKey: 'claim-key-aaaa' },
    NOW_MS,
  );
  assert.equal(replay.ok, true);
  assert.equal(replay.cashAfter, 70_000);

  const otherKey = await claimSeasonRewardTransaction(
    firestore,
    'uid_01',
    { seasonKey: SEASON_KEY, idempotencyKey: 'claim-key-bbbb' },
    NOW_MS,
  );
  assert.equal(otherKey.ok, false);
  assert.equal(otherKey.reason, 'already-claimed');

  const market = await firestore.doc('users/uid_01/marketplaceState/current').get();
  const server = await firestore.doc('users/uid_01/serverState/current').get();
  assert.equal(market.data()?.canonicalCash, 70_000);
  assert.equal(server.data()?.cash, 70_000);

  const ent = await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_01').get();
  assert.equal(ent.data()?.status, 'claimed');
  assert.ok(ent.data()?.claimedAt);

  const claim = await seasonRewardClaimRef(firestore, SEASON_KEY, 'uid_01').get();
  assert.equal(claim.data()?.idempotencyKey, 'claim-key-aaaa');
});

test('no entitlement → no payout; rewards disabled → no payout', async () => {
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: tenParticipants(),
  });
  await seedPlayer('uid_ghost', 5_000);
  const missing = await claimSeasonRewardTransaction(
    firestore,
    'uid_ghost',
    { seasonKey: SEASON_KEY, idempotencyKey: 'claim-key-cccc' },
    NOW_MS,
  );
  assert.equal(missing.reason, 'no_reward');
  assert.equal(
    (await firestore.doc('users/uid_ghost/marketplaceState/current').get()).data()
      ?.canonicalCash,
    5_000,
  );

  await rulesEnvironment.clearFirestore();
  await seedClosedSeason({
    rewardsEnabled: false,
    participants: tenParticipants(),
  });
  await seedPlayer('uid_01', 5_000);
  await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_01').set({
    uid: 'uid_01',
    seasonKey: SEASON_KEY,
    resultSnapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
    rewardCatalogVersion: 1,
    finalRank: 1,
    participantCount: 10,
    tierId: 'rank_1',
    cashAmount: 60_000,
    status: 'unclaimed',
    createdAt: 1,
    claimedAt: null,
    claimIdempotencyKey: null,
    version: 1,
  });
  const disabled = await claimSeasonRewardTransaction(
    firestore,
    'uid_01',
    { seasonKey: SEASON_KEY, idempotencyKey: 'claim-key-dddd' },
    NOW_MS,
  );
  assert.equal(disabled.reason, 'rewards_disabled');
});

test('get entitlement states', async () => {
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: tenParticipants(),
  });
  await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, { nowMs: NOW_MS });
  const unclaimed = await getSeasonRewardEntitlementForUid(
    firestore,
    'uid_01',
    SEASON_KEY,
    NOW_MS,
  );
  assert.equal(unclaimed.reason, 'eligible_unclaimed');
  const none = await getSeasonRewardEntitlementForUid(
    firestore,
    'uid_ghost',
    SEASON_KEY,
    NOW_MS,
  );
  assert.equal(none.reason, 'no_reward');
});

test('account deletion removes only caller reward docs', async () => {
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: tenParticipants(),
  });
  await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, { nowMs: NOW_MS });
  await seedPlayer('uid_01', 10_000);
  await claimSeasonRewardTransaction(
    firestore,
    'uid_01',
    { seasonKey: SEASON_KEY, idempotencyKey: 'claim-key-eeee' },
    NOW_MS,
  );
  const cleanup = await deleteSeasonRewardDataForUid(firestore, 'uid_01', NOW_MS);
  assert.ok(cleanup.entitlementsDeleted >= 1);
  assert.ok(cleanup.claimsDeleted >= 1);
  assert.equal(
    (await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_01').get()).exists,
    false,
  );
  assert.equal(
    (await seasonRewardEntitlementRef(firestore, SEASON_KEY, 'uid_02').get()).exists,
    true,
  );
});

test('clients cannot write reward entitlements or claims', async () => {
  const uid = 'rules-user';
  const db = rulesEnvironment.authenticatedContext(uid).firestore();
  await rulesTesting.assertFails(
    db.doc(`seasons/${SEASON_KEY}/rewardEntitlements/${uid}`).set({ cashAmount: 999 }),
  );
  await rulesTesting.assertFails(
    db.doc(`seasons/${SEASON_KEY}/rewardClaims/${uid}`).set({ cashAmount: 999 }),
  );
});

test('feature flag OFF blocks materialize even if season enabled', async () => {
  await seedClosedSeason({
    rewardsEnabled: true,
    rewardCatalogVersion: 1,
    participants: tenParticipants(),
  });
  delete process.env.SEASON_REWARDS_ENABLED;
  const result = await materializeSeasonRewardEntitlements(firestore, SEASON_KEY, {
    nowMs: NOW_MS,
  });
  assert.equal(result.reason, 'feature-disabled');
  process.env.SEASON_REWARDS_ENABLED = 'true';
});
