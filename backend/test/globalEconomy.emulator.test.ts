import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import {
  buildCanonicalSnapshot,
  resolveWorkerConfigVersion,
} from '../src/globalEconomyGenerator';
import {
  HISTORY_RETENTION_EPOCHS,
  runGlobalEconomyEpoch,
} from '../src/globalEconomyWorker';
import { CITIES } from '../../src/data/cities';
import { buildGlobalEconomySnapshot } from '../../src/simulation/globalMarketSnapshot';
import { resolveGlobalMarketAvailability } from '../../src/simulation/globalMarketAvailability';

const PROJECT_ID = 'logisticore-emulator';
const NOW_MS = 1_800_000_000_000;
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;
let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'global-economy-tests');
const adminFirestore = getFirestore(adminApp);
adminFirestore.settings({ host: '127.0.0.1:8080', ssl: false });

before(async () => {
  rulesTesting = await import('@firebase/rules-unit-testing');
  rulesEnvironment = await rulesTesting.initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(resolve(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await rulesEnvironment.clearFirestore();
  delete process.env.ECONOMY_CONFIG_VERSION;
});

after(async () => {
  await rulesEnvironment?.cleanup();
  await deleteApp(adminApp);
});

test('authenticated global reads and production client write denial', async () => {
  const { assertFails, assertSucceeds } = rulesTesting;
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await firestore.doc('globalEconomy/current').set({
      epoch: 100,
      configVersion: 1,
    });
    await firestore.doc('globalEconomySnapshots/100_1').set({
      epoch: 100,
      configVersion: 1,
    });
    await firestore.doc('globalMarketHistory/100_izmir_fruit').set({
      epoch: 100,
      configVersion: 1,
      cityId: 'izmir',
      productId: 'fruit',
      price: 900,
    });
  });

  const authenticated = rulesEnvironment.authenticatedContext('player-a');
  const unauthenticated = rulesEnvironment.unauthenticatedContext();
  const authenticatedDb = authenticated.firestore();
  const unauthenticatedDb = unauthenticated.firestore();
  await assertSucceeds(
    authenticatedDb.doc('globalEconomy/current').get(),
  );
  await assertSucceeds(
    authenticatedDb.doc('globalEconomySnapshots/100_1').get(),
  );
  await assertFails(
    unauthenticatedDb.doc('globalEconomy/current').get(),
  );

  for (const path of [
    'globalEconomy/current',
    'globalEconomySnapshots/100_1',
    'globalMarketHistory/100_izmir_fruit',
  ]) {
    await assertFails(
      authenticatedDb.doc(path).set({ tampered: true }),
    );
  }
});

test('history query and private owner data rules', async () => {
  const { assertFails, assertSucceeds } = rulesTesting;
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    for (const epoch of [98, 99, 100]) {
      await firestore
        .doc(`globalMarketHistory/${epoch}_izmir_fruit`)
        .set({
          epoch,
          configVersion: 1,
          cityId: 'izmir',
          productId: 'fruit',
          price: 900 + epoch,
        });
    }
  });
  const owner = rulesEnvironment.authenticatedContext('owner', {
    firebase: { sign_in_provider: 'google.com' },
  });
  const stranger = rulesEnvironment.authenticatedContext('stranger');
  const ownerDb = owner.firestore();
  const strangerDb = stranger.firestore();
  const historyQuery = ownerDb
    .collection('globalMarketHistory')
    .where('cityId', '==', 'izmir')
    .where('productId', '==', 'fruit')
    .orderBy('epoch', 'desc');
  const result = await assertSucceeds(historyQuery.get());
  assert.equal(result.size, 3);

  await assertSucceeds(
    ownerDb.doc('users/owner/saves/current').set({
      ownerUid: 'owner',
      schemaVersion: 1,
      saveVersion: 3,
      version: 1,
    }),
  );
  await assertFails(
    strangerDb.doc('users/owner/saves/current').get(),
  );
  await assertFails(
    ownerDb.doc('users/owner/marketAlerts/alert-1').set({
      ownerUid: 'owner',
      isActive: true,
      productId: 'fruit',
    }),
  );
  await assertFails(
    strangerDb.doc('users/owner/marketAlerts/alert-2').set({
      ownerUid: 'stranger',
      isActive: true,
      productId: 'fruit',
    }),
  );
});

