/**
 * Canonical fleet delivery-wear authority — in-memory tests (Step 29M).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { persistCanonicalCatalogFleetAssetTransaction } from '../src/canonicalProductionFleet';
import { applyCanonicalRoadDeliveryWearTransaction } from '../src/canonicalFleetWear';
import {
  acceptCanonicalRoadDeliveryTransaction,
  cancelCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { settleCanonicalRoadDeliveryInternalTransaction } from '../src/canonicalRoadSettlement';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION,
  classifyCanonicalDeliveryWear,
  createCanonicalDeliveryWearOperationId,
  deriveCanonicalDeliveryWear,
  hasOnlyCanonicalRoadWearKeys,
} from '../../src/domain/canonicalFleetConditionWear';
import { calculateConditionLoss } from '../../src/simulation/delivery';
import { STARTER_DRIVER } from '../../src/data/drivers';
import { getRoute } from '../../src/data/routes';
import { PRODUCT_BY_ID } from '../../src/data/products';
import { truckFromCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import { STARTER_TRUCK } from '../../src/data/trucks';
import { realMsForCanonicalGameHours } from '../../src/domain/canonicalRoadTiming';

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

test('auth, mint keys, client wear fields rejected', () => {
  assert.equal(hasOnlyCanonicalRoadWearKeys({ deliveryId: 'crd_x', canonicalSchemaVersion: 1 }), true);
  assert.equal(hasOnlyCanonicalRoadWearKeys({ deliveryId: 'crd_x', canonicalSchemaVersion: 1, wear: 3 }), false);
  assert.equal(
    hasOnlyCanonicalRoadWearKeys({ deliveryId: 'crd_x', canonicalSchemaVersion: 1, conditionBefore: 88 }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadWearKeys({ deliveryId: 'crd_x', canonicalSchemaVersion: 1, conditionAfter: 80 }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadWearKeys({ deliveryId: 'crd_x', canonicalSchemaVersion: 1, conditionDelta: -2 }),
    false,
  );
});

test('unauthenticated wear rejected; legacy asset blocked', async () => {
  const db = createMemoryFirestore();
  const unauth = await applyCanonicalRoadDeliveryWearTransaction(db, '', 'crd_x', 1);
  assert.equal(unauth.ok, false);
  const missing = await applyCanonicalRoadDeliveryWearTransaction(db, 'uid-a', 'crd_missing', 1);
  assert.equal(missing.ok, false);
});

test('successful wear once; retry; next delivery uses new condition; no cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 20_000 });
  db.dump.set('users/uid-a', { money: 99_000 });
  const minted = await persistCanonicalCatalogFleetAssetTransaction(
    db,
    'uid-a',
    STARTER_TRUCK.catalogId ?? STARTER_TRUCK.id,
    'wear1',
    1,
  );
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: minted.assetId },
    10_000,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const aPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${minted.assetId}`;
  const before = db.dump.get(aPath) as {
    economicCondition: number;
    economicRevision: number;
    activeCanonicalRoadDeliveryId: string;
  };
  assert.equal(before.economicRevision, 1);
  assert.equal(before.economicCondition, STARTER_TRUCK.condition);
  assert.equal(before.activeCanonicalRoadDeliveryId, accepted.receipt.deliveryId);

  const premature = await applyCanonicalRoadDeliveryWearTransaction(db, 'uid-a', accepted.receipt.deliveryId, 11_000);
  assert.equal(premature.ok, false);
  if (!premature.ok) assert.equal(premature.reason, 'DELIVERY_NOT_COMPLETED');

  const completeAt = 10_000 + realMsForCanonicalGameHours(issued.snapshot.deadlineHours * 0.9);
  const reported = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'COMPLETED',
    completeAt,
  );
  assert.equal(reported.ok, true);

  const deliveryDoc = db.dump.get(
    `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`,
  ) as {
    originCityId: string;
    destinationCityId: string;
    productId: string;
    amount: number;
    distanceKm: number;
    derivedSettlement: { maintenanceCost: number; netCashDelta: number };
    executionEconomicsSnapshot: {
      truckEconomicProfile: { condition: number; economicRevision: number };
      maintenanceSnapshot: { bundle: number };
    };
  };
  const frozenMaint = deliveryDoc.derivedSettlement.maintenanceCost;
  const truck = truckFromCanonicalFleetAsset(before as never);
  const route = getRoute('istanbul', 'bursa')!;
  const product = PRODUCT_BY_ID.steel;
  const expectedWear = calculateConditionLoss(
    {
      id: 'x',
      originCityId: 'istanbul',
      destinationCityId: 'bursa',
      productId: 'steel',
      amount: deliveryDoc.amount,
      cargoWeight: deliveryDoc.amount,
      payment: 0,
      deadlineHours: 1,
      distanceKm: deliveryDoc.distanceKm,
      urgency: 0,
      status: 'active',
      createdAt: 0,
      expiresAt: 1,
      requiredLevel: 1,
      contractType: 'standard',
      riskLevel: 'low',
    },
    truck,
    { ...STARTER_DRIVER, attention: 100 },
    route,
    product,
  );
  const helper = deriveCanonicalDeliveryWear({
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    productId: 'steel',
    amount: deliveryDoc.amount,
    distanceKm: deliveryDoc.distanceKm,
    truck,
  });
  assert.equal(helper.ok, true);
  if (helper.ok) assert.equal(helper.wear, expectedWear);

  const worn = await applyCanonicalRoadDeliveryWearTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    completeAt + 1,
  );
  assert.equal(worn.ok, true);
  if (!worn.ok) return;
  assert.equal(worn.alreadyApplied, false);
  assert.equal(worn.receipt.wearAmount, expectedWear);
  assert.equal(worn.receipt.revisionBefore, 1);
  assert.equal(worn.receipt.revisionAfter, 2);
  assert.equal(worn.receipt.conditionBefore, STARTER_TRUCK.condition);
  const after = db.dump.get(aPath) as {
    economicCondition: number;
    economicRevision: number;
    activeCanonicalRoadDeliveryId: string | null;
  };
  assert.equal(after.economicRevision, 2);
  assert.equal(after.economicCondition, STARTER_TRUCK.condition - expectedWear);
  assert.equal(after.activeCanonicalRoadDeliveryId, null);

  const retry = await applyCanonicalRoadDeliveryWearTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    completeAt + 2,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.receipt.revisionAfter, 2);
  assert.equal((db.dump.get(aPath) as { economicRevision: number }).economicRevision, 2);

  const afterWearDelivery = db.dump.get(
    `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`,
  ) as { derivedSettlement: { maintenanceCost: number } };
  assert.equal(afterWearDelivery.derivedSettlement.maintenanceCost, frozenMaint);

  const issued2 = await issueCanonicalRoadContractTransaction(db, 'uid-a', { ...ISSUANCE, sequence: 2 }, 2);
  assert.equal(issued2.ok, true);
  if (!issued2.ok) return;
  const accepted2 = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued2.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: minted.assetId },
    completeAt + 50,
  );
  assert.equal(accepted2.ok, true);
  if (!accepted2.ok) return;
  const d2 = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${accepted2.receipt.deliveryId}`) as {
    executionEconomicsSnapshot: {
      truckEconomicProfile: { condition: number; economicRevision: number };
      maintenanceSnapshot: { bundle: number };
    };
  };
  assert.equal(d2.executionEconomicsSnapshot.truckEconomicProfile.economicRevision, 2);
  assert.equal(d2.executionEconomicsSnapshot.truckEconomicProfile.condition, after.economicCondition);
  assert.ok(after.economicCondition < STARTER_TRUCK.condition);
  assert.ok(
    d2.executionEconomicsSnapshot.maintenanceSnapshot.bundle >=
      deliveryDoc.executionEconomicsSnapshot.maintenanceSnapshot.bundle,
  );

  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_000);
  assert.equal(db.dump.get('users/uid-a')?.money, 99_000);
  assert.equal(db.dump.has(`users/uid-a/canonicalCashTransactions/${worn.receipt.operationId}`), false);
});

test('failed and incident blocked; cancel releases reservation; fixtures wear; conflict; cross-user', async () => {
  const db = createMemoryFirestore();
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: 'fixture-healthy' },
    10_000,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  const cancelled = await cancelCanonicalRoadDeliveryTransaction(db, 'uid-a', accepted.receipt.deliveryId, 10_500);
  assert.equal(cancelled.ok, true);
  const fixturePath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-healthy`;
  assert.equal((db.dump.get(fixturePath) as { activeCanonicalRoadDeliveryId: null }).activeCanonicalRoadDeliveryId, null);

  const issuedFail = await issueCanonicalRoadContractTransaction(db, 'uid-a', { ...ISSUANCE, sequence: 3 }, 3);
  assert.equal(issuedFail.ok, true);
  if (!issuedFail.ok) return;
  const acceptedFail = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issuedFail.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: 'fixture-healthy' },
    20_000,
  );
  assert.equal(acceptedFail.ok, true);
  if (!acceptedFail.ok) return;
  const failReport = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    acceptedFail.receipt.deliveryId,
    'FAILED',
    21_000,
  );
  assert.equal(failReport.ok, true);
  const failWear = await applyCanonicalRoadDeliveryWearTransaction(
    db,
    'uid-a',
    acceptedFail.receipt.deliveryId,
    21_100,
  );
  assert.equal(failWear.ok, false);
  if (!failWear.ok) assert.equal(failWear.reason, 'FAILED_AUTHORITY_UNRESOLVED');
  assert.equal((db.dump.get(fixturePath) as { activeCanonicalRoadDeliveryId: null }).activeCanonicalRoadDeliveryId, null);

  const issuedOk = await issueCanonicalRoadContractTransaction(db, 'uid-a', { ...ISSUANCE, sequence: 4 }, 4);
  assert.equal(issuedOk.ok, true);
  if (!issuedOk.ok) return;
  const acceptedOk = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issuedOk.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: 'fixture-healthy' },
    30_000,
  );
  assert.equal(acceptedOk.ok, true);
  if (!acceptedOk.ok) return;
  const dPath = `users/uid-a/canonicalRoadDeliveries/${acceptedOk.receipt.deliveryId}`;
  const completeAt = 30_000 + realMsForCanonicalGameHours(issuedOk.ok ? issuedOk.snapshot.deadlineHours * 0.9 : 1);
  await reportCanonicalRoadDeliveryCompletedTransaction(db, 'uid-a', acceptedOk.receipt.deliveryId, 'COMPLETED', completeAt);
  const incidentDoc = db.dump.get(dPath) as Record<string, unknown>;
  db.dump.set(dPath, { ...incidentDoc, incidentConditionAuthority: 'UNRESOLVED' });
  const incidentWear = await applyCanonicalRoadDeliveryWearTransaction(
    db,
    'uid-a',
    acceptedOk.receipt.deliveryId,
    completeAt + 1,
  );
  assert.equal(incidentWear.ok, false);
  if (!incidentWear.ok) assert.equal(incidentWear.reason, 'INCIDENT_AUTHORITY_UNRESOLVED');

  db.dump.set(dPath, { ...incidentDoc, incidentConditionAuthority: 'NONE', lifecycleState: 'COMPLETION_REPORTED', completionOutcome: 'COMPLETED' });
  const opId = createCanonicalDeliveryWearOperationId('fixture-healthy', acceptedOk.receipt.deliveryId);
  db.dump.set(`users/uid-a/${CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION}/${opId}`, {
    operationId: opId,
    operationType: 'ROAD_DELIVERY_WEAR',
    assetId: 'fixture-healthy',
    ownerUid: 'uid-a',
    sourceDeliveryId: acceptedOk.receipt.deliveryId,
    revisionBefore: 1,
    revisionAfter: 2,
    conditionBefore: 88,
    wearAmount: 99,
    conditionAfter: 1,
    policyVersion: 'canonical-road-delivery-wear-v1',
    createdAtMs: 1,
    authoritySource: 'INTERNAL_TEST_FIXTURE',
    canonicalSchemaVersion: 1,
  });
  const conflict = await applyCanonicalRoadDeliveryWearTransaction(
    db,
    'uid-a',
    acceptedOk.receipt.deliveryId,
    completeAt + 2,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'CANONICAL_FLEET_MUTATION_CONFLICT');

  const cross = await applyCanonicalRoadDeliveryWearTransaction(
    db,
    'uid-b',
    acceptedOk.receipt.deliveryId,
    completeAt + 3,
  );
  assert.equal(cross.ok, false);

  const ready = classifyCanonicalDeliveryWear({
    delivery: { deliveryId: 'x', lifecycleState: 'ACCEPTED', completionOutcome: null },
    asset: null,
    callerUid: 'uid-a',
  });
  assert.equal(ready, 'DELIVERY_NOT_COMPLETED');
});

test('29K shadow settlement snapshot immutable after wear; floor; no generic mutation callable', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 20_000, ownerUid: 'uid-a', sourceVersion: 1 });
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', { ...ISSUANCE, sequence: 8 }, 8);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: 'fixture-healthy' },
    10_000,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const dPath = `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`;
  const completeAt = 10_000 + realMsForCanonicalGameHours(issued.snapshot.deadlineHours * 0.95);
  await reportCanonicalRoadDeliveryCompletedTransaction(db, 'uid-a', accepted.receipt.deliveryId, 'COMPLETED', completeAt);
  const beforeSettle = db.dump.get(dPath) as { derivedSettlement: { netCashDelta: number; maintenanceCost: number } };
  const settled = await settleCanonicalRoadDeliveryInternalTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    completeAt + 5,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  const net = settled.receipt.netCashDelta;
  const worn = await applyCanonicalRoadDeliveryWearTransaction(db, 'uid-a', accepted.receipt.deliveryId, completeAt + 6);
  assert.equal(worn.ok, true);
  const after = db.dump.get(dPath) as { derivedSettlement: { netCashDelta: number; maintenanceCost: number } };
  assert.equal(after.derivedSettlement.netCashDelta, beforeSettle.derivedSettlement.netCashDelta);
  assert.equal(after.derivedSettlement.maintenanceCost, beforeSettle.derivedSettlement.maintenanceCost);
  assert.equal(settled.receipt.netCashDelta, net);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_000 + net);

  const floorAsset = db.dump.get(`users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-degraded`) as {
    economicCondition: number;
  };
  assert.ok(floorAsset.economicCondition >= 0);

  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const setTruckCondition'), false);
  assert.equal(index.includes('export const applyFleetDelta'), false);
  assert.equal(index.includes('export const updateCanonicalTruck'), false);
  assert.match(index, /export const applyCanonicalRoadDeliveryWear/);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalFleetMutationReceipts\/\{receiptId\}[\s\S]*?allow write: if false/);
});
