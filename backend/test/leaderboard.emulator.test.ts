import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import {
  deleteLeaderboardEntriesForUid,
  getLeaderboardSnapshot,
  submitLeaderboardScoreTransaction,
} from '../src/leaderboard';
import { calculateLeaderboardScore } from '../src/leaderboardScore';
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

async function seedSave(uid: string, overrides: Record<string, unknown> = {}) {
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
  await adminFirestore.doc(`users/${uid}/saves/current`).set(buildSave(uid, overrides));
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

test('trusted score submit writes backend-calculated score', async () => {
  await seedSave('player-1');
  const result = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'player-1', displayName: 'Player' },
    { transactionId: 'tx-1', idempotencyKey: 'idem-1' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.updated, true);
  assert.equal(result.seasonKey, getLeaderboardSeasonKey());
  const expected = calculateLeaderboardScore(
    buildSave('player-1').gameState.player,
    buildSave('player-1').gameState,
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
  await adminFirestore.doc('users/no-name/saves/current').set(buildSave('no-name'));
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
  await seedSave('player-2', {
    player: { money: 500_000, completedContracts: 40, level: 10, reputation: 90 },
  });
  const first = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'player-2', displayName: null },
    { transactionId: 'tx-hi', idempotencyKey: 'idem-hi' },
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;

  await seedSave('player-2', {
    player: { money: 1_000, completedContracts: 0, level: 1, reputation: 0, trucks: [] },
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
  await seedSave('player-3');
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
  await seedSave('real-uid');
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
    await seedSave(uid, {
      player: {
        money: 100_000 * (i + 1),
        level: i + 1,
        reputation: 40 + i,
        completedContracts: i * 3,
      },
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

test('account deletion clears leaderboard entries', async () => {
  await seedSave('delete-me');
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

test('save-not-found when cloud save missing', async () => {
  const result = await submitLeaderboardScoreTransaction(
    adminFirestore,
    { uid: 'missing-save', displayName: null },
    { transactionId: 'tx-miss', idempotencyKey: 'idem-miss' },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'save-not-found');
});
