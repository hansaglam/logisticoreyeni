import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import {
  buildDefaultServerState,
  migrateLegacyServerStateTransaction,
} from '../src/serverState';
import type { ServerStateDocument } from '../src/serverStateTypes';

import {
  deleteLeaderboardEntriesForUid,
  getLeaderboardSnapshot,
  submitLeaderboardScoreTransaction,
} from '../src/leaderboard';
import { seedLeaderboardSeason } from '../src/leaderboardSeasonSeed';
import {
  calculateLeaderboardScore,
  extractCanonicalPlayerStateFromServerState,
} from '../src/leaderboardScore';
import { getLeaderboardSeasonKey } from '../src/leaderboardSeason';

const PROJECT_ID = 'logisticore-leaderboard-emulator';
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'leaderboard-tests');
const adminFirestore = getFirestore(adminApp);
adminFirestore.settings({ host: '127.0.0.1:8080', ssl: false });

function buildSave(uid: string, overrides: Record<string, unknown> = {}) {
  const player = {
    companyName: 'Aegean Freight',
    money: 250_000,
    level: 5,
    reputation: 60,
    completedContracts: 12,
    failedDeliveries: 0,
    lateDeliveries: 0,
    trucks: [
      {
        id: `${uid}-truck-1`,
        purchasePrice: 80_000,
        condition: 90,
        ownershipType: 'owned',
      },
    ],
    warehouses: [
      {
        id: `${uid}-wh-1`,
        cityId: 'izmir',
        capacityTons: 100,
        upgradeTier: 2,
      },
    ],
    ...((overrides.player as Record<string, unknown> | undefined) ?? {}),
  };
  return {
    ownerUid: uid,
    saveVersion: 3,
    gameState: {
      currentTime: 1_000,
      financeLedger: [],
      player,
      ...(overrides.gameState as Record<string, unknown> | undefined),
    },
  };
}

async function seedServerState(uid: string, overrides: Partial<ServerStateDocument> = {}) {
  await adminFirestore.doc(`users/${uid}`).set(
    {
      uid,
      username: `user_${uid.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12) || 'player'}`,
      usernameNormalized: `user_${uid.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12) || 'player'}`.toLowerCase(),
      usernameSetupCompleted: true,
      usernameChangeCount: 0,
    },
    { merge: true },
  );
  const base = buildDefaultServerState(uid, Timestamp.now());
  const state: ServerStateDocument = {
    ...base,
    ...overrides,
    ownedTruckIds:
      overrides.ownedTrucks?.map((truck) => truck.truckId) ?? base.ownedTruckIds,
    ownedTrucks: overrides.ownedTrucks ?? base.ownedTrucks,
    warehouses: overrides.warehouses ?? base.warehouses,
    migrationCompleted: overrides.migrationCompleted ?? true,
  };
  const extracted = extractCanonicalPlayerStateFromServerState(state);
  if (extracted.ok) {
    state.leaderboardScore = calculateLeaderboardScore(
      extracted.player,
      extracted.gameState,
    ).totalScore;
  }
  await adminFirestore.doc(`users/${uid}/serverState/current`).set(state);
  return state;
}

async function submitScore(uid: string, suffix: string) {
  return submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid, displayName: null },
    { transactionId: `tx-${suffix}`, idempotencyKey: `idem-${suffix}` },
  );
}

function expectedScoreFromState(state: ServerStateDocument): number {
  const extracted = extractCanonicalPlayerStateFromServerState(state);
  if (!extracted.ok) {
    throw new Error(`invalid server state: ${extracted.reason}`);
  }
  return calculateLeaderboardScore(extracted.player, extracted.gameState).totalScore;
}

before(async () => {
  rulesTesting = await import('@firebase/rules-unit-testing');
  rulesEnvironment = await rulesTesting.initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await rulesEnvironment.clearFirestore();
});

after(async () => {
  await rulesEnvironment.cleanup();
  await deleteApp(adminApp);
});

