/**
 * Canonical progressive fuel — in-memory tests (Step 29X).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { getMsPerGameHour } from '../../src/config/balance';
import {
  acceptCanonicalRoadDeliveryTransaction,
  cancelCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import {
  advanceCanonicalRoadExecutionTransaction,
  setCanonicalRoadExecutionPausedTransaction,
  setCanonicalRoadExecutionSpeedTransaction,
} from '../src/canonicalProgressiveFuel';
import { serverStateCurrentRef, CANONICAL_CASH_TRANSACTIONS_COLLECTION } from '../src/canonicalCashTransaction';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import { CANONICAL_ROAD_DELIVERIES_COLLECTION } from '../../src/domain/canonicalRoadDelivery';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import { deriveCanonicalRoadFuelRequirement, withCanonicalFuelState } from '../../src/domain/canonicalFuelTankPrice';
import { parseCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import {
  createInitialCanonicalProgressiveFuelState,
  deriveCanonicalProgressiveFuel,
  hasOnlyCanonicalProgressiveAdvanceKeys,
  isCanonicalProgressiveFuelAllowed,
  progressiveFuelAuditHasUnknown,
  settleCanonicalProgressiveFuelState,
} from '../../src/domain/canonicalProgressiveFuel';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path };
    },
    async runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>) {
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

const PROGRESS = { envValue: 'INTERNAL_TEST' as const };
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
    productionPerDay: 12,
    consumptionPerDay: 8,
  }),
  destinationMarket: buildFixtureMarket({
    currentPrice: 2500,
    basePrice: 2000,
    stock: 8,
    targetStock: 60,
    productionPerDay: 4,
    consumptionPerDay: 18,
  }),
  fuelPricePerLiter: 1.72,
  sequence: 1,
};

test('gate, keys, audit, cumulative invariance', () => {
  assert.equal(isCanonicalProgressiveFuelAllowed({ envValue: null }), false);
  assert.equal(isCanonicalProgressiveFuelAllowed(PROGRESS), true);
  assert.equal(progressiveFuelAuditHasUnknown(), false);
  assert.equal(
    hasOnlyCanonicalProgressiveAdvanceKeys({
      deliveryId: 'd',
      canonicalSchemaVersion: 1,
      fuelConsumed: 10,
      progress: 1,
      elapsedMs: 5,
      distanceKm: 3,
    }),
    false,
  );
  const state = createInitialCanonicalProgressiveFuelState({
    nowMs: 1_000,
    distanceKm: 100,
    travelHours: 10,
    fuelLitersTotal: 50,
    fuelLitersAtStart: 80,
    fuelCapacityL: 200,
  });
  const once = settleCanonicalProgressiveFuelState(state, 1_000 + 30_000, 80);
  let stepped = state;
  let fuel = 80;
  for (let i = 1; i <= 30; i += 1) {
    const next = settleCanonicalProgressiveFuelState(stepped, 1_000 + i * 1_000, fuel);
    stepped = next.state;
    fuel = next.currentFuelL;
  }
  assert.ok(Math.abs(once.state.progress - stepped.progress) < 1e-9);
  assert.equal(once.state.cumulativeFuelConsumedL, stepped.cumulativeFuelConsumedL);
  assert.equal(once.currentFuelL, fuel);
  assert.equal(once.currentFuelL < 80, true);
  assert.equal(once.currentFuelL > 0, true);

  const low = deriveCanonicalProgressiveFuel({
    gameHours: 10,
    travelHours: 10,
    distanceKm: 100,
    fuelLitersAtStart: 20,
    fuelLitersTotal: 50,
    currentFuelL: 20,
    cumulativeFuelConsumedL: 0,
    fuelCapacityL: 200,
  });
  assert.equal(low.outOfFuel, true);
  assert.equal(low.currentFuelL, 0);
  assert.equal(low.progress < 1, true);

  const exact = deriveCanonicalProgressiveFuel({
    gameHours: 10,
    travelHours: 10,
    distanceKm: 100,
    fuelLitersAtStart: 50,
    fuelLitersTotal: 50,
    currentFuelL: 50,
    cumulativeFuelConsumedL: 0,
    fuelCapacityL: 200,
  });
  assert.equal(exact.progress, 1);
  assert.equal(exact.currentFuelL <= 0.001, true);
  assert.equal(exact.outOfFuel, false);
});

test('accept holds fuel, advance burns once, pause and speed, no cash', async () => {
  const db = createMemoryFirestore();
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const truckPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-healthy`;
  const parsed = parseCanonicalFleetAsset(db.dump.get(truckPath), 'TRUCK');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const required = deriveCanonicalRoadFuelRequirement({
    truckAsset: withCanonicalFuelState(parsed.asset),
    trailerAsset: null,
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    amount: 10,
    payment: 1000,
  });
  assert.equal(required.ok, true);
  if (!required.ok) return;
  db.dump.set(truckPath, {
    ...db.dump.get(truckPath)!,
    currentFuelL: required.requiredFuelL + 25,
    fuelCapacityL: 800,
  });
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 1000, ownerUid: 'uid-a', sourceVersion: 1 });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 5);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const before = db.dump.get(truckPath)?.currentFuelL as number;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-healthy',
    },
    10_000,
    { fuelEnvValue: 'INTERNAL_TEST', progressiveEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(db.dump.get(truckPath)?.currentFuelL, before);
  const deliveryPath = `users/uid-a/${CANONICAL_ROAD_DELIVERIES_COLLECTION}/${accepted.receipt.deliveryId}`;
  const delivery = db.dump.get(deliveryPath);
  const progressive = delivery?.progressiveFuel as { travelHours: number; fuelLitersTotal: number };
  assert.equal(progressive.fuelLitersTotal, required.requiredFuelL);
  const cashKeysBefore = [...db.dump.keys()].filter((key) => key.includes(CANONICAL_CASH_TRANSACTIONS_COLLECTION));

  const partialAt = 10_000 + getMsPerGameHour(1) * (progressive.travelHours / 2);
  const advanced = await advanceCanonicalRoadExecutionTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    1,
    partialAt,
    PROGRESS,
  );
  assert.equal(advanced.ok, true);
  if (!advanced.ok) return;
  assert.equal(advanced.state.progress > 0.4 && advanced.state.progress < 0.6, true);
  assert.equal(advanced.currentFuelL < before, true);
  const retry = await advanceCanonicalRoadExecutionTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    1,
    partialAt,
    PROGRESS,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.currentFuelL, advanced.currentFuelL);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 1000);
  const cashKeysAfter = [...db.dump.keys()].filter((key) => key.includes(CANONICAL_CASH_TRANSACTIONS_COLLECTION));
  assert.equal(cashKeysAfter.length, cashKeysBefore.length);

  const other = await advanceCanonicalRoadExecutionTransaction(
    db,
    'uid-b',
    accepted.receipt.deliveryId,
    1,
    partialAt + 1_000,
    PROGRESS,
  );
  assert.equal(other.ok, false);

  const paused = await setCanonicalRoadExecutionPausedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    true,
    1,
    partialAt + 60_000,
    PROGRESS,
  );
  assert.equal(paused.ok, true);
  if (!paused.ok) return;
  const duringPause = await advanceCanonicalRoadExecutionTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    1,
    partialAt + 120_000,
    PROGRESS,
  );
  assert.equal(duringPause.ok, true);
  if (!duringPause.ok) return;
  assert.equal(duringPause.currentFuelL, paused.currentFuelL);

  await setCanonicalRoadExecutionPausedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    false,
    1,
    partialAt + 120_000,
    PROGRESS,
  );
  const fast = await setCanonicalRoadExecutionSpeedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    8,
    1,
    partialAt + 120_000,
    PROGRESS,
  );
  assert.equal(fast.ok, true);
  const doneAt = partialAt + 120_000 + getMsPerGameHour(8) * progressive.travelHours;
  const finished = await advanceCanonicalRoadExecutionTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    1,
    doneAt,
    PROGRESS,
  );
  assert.equal(finished.ok, true);
  if (!finished.ok) return;
  assert.equal(finished.state.progress, 1);
  const expectedRemaining = Math.round((before - required.requiredFuelL) * 1000) / 1000;
  assert.equal(Math.abs(finished.currentFuelL - expectedRemaining) < 0.02, true);

  const completed = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'COMPLETED',
    doneAt,
  );
  assert.equal(completed.ok, true);
  assert.equal(db.dump.get(truckPath)?.currentFuelL, finished.currentFuelL);

  const issuedEarly = await issueCanonicalRoadContractTransaction(
    db,
    'uid-a',
    { ...ISSUANCE, sequence: 2 },
    20,
  );
  assert.equal(issuedEarly.ok, true);
  if (!issuedEarly.ok) return;
  db.dump.set(truckPath, {
    ...db.dump.get(truckPath)!,
    activeCanonicalRoadDeliveryId: null,
    currentFuelL: required.requiredFuelL + 25,
  });
  const earlyAccept = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issuedEarly.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-healthy',
    },
    50_000,
    { progressiveEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(earlyAccept.ok, true);
  if (!earlyAccept.ok) return;
  const held = db.dump.get(truckPath)?.currentFuelL;
  const tooSoon = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    earlyAccept.receipt.deliveryId,
    'COMPLETED',
    50_000,
  );
  assert.equal(tooSoon.ok, false);
  if (!tooSoon.ok) assert.equal(tooSoon.reason, 'PROGRESS_INCOMPLETE');
  assert.equal(db.dump.get(truckPath)?.currentFuelL, held);

  const cancelled = await cancelCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    earlyAccept.receipt.deliveryId,
    50_000 + getMsPerGameHour(1),
  );
  assert.equal(cancelled.ok, true);
  const afterCancel = db.dump.get(truckPath)?.currentFuelL as number;
  assert.equal(afterCancel < (held as number), true);
  const after = await advanceCanonicalRoadExecutionTransaction(
    db,
    'uid-a',
    earlyAccept.receipt.deliveryId,
    1,
    50_000 + getMsPerGameHour(1) * 3,
    PROGRESS,
  );
  assert.equal(after.ok, false);
  assert.equal(db.dump.get(truckPath)?.currentFuelL, afterCancel);
});
