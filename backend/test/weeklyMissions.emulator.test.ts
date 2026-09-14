import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { recordCanonicalDeliveryCompletionTransaction } from '../src/canonicalDeliveryCompletion';
import { buildDefaultServerState } from '../src/serverState';
import type { MarketplacePlayerState } from '../src/vehicleMarketplaceTypes';
import {
  claimWeeklyMissionRewardTransaction,
  ensureWeeklyMissionRotation,
  getWeeklyMissionsState,
  weeklyMissionClaimRef,
} from '../src/weeklyMissions';
import { getWeeklyMissionPeriod } from '../src/weeklyMissionWeek';

const PROJECT_ID = 'logisticore-weekly-missions-emulator';
const NOW_MS = Date.UTC(2026, 8, 9, 12);
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.WEEKLY_MISSIONS_BACKEND_ENABLED = 'true';

let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'weekly-mission-tests');
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

async function seedUser(uid: string, cash = 10_000, completedDeliveries?: number) {
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
  if (completedDeliveries !== undefined) {
    server.completedDeliveries = completedDeliveries;
  } else {
    delete (server as { completedDeliveries?: number }).completedDeliveries;
  }
  await firestore.doc(`users/${uid}`).set({ uid });
  await firestore.doc(`users/${uid}/marketplaceState/current`).set(marketplace);
  await firestore.doc(`users/${uid}/serverState/current`).set(server);
}

test('delivery increment is monotonic, idempotent and bootstraps missing field', async () => {
  const uid = 'delivery-user';
  await seedUser(uid, 10_000);
  const first = await recordCanonicalDeliveryCompletionTransaction(
    firestore,
    uid,
    'delivery-1',
    NOW_MS,
  );
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.alreadyRecorded, false);
    assert.equal(first.completedDeliveries, 1);
  }
  const duplicate = await recordCanonicalDeliveryCompletionTransaction(
    firestore,
    uid,
    'delivery-1',
    NOW_MS,
  );
  assert.equal(duplicate.ok, true);
  if (duplicate.ok) {
    assert.equal(duplicate.alreadyRecorded, true);
    assert.equal(duplicate.completedDeliveries, 1);
  }
  const second = await recordCanonicalDeliveryCompletionTransaction(
    firestore,
    uid,
    'delivery-2',
    NOW_MS,
  );
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.completedDeliveries, 2);
  const server = await firestore.doc(`users/${uid}/serverState/current`).get();
  assert.equal(server.data()?.completedDeliveries, 2);
});

test('delivery increment rejects malformed id and missing server state', async () => {
  const invalid = await recordCanonicalDeliveryCompletionTransaction(
    firestore,
    'uid',
    'not valid',
    NOW_MS,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, 'invalid-request');
  const missing = await recordCanonicalDeliveryCompletionTransaction(
    firestore,
    'ghost',
    'delivery-1',
    NOW_MS,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, 'server-state-not-initialized');
});

