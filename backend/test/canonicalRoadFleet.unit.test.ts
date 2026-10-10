/**
 * Canonical ROAD fleet economic authority — in-memory Firestore tests (Step 29J).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  bootstrapInternalCanonicalFleetFixturesTransaction,
  canonicalFleetAssetPath,
} from '../src/canonicalFleet';
import {
  acceptCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
} from '../src/canonicalRoadDelivery';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import {
  CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
  CANONICAL_FLEET_ECONOMICS_PACKAGE_HASH,
  hasOnlyCanonicalFleetBootstrapKeys,
  isCanonicalRoadInternalFleetBootstrapAllowed,
  type CanonicalFleetAssetDocument,
} from '../../src/domain/canonicalRoadFleet';
import {
  CANONICAL_ROAD_TRUCK_FIXTURES,
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

test('bootstrap gate, keys, schema', async () => {
  assert.equal(isCanonicalRoadInternalFleetBootstrapAllowed({ envValue: null }), false);
  assert.equal(isCanonicalRoadInternalFleetBootstrapAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(CANONICAL_FLEET_ASSET_SCHEMA_VERSION, 1);
  assert.equal(typeof CANONICAL_FLEET_ECONOMICS_PACKAGE_HASH, 'string');
  assert.equal(hasOnlyCanonicalFleetBootstrapKeys({ canonicalSchemaVersion: 1, condition: 100 }), false);
  const db = createMemoryFirestore();
  const denied = await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, {
    envValue: null,
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, 'FLEET_AUTHORITY_NOT_AVAILABLE');
  const unauth = await bootstrapInternalCanonicalFleetFixturesTransaction(db, '', 1, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(unauth.ok, false);
});

test('bootstrap idempotent; conflict; no cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 44_000 });
  db.dump.set('users/uid-a/canonicalCashTransactions/keep', { amount: 9 });
  const first = await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 10, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.alreadyBootstrapped, false);
  const second = await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 20, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.alreadyBootstrapped, true);
  const path = canonicalFleetAssetPath('uid-a', 'fixture-healthy');
  const healthy = db.dump.get(path) as CanonicalFleetAssetDocument;
  db.dump.set(path, { ...healthy, economicCondition: 1 });
  const conflict = await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 30, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.reason, 'CANONICAL_FLEET_ASSET_CONFLICT');
  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 44_000);
  assert.equal(db.dump.get('users/uid-a/canonicalCashTransactions/keep')?.amount, 9);
});

test('accept uses server fleet economics; legacy and cross-user rejected; snapshot frozen', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/serverState/current', { cash: 12_000 });
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const missing = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    2,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, 'CANONICAL_TRUCK_NOT_FOUND');

  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 3, {
    envValue: 'INTERNAL_TEST',
  });
  const legacy = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'truck-starter-1',
    },
    4,
  );
  assert.equal(legacy.ok, false);
  if (!legacy.ok) assert.equal(legacy.reason, 'LEGACY_CLIENT_FLEET_UNVERIFIED');

  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-degraded',
      selectedTrailerId: 'fixture-standard',
    },
    5,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const deliveryPath = `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`;
  const delivery = db.dump.get(deliveryPath) as {
    executionEconomicsSnapshot: {
      truckEconomicProfile: { condition: number; economicRevision: number; source: string };
      trailerEconomicProfile: { trailerId: string | null; economicRevision: number | null };
      maintenanceSnapshot: { bundle: number; trailer: number; toll: number };
    };
  };
  assert.equal(delivery.executionEconomicsSnapshot.truckEconomicProfile.source, 'CANONICAL_FLEET_ASSET');
  assert.equal(delivery.executionEconomicsSnapshot.truckEconomicProfile.condition, 35);
  assert.equal(delivery.executionEconomicsSnapshot.truckEconomicProfile.economicRevision, 1);
  assert.equal(delivery.executionEconomicsSnapshot.trailerEconomicProfile.trailerId, 'fixture-standard');
  const local = freezeCanonicalRoadExecutionEconomics({
    contract: issued.snapshot,
    selectedTruckId: 'fixture-degraded',
    selectedTrailerId: 'fixture-standard',
  });
  assert.equal(local.ok, true);
  if (!local.ok) return;
  assert.equal(
    delivery.executionEconomicsSnapshot.maintenanceSnapshot.bundle,
    local.snapshot.maintenanceSnapshot.bundle,
  );
  assert.equal(
    delivery.executionEconomicsSnapshot.maintenanceSnapshot.toll,
    local.snapshot.maintenanceSnapshot.toll,
  );

  const truckPath = canonicalFleetAssetPath('uid-a', 'fixture-degraded');
  const asset = db.dump.get(truckPath) as CanonicalFleetAssetDocument;
  db.dump.set(truckPath, { ...asset, economicCondition: 100, economicRevision: 9 });
  const storedAgain = db.dump.get(deliveryPath) as {
    executionEconomicsSnapshot: { truckEconomicProfile: { condition: number; economicRevision: number } };
  };
  assert.equal(storedAgain.executionEconomicsSnapshot.truckEconomicProfile.condition, 35);
  assert.equal(storedAgain.executionEconomicsSnapshot.truckEconomicProfile.economicRevision, 1);
  assert.equal(db.dump.get('users/uid-a/serverState/current')?.cash, 12_000);

  const issuedB = await issueCanonicalRoadContractTransaction(db, 'uid-b', { ...ISSUANCE, sequence: 9 }, 6);
  assert.equal(issuedB.ok, true);
  if (!issuedB.ok) return;
  const cross = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-b',
    {
      contractId: issuedB.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: 'fixture-healthy',
    },
    7,
  );
  assert.equal(cross.ok, false);
  if (!cross.ok) assert.equal(cross.reason, 'CANONICAL_TRUCK_NOT_FOUND');
});

test('healthy/upgraded/no-trailer parity vs in-memory fixtures', () => {
  const issued = {
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    originMarket: ISSUANCE.originMarket,
    destinationMarket: ISSUANCE.destinationMarket,
    fuelPricePerLiter: 1.72,
    sequence: 4,
  };
  return issueCanonicalRoadContractTransaction(createMemoryFirestore(), 'uid-p', issued, 1).then(
    (wrap) => {
      assert.equal(wrap.ok, true);
      if (!wrap.ok) return;
      for (const truckId of ['fixture-healthy', 'fixture-degraded', 'fixture-upgraded'] as const) {
        const frozen = freezeCanonicalRoadExecutionEconomics({
          contract: wrap.snapshot,
          selectedTruckId: truckId,
        });
        assert.equal(frozen.ok, true, truckId);
        if (!frozen.ok) continue;
        assert.equal(frozen.snapshot.truckEconomicProfile.condition, CANONICAL_ROAD_TRUCK_FIXTURES[truckId]!.condition);
      }
    },
  );
});

test('rules deny fleet writes; bootstrap callable gated in index', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalFleetAssets\/\{assetId\}[\s\S]*?allow write: if false/);
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const bootstrapInternalCanonicalFleetFixtures'), true);
  assert.equal(index.includes('CANONICAL_ROAD_INTERNAL_TEST'), true);
  assert.equal(index.includes('export const applyCashDelta'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
});