test('direct client write to leaderboard is denied', async () => {
  const seasonKey = getLeaderboardSeasonKey();
  const context = rulesEnvironment.authenticatedContext('player-1');
  const db = context.firestore();
  await rulesTesting.assertFails(
    db.doc(`leaderboards/${seasonKey}/entries/player-1`).set({
      uid: 'player-1',
      companyScore: 999_999,
      companyName: 'Cheater Co',
    }),
  );
});

test('trusted score submit writes backend-calculated score from serverState', async () => {
  const state = await seedServerState('player-1', {
    cash: 250_000,
    companyLevel: 5,
    reputation: 60,
    completedDeliveries: 12,
    ownedTrucks: [
      {
        truckId: 'player-1-truck-1',
        templateId: 'truck-ford-cargo',
        currentCityId: 'izmir',
        condition: 90,
        totalMileageKm: 0,
        currentFuelL: 100,
        fuelTankCapacityL: 300,
        purchasePrice: 80_000,
        ownershipType: 'owned',
        status: 'idle',
        upgrades: { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 },
      },
    ],
    warehouses: [
      { id: 'player-1-wh-1', cityId: 'izmir', capacityTons: 100, upgradeTier: 2 },
    ],
  });
  const result = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'player-1', displayName: 'Player' },
    { transactionId: 'tx-1', idempotencyKey: 'idem-1' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.updated, true);
  assert.equal(result.seasonKey, getLeaderboardSeasonKey());
  const extracted = extractCanonicalPlayerStateFromServerState(state);
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  const expected = calculateLeaderboardScore(
    extracted.player,
    extracted.gameState,
  ).totalScore;
  assert.equal(result.score, expected);

  const snap = await adminFirestore
    .doc(`leaderboards/${result.seasonKey}/entries/player-1`)
    .get();
  assert.equal(snap.exists, true);
  assert.equal(snap.data()?.companyScore, expected);
  assert.equal(snap.data()?.uid, 'player-1');
  assert.equal(typeof snap.data()?.username, 'string');
  assert.ok(String(snap.data()?.username).length > 0);
  assert.equal(snap.data()?.scoreVersion, 2);
});

test('submit without username is rejected', async () => {
  await adminFirestore.doc('users/no-name').set({ uid: 'no-name' });
  await adminFirestore
    .doc('users/no-name/serverState/current')
    .set(buildDefaultServerState('no-name', Timestamp.now()));
  const result = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'no-name', displayName: 'Ignored' },
    { transactionId: 'tx-nouser', idempotencyKey: 'idem-nouser' },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'username-required');
});

test('current score overwrites previous score and ineligible players are removed', async () => {
  await seedServerState('player-2', {
    cash: 80_000,
    completedDeliveries: 40,
    companyLevel: 10,
    reputation: 90,
  });
  const first = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'player-2', displayName: null },
    { transactionId: 'tx-hi', idempotencyKey: 'idem-hi' },
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.rankedEligible, true);

  await seedServerState('player-2', {
    cash: 1_000,
    completedDeliveries: 0,
    companyLevel: 1,
    reputation: 0,
    ownedTrucks: [],
  });
  const second = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'player-2', displayName: null },
    { transactionId: 'tx-lo', idempotencyKey: 'idem-lo' },
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.reason, 'not-ranked-eligible');
  assert.equal(second.rankedEligible, false);

  const snap = await adminFirestore
    .doc(`leaderboards/${first.seasonKey}/entries/player-2`)
    .get();
  assert.equal(snap.exists, false);
});

test('duplicate submit is idempotent', async () => {
  await seedServerState('player-3', { completedDeliveries: 5 });
  const a = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'player-3', displayName: null },
    { transactionId: 'tx-dup', idempotencyKey: 'same-key' },
  );
  const b = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'player-3', displayName: null },
    { transactionId: 'tx-dup', idempotencyKey: 'same-key' },
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.score, b.score);
  assert.equal(a.seasonKey, b.seasonKey);
});

