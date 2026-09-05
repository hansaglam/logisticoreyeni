import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { claimChallengeRewardTransaction, getCurrentChallengeState } from '../src/challenges';
import { buildDefaultServerState } from '../src/serverState';
import { getDailyPeriod, getWeeklyPeriod } from '../src/seasonPeriods';
import type { MarketplacePlayerState } from '../src/vehicleMarketplaceTypes';

const PROJECT_ID = 'logisticore-challenges-emulator';
const NOW_MS = Date.UTC(2026, 8, 1, 12);
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'challenge-tests');
const firestore = getFirestore(adminApp);
firestore.settings({ host: '127.0.0.1:8080', ssl: false });

before(async () => {
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
});

after(async () => {
  await rulesEnvironment.cleanup();
  await deleteApp(adminApp);
});

async function seedUser(uid: string, cash = 10_000) {
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
  const server = { ...buildDefaultServerState(uid, now), cash };
  await firestore.doc(`users/${uid}`).set({ uid });
  await firestore.doc(`users/${uid}/marketplaceState/current`).set(marketplace);
  await firestore.doc(`users/${uid}/serverState/current`).set(server);
}

async function seedPurchase(uid: string, id: string, createdAt = NOW_MS) {
  await firestore.doc(`users/${uid}/marketplaceHistory/${id}`).set({
    id,
    buyerUid: uid,
    sellerUid: `seller-${id}`,
    createdAt: Timestamp.fromMillis(createdAt),
  });
}

test('trusted history drives zero, partial and completed progress across periods', async () => {
  const uid = 'progress-user';
  await seedUser(uid);
  let state = await getCurrentChallengeState(firestore, uid, NOW_MS);
  assert.equal(state.challenges.find((item) => item.definition.id === 'weekly_marketplace_purchases')?.progress.current, 0);
  await seedPurchase(uid, 'purchase-1');
  await seedPurchase(uid, 'purchase-2');
  state = await getCurrentChallengeState(firestore, uid, NOW_MS);
  assert.equal(state.challenges.find((item) => item.definition.id === 'daily_marketplace_purchase')?.progress.current, 1);
  assert.equal(state.challenges.find((item) => item.definition.id === 'weekly_marketplace_purchases')?.progress.current, 2);
  await seedPurchase(uid, 'purchase-old', getWeeklyPeriod(NOW_MS).startsAt - 1);
  state = await getCurrentChallengeState(firestore, uid, NOW_MS);
  assert.equal(state.challenges.find((item) => item.definition.id === 'weekly_marketplace_purchases')?.progress.current, 2);
});

test('claim is atomic, idempotent and season points stay season-scoped', async () => {
  const uid = 'claim-user';
  await seedUser(uid);
  await seedPurchase(uid, 'purchase-1');
  const periodKey = getDailyPeriod(NOW_MS).key;
  const input = {
    challengeId: 'daily_marketplace_purchase',
    periodKey,
    transactionId: 'claim-1',
    idempotencyKey: 'claim-key-1',
  };
  const first = await claimChallengeRewardTransaction(firestore, uid, input, NOW_MS);
  assert.equal(first.ok, true);
  const replay = await claimChallengeRewardTransaction(firestore, uid, input, NOW_MS);
  assert.deepEqual(replay, first);
  const marketplace = await firestore.doc(`users/${uid}/marketplaceState/current`).get();
  assert.equal(marketplace.data()?.canonicalCash, 10_500);
  const server = await firestore.doc(`users/${uid}/serverState/current`).get();
  assert.equal(server.data()?.cash, 10_500);
  const season = await firestore.doc(`users/${uid}/seasonProgress/${getWeeklyPeriod(NOW_MS).key}`).get();
  assert.equal(season.data()?.points, 10);
  const duplicate = await claimChallengeRewardTransaction(firestore, uid, { ...input, transactionId: 'claim-2', idempotencyKey: 'claim-key-2' }, NOW_MS);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'already-claimed');
});

test('invalid, incomplete, stale and future claims fail closed', async () => {
  const uid = 'failure-user';
  await seedUser(uid);
  const weekly = getWeeklyPeriod(NOW_MS);
  const base = { transactionId: 'claim-x', idempotencyKey: 'claim-key-x' };
  assert.equal((await claimChallengeRewardTransaction(firestore, uid, { ...base, challengeId: 'unknown', periodKey: weekly.key }, NOW_MS)).reason, 'invalid-challenge-id');
  assert.equal((await claimChallengeRewardTransaction(firestore, uid, { ...base, challengeId: 'daily_delivery_foundation_deferred', periodKey: getDailyPeriod(NOW_MS).key }, NOW_MS)).reason, 'challenge-disabled');
  assert.equal((await claimChallengeRewardTransaction(firestore, uid, { ...base, challengeId: 'weekly_marketplace_purchases', periodKey: weekly.key }, NOW_MS)).reason, 'not-complete');
  assert.equal((await claimChallengeRewardTransaction(firestore, uid, { ...base, challengeId: 'weekly_marketplace_purchases', periodKey: '2025-W01' }, NOW_MS)).reason, 'period-closed');
  assert.equal((await claimChallengeRewardTransaction(firestore, uid, { ...base, challengeId: 'weekly_marketplace_purchases', periodKey: '2099-W01' }, NOW_MS)).reason, 'period-closed');
});

test('client cannot fabricate claim or season points', async () => {
  const uid = 'rules-user';
  await seedUser(uid);
  const db = rulesEnvironment.authenticatedContext(uid).firestore();
  await rulesTesting.assertFails(db.doc(`users/${uid}/challengeClaims/fake`).set({ claimed: true }));
  await rulesTesting.assertFails(db.doc(`users/${uid}/seasonProgress/2026-W36`).set({ points: 999999 }));
});
