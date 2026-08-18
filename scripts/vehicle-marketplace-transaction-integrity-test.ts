/**
 * Two-user marketplace transaction integrity (client reconcile + stale cloud guards).
 * Run: npx tsx scripts/vehicle-marketplace-transaction-integrity-test.ts
 */
import './test-globals';

import { STARTER_TRUCK } from '../src/data/trucks';
import { resolveStaleCloudMarketplaceOverwrite } from '../src/domain/vehicleMarketplaceCloudMerge';
import { reconcileFleetWithVehicleMarketplace } from '../src/domain/vehicleMarketplaceReconciliation';
import {
  planMarketplaceStartupReconcile,
} from '../src/domain/vehicleMarketplaceStartupReconcile';
import { resolveCashAfterMarketplaceReconcile } from '../src/config/testMoneySyncPure';
import type { Truck } from '../src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const TRUCK_A = 'truckA';
const PRICE = 41_000;
const FEE_RATE = 0.06;
const FEE = Math.round(PRICE * FEE_RATE * 100) / 100;
const SELLER_NET = PRICE - FEE;

function vehicleSnapshot(truckId: string) {
  return {
    truckId,
    templateId: 'truck-ford-cargo',
    currentCityId: 'izmir' as const,
    condition: 90,
    totalMileageKm: 10_000,
    currentFuelL: 100,
    fuelTankCapacityL: 300,
    purchasePrice: 52_000,
    ownershipType: 'owned' as const,
    status: 'idle' as const,
  };
}

function applyAuthoritative(
  localTrucks: Truck[],
  localCash: number,
  authoritative: {
    marketplaceStateVersion: number;
    cash: number;
    soldTruckIds: string[];
    vehicles: ReturnType<typeof vehicleSnapshot>[];
  },
) {
  const fleet = reconcileFleetWithVehicleMarketplace(localTrucks, authoritative);
  const money = resolveCashAfterMarketplaceReconcile({
    localCash,
    authoritativeCash: fleet.authoritativeCash,
    acceptedTestRemoteMoney: null,
    testMoneySyncEnabled: false,
  });
  return { trucks: fleet.trucks, money, cache: fleet.cache };
}

console.log('\n=== Vehicle Marketplace Transaction Integrity ===\n');

console.log('Two-user purchase (authoritative reconcile)');
{
  const sellerTrucksBefore: Truck[] = [{
    ...structuredClone(STARTER_TRUCK),
    id: TRUCK_A,
    catalogId: 'truck-ford-cargo',
    name: 'Truck A',
  }];
  const buyerTrucksBefore: Truck[] = [];

  const sellerAuthoritative = {
    marketplaceStateVersion: 2,
    cash: 10_000 + SELLER_NET,
    soldTruckIds: [TRUCK_A],
    vehicles: [] as ReturnType<typeof vehicleSnapshot>[],
  };
  const buyerAuthoritative = {
    marketplaceStateVersion: 3,
    cash: 100_000 - PRICE,
    soldTruckIds: [] as string[],
    vehicles: [vehicleSnapshot(TRUCK_A)],
  };

  const sellerAfter = applyAuthoritative(sellerTrucksBefore, 10_000, sellerAuthoritative);
  const buyerAfter = applyAuthoritative(buyerTrucksBefore, 100_000, buyerAuthoritative);

  assert(sellerAfter.money === 10_000 + SELLER_NET, 'seller cash credited (net of fee)');
  assert(!sellerAfter.trucks.some((truck) => truck.id === TRUCK_A), 'seller fleet no longer contains truckA');
  assert(buyerAfter.money === 100_000 - PRICE, 'buyer cash debited');
  assert(
    buyerAfter.trucks.filter((truck) => truck.id === TRUCK_A).length === 1,
    'buyer fleet contains truckA exactly once',
  );

  const buyerRestart = applyAuthoritative(buyerAfter.trucks, buyerAfter.money, buyerAuthoritative);
  assert(
    buyerRestart.trucks.filter((truck) => truck.id === TRUCK_A).length === 1,
    'buyer restart reconcile does not duplicate truckA',
  );
  assert(buyerRestart.money === buyerAfter.money, 'buyer restart keeps debited cash');

  const sellerRestart = applyAuthoritative(sellerAfter.trucks, sellerAfter.money, sellerAuthoritative);
  assert(!sellerRestart.trucks.some((truck) => truck.id === TRUCK_A), 'seller restart keeps truck removed');
  assert(sellerRestart.money === sellerAfter.money, 'seller restart keeps sale proceeds');
}

console.log('\nOffline seller startup reconcile');
{
  const localTrucks: Truck[] = [{
    ...structuredClone(STARTER_TRUCK),
    id: TRUCK_A,
    catalogId: 'truck-ford-cargo',
    name: 'Truck A',
  }];
  const authoritative = {
    marketplaceStateVersion: 5,
    cash: 10_000 + SELLER_NET,
    fleetLimit: 10,
    soldTruckIds: [TRUCK_A],
    vehicles: [] as ReturnType<typeof vehicleSnapshot>[],
  };
  const plan = planMarketplaceStartupReconcile({
    localTruckIds: localTrucks.map((truck) => truck.id),
    localCash: 10_000,
    localMarketplaceStateVersion: 4,
    acknowledgedVehicleIds: [],
    authoritative,
  });
  assert(plan.shouldApply, 'seller offline sale triggers startup reconcile');
  const applied = applyAuthoritative(localTrucks, 10_000, authoritative);
  assert(!applied.trucks.some((truck) => truck.id === TRUCK_A), 'offline seller truck removed on reconcile');
  assert(applied.money === 10_000 + SELLER_NET, 'offline seller proceeds applied');
}

console.log('\nStale cloud save must not undo marketplace mutation');
{
  const sellerMerge = resolveStaleCloudMarketplaceOverwrite({
    existingCash: 10_000 + SELLER_NET,
    cloudCash: 10_000,
    existingVehicleIds: [],
    cloudVehicleIds: [TRUCK_A],
    soldTruckIds: [TRUCK_A],
  });
  assert(sellerMerge.cash === 10_000 + SELLER_NET, 'seller stale cloud cannot erase proceeds');
  assert(!sellerMerge.preservedVehicleIds.includes(TRUCK_A), 'seller stale cloud cannot restore sold truck');

  const buyerMerge = resolveStaleCloudMarketplaceOverwrite({
    existingCash: 100_000 - PRICE,
    cloudCash: 100_000,
    existingVehicleIds: [TRUCK_A],
    cloudVehicleIds: [],
    soldTruckIds: [],
  });
  assert(buyerMerge.cash === 100_000 - PRICE, 'buyer stale cloud cannot restore pre-purchase cash');
  assert(buyerMerge.preservedVehicleIds.includes(TRUCK_A), 'buyer stale cloud cannot remove purchased truck');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('vehicle-marketplace-transaction-integrity-test: PASSED\n');
