/**
 * Canonical ROAD execution economics — in-memory Firestore tests (Step 29H).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalRoadDeliveryTransaction,
  hasOnlyCanonicalRoadAcceptKeys,
  hasOnlyCanonicalRoadCompleteKeys,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { createCanonicalRoadDeliveryId } from '../../src/domain/canonicalRoadDelivery';
import {
  buildFixtureMarket,
  issueCanonicalRoadContractFromTrustedState,
  prepareCanonicalRoadDeliverySettlement,
} from '../../src/domain/canonicalRoadEconomics';
import {
  CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
  CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
  CANONICAL_ROAD_TRUCK_FIXTURES,
  buildCanonicalRoadTrailerFixture,
  computeLiveParityRoadCompletion,
  diagnoseRoadSettlementMismatch,
  freezeCanonicalRoadExecutionEconomics,
} from '../../src/domain/canonicalRoadExecutionEconomics';

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

test('client financial and truck-state keys rejected', () => {
  assert.equal(
    hasOnlyCanonicalRoadAcceptKeys({
      contractId: 'crc_x',
      canonicalSchemaVersion: 1,
      maintenanceCost: 12,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadAcceptKeys({
      contractId: 'crc_x',
      canonicalSchemaVersion: 1,
      condition: 10,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadAcceptKeys({
      contractId: 'crc_x',
      canonicalSchemaVersion: 1,
      upgrades: { engine: 3 },
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadCompleteKeys({
      deliveryId: 'crd_x',
      outcome: 'COMPLETED',
      actualTravelHours: 2,
      canonicalSchemaVersion: 1,
      latePenalty: 9,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadAcceptKeys({
      contractId: 'crc_x',
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-degraded',
    }),
    true,
  );
});

test('unauthenticated accept rejected', async () => {
  const db = createMemoryFirestore();
  const result = await acceptCanonicalRoadDeliveryTransaction(
    db,
    '',
    { contractId: 'crc_istanbul_bursa_steel_100_1', canonicalSchemaVersion: 1 },
    1000,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'UNAUTHENTICATED');
});

test('accept freezes fixture snapshot; client cannot override condition; no cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 20_000 });
  db.dump.set('users/uid-a/canonicalCashTransactions/keep', { amount: 1 });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1000);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');

  const badTruck = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'truck-starter-1',
    },
    1500,
  );
  assert.equal(badTruck.ok, false);
  if (!badTruck.ok) assert.equal(badTruck.reason, 'LEGACY_CLIENT_FLEET_UNVERIFIED');

  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-degraded',
      selectedTrailerId: CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
    },
    2000,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const deliveryId = accepted.receipt.deliveryId;
  const stored = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${deliveryId}`) as {
    executionEconomicsSnapshot: {
      truckEconomicProfile: { truckId: string; condition: number };
      trailerEconomicProfile: { trailerId: string | null };
      maintenanceSnapshot: { bundle: number };
    };
  };
  assert.equal(stored.executionEconomicsSnapshot.truckEconomicProfile.truckId, 'fixture-degraded');
  assert.equal(stored.executionEconomicsSnapshot.truckEconomicProfile.condition, 35);
  assert.equal(
    stored.executionEconomicsSnapshot.trailerEconomicProfile.trailerId,
    CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
  );

  const retry = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
    },
    3000,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.receipt.alreadyAccepted, true);
  const storedAgain = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${deliveryId}`) as {
    executionEconomicsSnapshot: { truckEconomicProfile: { truckId: string } };
  };
  assert.equal(storedAgain.executionEconomicsSnapshot.truckEconomicProfile.truckId, 'fixture-degraded');
  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 20_000);
  assert.equal(db.dump.get('users/uid-a/canonicalCashTransactions/keep')?.amount, 1);
});

test('completion report derives money; conflict rejected; idempotent; no cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 9_000 });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1000);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    2000,
  );
  if (!accepted.ok) return;
  const hours = accepted.receipt.deadlineHours * 0.5;
  const first = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'COMPLETED',
    3000,
    hours,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.derivedSettlement?.fuelChargedOnCompletion, 0);
  assert.equal(first.derivedSettlement?.completionBand, 'EARLY');

  const same = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'COMPLETED',
    4000,
    hours,
  );
  assert.equal(same.ok, true);
  if (!same.ok) return;
  assert.equal(same.alreadyReported, true);

  const conflict = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'FAILED',
    5000,
    hours,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'COMPLETION_CONFLICT');
  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 9_000);
});

test('truck-true vectors match live parity helper', () => {
  const issued = issueCanonicalRoadContractFromTrustedState({
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    originMarket: ISSUANCE.originMarket,
    destinationMarket: ISSUANCE.destinationMarket,
    fuelPricePerLiter: 1.72,
    sequence: 4,
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const snapshot = issued.snapshot;
  const cases: Array<{
    truckId: string;
    trailerId: string | null;
    type: 'standard' | 'fragile';
    outcome: 'COMPLETED' | 'FAILED';
    ratio: number;
  }> = [
    { truckId: 'fixture-healthy', trailerId: null, type: 'standard', outcome: 'COMPLETED', ratio: 0.5 },
    { truckId: 'fixture-healthy', trailerId: null, type: 'standard', outcome: 'COMPLETED', ratio: 0.9 },
    { truckId: 'fixture-healthy', trailerId: null, type: 'standard', outcome: 'COMPLETED', ratio: 1.2 },
    { truckId: 'fixture-healthy', trailerId: null, type: 'standard', outcome: 'COMPLETED', ratio: 1.6 },
    { truckId: 'fixture-healthy', trailerId: null, type: 'standard', outcome: 'FAILED', ratio: 3 },
    { truckId: 'fixture-degraded', trailerId: null, type: 'standard', outcome: 'COMPLETED', ratio: 0.9 },
    { truckId: 'fixture-upgraded', trailerId: null, type: 'standard', outcome: 'COMPLETED', ratio: 0.9 },
    {
      truckId: 'fixture-healthy',
      trailerId: CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
      type: 'standard',
      outcome: 'COMPLETED',
      ratio: 0.9,
    },
    { truckId: 'fixture-degraded', trailerId: null, type: 'fragile', outcome: 'COMPLETED', ratio: 0.9 },
  ];
  for (const row of cases) {
    const frozen = freezeCanonicalRoadExecutionEconomics({
      contract: snapshot,
      selectedTruckId: row.truckId,
      selectedTrailerId: row.trailerId,
      contractType: row.type,
    });
    assert.equal(frozen.ok, true, row.truckId);
    if (!frozen.ok) continue;
    const hours = snapshot.deadlineHours * row.ratio;
    const truck = CANONICAL_ROAD_TRUCK_FIXTURES[row.truckId]!;
    const trailer =
      row.trailerId === CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID
        ? buildCanonicalRoadTrailerFixture(truck.id)
        : null;
    const local = computeLiveParityRoadCompletion({
      contract: snapshot,
      truck,
      trailer,
      fuelPricePerLiter: 1.72,
      outcome: row.outcome,
      actualTravelHours: hours,
      contractType: row.type,
    });
    const server = prepareCanonicalRoadDeliverySettlement({
      snapshot,
      deliveryId: createCanonicalRoadDeliveryId(snapshot.contractId),
      outcome: row.outcome,
      actualTravelHours: hours,
      executionEconomics: frozen.snapshot,
    });
    assert.deepEqual(diagnoseRoadSettlementMismatch({ local, server }), [], `${row.truckId} ${row.ratio}`);
    assert.equal(server.fuelChargedOnCompletion, 0);
  }
});

test('rules still deny client writes; no multimodal settle', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalRoadDeliveries\/\{deliveryId\}[\s\S]*?allow write: if false/);
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
  assert.equal(index.includes('export const applyCashDelta'), false);
});