test('concurrent worker invocation creates one snapshot and retries safely', async () => {
  let firstAttemptArrivals = 0;
  let releaseBarrier!: () => void;
  const barrier = new Promise<void>((resolveBarrier) => {
    releaseBarrier = resolveBarrier;
  });
  const beforeWrites = async (attempt: number) => {
    if (attempt !== 1) return;
    firstAttemptArrivals += 1;
    if (firstAttemptArrivals === 2) releaseBarrier();
    await barrier;
  };

  const results = await Promise.all([
    runGlobalEconomyEpoch(adminFirestore, {
      nowMs: NOW_MS,
      beforeTransactionWritesForTest: beforeWrites,
    }),
    runGlobalEconomyEpoch(adminFirestore, {
      nowMs: NOW_MS,
      beforeTransactionWritesForTest: beforeWrites,
    }),
  ]);
  assert.equal(results.filter((result) => result.snapshotCreated).length, 1);
  assert.ok(results.some((result) => result.retryCount >= 1));
  assert.deepEqual(results[0]!.snapshot, results[1]!.snapshot);

  const history = await adminFirestore
    .collection('globalMarketHistory')
    .where('epoch', '==', results[0]!.epoch)
    .get();
  assert.equal(history.size, results[0]!.snapshot.marketMovements.length);
  const repeated = await runGlobalEconomyEpoch(adminFirestore, { nowMs: NOW_MS });
  assert.equal(repeated.snapshotCreated, false);
});

test('worker output matches client canonical formula', () => {
  const epoch = Math.floor(NOW_MS / (30 * 60 * 1000));
  const workerSnapshot = buildCanonicalSnapshot(epoch, 1);
  const clientSnapshot = buildGlobalEconomySnapshot({
    epoch,
    configVersion: 1,
    cities: CITIES,
  });
  assert.deepEqual(workerSnapshot, clientSnapshot);
});

test('config mismatch fails closed', () => {
  process.env.ECONOMY_CONFIG_VERSION = '2';
  assert.throws(
    () => resolveWorkerConfigVersion(),
    /ECONOMY_CONFIG_VERSION_MISMATCH/,
  );
});

test('snapshot missing, stale cache and unsupported config fail safely', () => {
  const snapshot = buildGlobalEconomySnapshot({
    nowMs: NOW_MS,
    cities: CITIES,
  });
  assert.deepEqual(
    resolveGlobalMarketAvailability({
      trusted: false,
      syncStatus: 'error',
      development: false,
    }),
    {
      canDisplay: false,
      priceCriticalOperationsAllowed: false,
      stale: false,
      reason: 'snapshot-missing',
    },
  );
  const stale = resolveGlobalMarketAvailability({
    snapshot,
    trusted: true,
    syncStatus: 'offline-cache',
    development: false,
  });
  assert.equal(stale.canDisplay, true);
  assert.equal(stale.priceCriticalOperationsAllowed, false);
  assert.equal(stale.stale, true);
  const unsupported = resolveGlobalMarketAvailability({
    snapshot: { ...snapshot, configVersion: 999 },
    trusted: true,
    syncStatus: 'online',
    development: false,
  });
  assert.equal(unsupported.reason, 'unsupported-snapshot');
});

test('partial failure rolls back snapshot, history and current pointer', async () => {
  const failedNow = NOW_MS + 30 * 60 * 1000;
  await assert.rejects(
    runGlobalEconomyEpoch(adminFirestore, {
      nowMs: failedNow,
      failAfterWritesForTest: true,
    }),
    /TEST_FAIL_AFTER_WRITES/,
  );
  const epoch = Math.floor(failedNow / (30 * 60 * 1000));
  assert.equal(
    (
      await adminFirestore
        .collection('globalEconomySnapshots')
        .doc(`${epoch}_1`)
        .get()
    ).exists,
    false,
  );
  assert.equal(
    (
      await adminFirestore
        .collection('globalMarketHistory')
        .where('epoch', '==', epoch)
        .get()
    ).size,
    0,
  );
  assert.equal(
    (await adminFirestore.collection('globalEconomy').doc('current').get())
      .exists,
    false,
  );
});

test('history older than 30 days is removed atomically', async () => {
  const epoch = Math.floor(NOW_MS / (30 * 60 * 1000));
  const expiredEpoch = epoch - HISTORY_RETENTION_EPOCHS - 1;
  const expiredRef = adminFirestore
    .collection('globalMarketHistory')
    .doc(`${expiredEpoch}_izmir_fruit`);
  await expiredRef.set({
    epoch: expiredEpoch,
    configVersion: 1,
    cityId: 'izmir',
    productId: 'fruit',
    price: 1,
  });
  const result = await runGlobalEconomyEpoch(adminFirestore, { nowMs: NOW_MS });
  assert.equal(result.historyRecordsDeleted, 1);
  assert.equal((await expiredRef.get()).exists, false);
});
