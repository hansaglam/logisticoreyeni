import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';

import { mergeCloudFleetIntoExistingMarketplaceState } from '../src/authoritativeFleetReconciliation';
import type {
  MarketplacePlayerState,
  MarketplaceVehicleRecord,
} from '../src/vehicleMarketplaceTypes';

function vehicle(
  truckId: string,
  overrides: Partial<MarketplaceVehicleRecord> = {},
): MarketplaceVehicleRecord {
  return {
    truckId,
    templateId: 'truck-ford-cargo',
    customName: `Truck ${truckId}`,
    currentCityId: 'izmir',
    condition: 90,
    totalMileageKm: 10_000,
    currentFuelL: 100,
    fuelTankCapacityL: 300,
    purchasePrice: 52_000,
    ownershipType: 'owned',
    status: 'idle',
    assignedDriverId: null,
    attachedTrailerId: null,
    activeJobIds: [],
    marketplaceListingId: null,
    upgrades: { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 },
    ...overrides,
  };
}

function state(
  overrides: Partial<MarketplacePlayerState> = {},
): MarketplacePlayerState {
  return {
    ownerUid: 'buyer',
    canonicalCash: 100_000,
    fleetLimit: 10,
    stateVersion: 4,
    sourceSaveVersion: 7,
    ownedTruckSnapshots: [vehicle('starter')],
    activeListingIds: [],
    soldTruckTombstones: [],
    updatedAt: Timestamp.fromMillis(1_000),
    ...overrides,
  };
}

test('stale cloud save cannot undo a committed marketplace purchase', () => {
  const existing = state({
    canonicalCash: 80_000,
    ownedTruckSnapshots: [vehicle('starter'), vehicle('purchased-market-truck')],
    stateVersion: 5,
    updatedAt: Timestamp.fromMillis(5_000),
  });
  const fromCloud = state({
    canonicalCash: 100_000,
    ownedTruckSnapshots: [vehicle('starter')],
    sourceSaveVersion: 7,
    updatedAt: Timestamp.fromMillis(9_000),
  });

  const merged = mergeCloudFleetIntoExistingMarketplaceState(
    existing,
    fromCloud,
    Timestamp.fromMillis(10_000),
  );

  assert.equal(merged.canonicalCash, 80_000);
  assert.deepEqual(
    merged.ownedTruckSnapshots.map((truck) => truck.truckId).sort(),
    ['purchased-market-truck', 'starter'],
  );
});