test('scheduler and lazy create the same locked rotation and concurrent create is safe', async () => {
  const [a, b] = await Promise.all([
    ensureWeeklyMissionRotation(firestore, NOW_MS),
    ensureWeeklyMissionRotation(firestore, NOW_MS),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(a.rotation.missionIds, b.rotation.missionIds);
  assert.equal(a.rotation.locked, true);
  const again = await ensureWeeklyMissionRotation(firestore, NOW_MS);
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.deepEqual(again.rotation.missionIds, a.rotation.missionIds);
    assert.deepEqual(again.rotation.missions, a.rotation.missions);
    assert.equal(again.created, false);
    assert.equal(again.rotation.locked, true);
  }
});

test('get weekly missions is read-only for guests and progress uses server baseline', async () => {
  const uid = 'linked-user';
  await seedUser(uid, 20_000, 4);
  const guest = await getWeeklyMissionsState(
    firestore,
    { uid: null, linkedAccount: false },
    NOW_MS,
  );
  assert.equal(guest.ok, true);
  if (guest.ok) {
    assert.equal(guest.claimAvailableForAccount, false);
    assert.equal(guest.missions.every((mission) => mission.claimAvailable === false), true);
    assert.equal(guest.missions.every((mission) => mission.progress === 0), true);
  }
  const firstLook = await getWeeklyMissionsState(
    firestore,
    { uid, linkedAccount: true },
    NOW_MS,
  );
  assert.equal(firstLook.ok, true);
  if (!firstLook.ok) return;
  const easy = firstLook.missions.find((mission) => mission.difficulty === 'easy');
  assert.ok(easy);
  assert.equal(easy!.progress, 0);
  assert.equal(easy!.completed, false);
  await recordCanonicalDeliveryCompletionTransaction(firestore, uid, 'd1', NOW_MS);
  await recordCanonicalDeliveryCompletionTransaction(firestore, uid, 'd2', NOW_MS);
  const after = await getWeeklyMissionsState(firestore, { uid, linkedAccount: true }, NOW_MS);
  assert.equal(after.ok, true);
  if (after.ok) {
    const easyAfter = after.missions.find((mission) => mission.difficulty === 'easy');
    assert.equal(easyAfter?.progress, 2);
  }
});

test('claim is atomic, idempotent, dual-writes cash and rejects incomplete/unknown', async () => {
  const uid = 'claim-user';
  await seedUser(uid, 10_000, 0);
  const view = await getWeeklyMissionsState(firestore, { uid, linkedAccount: true }, NOW_MS);
  assert.equal(view.ok, true);
  if (!view.ok) return;
  const easy = view.missions.find((mission) => mission.difficulty === 'easy');
  assert.ok(easy);
  const weekKey = view.weekKey;
  const incomplete = await claimWeeklyMissionRewardTransaction(
    firestore,
    uid,
    { weekKey, missionId: easy.id, idempotencyKey: 'idem-key-01' },
    NOW_MS,
  );
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) assert.equal(incomplete.reason, 'not-complete');
  const unknown = await claimWeeklyMissionRewardTransaction(
    firestore,
    uid,
    { weekKey, missionId: 'not-in-rotation', idempotencyKey: 'idem-key-01' },
    NOW_MS,
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, 'invalid-mission-id');

  for (let i = 0; i < easy.target; i += 1) {
    const recorded = await recordCanonicalDeliveryCompletionTransaction(
      firestore,
      uid,
      `delivery-${i + 1}`,
      NOW_MS,
    );
    assert.equal(recorded.ok, true);
  }

  const cashBeforeSnap = await firestore.doc(`users/${uid}/marketplaceState/current`).get();
  const cashBefore = cashBeforeSnap.data()?.canonicalCash;
  const first = await claimWeeklyMissionRewardTransaction(
    firestore,
    uid,
    { weekKey, missionId: easy.id, idempotencyKey: 'idem-key-01' },
    NOW_MS,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.cashAmount, 2_000);
  assert.equal(first.cashAfter, cashBefore + 2_000);
  const replay = await claimWeeklyMissionRewardTransaction(
    firestore,
    uid,
    { weekKey, missionId: easy.id, idempotencyKey: 'idem-key-01' },
    NOW_MS,
  );
  assert.deepEqual(replay, first);
  const otherKey = await claimWeeklyMissionRewardTransaction(
    firestore,
    uid,
    { weekKey, missionId: easy.id, idempotencyKey: 'idem-key-02' },
    NOW_MS,
  );
  assert.equal(otherKey.ok, false);
  if (!otherKey.ok) assert.equal(otherKey.reason, 'already-claimed');
  const marketplace = await firestore.doc(`users/${uid}/marketplaceState/current`).get();
  const server = await firestore.doc(`users/${uid}/serverState/current`).get();
  assert.equal(marketplace.data()?.canonicalCash, cashBefore + 2_000);
  assert.equal(server.data()?.cash, cashBefore + 2_000);
});

test('weekly cap is enforced from trusted claim docs', async () => {
  const uid = 'cap-user';
  await seedUser(uid, 10_000, 0);
  const view = await getWeeklyMissionsState(firestore, { uid, linkedAccount: true }, NOW_MS);
  assert.equal(view.ok, true);
  if (!view.ok) return;
  const medium = view.missions.find((mission) => mission.difficulty === 'medium');
  const easy = view.missions.find((mission) => mission.difficulty === 'easy');
  assert.ok(medium && easy);
  await weeklyMissionClaimRef(firestore, uid, view.weekKey, easy.id).set({
    ownerUid: uid,
    weekKey: view.weekKey,
    missionId: easy.id,
    idempotencyKey: 'seed-cap',
    reward: { cash: 16_000 },
    claimedAt: NOW_MS,
    schemaVersion: 1,
    cashBefore: 10_000,
    cashAfter: 26_000,
  });
  for (let i = 0; i < medium.target; i += 1) {
    await recordCanonicalDeliveryCompletionTransaction(firestore, uid, `cap-${i}`, NOW_MS);
  }
  const blocked = await claimWeeklyMissionRewardTransaction(
    firestore,
    uid,
    { weekKey: view.weekKey, missionId: medium.id, idempotencyKey: 'idem-cap-01' },
    NOW_MS,
  );
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, 'weekly-cap-exceeded');
  const marketplace = await firestore.doc(`users/${uid}/marketplaceState/current`).get();
  assert.equal(marketplace.data()?.canonicalCash, 10_000);
});

