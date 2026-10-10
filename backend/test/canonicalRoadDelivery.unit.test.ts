/**
 * Canonical ROAD delivery economy — in-memory Firestore tests (Step 29F).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalRoadDeliveryTransaction,
  hasOnlyCanonicalRoadAcceptKeys,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { createCanonicalRoadDeliveryId } from '../../src/domain/canonicalRoadDelivery';
import {
  buildFixtureMarket,
  compareRoadSettlementShadow,
  issueCanonicalRoadContractFromTrustedState,
  localProductionSettlementFromSnapshot,
  lookupCanonicalRoadRoute,
  prepareCanonicalRoadDeliverySettlement,
} from '../../src/domain/canonicalRoadEconomics';

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

test('client money keys rejected on accept payload', () => {
  assert.equal(
    hasOnlyCanonicalRoadAcceptKeys({
      contractId: 'x',
      originCityId: 'izmir',
      destinationCityId: 'ankara',
      productId: 'steel',
      cargoAmount: 10,
      canonicalSchemaVersion: 1,
      payment: 9000,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadAcceptKeys({
      contractId: 'crc_istanbul_bursa_steel_100_1',
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'steel',
      cargoAmount: 10,
      canonicalSchemaVersion: 1,
    }),
    true,
  );
});

test('unauthenticated accept rejected', async () => {
  const db = createMemoryFirestore();
  const result = await acceptCanonicalRoadDeliveryTransaction(
    db,
    '',
    {
      contractId: 'crc_istanbul_bursa_steel_100_1',
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'steel',
      cargoAmount: 10,
      canonicalSchemaVersion: 1,
    },
    1000,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'UNAUTHENTICATED');
});

test('accept without issued contract fail-closed', async () => {
  const db = createMemoryFirestore();
  const result = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: 'crc_istanbul_bursa_steel_100_1',
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'steel',
      cargoAmount: 10,
      canonicalSchemaVersion: 1,
    },
    1000,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'CANONICAL_ROAD_CONTRACT_ISSUANCE_REQUIRED');
});

test('issue/accept/report idempotent; no cash or count-completion writes', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 20_000 });
  db.dump.set('users/uid-a/canonicalDeliveryCompletions/keep', { count: 2 });
  db.dump.set('users/uid-a/saves/current', { gameState: { player: { money: 33_000 } } });

  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1000);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');
  const contractId = issued.snapshot.contractId;
  const deliveryId = createCanonicalRoadDeliveryId(contractId);

  const first = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId,
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'steel',
      cargoAmount: 10,
      canonicalSchemaVersion: 1,
    },
    2000,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.receipt.alreadyAccepted, false);
  assert.equal(first.receipt.deliveryId, deliveryId);
  const acceptedDoc = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${deliveryId}`) as {
    executionEconomicsSnapshot?: { truckEconomicProfile?: { truckId?: string } };
  };
  assert.equal(acceptedDoc.executionEconomicsSnapshot?.truckEconomicProfile?.truckId, 'fixture-healthy');

  const second = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId,
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'steel',
      cargoAmount: 10,
      canonicalSchemaVersion: 1,
    },
    3000,
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.receipt.alreadyAccepted, true);
  assert.equal(second.receipt.acceptedAtMs, first.receipt.acceptedAtMs);

  const conflict = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId,
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'fruit',
      cargoAmount: 10,
      canonicalSchemaVersion: 1,
    },
    4000,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'CANONICAL_ROAD_DELIVERY_CONFLICT');

  const report = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    deliveryId,
    'COMPLETED',
    5000,
    first.receipt.deadlineHours * 0.8,
  );
  assert.equal(report.ok, true);
  if (!report.ok) return;
  assert.equal(report.alreadyReported, false);
  assert.ok(report.derivedSettlement);
  assert.equal(report.derivedSettlement?.fuelChargedOnCompletion, 0);

  const report2 = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    deliveryId,
    'COMPLETED',
    6000,
    99,
  );
  assert.equal(report2.ok, true);
  if (!report2.ok) return;
  assert.equal(report2.alreadyReported, true);
  assert.equal(report2.derivedSettlement?.netCashDelta, report.derivedSettlement?.netCashDelta);

  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 20_000);
  assert.equal(db.dump.get('users/uid-a/canonicalDeliveryCompletions/keep')?.count, 2);
  assert.equal(
    (db.dump.get('users/uid-a/saves/current')?.gameState as { player: { money: number } }).player.money,
    33_000,
  );
});

test('route validation and settlement vectors match local production helper', () => {
  assert.equal(lookupCanonicalRoadRoute('izmir', 'nowhere'), null);
  assert.ok(lookupCanonicalRoadRoute('izmir', 'ankara'));

  const cases: Array<{
    label: string;
    amount: number;
    origin: string;
    dest: string;
    product: string;
    outcome: 'COMPLETED' | 'FAILED';
    travelRatio: number;
  }> = [
    { label: 'short-on-time', amount: 10, origin: 'istanbul', dest: 'bursa', product: 'steel', outcome: 'COMPLETED', travelRatio: 0.8 },
    { label: 'short-early', amount: 10, origin: 'istanbul', dest: 'bursa', product: 'steel', outcome: 'COMPLETED', travelRatio: 0.5 },
    { label: 'short-late-minor', amount: 10, origin: 'istanbul', dest: 'bursa', product: 'steel', outcome: 'COMPLETED', travelRatio: 1.2 },
    { label: 'short-late-major', amount: 10, origin: 'istanbul', dest: 'bursa', product: 'steel', outcome: 'COMPLETED', travelRatio: 1.6 },
    { label: 'long-fruit', amount: 12, origin: 'istanbul', dest: 'diyarbakir', product: 'fruit', outcome: 'COMPLETED', travelRatio: 0.9 },
    { label: 'adana-amount', amount: 25, origin: 'adana', dest: 'ankara', product: 'textile', outcome: 'COMPLETED', travelRatio: 0.95 },
    { label: 'failure', amount: 10, origin: 'izmir', dest: 'ankara', product: 'steel', outcome: 'FAILED', travelRatio: 3 },
  ];

  for (const row of cases) {
    const issued = issueCanonicalRoadContractFromTrustedState({
      originCityId: row.origin,
      destinationCityId: row.dest,
      productId: row.product,
      amount: row.amount,
      originMarket: ISSUANCE.originMarket,
      destinationMarket: ISSUANCE.destinationMarket,
      fuelPricePerLiter: 1.72,
      sequence: 7,
    });
    assert.equal(issued.ok, true, row.label);
    if (!issued.ok) continue;
    const hours = issued.snapshot.deadlineHours * row.travelRatio;
    const local = localProductionSettlementFromSnapshot(issued.snapshot, row.outcome, hours);
    const server = prepareCanonicalRoadDeliverySettlement({
      snapshot: issued.snapshot,
      deliveryId: createCanonicalRoadDeliveryId(issued.snapshot.contractId),
      outcome: row.outcome,
      actualTravelHours: hours,
    });
    assert.equal(compareRoadSettlementShadow({ local, server }), 'MATCH', row.label);
    assert.equal(server.fuelChargedOnCompletion, 0, `${row.label} fuel`);
  }
});

test('no generic delta callable; rules deny ROAD canonical writes', () => {
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const applyCashDelta'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
  assert.equal(index.includes('export const acceptCanonicalRoadDelivery'), true);
  assert.equal(index.includes('issueCanonicalRoadContractTransaction'), false);
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalRoadDeliveries\/\{deliveryId\}[\s\S]*?allow write: if false/);
  assert.match(rules, /match \/canonicalRoadContracts\/\{contractId\}[\s\S]*?allow write: if false/);
});
