import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import {
  LEGACY_MIGRATION_BOUNDS,
  SERVER_DEFAULT_CASH,
  buildDefaultServerState,
  buildBoundedLegacyMigrationFromCloudSave,
  migrateLegacyServerStateTransaction,
} from '../src/serverState';
import type { ServerStateDocument } from '../src/serverStateTypes';

const PROJECT_ID = 'logisticore-server-state-emulator';
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;

let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'server-state-tests');
const adminFirestore = getFirestore(adminApp);
adminFirestore.settings({ host: '127.0.0.1:8080', ssl: false });

function buildMaliciousSave(uid: string) {
  return {
    ownerUid: uid,
    saveVersion: 3,
    gameState: {
      player: {
        money: 987_654_321,
        level: 100,
        reputation: 100,
        completedContracts: 50_000,
        homeCityId: 'izmir',
        trucks: [
          {
            id: 'fake-truck',
            catalogId: 'truck-ford-cargo',
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
          },
          {
            id: 'fake-truck',
            catalogId: 'truck-ford-cargo',
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
          },
          {
            id: 'invalid-truck',
            catalogId: 'not-in-catalog',
            purchasePrice: 1,
            ownershipType: 'owned',
            status: 'idle',
          },
        ],
        warehouses: [],
      },
    },
  };
}

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

test('direct client write to serverState is denied', async () => {
  const db = rulesEnvironment.authenticatedContext('player-1').firestore();
  await rulesTesting.assertFails(
    db.doc('users/player-1/serverState/current').set({
      cash: 999_999,
      initialized: true,
    }),
  );
});

test('new user safe bootstrap uses server defaults', async () => {
  const uid = 'new-user';
  const state = buildDefaultServerState(uid, Timestamp.now());
  await adminFirestore.doc(`users/${uid}/serverState/current`).set(state);
  const snap = await adminFirestore.doc(`users/${uid}/serverState/current`).get();
  const data = snap.data() as ServerStateDocument;
  assert.equal(data.cash, SERVER_DEFAULT_CASH);
  assert.equal(data.ownedTrucks.length, 1);
  assert.equal(data.initialized, true);
  assert.equal(data.migrationCompleted, false);
});

test('legacy migration clamps suspicious cash and rejects invalid trucks', async () => {
  const uid = 'legacy-user';
  await adminFirestore.doc(`users/${uid}/saves/current`).set(buildMaliciousSave(uid));
  const built = buildBoundedLegacyMigrationFromCloudSave(
    uid,
    buildMaliciousSave(uid),
    Timestamp.now(),
  );
  assert.equal(built.state.cash, LEGACY_MIGRATION_BOUNDS.maxCash);
  assert.ok(built.report.suspicious);
  assert.ok(built.report.flags.includes('suspicious-cash'));
  assert.ok(built.report.rejected);
  assert.ok(built.report.flags.some((flag) => flag.startsWith('rejected-trucks:')));
});

test('legacy migration is idempotent', async () => {
  const uid = 'legacy-idempotent';
  await adminFirestore.doc(`users/${uid}/saves/current`).set({
    ownerUid: uid,
    saveVersion: 2,
    gameState: {
      player: {
        money: 120_000,
        level: 4,
        reputation: 55,
        completedContracts: 8,
        homeCityId: 'izmir',
        trucks: [
          {
            id: 'truck-a',
            catalogId: 'truck-ford-cargo',
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
          },
        ],
        warehouses: [],
      },
    },
  });
  const first = await migrateLegacyServerStateTransaction(
    adminFirestore,
    uid,
    false,
  );
  assert.equal(first.ok, true);
  const second = await migrateLegacyServerStateTransaction(
    adminFirestore,
    uid,
    false,
  );
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.reason, 'migration-already-completed');
});

test('legacy migration dry-run does not write', async () => {
  const uid = 'legacy-dry-run';
  await adminFirestore.doc(`users/${uid}/saves/current`).set(buildMaliciousSave(uid));
  const dry = await migrateLegacyServerStateTransaction(adminFirestore, uid, true);
  assert.equal(dry.ok, true);
  const snap = await adminFirestore.doc(`users/${uid}/serverState/current`).get();
  assert.equal(snap.exists, false);
});
