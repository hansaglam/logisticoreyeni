/**
 * Canonical ROAD timing authority — in-memory Firestore tests (Step 29I).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalRoadDeliveryTransaction,
  hasOnlyCanonicalRoadCompleteKeys,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { buildFixtureMarket, prepareCanonicalRoadDeliverySettlement } from '../../src/domain/canonicalRoadEconomics';
import {
  CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR,
  classifyCanonicalRoadTimingBand,
  deriveCanonicalRoadElapsedGameHours,
  freezeCanonicalRoadTimingSnapshot,
  realMsForCanonicalGameHours,
  resolveCanonicalRoadTimingGate,
} from '../../src/domain/canonicalRoadTiming';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data };
        },
        create(ref, data) {
          if (dump.has(ref.path)) throw new Error('already-exists');
          dump.set(ref.path, { ...data });
        },
        update(ref, data) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

async function seedFleet(db: Firestore, uid: string): Promise<void> {
  const result = await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(result.ok, true);
}

const ISSUANCE = {
  originCityId: 'istanbul',
  destinationCityId: 'bursa',
  productId: 'steel',
  amount: 10,
  originMarket: buildFixtureMarket({
    currentPrice: 1900,
    basePrice: 2000,
    stock: 90,
    targetStock: 40,
  }),
  destinationMarket: buildFixtureMarket({
    currentPrice: 2400,
    basePrice: 2000,
    stock: 10,
    targetStock: 50,
    consumptionPerDay: 20,
  }),
  fuelPricePerLiter: 1.72,
  sequence: 1,
};

test('timing gate default OFF; complete keys ignore money/timing category', () => {
  assert.equal(resolveCanonicalRoadTimingGate({ envValue: null }), 'OFF');
  assert.equal(CANONICAL_ROAD_FIXED_MS_PER_GAME_HOUR, 15_000);
  assert.equal(
    hasOnlyCanonicalRoadCompleteKeys({
      deliveryId: 'd',
      outcome: 'COMPLETED',
      canonicalSchemaVersion: 1,
      timingClassification: 'EARLY',
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadCompleteKeys({
      deliveryId: 'd',
      outcome: 'COMPLETED',
      canonicalSchemaVersion: 1,
    }),
    true,
  );
});

test('unauthenticated report rejected', async () => {
  const db = createMemoryFirestore();
  const result = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    '',
    'crd_x',
    'COMPLETED',
    1000,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'UNAUTHENTICATED');
});

test('accept start immutable; client hours ignored; no cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 20_000 });
  db.dump.set('users/uid-a/canonicalCashTransactions/keep', { amount: 3 });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1000);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    10_000,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const retry = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    99_000,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.receipt.alreadyAccepted, true);
  assert.equal(retry.receipt.acceptedAtMs, 10_000);

  const deliveryId = accepted.receipt.deliveryId;
  const stored = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${deliveryId}`) as {
    timingSnapshot: { startedAtServerMs: number; frozenGameSpeed: number };
  };
  assert.equal(stored.timingSnapshot.startedAtServerMs, 10_000);
  assert.equal(stored.timingSnapshot.frozenGameSpeed, 1);

  const deadline = accepted.receipt.deadlineHours;
  const planned = issued.snapshot.deadlineHours;
  const earlyMs = 10_000 + realMsForCanonicalGameHours(deadline * 0.2);
  const forged = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    deliveryId,
    'COMPLETED',
    earlyMs,
    0,
  );
  assert.equal(forged.ok, true);
  if (!forged.ok) return;
  assert.equal(forged.clientActualTravelHoursIgnored, true);
  assert.notEqual(forged.actualTravelHours, 0);
  assert.equal(forged.timingClassification, 'EARLY');
  const expectedHours = deriveCanonicalRoadElapsedGameHours({
    startedAtServerMs: 10_000,
    completedAtServerMs: earlyMs,
  }).actualTravelHours;
  assert.equal(forged.actualTravelHours, expectedHours);
  void planned;
  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 20_000);
  assert.equal(db.dump.get('users/uid-a/canonicalCashTransactions/keep')?.amount, 3);
});

test('timing classifications and late penalty use server elapsed', async () => {
  const db = createMemoryFirestore();
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  if (!issued.ok) return;
  const snapshot = issued.snapshot;

  async function runAt(label: string, ratioOfDeadline: number, expectedBand: string) {
    const db2 = createMemoryFirestore();
    const issued2 = await issueCanonicalRoadContractTransaction(db2, 'uid-a', { ...ISSUANCE, sequence: 2 }, 1);
    if (!issued2.ok) return;
    await seedFleet(db2, 'uid-a');
    const start = 50_000;
    const accepted = await acceptCanonicalRoadDeliveryTransaction(
      db2,
      'uid-a',
      { contractId: issued2.snapshot.contractId, canonicalSchemaVersion: 1 },
      start,
    );
    if (!accepted.ok) return;
    const hours = issued2.snapshot.deadlineHours * ratioOfDeadline;
    const completeAt = start + realMsForCanonicalGameHours(hours);
    const report = await reportCanonicalRoadDeliveryCompletedTransaction(
      db2,
      'uid-a',
      accepted.receipt.deliveryId,
      'COMPLETED',
      completeAt,
      0.1,
    );
    assert.equal(report.ok, true, label);
    if (!report.ok) return;
    assert.equal(report.timingClassification, expectedBand, label);
    const derived = prepareCanonicalRoadDeliverySettlement({
      snapshot: issued2.snapshot,
      deliveryId: accepted.receipt.deliveryId,
      outcome: 'COMPLETED',
      actualTravelHours: report.actualTravelHours ?? 0,
      executionEconomics: (
        db2.dump.get(
          `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`,
        ) as { executionEconomicsSnapshot: never }
      ).executionEconomicsSnapshot,
    });
    assert.equal(report.derivedSettlement?.latePenalty, derived.latePenalty, `${label} penalty`);
    assert.equal(report.derivedSettlement?.fuelChargedOnCompletion, 0);
  }

  const planned = snapshot.planningMaintenanceBundle;
  void planned;
  const timing = freezeCanonicalRoadTimingSnapshot({
    startedAtServerMs: 0,
    plannedTravelGameHours: snapshot.deadlineHours * 0.7,
    deadlineHours: snapshot.deadlineHours,
  });
  const d = snapshot.deadlineHours;
  const p = timing.plannedTravelGameHours;
  assert.equal(
    classifyCanonicalRoadTimingBand({
      outcome: 'COMPLETED',
      actualTravelHours: p * 0.92,
      deadlineHours: d,
      plannedTravelGameHours: p,
    }),
    'EARLY',
  );
  assert.equal(
    classifyCanonicalRoadTimingBand({
      outcome: 'COMPLETED',
      actualTravelHours: p * 0.921,
      deadlineHours: d,
      plannedTravelGameHours: p,
    }),
    'ON_TIME',
  );
  assert.equal(
    classifyCanonicalRoadTimingBand({
      outcome: 'COMPLETED',
      actualTravelHours: d,
      deadlineHours: d,
      plannedTravelGameHours: p,
    }),
    'ON_TIME',
  );
  assert.equal(
    classifyCanonicalRoadTimingBand({
      outcome: 'COMPLETED',
      actualTravelHours: d * 1.05,
      deadlineHours: d,
      plannedTravelGameHours: p,
    }),
    'LATE_MINOR',
  );
  assert.equal(
    classifyCanonicalRoadTimingBand({
      outcome: 'COMPLETED',
      actualTravelHours: d * 1.11,
      deadlineHours: d,
      plannedTravelGameHours: p,
    }),
    'LATE_MAJOR',
  );

  await runAt('early', 0.2, 'EARLY');
  await runAt('on-time', 0.95, 'ON_TIME');
  await runAt('late-minor', 1.05, 'LATE_MINOR');
  await runAt('late-major', 1.6, 'LATE_MAJOR');
});

test('offline wall clock included; duplicate and conflict', async () => {
  const db = createMemoryFirestore();
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');
  const start = 1_000;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    start,
  );
  if (!accepted.ok) return;
  const hours = issued.snapshot.deadlineHours * 1.6;
  const completeAt = start + realMsForCanonicalGameHours(hours);
  const first = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'COMPLETED',
    completeAt,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.timingClassification, 'LATE_MAJOR');
  const dup = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'COMPLETED',
    completeAt + 50_000,
    0,
  );
  assert.equal(dup.ok, true);
  if (!dup.ok) return;
  assert.equal(dup.alreadyReported, true);
  assert.equal(dup.actualTravelHours, first.actualTravelHours);
  const conflict = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'FAILED',
    completeAt,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'COMPLETION_CONFLICT');
});

test('no cash helper; rules deny writes', () => {
  const src = readFileSync(resolve(__dirname, '../src/canonicalRoadDelivery.ts'), 'utf8');
  assert.equal(src.includes('runCanonicalCashMutation'), false);
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalRoadDeliveries\/\{deliveryId\}[\s\S]*?allow write: if false/);
});
