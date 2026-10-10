/**
 * Canonical fleet repair / upgrade — in-memory tests (Step 29N).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { persistCanonicalCatalogFleetAssetTransaction } from '../src/canonicalProductionFleet';
import {
  repairCanonicalFleetAssetTransaction,
  upgradeCanonicalFleetAssetTransaction,
} from '../src/canonicalFleetRepairUpgrade';
import { applyCanonicalRoadDeliveryWearTransaction } from '../src/canonicalFleetWear';
import {
  acceptCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { CANONICAL_CASH_TRANSACTIONS_COLLECTION } from '../src/canonicalCashTransaction';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import { CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION } from '../../src/domain/canonicalFleetConditionWear';
import {
  classifyCanonicalFleetRepair,
  classifyCanonicalFleetUpgrade,
  deriveCanonicalFleetRepair,
  deriveCanonicalFleetUpgrade,
  hasOnlyCanonicalFleetRepairKeys,
  hasOnlyCanonicalFleetUpgradeKeys,
  isCanonicalFleetMutationsAllowed,
} from '../../src/domain/canonicalFleetRepairUpgrade';
import { calculateTruckRepairCost } from '../../src/simulation/delivery';
import { getTruckUpgradeCost, applyTruckUpgrade } from '../../src/simulation/truckUpgrades';
import { STARTER_TRUCK } from '../../src/data/trucks';
import { truckFromCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import { deriveCanonicalDeliveryWear } from '../../src/domain/canonicalFleetConditionWear';
import { getRoute } from '../../src/data/routes';
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

const GATE = { envValue: 'INTERNAL_TEST' as const };

test('keys, gate, derivation parity', () => {
  assert.equal(isCanonicalFleetMutationsAllowed({ envValue: null }), false);
  assert.equal(isCanonicalFleetMutationsAllowed(GATE), true);
  assert.equal(
    hasOnlyCanonicalFleetRepairKeys({
      assetId: 'a',
      repairIntentId: 'intent-aa',
      canonicalSchemaVersion: 1,
      repairCost: 10,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalFleetUpgradeKeys({
      assetId: 'a',
      upgradeType: 'engine',
      upgradeIntentId: 'intent-bb',
      canonicalSchemaVersion: 1,
      upgradePrice: 1,
    }),
    false,
  );
  const truck = { ...STARTER_TRUCK, condition: 35 };
  assert.equal(calculateTruckRepairCost(truck), calculateTruckRepairCost(truck));
  assert.equal(getTruckUpgradeCost(STARTER_TRUCK, 'engine'), getTruckUpgradeCost(STARTER_TRUCK, 'engine'));
});

test('auth, gate, legacy, reservation, not-needed, insufficient cash', async () => {
  const db = createMemoryFirestore();
  const unauth = await repairCanonicalFleetAssetTransaction(db, '', 'fixture-degraded', 'intent-01', 1, GATE);
  assert.equal(unauth.ok, false);
  const off = await repairCanonicalFleetAssetTransaction(db, 'uid-a', 'fixture-degraded', 'intent-01', 1, {
    envValue: null,
  });
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_FLEET_MUTATIONS_OFF');

  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const legacy = await repairCanonicalFleetAssetTransaction(db, 'uid-a', 'truck-starter-1', 'intent-02x', 1, GATE);
  assert.equal(legacy.ok, false);

  const upgradedPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-upgraded`;
  const notNeeded = await repairCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    'fixture-upgraded',
    'intent-03x',
    1,
    GATE,
  );
  assert.equal(notNeeded.ok, true);
  if (notNeeded.ok) assert.equal(notNeeded.notNeeded, true);
  assert.equal((db.dump.get(upgradedPath) as { economicRevision: number }).economicRevision, 1);

  const healthyPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-healthy`;

  db.dump.set(healthyPath, {
    ...db.dump.get(healthyPath)!,
    activeCanonicalRoadDeliveryId: 'crd_busy',
  });
  const reserved = await upgradeCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    'fixture-healthy',
    'engine',
    'intent-04x',
    1,
    GATE,
  );
  assert.equal(reserved.ok, false);
  if (!reserved.ok) assert.equal(reserved.reason, 'ASSET_RESERVED_BY_ACTIVE_DELIVERY');
  db.dump.set(healthyPath, { ...db.dump.get(healthyPath)!, activeCanonicalRoadDeliveryId: null });

  const broke = createMemoryFirestore();
  await bootstrapInternalCanonicalFleetFixturesTransaction(broke, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  broke.dump.set(serverStateCurrentRef('uid-a'), { cash: 1, ownerUid: 'uid-a', sourceVersion: 1 });
  const poor = await repairCanonicalFleetAssetTransaction(
    broke,
    'uid-a',
    'fixture-degraded',
    'intent-05x',
    1,
    GATE,
  );
  assert.equal(poor.ok, false);
  if (!poor.ok) assert.equal(poor.reason, 'INSUFFICIENT_CASH');
  assert.equal(broke.dump.get(serverStateCurrentRef('uid-a'))?.cash, 1);
  assert.equal(
    (broke.dump.get(`users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-degraded`) as { economicCondition: number })
      .economicCondition,
    35,
  );
});

test('repair apply once, retry, cash exact, no local money', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 20_000, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 77_000 });
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const path = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-degraded`;
  const asset = db.dump.get(path) as Parameters<typeof deriveCanonicalFleetRepair>[0];
  const derived = deriveCanonicalFleetRepair(asset);
  const truck = truckFromCanonicalFleetAsset(asset);
  assert.equal(derived.repairCost, calculateTruckRepairCost(truck));
  assert.equal(derived.targetCondition, 100);

  const first = await repairCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    'fixture-degraded',
    'repair-aa1',
    10,
    GATE,
  );
  assert.equal(first.ok, true);
  if (!first.ok || !first.receipt) return;
  assert.equal(first.alreadyApplied, false);
  assert.equal(first.receipt.derivedCost, derived.repairCost);
  assert.equal(first.receipt.revisionAfter, 2);
  assert.equal(first.receipt.conditionAfter, 100);
  assert.equal(first.receipt.cashDelta, -derived.repairCost);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_000 - derived.repairCost);
  assert.equal((db.dump.get(path) as { economicCondition: number }).economicCondition, 100);
  assert.equal((db.dump.get(path) as { economicRevision: number }).economicRevision, 2);
  assert.equal(db.dump.get('users/uid-a')?.money, 77_000);
  const cashDoc = db.dump.get(
    `users/uid-a/${CANONICAL_CASH_TRANSACTIONS_COLLECTION}/${first.receipt.cashTransactionId}`,
  );
  assert.equal(cashDoc?.amountDelta, -derived.repairCost);
  assert.ok(
    db.dump.get(`users/uid-a/${CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION}/${first.receipt.operationId}`),
  );

  const retry = await repairCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    'fixture-degraded',
    'repair-aa1',
    20,
    GATE,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_000 - derived.repairCost);
  assert.equal((db.dump.get(path) as { economicRevision: number }).economicRevision, 2);

  const maxed = await upgradeCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    'fixture-upgraded',
    'engine',
    'upg-maxxx',
    30,
    GATE,
  );
  assert.equal(maxed.ok, false);
  if (!maxed.ok) assert.equal(maxed.reason, 'UPGRADE_MAX_LEVEL');
});

test('upgrade durability then wear is lower; revision; old snapshot frozen', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 50_000, ownerUid: 'uid-a', sourceVersion: 1 });
  const minted = await persistCanonicalCatalogFleetAssetTransaction(
    db,
    'uid-a',
    STARTER_TRUCK.catalogId ?? STARTER_TRUCK.id,
    'upgwear1',
    1,
  );
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const aPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${minted.assetId}`;
  const before = db.dump.get(aPath) as Parameters<typeof deriveCanonicalFleetUpgrade>[0];
  const truck0 = truckFromCanonicalFleetAsset(before);
  const routeKm = getRoute('istanbul', 'adana')!.distanceKm;
  const wear0 = deriveCanonicalDeliveryWear({
    originCityId: 'istanbul',
    destinationCityId: 'adana',
    productId: 'steel',
    amount: 10,
    distanceKm: routeKm,
    truck: truck0,
  });
  const upDerived = deriveCanonicalFleetUpgrade(before, 'durability');
  assert.equal(upDerived.derivedCost, getTruckUpgradeCost(truck0, 'durability'));
  assert.equal(upDerived.nextLevel, applyTruckUpgrade(truck0, 'durability').upgrades.durability);

  const upgraded = await upgradeCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    minted.assetId,
    'durability',
    'dur-intent1',
    5,
    GATE,
  );
  assert.equal(upgraded.ok, true);
  if (!upgraded.ok) return;
  assert.equal(upgraded.receipt.revisionAfter, 2);
  const afterUp = db.dump.get(aPath) as Parameters<typeof truckFromCanonicalFleetAsset>[0];
  assert.equal(afterUp.economicUpgradeIds.durability, 1);
  const wear1 = deriveCanonicalDeliveryWear({
    originCityId: 'istanbul',
    destinationCityId: 'adana',
    productId: 'steel',
    amount: 10,
    distanceKm: routeKm,
    truck: truckFromCanonicalFleetAsset(afterUp),
  });
  assert.equal(wear0.ok && wear1.ok, true);
  if (wear0.ok && wear1.ok) assert.ok(wear1.wear < wear0.wear);

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
  const dPath = `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`;
  const snap = db.dump.get(dPath) as {
    executionEconomicsSnapshot: { truckEconomicProfile: { economicRevision: number; upgrades: { durability: number } } };
  };
  assert.equal(snap.executionEconomicsSnapshot.truckEconomicProfile.economicRevision, 2);
  assert.equal(snap.executionEconomicsSnapshot.truckEconomicProfile.upgrades.durability, 1);

  const completeAt = 10_000 + realMsForCanonicalGameHours(issued.snapshot.deadlineHours * 0.9);
  await reportCanonicalRoadDeliveryCompletedTransaction(db, 'uid-a', accepted.receipt.deliveryId, 'COMPLETED', completeAt);
  const worn = await applyCanonicalRoadDeliveryWearTransaction(db, 'uid-a', accepted.receipt.deliveryId, completeAt + 1);
  assert.equal(worn.ok, true);
  if (!worn.ok) return;
  const wearApplied = deriveCanonicalDeliveryWear({
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    productId: 'steel',
    amount: 10,
    distanceKm: getRoute('istanbul', 'bursa')!.distanceKm,
    truck: truckFromCanonicalFleetAsset(afterUp),
  });
  assert.equal(wearApplied.ok, true);
  if (wearApplied.ok) assert.equal(worn.receipt.wearAmount, wearApplied.wear);
  const afterWear = db.dump.get(aPath) as { economicRevision: number; economicCondition: number };
  assert.equal(afterWear.economicRevision, 3);
  assert.equal(
    (db.dump.get(dPath) as { executionEconomicsSnapshot: { truckEconomicProfile: { economicRevision: number } } })
      .executionEconomicsSnapshot.truckEconomicProfile.economicRevision,
    2,
  );

  const repaired = await repairCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    minted.assetId,
    'repair-after',
    completeAt + 2,
    GATE,
  );
  assert.equal(repaired.ok, true);
  if (!repaired.ok || !repaired.receipt) return;
  assert.equal(repaired.receipt.revisionAfter, 4);
  assert.equal((db.dump.get(aPath) as { economicCondition: number }).economicCondition, 100);

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
    executionEconomicsSnapshot: { truckEconomicProfile: { condition: number; economicRevision: number } };
  };
  assert.equal(d2.executionEconomicsSnapshot.truckEconomicProfile.condition, 100);
  assert.equal(d2.executionEconomicsSnapshot.truckEconomicProfile.economicRevision, 4);
  assert.equal(db.dump.get('users/uid-a')?.money, undefined);

  const cross = await repairCanonicalFleetAssetTransaction(
    db,
    'uid-b',
    minted.assetId,
    'repair-xx1',
    9,
    GATE,
  );
  assert.equal(cross.ok, false);

  classifyCanonicalFleetRepair(null, 'uid-a');
  classifyCanonicalFleetUpgrade(null, 'uid-a', 'engine');
});

test('no generic cash or setCondition; rules still deny writes', () => {
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const setTruckCondition'), false);
  assert.equal(index.includes('export const applyFleetDelta'), false);
  assert.match(index, /export const repairCanonicalFleetAsset/);
  assert.match(index, /export const upgradeCanonicalFleetAsset/);
  assert.equal(index.includes('upgradeTruck('), false);
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalFleetAssets\/\{assetId\}[\s\S]*?allow write: if false/);
  assert.match(rules, /canonicalCashTransactions[\s\S]*?allow write: if false/);
});
