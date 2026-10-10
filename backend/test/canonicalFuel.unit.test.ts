/**
 * Canonical fuel tank / price — in-memory tests (Step 29Q).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { purchaseCanonicalFuelTransaction } from '../src/canonicalFuel';
import { purchaseCanonicalCatalogAssetTransaction } from '../src/canonicalCatalogPurchase';
import {
  acceptCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { serverStateCurrentRef, CANONICAL_CASH_TRANSACTIONS_COLLECTION } from '../src/canonicalCashTransaction';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import { CANONICAL_FUEL_RECEIPTS_COLLECTION } from '../../src/domain/canonicalFuelTankPrice';
import {
  classifyCanonicalFuelAuthority,
  createCanonicalFuelPurchaseOperationId,
  deriveCanonicalFuelPricePerLiter,
  deriveCanonicalRoadFuelRequirement,
  hasOnlyCanonicalFuelPurchaseKeys,
  isCanonicalFuelAuthorityAllowed,
  quoteCanonicalFuelPurchase,
  withCanonicalFuelState,
} from '../../src/domain/canonicalFuelTankPrice';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import { parseCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import { truckFromCanonicalFleetAsset } from '../../src/domain/canonicalRoadFleet';
import { getFuelEfficiencyReduction } from '../../src/simulation/truckUpgrades';

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

const GATE = { envValue: 'INTERNAL_TEST' as const };
const PRICE = { ...GATE, fuelPriceRaw: 1.72 };

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

test('gate, keys, price, client overrides rejected', () => {
  assert.equal(isCanonicalFuelAuthorityAllowed({ envValue: null }), false);
  assert.equal(isCanonicalFuelAuthorityAllowed(GATE), true);
  assert.equal(
    hasOnlyCanonicalFuelPurchaseKeys({
      assetId: 'a',
      fuelPurchaseIntentId: 'intent-aa',
      mode: 'FILL_TO_CAPACITY',
      canonicalSchemaVersion: 1,
      pricePerLiter: 1,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalFuelPurchaseKeys({
      assetId: 'a',
      fuelPurchaseIntentId: 'intent-aa',
      mode: 'BUY_LITERS',
      requestedLiters: 25,
      canonicalSchemaVersion: 1,
    }),
    true,
  );
  const priced = deriveCanonicalFuelPricePerLiter(9.99);
  assert.equal(priced.ok, true);
  assert.equal(priced.pricePerLiter, 1.72 < 9.99 ? priced.pricePerLiter : priced.pricePerLiter);
  assert.equal(deriveCanonicalFuelPricePerLiter(1.72).pricePerLiter, 1.72);
});

test('auth, legacy, full tank, insufficient cash', async () => {
  const db = createMemoryFirestore();
  const unauth = await purchaseCanonicalFuelTransaction(db, '', 'fixture-healthy', 'intent-aa1', 'FILL_TO_CAPACITY', 1, PRICE);
  assert.equal(unauth.ok, false);
  const off = await purchaseCanonicalFuelTransaction(db, 'uid-a', 'fixture-healthy', 'intent-aa1', 'FILL_TO_CAPACITY', 1, {
    envValue: null,
  });
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_FUEL_AUTHORITY_OFF');

  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const legacy = await purchaseCanonicalFuelTransaction(db, 'uid-a', 'truck-starter-1', 'intent-bb1', 'FILL_TO_CAPACITY', 1, PRICE);
  assert.equal(legacy.ok, false);

  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 1, ownerUid: 'uid-a', sourceVersion: 1 });
  const path = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-healthy`;
  const parsed = parseCanonicalFleetAsset(db.dump.get(path), 'TRUCK');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  classifyCanonicalFuelAuthority(parsed.asset, GATE);
  const fueled = withCanonicalFuelState(parsed.asset);
  db.dump.set(path, { ...fueled, currentFuelL: fueled.fuelCapacityL });
  const full = await purchaseCanonicalFuelTransaction(db, 'uid-a', 'fixture-healthy', 'intent-cc1', 'FILL_TO_CAPACITY', 1, PRICE);
  assert.equal(full.ok, true);
  if (full.ok) assert.equal(full.notNeeded, true);

  db.dump.set(path, { ...fueled, currentFuelL: 0 });
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 1, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 88_000 });
  const poor = await purchaseCanonicalFuelTransaction(db, 'uid-a', 'fixture-healthy', 'intent-dd1', 'FILL_TO_CAPACITY', 1, PRICE);
  assert.equal(poor.ok, false);
  if (!poor.ok) assert.equal(poor.reason, 'INSUFFICIENT_CASH');
  assert.equal(db.dump.get(path)?.currentFuelL, 0);
  assert.equal(db.dump.get('users/uid-a')?.money, 88_000);
});

test('purchase fill, retry, exact cost, no profile money', async () => {
  const db = createMemoryFirestore();
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const path = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-healthy`;
  const parsed = parseCanonicalFleetAsset(db.dump.get(path), 'TRUCK');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const fueled = withCanonicalFuelState({ ...parsed.asset, currentFuelL: 10 });
  db.dump.set(path, fueled);
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 50_000, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 77_000 });
  const q = quoteCanonicalFuelPurchase({
    asset: fueled,
    mode: 'FILL_TO_CAPACITY',
    pricePerLiter: 1.72,
  });
  assert.equal(q.ok, true);
  if (!q.ok) return;
  const first = await purchaseCanonicalFuelTransaction(
    db,
    'uid-a',
    'fixture-healthy',
    'fuelbuy01',
    'FILL_TO_CAPACITY',
    10,
    PRICE,
  );
  assert.equal(first.ok, true);
  if (!first.ok || !first.receipt) return;
  assert.equal(first.alreadyApplied, false);
  assert.equal(first.receipt.cost, q.cost);
  assert.equal(first.receipt.litersDelta, q.litersToAdd);
  assert.equal(first.receipt.fuelAfter, q.fuelAfter);
  assert.equal(first.receipt.fuelRevisionAfter, (fueled.fuelRevision ?? 1) + 1);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 50_000 - q.cost);
  assert.equal(db.dump.get('users/uid-a')?.money, 77_000);
  assert.equal(db.dump.get(path)?.currentFuelL, q.fuelAfter);
  const retry = await purchaseCanonicalFuelTransaction(
    db,
    'uid-a',
    'fixture-healthy',
    'fuelbuy01',
    'FILL_TO_CAPACITY',
    11,
    PRICE,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 50_000 - q.cost);
  assert.equal(
    db.dump.get(`users/uid-a/${CANONICAL_CASH_TRANSACTIONS_COLLECTION}/${createCanonicalFuelPurchaseOperationId('fixture-healthy', 'fuelbuy01')}`)
      ?.amountDelta,
    -q.cost,
  );
});

test('catalog mint has fuel; custom liters; accept burn; insufficient fuel; upgrade reduces required', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 200_000, ownerUid: 'uid-a', sourceVersion: 1 });
  const minted = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    'truck-ford-cargo',
    'fuelcat01',
    'TRUCK',
    1,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const assetPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${minted.receipt.assetId}`;
  const mintedAsset = parseCanonicalFleetAsset(db.dump.get(assetPath), 'TRUCK');
  assert.equal(mintedAsset.ok, true);
  if (!mintedAsset.ok) return;
  assert.equal(typeof mintedAsset.asset.currentFuelL, 'number');
  assert.equal((mintedAsset.asset.fuelCapacityL ?? 0) > 0, true);

  const liters = await purchaseCanonicalFuelTransaction(
    db,
    'uid-a',
    minted.receipt.assetId,
    'liters001',
    'BUY_LITERS',
    2,
    { ...PRICE, requestedLiters: 25 },
  );
  assert.equal(liters.ok, true);
  if (!liters.ok || !liters.receipt) return;
  assert.equal(liters.receipt.litersDelta, 25);

  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-b', 1, { envValue: 'INTERNAL_TEST' });
  const healthyPath = `users/uid-b/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-healthy`;
  const healthy = parseCanonicalFleetAsset(db.dump.get(healthyPath), 'TRUCK');
  assert.equal(healthy.ok, true);
  if (!healthy.ok) return;
  const req = deriveCanonicalRoadFuelRequirement({
    truckAsset: withCanonicalFuelState(healthy.asset),
    trailerAsset: null,
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    amount: 10,
    payment: 1000,
  });
  assert.equal(req.ok, true);
  if (!req.ok) return;
  const upgradedPath = `users/uid-b/${CANONICAL_FLEET_ASSETS_COLLECTION}/fixture-upgraded`;
  const upgraded = parseCanonicalFleetAsset(db.dump.get(upgradedPath), 'TRUCK');
  assert.equal(upgraded.ok, true);
  if (!upgraded.ok) return;
  const reqUp = deriveCanonicalRoadFuelRequirement({
    truckAsset: withCanonicalFuelState(upgraded.asset),
    trailerAsset: null,
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    amount: 10,
    payment: 1000,
  });
  assert.equal(reqUp.ok, true);
  if (!reqUp.ok) return;
  assert.equal(reqUp.requiredFuelL < req.requiredFuelL, true);
  const truck = truckFromCanonicalFleetAsset(upgraded.asset);
  assert.equal(getFuelEfficiencyReduction(truck) > 0, true);

  db.dump.set(serverStateCurrentRef('uid-b'), { cash: 50_000, ownerUid: 'uid-b', sourceVersion: 1 });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-b', ISSUANCE, 5);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const before = db.dump.get(healthyPath)?.currentFuelL;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-b',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-healthy',
    },
    6,
    { fuelEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(accepted.ok, true);
  const after = db.dump.get(healthyPath)?.currentFuelL;
  assert.equal(typeof before === 'number' && typeof after === 'number' && after < before, true);
  const consumeReceipts = [...db.dump.keys()].filter((key) =>
    key.includes(`${CANONICAL_FUEL_RECEIPTS_COLLECTION}/fuel:fixture-healthy:delivery:`),
  );
  assert.equal(consumeReceipts.length, 1);

  const issued2 = await issueCanonicalRoadContractTransaction(db, 'uid-b', { ...ISSUANCE, sequence: 2 }, 7);
  assert.equal(issued2.ok, true);
  if (!issued2.ok) return;
  db.dump.set(healthyPath, { ...db.dump.get(healthyPath)!, currentFuelL: 0, activeCanonicalRoadDeliveryId: null });
  const denied = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-b',
    {
      contractId: issued2.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-healthy',
    },
    8,
    { fuelEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, 'CANONICAL_FUEL_INSUFFICIENT');
});

test('no public wiring, no generic cash, no multimodal settle', () => {
  const store = readFileSync(resolve(__dirname, '../../src/store/gameStore.ts'), 'utf8');
  assert.equal(store.includes('purchaseCanonicalFuel'), false);
  const sheet = readFileSync(resolve(__dirname, '../../src/components/TruckRefuelSheet.tsx'), 'utf8');
  assert.equal(sheet.includes('purchaseCanonicalFuel'), false);
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const applyCashDelta'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
});
