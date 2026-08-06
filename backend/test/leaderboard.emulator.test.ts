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

test('lower score does not overwrite higher score', async () => {
  await seedServerState('player-2', {
    cash: 500_000,
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
  assert.equal(second.updated, false);
  assert.equal(second.reason, 'score-not-improved');
  assert.equal(second.score, first.score);

  const snap = await adminFirestore
    .doc(`leaderboards/${first.seasonKey}/entries/player-2`)
    .get();
  assert.equal(snap.data()?.companyScore, first.score);
});

test('duplicate submit is idempotent', async () => {
  await seedServerState('player-3');
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
  await seedServerState('real-uid');
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
      completedDeliveries: i * 3,
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
  for (let i = 1; i < board.entries.length; i += 1) {
    assert.ok(board.entries[i - 1]!.companyScore >= board.entries[i]!.companyScore);
  }
});

test('malicious cloud save write does not change leaderboard score', async () => {
  await seedServerState('secure-player', {
    cash: 50_000,
    companyLevel: 3,
    reputation: 55,
    completedDeliveries: 4,
  });
  const first = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'secure-player', displayName: null },
    { transactionId: 'tx-secure-1', idempotencyKey: 'idem-secure-1' },
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await adminFirestore.doc('users/secure-player/saves/current').set(
    buildSave('secure-player', {
      player: {
        money: 987_654_321,
        level: 100,
        reputation: 100,
        completedContracts: 50_000,
      },
    }),
  );
  const second = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'secure-player', displayName: null },
    { transactionId: 'tx-secure-2', idempotencyKey: 'idem-secure-2' },
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.score, first.score);
});

test('account deletion clears leaderboard entries', async () => {
  await seedServerState('delete-me');
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
  assert.ok(whale.financialScore < 500_000_000);
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
  const serverSnap = await adminFirestore
    .doc('users/missing-save/serverState/current')
    .get();
  assert.equal(serverSnap.exists, true);
  assert.equal(Number(serverSnap.data()?.cash), 20_000);
});