test('wrong uid payload is ignored — entry owned by auth uid', async () => {
  await seedServerState('real-uid', { completedDeliveries: 5 });
  const result = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'real-uid', displayName: null },
    { transactionId: 'tx-uid', idempotencyKey: 'idem-uid' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const spoof = await adminFirestore
    .doc(`leaderboards/${result.seasonKey}/entries/other-uid`)
    .get();
  assert.equal(spoof.exists, false);
  const own = await adminFirestore
    .doc(`leaderboards/${result.seasonKey}/entries/real-uid`)
    .get();
  assert.equal(own.exists, true);
});

test('getLeaderboard returns top list and own rank', async () => {
  for (let i = 0; i < 5; i += 1) {
    const uid = `rank-${i}`;
    await seedServerState(uid, {
      cash: 100_000 * (i + 1),
      companyLevel: i + 1,
      reputation: 40 + i,
      completedDeliveries: (i + 1) * 3,
    });
    await submitLeaderboardScoreTransaction(
      adminFirestore,
      { uid, displayName: null },
      { transactionId: `tx-r-${i}`, idempotencyKey: `idem-r-${i}` },
    );
  }

  const board = await getLeaderboardSnapshot(
    adminFirestore,
    { uid: 'rank-0', displayName: null },
    { limit: 100 },
  );
  assert.equal(board.ok, true);
  if (!board.ok) return;
  assert.ok(board.entries.length <= 100);
  assert.equal(board.seasonKey, getLeaderboardSeasonKey());
  assert.ok(board.playerRank != null && board.playerRank >= 1);
  assert.ok(board.playerEntry != null);
  assert.equal(board.entries[0]?.rank, 1);
  assert.ok(typeof board.totalParticipants === 'number');
  assert.ok(board.totalParticipants >= board.entries.length);
  for (let i = 1; i < board.entries.length; i += 1) {
    assert.ok(board.entries[i - 1]!.companyScore >= board.entries[i]!.companyScore);
  }
});

test('malicious cloud save write does not change leaderboard score', async () => {
  const uid = 'secure-player';
  const trustedState = await seedServerState(uid, {
    cash: 50_000,
    companyLevel: 3,
    reputation: 55,
    completedDeliveries: 4,
  });
  const expectedScore = expectedScoreFromState(trustedState);
  const first = await submitScore(uid, 'secure-1');
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.score, expectedScore);
  await adminFirestore.doc(`users/${uid}/saves/current`).set(
    buildSave(uid, {
      player: {
        money: 987_654_321,
        level: 100,
        reputation: 100,
        completedContracts: 50_000,
        trucks: [
          {
            id: 'phantom-truck',
            purchasePrice: 500_000,
            condition: 100,
            ownershipType: 'owned',
          },
        ],
        warehouses: [
          { id: 'phantom-wh', cityId: 'ankara', capacityTons: 500, upgradeTier: 5 },
        ],
      },
    }),
  );
  const second = await submitScore(uid, 'secure-2');
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.score, first.score);
  assert.equal(second.score, expectedScore);

  const entrySnap = await adminFirestore
    .doc(`leaderboards/${first.seasonKey}/entries/${uid}`)
    .get();
  assert.equal(entrySnap.data()?.completedContracts, 4);
  assert.equal(entrySnap.data()?.level, 3);
  assert.equal(entrySnap.data()?.reputation, 55);
});