test('client cannot write weekly mission authority docs', async () => {
  const uid = 'rules-user';
  await seedUser(uid, 10_000, 0);
  const db = rulesEnvironment.authenticatedContext(uid).firestore();
  const period = getWeeklyMissionPeriod(NOW_MS);
  await rulesTesting.assertFails(
    db.doc('weeklyMissionTemplates/wm_deliveries_5').set({ reward: { cash: 99_000 } }),
  );
  await rulesTesting.assertFails(
    db.doc(`weeklyMissionRotations/${period.weekKey}`).set({ locked: true, missionIds: ['x'] }),
  );
  await rulesTesting.assertFails(
    db.doc(`users/${uid}/weeklyMissionClaims/${period.weekKey}:wm_deliveries_5`).set({
      claimed: true,
    }),
  );
  await rulesTesting.assertFails(
    db.doc(`users/${uid}/weeklyMissionBaselines/${period.weekKey}`).set({
      completedDeliveriesBaseline: 0,
    }),
  );
  await rulesTesting.assertFails(
    db.doc(`users/${uid}/canonicalDeliveryCompletions/delivery-1`).set({ ownerUid: uid }),
  );
  await rulesTesting.assertSucceeds(db.doc(`users/${uid}/weeklyMissionClaims/x`).get());
});

test('new week gets a new baseline and previous week baseline stays', async () => {
  const uid = 'rollover-user';
  await seedUser(uid, 10_000, 3);
  const first = await getWeeklyMissionsState(firestore, { uid, linkedAccount: true }, NOW_MS);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await recordCanonicalDeliveryCompletionTransaction(firestore, uid, 'roll-1', NOW_MS);
  const nextWeekMs = Date.UTC(2026, 8, 14, 12);
  const second = await getWeeklyMissionsState(firestore, { uid, linkedAccount: true }, nextWeekMs);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.notEqual(second.weekKey, first.weekKey);
  assert.equal(second.missions.every((mission) => mission.progress === 0), true);
  const oldBaseline = await firestore.doc(
    `users/${uid}/weeklyMissionBaselines/${first.weekKey}`,
  ).get();
  const newBaseline = await firestore.doc(
    `users/${uid}/weeklyMissionBaselines/${second.weekKey}`,
  ).get();
  assert.equal(oldBaseline.data()?.completedDeliveriesBaseline, 3);
  assert.equal(newBaseline.data()?.completedDeliveriesBaseline, 4);
});

test('account deletion recursive path includes weekly mission user docs', async () => {
  const uid = 'delete-me';
  await seedUser(uid, 10_000, 3);
  await getWeeklyMissionsState(firestore, { uid, linkedAccount: true }, NOW_MS);
  await recordCanonicalDeliveryCompletionTransaction(firestore, uid, 'delivery-del', NOW_MS);
  const period = getWeeklyMissionPeriod(NOW_MS);
  const baseline = await firestore.doc(
    `users/${uid}/weeklyMissionBaselines/${period.weekKey}`,
  ).get();
  const completion = await firestore.doc(
    `users/${uid}/canonicalDeliveryCompletions/delivery-del`,
  ).get();
  assert.equal(baseline.exists, true);
  assert.equal(completion.exists, true);
  await firestore.recursiveDelete(firestore.doc(`users/${uid}`));
  const baselineAfter = await firestore.doc(
    `users/${uid}/weeklyMissionBaselines/${period.weekKey}`,
  ).get();
  const completionAfter = await firestore.doc(
    `users/${uid}/canonicalDeliveryCompletions/delivery-del`,
  ).get();
  assert.equal(baselineAfter.exists, false);
  assert.equal(completionAfter.exists, false);
});
