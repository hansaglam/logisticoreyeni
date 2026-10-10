/**
 * Core vehicle/staff cash — in-memory tests (Step 29R).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { purchaseCanonicalCatalogAssetTransaction } from '../src/canonicalCatalogPurchase';
import { serverStateCurrentRef, CANONICAL_CASH_TRANSACTIONS_COLLECTION } from '../src/canonicalCashTransaction';
import {
  createCanonicalVehicleLeaseTransaction,
  fireCanonicalDriverTransaction,
  hireCanonicalDriverTransaction,
  recoverCanonicalVehicleTransaction,
  sellCanonicalFleetAssetTransaction,
} from '../src/canonicalCoreVehicleStaffCash';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_DRIVERS_COLLECTION,
  CANONICAL_VEHICLE_LEASES_COLLECTION,
  CANONICAL_VEHICLE_SALE_RECEIPTS_COLLECTION,
  VEHICLE_RECOVERY_FAMILY_STATUS,
  createCanonicalDriverFireTransactionId,
  createCanonicalDriverHireTransactionId,
  createCanonicalLeaseAssetId,
  createCanonicalLeaseStartTransactionId,
  createCanonicalVehicleSaleTransactionId,
  deriveCanonicalDriverSeveranceCost,
  deriveCanonicalLeaseStartCost,
  deriveCanonicalVehicleSaleValue,
  freezeCanonicalDriverOfferFromPool,
  hasOnlyCanonicalDriverFireKeys,
  hasOnlyCanonicalDriverHireKeys,
  hasOnlyCanonicalLeaseStartKeys,
  hasOnlyCanonicalVehicleRecoveryKeys,
  hasOnlyCanonicalVehicleSaleKeys,
  isCanonicalCoreVehicleStaffCashAllowed,
} from '../../src/domain/canonicalCoreVehicleStaffCash';
import { createCanonicalCatalogAssetId } from '../../src/domain/remainingRoadCashPathCanonicalization';
import { findTruckMarketItem } from '../../src/data/trucks';

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
const TRUCK_ID = 'truck-ford-cargo';
const POOL_A = 'driver-can-t';
const POOL_B = 'driver-seda-n';

function seedCash(db: ReturnType<typeof createMemoryFirestore>, cash = 200_000) {
  db.dump.set(serverStateCurrentRef('uid-a'), { cash, ownerUid: 'uid-a', sourceVersion: 1 });
  db.dump.set('users/uid-a', { money: 88_000 });
}

test('gate, keys, server-derived lease/hire/sale, recovery blocked', () => {
  assert.equal(isCanonicalCoreVehicleStaffCashAllowed({ envValue: null }), false);
  assert.equal(isCanonicalCoreVehicleStaffCashAllowed(GATE), true);
  assert.equal(
    hasOnlyCanonicalLeaseStartKeys({
      catalogModelId: TRUCK_ID,
      leaseIntentId: 'lease-aa1',
      leasePeriod: 'weekly',
      canonicalSchemaVersion: 1,
      prepaidLeaseCost: 1,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalLeaseStartKeys({
      catalogModelId: TRUCK_ID,
      leaseIntentId: 'lease-aa1',
      leasePeriod: 'weekly',
      canonicalSchemaVersion: 1,
    }),
    true,
  );
  assert.equal(
    hasOnlyCanonicalDriverHireKeys({
      poolId: POOL_A,
      hireIntentId: 'hire-aa01',
      canonicalSchemaVersion: 1,
      hiringFee: 1,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalVehicleSaleKeys({
      assetId: 'cfa_x',
      saleIntentId: 'sale-aa01',
      canonicalSchemaVersion: 1,
      salePrice: 1,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalDriverFireKeys({
      driverId: POOL_A,
      fireIntentId: 'fire-aa01',
      canonicalSchemaVersion: 1,
      severanceCost: 1,
    }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalVehicleRecoveryKeys({
      assetId: 'cfa_x',
      recoveryIntentId: 'recov-aa1',
      actionId: 'tow',
      canonicalSchemaVersion: 1,
      recoveryCost: 1,
    }),
    false,
  );
  const lease = deriveCanonicalLeaseStartCost(TRUCK_ID, 'weekly');
  assert.equal(lease.ok, true);
  if (lease.ok) {
    assert.equal(lease.prepaidCost, findTruckMarketItem(TRUCK_ID)?.weeklyLeaseCost);
  }
  const offer = freezeCanonicalDriverOfferFromPool(POOL_A);
  assert.equal(offer.ok, true);
  if (offer.ok) assert.equal(offer.offer.hiringFee, 800);
  const coming = freezeCanonicalDriverOfferFromPool('driver-lars-h');
  assert.equal(coming.ok, false);
});

test('auth, gate off, recovery fail-closed', async () => {
  const db = createMemoryFirestore();
  const unauth = await createCanonicalVehicleLeaseTransaction(
    db,
    '',
    TRUCK_ID,
    'lease-aa1',
    'weekly',
    1,
    GATE,
  );
  assert.equal(unauth.ok, false);
  if (!unauth.ok) assert.equal(unauth.reason, 'UNAUTHENTICATED');
  const off = await hireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'hire-aa01', 1, {
    envValue: null,
  });
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_CORE_VEHICLE_STAFF_CASH_OFF');
  seedCash(db);
  const rec = await recoverCanonicalVehicleTransaction(db, 'uid-a', 'cfa_x', 'recov-aa1', GATE);
  assert.equal(rec.ok, false);
  assert.equal(rec.reason, VEHICLE_RECOVERY_FAMILY_STATUS);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 200_000);
});

test('lease start atomic debit, leased asset, retry, no daily double-charge field', async () => {
  const db = createMemoryFirestore();
  seedCash(db);
  const priced = deriveCanonicalLeaseStartCost(TRUCK_ID, 'weekly');
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  const first = await createCanonicalVehicleLeaseTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'lease-aa1',
    'weekly',
    1,
    GATE,
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const assetId = createCanonicalLeaseAssetId('lease-aa1');
  assert.equal(first.receipt.prepaidCost, priced.prepaidCost);
  assert.equal(first.receipt.transactionId, createCanonicalLeaseStartTransactionId(assetId, 'lease-aa1'));
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 200_000 - priced.prepaidCost);
  assert.equal(db.dump.get('users/uid-a')?.money, 88_000);
  const asset = db.dump.get(`users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`);
  assert.equal(asset?.ownershipType, 'leased');
  assert.equal(asset?.lifecycleStatus, 'LEASE_ACTIVE');
  assert.equal(asset?.mileageKm, 0);
  const lease = db.dump.get(`users/uid-a/${CANONICAL_VEHICLE_LEASES_COLLECTION}/${first.receipt.leaseId}`);
  assert.equal(lease?.status, 'ACTIVE');
  assert.equal(lease?.recurringCost, priced.recurringDailyCost);
  const retry = await createCanonicalVehicleLeaseTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'lease-aa1',
    'weekly',
    2,
    GATE,
  );
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.receipt.prepaidCost, first.receipt.prepaidCost);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 200_000 - priced.prepaidCost);
  const sale = await sellCanonicalFleetAssetTransaction(db, 'uid-a', assetId, 'sale-lease1', 3, GATE);
  assert.equal(sale.ok, false);
  if (!sale.ok) assert.equal(sale.reason, 'LEASED_ASSET_NOT_SELLABLE');
});

test('hire once, fire last blocked, fire after two, legacy driver rejected', async () => {
  const db = createMemoryFirestore();
  seedCash(db);
  const offerA = freezeCanonicalDriverOfferFromPool(POOL_A);
  const offerB = freezeCanonicalDriverOfferFromPool(POOL_B);
  assert.equal(offerA.ok && offerB.ok, true);
  if (!offerA.ok || !offerB.ok) return;
  const hireA = await hireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'hire-aa01', 1, GATE);
  assert.equal(hireA.ok, true);
  if (!hireA.ok) return;
  assert.equal(hireA.receipt.amount, offerA.offer.hiringFee);
  assert.equal(
    hireA.receipt.transactionId,
    createCanonicalDriverHireTransactionId(POOL_A, 'hire-aa01'),
  );
  const retryHire = await hireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'hire-aa01', 2, GATE);
  assert.equal(retryHire.ok, true);
  if (retryHire.ok) assert.equal(retryHire.alreadyApplied, true);
  const dup = await hireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'hire-aa02', 3, GATE);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.reason, 'DRIVER_ALREADY_HIRED');
  const last = await fireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'fire-aa01', 4, GATE);
  assert.equal(last.ok, false);
  if (!last.ok) assert.equal(last.reason, 'LAST_DRIVER');
  const hireB = await hireCanonicalDriverTransaction(db, 'uid-a', POOL_B, 'hire-bb01', 5, GATE);
  assert.equal(hireB.ok, true);
  const fire = await fireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'fire-aa02', 6, GATE);
  assert.equal(fire.ok, true);
  if (!fire.ok) return;
  assert.equal(fire.receipt.amount, deriveCanonicalDriverSeveranceCost(offerA.offer.salaryPerDay));
  assert.equal(fire.receipt.transactionId, createCanonicalDriverFireTransactionId(POOL_A, 'fire-aa02'));
  const driver = db.dump.get(`users/uid-a/${CANONICAL_DRIVERS_COLLECTION}/${POOL_A}`);
  assert.equal(driver?.status, 'fired');
  const retryFire = await fireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'fire-aa02', 7, GATE);
  assert.equal(retryFire.ok, true);
  if (retryFire.ok) assert.equal(retryFire.alreadyApplied, true);
  const legacy = await fireCanonicalDriverTransaction(
    db,
    'uid-a',
    'driver-starter-1',
    'fire-leg01',
    8,
    GATE,
  );
  assert.equal(legacy.ok, false);
  if (!legacy.ok) assert.equal(legacy.reason, 'LEGACY_DRIVER_UNVERIFIED');
  assert.equal(db.dump.get('users/uid-a')?.money, 88_000);
});

test('sale formula, reservation, legacy, sold once, insufficient ignored for credit', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 300_000);
  const purchased = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'purchase01',
    'TRUCK',
    1,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(purchased.ok, true);
  const assetId = createCanonicalCatalogAssetId('TRUCK', 'purchase01');
  const path = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
  const asset = db.dump.get(path) as Record<string, unknown>;
  const valued = deriveCanonicalVehicleSaleValue(asset as never);
  assert.equal(valued.ok, true);
  if (!valued.ok) return;
  db.dump.set(path, { ...asset, activeCanonicalRoadDeliveryId: 'crd_busy' });
  const reserved = await sellCanonicalFleetAssetTransaction(db, 'uid-a', assetId, 'sale-aa01', 2, GATE);
  assert.equal(reserved.ok, false);
  if (!reserved.ok) assert.equal(reserved.reason, 'CANONICAL_ASSET_RESERVED');
  db.dump.set(path, { ...asset, activeCanonicalRoadDeliveryId: null, economicCondition: 50, mileageKm: 20_000 });
  const wornValued = deriveCanonicalVehicleSaleValue(db.dump.get(path) as never);
  assert.equal(wornValued.ok, true);
  const worn = await sellCanonicalFleetAssetTransaction(db, 'uid-a', assetId, 'sale-aa02', 3, GATE);
  assert.equal(worn.ok, true);
  if (!worn.ok || !wornValued.ok) return;
  assert.equal(worn.receipt.saleValue, wornValued.saleValue);
  assert.equal(worn.receipt.mileageKm, 20_000);
  assert.equal(worn.receipt.transactionId, createCanonicalVehicleSaleTransactionId(assetId, 'sale-aa02'));
  const after = db.dump.get(serverStateCurrentRef('uid-a'))?.cash;
  assert.equal(after, 300_000 - (findTruckMarketItem(TRUCK_ID)?.purchasePrice ?? 0) + wornValued.saleValue);
  assert.equal(db.dump.get(path)?.lifecycleStatus, 'SOLD');
  const again = await sellCanonicalFleetAssetTransaction(db, 'uid-a', assetId, 'sale-aa03', 4, GATE);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, 'CANONICAL_ASSET_ALREADY_SOLD');
  const retry = await sellCanonicalFleetAssetTransaction(db, 'uid-a', assetId, 'sale-aa02', 5, GATE);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.alreadyApplied, true);
  const legacy = await sellCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    'truck-starter-1',
    'sale-leg01',
    6,
    GATE,
  );
  assert.equal(legacy.ok, false);
  if (!legacy.ok) assert.equal(legacy.reason, 'LEGACY_FLEET_UNVERIFIED');
  const purchased2 = await purchaseCanonicalCatalogAssetTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'purchase02',
    'TRUCK',
    7,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(purchased2.ok, true);
  const assetId2 = createCanonicalCatalogAssetId('TRUCK', 'purchase02');
  const path2 = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId2}`;
  const asset2 = db.dump.get(path2) as Record<string, unknown>;
  db.dump.set(path2, {
    ...asset2,
    economicUpgradeIds: { engine: 1, fuelEfficiency: 0, cargo: 0, durability: 0 },
  });
  const upgradedValued = deriveCanonicalVehicleSaleValue(db.dump.get(path2) as never);
  assert.equal(upgradedValued.ok, true);
  const upgraded = await sellCanonicalFleetAssetTransaction(db, 'uid-a', assetId2, 'sale-upg01', 8, GATE);
  assert.equal(upgraded.ok, true);
  if (upgraded.ok && upgradedValued.ok) {
    assert.equal(upgraded.receipt.saleValue, upgradedValued.saleValue);
  }
  assert.equal(db.dump.get('users/uid-a')?.money, 88_000);
  assert.ok(
    [...db.dump.keys()].some((key) => key.includes(CANONICAL_CASH_TRANSACTIONS_COLLECTION)),
  );
  assert.ok([...db.dump.keys()].some((key) => key.includes(CANONICAL_VEHICLE_SALE_RECEIPTS_COLLECTION)));
});

test('insufficient cash lease/hire, receipts immutable collections', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 10);
  const lease = await createCanonicalVehicleLeaseTransaction(
    db,
    'uid-a',
    TRUCK_ID,
    'lease-poor',
    'weekly',
    1,
    GATE,
  );
  assert.equal(lease.ok, false);
  if (!lease.ok) assert.equal(lease.reason, 'INSUFFICIENT_CASH');
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 10);
  assert.equal(
    [...db.dump.keys()].filter((key) => key.includes(CANONICAL_VEHICLE_LEASES_COLLECTION)).length,
    0,
  );
  const hire = await hireCanonicalDriverTransaction(db, 'uid-a', POOL_A, 'hire-poor1', 2, GATE);
  assert.equal(hire.ok, false);
  if (!hire.ok) assert.equal(hire.reason, 'INSUFFICIENT_CASH');
  assert.equal(
    [...db.dump.keys()].filter((key) => key.includes(CANONICAL_DRIVERS_COLLECTION)).length,
    0,
  );
});

test('firestore rules deny client writes on new collections', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  for (const name of [
    'canonicalVehicleLeases',
    'canonicalLeaseReceipts',
    'canonicalDrivers',
    'canonicalDriverReceipts',
    'canonicalDriverRosterMeta',
    'canonicalVehicleSaleReceipts',
  ]) {
    assert.match(rules, new RegExp(`match /${name}/\\{`));
  }
  assert.match(rules, /match \/canonicalCashTransactions\/\{transactionId\}[\s\S]*?allow write: if false/);
});