test('malicious save fields cannot spoof individual progression inputs', async () => {
  const cases: Array<{ uid: string; player: Record<string, unknown> }> = [
    {
      uid: 'spoof-contracts',
      player: { completedContracts: 50_000, money: 50_000, level: 3, reputation: 55 },
    },
    {
      uid: 'spoof-level',
      player: { level: 100, completedContracts: 4, money: 50_000, reputation: 55 },
    },
    {
      uid: 'spoof-reputation',
      player: { reputation: 100, completedContracts: 4, money: 50_000, level: 3 },
    },
    {
      uid: 'spoof-money',
      player: { money: 987_654_321, completedContracts: 4, level: 3, reputation: 55 },
    },
  ];

  for (const testCase of cases) {
    const trustedState = await seedServerState(testCase.uid, {
      cash: 50_000,
      companyLevel: 3,
      reputation: 55,
      completedDeliveries: 4,
    });
    const baseline = await submitScore(testCase.uid, `${testCase.uid}-base`);
    assert.equal(baseline.ok, true, testCase.uid);
    if (!baseline.ok) return;

    await adminFirestore.doc(`users/${testCase.uid}/saves/current`).set(
      buildSave(testCase.uid, { player: testCase.player }),
    );
    const afterForged = await submitScore(testCase.uid, `${testCase.uid}-forged`);
    assert.equal(afterForged.ok, true, testCase.uid);
    if (!afterForged.ok) return;
    assert.equal(afterForged.score, baseline.score, testCase.uid);
    assert.equal(afterForged.score, expectedScoreFromState(trustedState), testCase.uid);
  }
});

test('malicious fleet and warehouse save does not inflate asset score', async () => {
  const uid = 'spoof-fleet';
  const trustedState = await seedServerState(uid, {
    cash: 50_000,
    companyLevel: 3,
    reputation: 55,
    completedDeliveries: 4,
    ownedTrucks: [],
    warehouses: [],
  });
  const baseline = await submitScore(uid, 'fleet-base');
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;

  await adminFirestore.doc(`users/${uid}/saves/current`).set(
    buildSave(uid, {
      player: {
        trucks: [
          { id: 'forged-1', purchasePrice: 400_000, condition: 100, ownershipType: 'owned' },
          { id: 'forged-2', purchasePrice: 400_000, condition: 100, ownershipType: 'owned' },
        ],
        warehouses: [
          { id: 'forged-wh', cityId: 'ankara', capacityTons: 500, upgradeTier: 5 },
        ],
      },
    }),
  );
  const afterForged = await submitScore(uid, 'fleet-forged');
  assert.equal(afterForged.ok, true);
  if (!afterForged.ok) return;
  assert.equal(afterForged.score, baseline.score);
  assert.equal(afterForged.score, expectedScoreFromState(trustedState));
});

test('repeated submit with new idempotency key returns same trusted score', async () => {
  const uid = 'deterministic-player';
  await seedServerState(uid, {
    cash: 50_000,
    companyLevel: 4,
    reputation: 50,
    completedDeliveries: 6,
  });
  const first = await submitScore(uid, 'det-1');
  const second = await submitScore(uid, 'det-2');
  const third = await submitScore(uid, 'det-3');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  if (!first.ok || !second.ok || !third.ok) return;
  assert.equal(second.score, first.score);
  assert.equal(third.score, first.score);
});

test('trusted serverState progression updates increase score', async () => {
  const uid = 'trusted-progress';
  await seedServerState(uid, {
    cash: 40_000,
    companyLevel: 3,
    reputation: 40,
    completedDeliveries: 5,
  });
  const first = await submitScore(uid, 'prog-1');
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const upgraded = await seedServerState(uid, {
    cash: 80_000,
    companyLevel: 6,
    reputation: 70,
    completedDeliveries: 12,
    ownedTrucks: [
      {
        truckId: `${uid}-truck-1`,
        templateId: 'truck-ford-cargo',
        currentCityId: 'izmir',
        condition: 90,
        totalMileageKm: 0,
        currentFuelL: 100,
        fuelTankCapacityL: 300,
        purchasePrice: 80_000,
        ownershipType: 'owned',
        status: 'idle',
        upgrades: { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 },
      },
    ],
  });
  const second = await submitScore(uid, 'prog-2');
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.ok((second.score ?? 0) > (first.score ?? 0));
  assert.equal(second.score, expectedScoreFromState(upgraded));
});

