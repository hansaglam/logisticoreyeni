/**
 * Production fleet authority migration — in-memory tests (Step 29L).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { persistCanonicalCatalogFleetAssetTransaction, persistCanonicalStarterFleetAssetTransaction } from '../src/canonicalProductionFleet';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import {
  acceptCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
} from '../src/canonicalRoadDelivery';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import {
  classifyLocalFleetAssetAuthority,
  classifyMarketplaceFleetLineage,
  classifyProductionFleetAuthority,
  deriveCanonicalDeliveryWear,
  deriveCanonicalRepairIntent,
  deriveCanonicalUpgradeIntent,
  hasOnlyCanonicalProductionMintKeys,
  issueCanonicalStarterFleetAsset,
  rejectLegacySaveFleetImport,
  buildCanonicalFleetAssetFromCatalogPurchase,
  buildCanonicalFleetAssetFromMarketplacePurchase,
} from '../../src/domain/canonicalProductionFleet';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import { truckFromCanonicalFleetAsset as truckFromAsset } from '../../src/domain/canonicalRoadFleet';

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

test('auth, mint keys, marketplace blocked, save import rejected', () => {
  assert.equal(hasOnlyCanonicalProductionMintKeys({ canonicalSchemaVersion: 1, condition: 100 }), false);
  assert.equal(hasOnlyCanonicalProductionMintKeys({ catalogModelId: 'truck-ford-cargo', purchaseId: 'p1', canonicalSchemaVersion: 1 }), true);
  assert.equal(classifyLocalFleetAssetAuthority({ id: 'truck-starter-1', fleetAuthorityClass: 'SERVER_CANONICAL' }), 'LEGACY_CLIENT_UNVERIFIED');
  assert.equal(rejectLegacySaveFleetImport().reason, 'LEGACY_CLIENT_FLEET_UNVERIFIED');
  assert.equal(buildCanonicalFleetAssetFromMarketplacePurchase().ok, false);
  assert.equal(classifyMarketplaceFleetLineage(), 'MARKETPLACE_CANONICAL_FLEET_IDENTITY_READY_ECONOMICS_BLOCKED');
  assert.equal(issueCanonicalStarterFleetAsset({ uid: '', nowMs: 1 }).ok, false);
});

test('catalog and starter mint ignore client economics; no cash', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 20_000 });
  db.dump.set('users/uid-a', { money: 99_000 });
  const starter = await persistCanonicalStarterFleetAssetTransaction(db, 'uid-a', 10);
  assert.equal(starter.ok, true);
  if (!starter.ok) return;
  const again = await persistCanonicalStarterFleetAssetTransaction(db, 'uid-a', 20);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.alreadyCreated, true);
  const catalog = await persistCanonicalCatalogFleetAssetTransaction(
    db,
    'uid-a',
    'truck-ford-cargo',
    'buy1',
    30,
  );
  assert.equal(catalog.ok, true);
  if (!catalog.ok) return;
  const path = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${catalog.assetId}`;
  const doc = db.dump.get(path) as { economicCondition: number; economicUpgradeIds: { engine: number }; authorityClass: string };
  assert.equal(doc.authorityClass, 'SERVER_CANONICAL');
  assert.equal(doc.economicUpgradeIds.engine, 0);
  assert.equal(classifyProductionFleetAuthority(doc as never), 'SERVER_CANONICAL_READY');
  const trailer = await persistCanonicalCatalogFleetAssetTransaction(
    db,
    'uid-a',
    'trailer-standard',
    't1',
    40,
    'TRAILER',
  );
  assert.equal(trailer.ok, true);
  const unauth = await persistCanonicalCatalogFleetAssetTransaction(db, '', 'truck-ford-cargo', 'x', 1);
  assert.equal(unauth.ok, false);
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 20_000);
  assert.equal(db.dump.get('users/uid-a')?.money, 99_000);
});

test('revision freeze vs later mutation; production accept; cross-user', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 20_000 });
  const minted = await persistCanonicalCatalogFleetAssetTransaction(db, 'uid-a', 'truck-ford-cargo', 'rev1', 1);
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: minted.assetId,
    },
    10_000,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const dPath = `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`;
  const delivery = db.dump.get(dPath) as {
    executionEconomicsSnapshot: { truckEconomicProfile: { economicRevision: number; condition: number } };
  };
  assert.equal(delivery.executionEconomicsSnapshot.truckEconomicProfile.economicRevision, 1);
  const aPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${minted.assetId}`;
  const asset = db.dump.get(aPath) as Parameters<typeof applyTrustedCanonicalFleetRevision>[0];
  assert.equal(asset.economicRevision, 1);
  assert.equal(delivery.executionEconomicsSnapshot.truckEconomicProfile.condition, asset.economicCondition);

  const issued2 = await issueCanonicalRoadContractTransaction(db, 'uid-a', { ...ISSUANCE, sequence: 2 }, 2);
  assert.equal(issued2.ok, true);
  if (!issued2.ok) return;
  const reserved = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued2.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: minted.assetId,
    },
    11_000,
  );
  assert.equal(reserved.ok, false);
  if (!reserved.ok) assert.equal(reserved.reason, 'ASSET_RESERVED_BY_OTHER_DELIVERY');

  const issuedB = await issueCanonicalRoadContractTransaction(db, 'uid-b', { ...ISSUANCE, sequence: 9 }, 3);
  assert.equal(issuedB.ok, true);
  if (!issuedB.ok) return;
  const cross = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-b',
    {
      contractId: issuedB.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: minted.assetId,
    },
    12_000,
  );
  assert.equal(cross.ok, false);
});

test('29K fixtures still seed; wear/repair/upgrade derive without client amounts', async () => {
  const db = createMemoryFirestore();
  const boot = await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(boot.ok, true);
  const catalog = buildCanonicalFleetAssetFromCatalogPurchase({
    uid: 'uid-a',
    catalogModelId: 'truck-ford-cargo',
    purchaseId: 'w1',
    nowMs: 1,
  });
  assert.equal(catalog.ok, true);
  if (!catalog.ok) return;
  const truck = truckFromAsset(catalog.asset);
  const wear = deriveCanonicalDeliveryWear({
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    productId: 'steel',
    amount: 10,
    distanceKm: 155,
    truck,
  });
  assert.equal(wear.ok, true);
  const repair = deriveCanonicalRepairIntent(truck);
  assert.equal(repair.targetCondition, 100);
  const upgrade = deriveCanonicalUpgradeIntent(truck, 'engine');
  assert.ok(upgrade.derivedCost >= 0);
});

test('no production mint callable; rules deny fleet writes', () => {
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const registerFleetAsset'), false);
  assert.equal(index.includes('export const updateCanonicalTruck'), false);
  assert.equal(index.includes('export const issueCanonicalStarterFleet'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalFleetAssets\/\{assetId\}[\s\S]*?allow write: if false/);
  assert.match(rules, /match \/canonicalFleetMutationReceipts\/\{receiptId\}[\s\S]*?allow write: if false/);
});
