/**
 * Canonical fleet runtime location — in-memory tests (Step 29AC).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import {
  CANONICAL_FLEET_RUNTIME_POLICY_VERSION,
  CONTRACT_HOME_CITY_WEIGHT_AUTHORITY,
  FLEET_RUNTIME_INITIAL_LOCATION,
  FLEET_RUNTIME_RECOVERY,
  FLEET_RUNTIME_TRANSFER,
  INTERNAL_FIXTURE_RUNTIME_CITY_ID,
  createInternalFixtureRuntime,
  deriveCanonicalFleetAvailabilitySummary,
  isCanonicalFleetRuntimeAllowed,
  planCanonicalFleetRuntimeTransition,
  productionOriginCityWeight,
  validateCanonicalFleetRuntimeState,
} from '../../src/domain/canonicalFleetRuntimeLocation';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3,
  generateCanonicalProductionRoadOffers,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
} from '../../src/domain/canonicalProductionRoadContractIssuance';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';
import type { CanonicalTradableMarketRow } from '../../src/domain/canonicalProductionRoadContractIssuance';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false as const };
    },
    collection(path: string) {
      return { path, _col: true as const };
    },
    async runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string; _col?: boolean }) => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
        docs: Array<{ id?: string; data: () => Record<string, unknown> }>;
      }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>) {
      return operation({
        async get(ref) {
          if (ref._col) {
            const prefix = `${ref.path.replace(/\/$/, '')}/`;
            const docs = [...dump.entries()]
              .filter(([key]) => {
                if (!key.startsWith(prefix)) return false;
                const rest = key.slice(prefix.length);
                return rest.length > 0 && !rest.includes('/');
              })
              .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }));
            return { exists: docs.length > 0, data: () => undefined, docs };
          }
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data, docs: [] };
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
        set(ref, data) {
          dump.set(ref.path, { ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const NOW = 1_700_000_000_000;

function rows(): CanonicalTradableMarketRow[] {
  const out: CanonicalTradableMarketRow[] = [];
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const product = city.products[productId];
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      out.push({
        cityId: city.id,
        productId,
        tradableStock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? product.basePrice,
        targetStock: product.targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      });
    }
  }
  return out;
}

test('gate, city, client fields, and production weights', () => {
  assert.equal(isCanonicalFleetRuntimeAllowed({ envValue: null }), false);
  assert.equal(isCanonicalFleetRuntimeAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ currentCityId: 'ankara' }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ truckStatus: 'idle' }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ activeDeliveryId: 'x' }), false);
  assert.equal(hasOnlyCanonicalProductionRoadIssuanceKeys({ runtimeRevision: 2 }), false);
  assert.equal(validateCanonicalFleetRuntimeState({ currentCityId: 'not-a-city' }).ok, false);
  assert.equal(productionOriginCityWeight('izmir', {
    idleTruckOriginCityIds: ['izmir'],
    busyTruckOriginCityIds: [],
    activeDeliveryDestinationCityIds: [],
    marketOpportunityOriginCityIds: [],
  }), 45);
  assert.equal(productionOriginCityWeight('ankara', {
    idleTruckOriginCityIds: ['izmir'],
    busyTruckOriginCityIds: [],
    activeDeliveryDestinationCityIds: [],
    marketOpportunityOriginCityIds: [],
  }), 5);
  assert.equal(productionOriginCityWeight('bursa', {
    idleTruckOriginCityIds: [],
    busyTruckOriginCityIds: ['bursa'],
    activeDeliveryDestinationCityIds: ['antalya'],
    marketOpportunityOriginCityIds: [],
  }), 15);
  assert.equal(CONTRACT_HOME_CITY_WEIGHT_AUTHORITY, 'CONTRACT_HOME_CITY_WEIGHT_NOT_A_SEPARATE_SCORE');
  assert.equal(FLEET_RUNTIME_INITIAL_LOCATION, 'FLEET_RUNTIME_INITIAL_LOCATION_BLOCKED_HOME_CITY_AUTHORITY');
  assert.equal(FLEET_RUNTIME_TRANSFER, 'FLEET_RUNTIME_TRANSFER_CLIENT_OWNED');
  assert.equal(FLEET_RUNTIME_RECOVERY, 'VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE');
  assert.equal(INTERNAL_FIXTURE_RUNTIME_CITY_ID, 'izmir');
});

test('delivery lifecycle, fuel-out, client failure, and summary', () => {
  const idle = createInternalFixtureRuntime({ assetId: 'truck-1', ownerUid: 'uid-a', serverNowMs: NOW });
  assert.equal(idle.currentCityId, 'izmir');
  assert.equal(idle.runtimeStatus, 'idle');
  const wrong = planCanonicalFleetRuntimeTransition(idle, {
    kind: 'START',
    deliveryId: 'del-1',
    originCityId: 'ankara',
    destinationCityId: 'bursa',
  }, NOW);
  assert.equal(wrong.ok, false);
  const started = planCanonicalFleetRuntimeTransition(idle, {
    kind: 'START',
    deliveryId: 'del-1',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
  }, NOW);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.state.runtimeStatus, 'on_route');
  assert.equal(started.state.currentCityId, 'izmir');
  assert.equal(started.state.runtimeRevision, 2);
  const second = planCanonicalFleetRuntimeTransition(started.state, {
    kind: 'START',
    deliveryId: 'del-2',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
  }, NOW);
  assert.equal(second.ok, false);
  const stranded = planCanonicalFleetRuntimeTransition(started.state, { kind: 'FUEL_OUT' }, NOW);
  assert.equal(stranded.ok, true);
  if (!stranded.ok) return;
  assert.equal(stranded.state.runtimeStatus, 'out_of_fuel');
  assert.equal(stranded.state.currentCityId, 'izmir');
  const resumed = planCanonicalFleetRuntimeTransition(stranded.state, { kind: 'ROADSIDE_REFUEL_RESUME' }, NOW);
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.state.runtimeStatus, 'on_route');
  const clientFail = planCanonicalFleetRuntimeTransition(resumed.state, { kind: 'FAIL_CLIENT_UNVERIFIED' }, NOW);
  assert.equal(clientFail.ok, true);
  if (!clientFail.ok) return;
  assert.equal(clientFail.state.currentCityId, 'izmir');
  assert.equal(clientFail.state.failureLocationClass, 'CLIENT_REPORTED_UNVERIFIED');
  const cancelled = planCanonicalFleetRuntimeTransition(resumed.state, { kind: 'CANCEL' }, NOW);
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) return;
  assert.equal(cancelled.state.runtimeStatus, 'idle');
  assert.equal(cancelled.state.currentCityId, 'izmir');
  const again = planCanonicalFleetRuntimeTransition(resumed.state, {
    kind: 'COMPLETE',
  }, NOW);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.state.runtimeStatus, 'idle');
  assert.equal(again.state.currentCityId, 'ankara');

  const summary = deriveCanonicalFleetAvailabilitySummary([
    { assetId: 'b', capacity: 10, lifecycleStatus: 'ACTIVE', runtime: { ...idle, assetId: 'b', currentCityId: 'ankara' } },
    { assetId: 'a', capacity: 40, lifecycleStatus: 'ACTIVE', runtime: { ...idle, assetId: 'a' } },
    { assetId: 'c', capacity: 25, lifecycleStatus: 'ACTIVE', runtime: started.state },
    { assetId: 'd', capacity: 80, lifecycleStatus: 'SOLD', runtime: idle },
    { assetId: 'e', capacity: 12, lifecycleStatus: 'LEASE_ACTIVE', runtime: { ...idle, assetId: 'e', currentCityId: 'bursa' } },
  ]);
  assert.equal(summary.ok, true);
  if (!summary.ok) return;
  assert.deepEqual(summary.summary.idleOriginCities, ['ankara', 'bursa', 'izmir']);
  assert.equal(summary.summary.idleMaxCapacityTons, 40);
  assert.equal(summary.summary.ownedMaxCapacityTons, 40);
  assert.equal(summary.summary.activeTruckCount, 1);
  assert.equal(summary.summary.busyOriginCities.includes('izmir'), true);
  const missing = deriveCanonicalFleetAvailabilitySummary([
    { assetId: 'old', capacity: 25, lifecycleStatus: 'ACTIVE', runtime: null },
  ]);
  assert.equal(missing.ok, false);
  assert.equal(CANONICAL_FLEET_RUNTIME_POLICY_VERSION, 'canonical-fleet-runtime-location-internal-v1');
});

test('issuance freezes runtime summary and ignores a later city change', async () => {
  const db = createMemoryFirestore();
  db.dump.set('users/uid-a/canonicalCompanyProgression/current', { level: 1, reputation: 0 });
  db.dump.set('users/uid-a/canonicalFleetAssets/truck-1', {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: 'uid-a',
  });
  db.dump.set('users/uid-a', { money: 22_000 });
  for (const row of rows()) {
    db.dump.set(`canonicalWorldMarkets/${row.cityId}_${row.productId}`, {
      cityId: row.cityId,
      productId: row.productId,
      stock: 1,
      epochSupply: row.epochSupply,
      currentPrice: row.currentPrice,
      marketRevision: 1,
      lastAppliedTickIndex: 100,
    });
  }
  const blocked = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, 'FLEET_RUNTIME_LOCATION_UNAVAILABLE');
  db.dump.set(
    'users/uid-a/canonicalFleetRuntime/truck-1',
    createInternalFixtureRuntime({ assetId: 'truck-1', ownerUid: 'uid-a', serverNowMs: NOW }) as unknown as Record<string, unknown>,
  );
  const issued = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  assert.equal(issued.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3);
  const offerKey = [...db.dump.keys()].find((key) => key.includes('canonicalRoadContracts/'));
  assert.ok(offerKey);
  const payment = db.dump.get(offerKey!)!.payment;
  assert.equal(db.dump.get(offerKey!)!.fleetSnapshotClass, 'CANONICAL_RUNTIME_IDLE_ORIGIN');
  db.dump.set('users/uid-a/canonicalFleetRuntime/truck-1', {
    ...db.dump.get('users/uid-a/canonicalFleetRuntime/truck-1')!,
    currentCityId: 'ankara',
  });
  const replay = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.alreadyApplied, true);
  assert.equal(db.dump.get(offerKey!)!.payment, payment);
  assert.equal(db.dump.get('users/uid-a')!.money, 22_000);
  const legacy = generateCanonicalProductionRoadOffers({
    uid: 'uid-a',
    serverNowMs: NOW,
    playerLevel: 1,
    playerReputation: 0,
    ownedMaxTruckCapacity: 25,
    marketRows: rows(),
    fuelPricePerLiter: 1.72,
  });
  assert.equal(legacy.ok, true);
  if (legacy.ok) {
    assert.equal(legacy.offers[0]?.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION);
    assert.equal(legacy.offers[0]?.fleetSnapshotClass, 'CAPACITY_ONLY_LOCATION_UNVERIFIED');
  }
});