test('season seed ignores malicious cloud save when serverState exists', async () => {
  const uid = 'season-seed-secure';
  const seasonKey = getLeaderboardSeasonKey();
  await adminFirestore.doc(`users/${uid}`).set({
    uid,
    username: 'seedsecure',
    usernameNormalized: 'seedsecure',
    usernameSetupCompleted: true,
  });
  const trustedState = await seedServerState(uid, {
    cash: 50_000,
    companyLevel: 3,
    reputation: 55,
    completedDeliveries: 4,
  });
  const expectedScore = expectedScoreFromState(trustedState);
  await adminFirestore.doc(`users/${uid}/saves/current`).set(
    buildSave(uid, {
      player: {
        money: 999_999_999,
        level: 100,
        reputation: 100,
        completedContracts: 50_000,
      },
    }),
  );

  const seeded = await seedLeaderboardSeason(adminFirestore, seasonKey, { force: true });
  assert.equal(seeded.ran, true);

  const entrySnap = await adminFirestore
    .doc(`leaderboards/${seasonKey}/entries/${uid}`)
    .get();
  assert.equal(entrySnap.exists, true);
  assert.equal(entrySnap.data()?.companyScore, expectedScore);
});

test('first-time submit bootstraps bounded score from cloud save when serverState missing', async () => {
  const uid = 'legacy-bootstrap';
  await adminFirestore.doc(`users/${uid}`).set({
    uid,
    username: 'legacy_user',
    usernameNormalized: 'legacy_user',
    usernameSetupCompleted: true,
  });
  await adminFirestore.doc(`users/${uid}/saves/current`).set(
    buildSave(uid, {
      player: {
        money: 50_000,
        level: 5,
        reputation: 60,
        completedContracts: 12,
      },
    }),
  );

  const result = await submitScore(uid, 'legacy-bootstrap');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok((result.score ?? 0) > 0);

  const serverSnap = await adminFirestore.doc(`users/${uid}/serverState/current`).get();
  assert.equal(serverSnap.exists, true);
  assert.equal(Number(serverSnap.data()?.completedDeliveries), 12);
});

test('account deletion clears leaderboard entries', async () => {
  await seedServerState('delete-me', { completedDeliveries: 6 });
  const submitted = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'delete-me', displayName: null },
    { transactionId: 'tx-del', idempotencyKey: 'idem-del' },
  );
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  const deleted = await deleteLeaderboardEntriesForUid(adminFirestore, 'delete-me');
  assert.ok(deleted >= 1);
  const snap = await adminFirestore
    .doc(`leaderboards/${submitted.seasonKey}/entries/delete-me`)
    .get();
  assert.equal(snap.exists, false);
});

test('season key format is YYYY-Www', () => {
  const key = getLeaderboardSeasonKey(Date.UTC(2026, 6, 28));
  assert.match(key, /^\d{4}-W\d{2}$/);
});

test('cash alone does not dominate score unboundedly', () => {
  const modest = calculateLeaderboardScore({
    money: 100_000,
    level: 5,
    reputation: 50,
    completedContracts: 10,
    trucks: [{ purchasePrice: 50_000, condition: 100, ownershipType: 'owned' }],
    warehouses: [],
  });
  const whale = calculateLeaderboardScore({
    money: 500_000_000,
    level: 5,
    reputation: 50,
    completedContracts: 10,
    trucks: [{ purchasePrice: 50_000, condition: 100, ownershipType: 'owned' }],
    warehouses: [],
  });
  assert.ok(whale.totalScore > modest.totalScore);
  assert.ok(whale.totalScore < modest.totalScore + 500_000_000);
  assert.ok(whale.financialScore <= 8_000);
  assert.ok(whale.totalScore - modest.totalScore < 5_000);
  assert.ok(whale.financialScore <= 8_000);
});

test('zero-delivery default account is not ranked', async () => {
  await seedServerState('fresh-uid');
  const result = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'fresh-uid', displayName: null },
    { transactionId: 'tx-fresh', idempotencyKey: 'idem-fresh' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.reason, 'not-ranked-eligible');
  const snap = await adminFirestore
    .doc(`leaderboards/${result.seasonKey}/entries/fresh-uid`)
    .get();
  assert.equal(snap.exists, false);
});

test('v1 ghost scores are excluded from ranking', async () => {
  const seasonKey = getLeaderboardSeasonKey();
  await adminFirestore.doc(`leaderboards/${seasonKey}/entries/v1-ghost`).set({
    uid: 'v1-ghost',
    username: 'oldscore',
    companyName: 'Ghost Co',
    companyScore: 119_535,
    level: 1,
    reputation: 50,
    completedContracts: 0,
    scoreVersion: 1,
    seasonKey,
  });
  await seedServerState('v2-player', {
    completedDeliveries: 14,
    companyLevel: 6,
    reputation: 32,
    cash: 18_000,
  });
  const submitted = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'v2-player', displayName: null },
    { transactionId: 'tx-v2', idempotencyKey: 'idem-v2' },
  );
  assert.equal(submitted.ok, true);
  const board = await getLeaderboardSnapshot(
    adminFirestore,
    { uid: 'v2-player', displayName: null },
    { limit: 100 },
  );
  assert.equal(board.ok, true);
  if (!board.ok) return;
  assert.equal(board.entries.some((entry) => entry.uid === 'v1-ghost'), false);
  assert.equal(board.entries[0]?.uid, 'v2-player');
});

test('leaderboard bootstraps default serverState when canonical state missing', async () => {
  await adminFirestore.doc('users/missing-save').set({
    uid: 'missing-save',
    username: 'missing_user',
    usernameNormalized: 'missing_user',
    usernameSetupCompleted: true,
  });
  const result = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'missing-save', displayName: null },
    { transactionId: 'tx-miss', idempotencyKey: 'idem-miss' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.reason, 'not-ranked-eligible');
  const serverSnap = await adminFirestore
    .doc('users/missing-save/serverState/current')
    .get();
  assert.equal(serverSnap.exists, true);
  assert.equal(Number(serverSnap.data()?.cash), 20_000);
  const entrySnap = await adminFirestore
    .doc(`leaderboards/${result.seasonKey}/entries/missing-save`)
    .get();
  assert.equal(entrySnap.exists, false);
});

test('cross-platform: Android and iOS users share one leaderboard (no platform filter)', async () => {
  const androidUid = 'uid-android-cross';
  const iosUid = 'uid-ios-cross';
  const seasonKey = getLeaderboardSeasonKey();

  await adminFirestore.doc(`users/${androidUid}`).set({
    uid: androidUid,
    username: 'androidtest',
    usernameNormalized: 'androidtest',
    usernameSetupCompleted: true,
  });
  await adminFirestore.doc(`users/${iosUid}`).set({
    uid: iosUid,
    username: 'iostest',
    usernameNormalized: 'iostest',
    usernameSetupCompleted: true,
  });

  await seedServerState(androidUid, {
    cash: 120_000,
    companyLevel: 6,
    reputation: 55,
    completedDeliveries: 15,
  });
  await seedServerState(iosUid, {
    cash: 95_000,
    companyLevel: 5,
    reputation: 50,
    completedDeliveries: 10,
  });

  await adminFirestore.doc(`users/${androidUid}`).set(
    {
      username: 'androidtest',
      usernameNormalized: 'androidtest',
      usernameSetupCompleted: true,
    },
    { merge: true },
  );
  await adminFirestore.doc(`users/${iosUid}`).set(
    {
      username: 'iostest',
      usernameNormalized: 'iostest',
      usernameSetupCompleted: true,
    },
    { merge: true },
  );

  const androidSubmit = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: androidUid, displayName: null },
    { transactionId: 'tx-android', idempotencyKey: 'idem-android' },
  );
  const iosSubmit = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: iosUid, displayName: null },
    { transactionId: 'tx-ios', idempotencyKey: 'idem-ios' },
  );
  assert.equal(androidSubmit.ok, true);
  assert.equal(iosSubmit.ok, true);
  if (!androidSubmit.ok || !iosSubmit.ok) return;
  assert.equal(androidSubmit.seasonKey, seasonKey);
  assert.equal(iosSubmit.seasonKey, seasonKey);
  assert.ok((androidSubmit.score ?? 0) > (iosSubmit.score ?? 0));

  const board = await getLeaderboardSnapshot(
    adminFirestore,
    { uid: androidUid, displayName: null },
    { limit: 100 },
  );
  assert.equal(board.ok, true);
  if (!board.ok) return;
  assert.equal(board.seasonKey, seasonKey);
  const uids = board.entries.map((entry) => entry.uid);
  assert.ok(uids.includes(androidUid), 'Android user visible in shared table');
  assert.ok(uids.includes(iosUid), 'iOS user visible in shared table');
  assert.equal(board.entries[0]?.username, 'androidtest');
  assert.equal(board.entries[0]?.uid, androidUid);
  assert.equal(board.entries[1]?.username, 'iostest');
  assert.ok(board.totalParticipants != null && board.totalParticipants >= 2);
  for (const entry of board.entries) {
    assert.equal('platform' in entry, false, 'platform must not be in public response');
  }
});

test('same UID submit from Android then iOS metadata updates one entry (no duplicate)', async () => {
  const uid = 'uid-same-account';
  await adminFirestore.doc(`users/${uid}`).set({
    uid,
    username: 'crossdevice',
    usernameNormalized: 'crossdevice',
    usernameSetupCompleted: true,
  });
  await seedServerState(uid, { cash: 80_000, companyLevel: 4, reputation: 45, completedDeliveries: 5 });

  const first = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid, displayName: null },
    { transactionId: 'tx-same-1', idempotencyKey: 'idem-same-1' },
  );
  await seedServerState(uid, { cash: 200_000, companyLevel: 7, reputation: 70, completedDeliveries: 12 });
  const second = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid, displayName: null },
    { transactionId: 'tx-same-2', idempotencyKey: 'idem-same-2' },
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.ok((second.score ?? 0) >= (first.score ?? 0));

  const seasonKey = first.seasonKey;
  const snapshot = await adminFirestore.collection(`leaderboards/${seasonKey}/entries`).get();
  const sameUidDocs = snapshot.docs.filter((doc) => doc.id === uid);
  assert.equal(sameUidDocs.length, 1, 'exactly one entry per UID');
});

test('cross-platform pagination returns mixed entries without platform cursor', async () => {
  for (let i = 0; i < 4; i += 1) {
    const uid = `page-user-${i}`;
    await seedServerState(uid, {
      cash: 50_000 * (i + 1),
      companyLevel: i + 1,
      reputation: 40 + i,
      completedDeliveries: (i + 1) * 3,
    });
    await submitLeaderboardScoreTransaction(
      adminFirestore,
      { uid, displayName: null },
      { transactionId: `tx-page-${i}`, idempotencyKey: `idem-page-${i}` },
    );
  }

  const page1 = await getLeaderboardSnapshot(
    adminFirestore,
    { uid: 'page-user-0', displayName: null },
    { limit: 2 },
  );
  assert.equal(page1.ok, true);
  if (!page1.ok || !page1.nextCursor) return;

  const page2 = await getLeaderboardSnapshot(
    adminFirestore,
    { uid: 'page-user-0', displayName: null },
    { limit: 2, cursor: page1.nextCursor },
  );
  assert.equal(page2.ok, true);
  if (!page2.ok) return;

  const page1Uids = new Set(page1.entries.map((entry) => entry.uid));
  const page2Uids = new Set(page2.entries.map((entry) => entry.uid));
  for (const uid of page2Uids) {
    assert.equal(page1Uids.has(uid), false, 'no duplicate across pages');
  }
  assert.equal(page1.entries.length + page2.entries.length, 4);
});
