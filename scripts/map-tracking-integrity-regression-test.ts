/**
 * Map tracking integrity / ghost marker recovery.
 * Run: npx tsx scripts/map-tracking-integrity-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';

import { buildVisibleMapMarkers } from '../src/components/map/mapMarkerState';
import {
  formatMapSyncToast,
  getCanonicalValidMapVehicleIds,
  reconcileMapTrackingState,
  validateVehicleTrackingIntegrity,
} from '../src/domain/mapTrackingIntegrity';
import {
  getVisibleFleetTrucks,
  processExpiredRentalTrucks,
} from '../src/simulation/rentalTruckLifecycle';
import type { Contract, Delivery, Driver, Player, Truck, TruckTransfer } from '../src/types/game';

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

function makeOwnedTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'owned-1',
    name: 'Owned Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
    ownershipType: 'owned',
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'on_route',
    ...overrides,
  };
}

function makeRentalTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'lease-1',
    name: 'Ghost Rental',
    capacity: 18,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 80,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 80,
    purchasePrice: 0,
    ownershipType: 'leased',
    leaseExpiresAt: 200,
    leaseExpired: false,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'on_route',
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'del-1',
    contractId: 'con-1',
    truckId: 'owned-1',
    driverId: 'drv-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'electronics',
    cargoWeight: 8,
    amount: 8,
    status: 'on_route',
    progress: 0.4,
    startedAt: 10,
    travelHours: 8,
    fuelCost: 120,
    estimatedArrivalTime: 18,
    ...overrides,
  } as Delivery;
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'con-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'electronics',
    amount: 8,
    cargoWeight: 8,
    payment: 1500,
    deadlineHours: 24,
    distanceKm: 480,
    urgency: 0.2,
    status: 'active',
    createdAt: 0,
    expiresAt: 48,
    ...overrides,
  } as Contract;
}

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'drv-1',
    name: 'Ali',
    salaryPerDay: 100,
    status: 'driving',
    assignedTruckId: 'owned-1',
    ...overrides,
  } as Driver;
}

function makePlayer(trucks: Truck[], extras: Partial<Player> = {}): Player {
  return {
    companyName: 'Test Lojistik',
    money: 40_000,
    companyLevel: 2,
    level: 2,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    homeCityId: 'izmir',
    reputation: 60,
    completedContracts: 1,
    trucks,
    drivers: extras.drivers ?? [makeDriver({ assignedTruckId: trucks[0]?.id ?? null })],
    warehouses: [],
    ...extras,
  };
}

function integrityInput(params: {
  currentTime?: number;
  trucks: Truck[];
  deliveries?: Delivery[];
  contracts?: Contract[];
  transfers?: TruckTransfer[];
  playerExtras?: Partial<Player>;
}) {
  return {
    currentTime: params.currentTime ?? 100,
    player: makePlayer(params.trucks, params.playerExtras),
    activeDeliveries: params.deliveries ?? [],
    contracts: params.contracts ?? [],
    activeTransfers: params.transfers ?? [],
    activeWarehouseStockTransfers: [],
  };
}

function visibleMarkers(deliveries: Delivery[], trucks: Truck[], currentTime = 100) {
  const validTruckIds = getCanonicalValidMapVehicleIds({
    trucks,
    currentTime,
    activeDeliveries: deliveries,
  });
  return buildVisibleMapMarkers({
    activeDeliveries: deliveries,
    activeTransfers: [],
    validTruckIds,
  });
}

console.log('\n=== Map Tracking Integrity Regression ===\n');

console.log('TEST 1 — owned active vehicle remains');
{
  const truck = makeOwnedTruck();
  const delivery = makeDelivery();
  const input = integrityInput({
    trucks: [truck],
    deliveries: [delivery],
    contracts: [makeContract()],
  });
  const report = validateVehicleTrackingIntegrity(input);
  const result = reconcileMapTrackingState(input);
  const markers = visibleMarkers(result.activeDeliveries, result.player.trucks);
  assert(report.issueCount === 0, 'owned active job has no integrity issues');
  assert(!result.changed, 'owned active job is not mutated');
  assert(result.activeDeliveries[0]?.status === 'on_route', 'owned delivery remains on_route');
  assert(markers.deliveries.length === 1, 'owned vehicle stays on the map');
  assert(markers.deliveries[0]?.truckId === 'owned-1', 'owned marker uses vehicleId');
}

console.log('\nTEST 2 — valid rental with active delivery remains');
{
  const truck = makeRentalTruck({ leaseExpiresAt: 200 });
  const delivery = makeDelivery({ truckId: truck.id, contractId: 'con-rental' });
  const input = integrityInput({
    currentTime: 100,
    trucks: [truck],
    deliveries: [delivery],
    contracts: [makeContract({ id: 'con-rental' })],
  });
  const result = reconcileMapTrackingState(input);
  const markers = visibleMarkers(result.activeDeliveries, result.player.trucks, 100);
  assert(result.player.trucks.length === 1, 'valid rental stays in fleet');
  assert(result.activeDeliveries[0]?.status === 'on_route', 'valid rental delivery remains');
  assert(markers.deliveries.length === 1, 'valid rental stays on the map');
}

console.log('\nTEST 3 — rental expires, fleet removal, ghost marker gone');
{
  const expired = makeRentalTruck({ leaseExpiresAt: 50, status: 'on_route' });
  const expiry = processExpiredRentalTrucks({
    player: { trucks: [expired], drivers: [], trailers: [] },
    activeDeliveries: [],
    currentTime: 100,
    source: 'game-tick',
  });
  assert(expiry.player.trucks.length === 0, 'expired rental without delivery is removed from fleet');

  const ghostDelivery = makeDelivery({
    id: 'ghost-del',
    contractId: 'ghost-con',
    truckId: expired.id,
    status: 'on_route',
  });
  const markersBefore = buildVisibleMapMarkers({
    activeDeliveries: [ghostDelivery],
    activeTransfers: [],
  });
  assert(markersBefore.deliveries.length === 1, 'unfiltered leftover delivery would still draw a marker');

  const markersAfter = visibleMarkers([ghostDelivery], expiry.player.trucks, 100);
  assert(markersAfter.deliveries.length === 0, 'derived map hides marker for missing rental vehicle');
}

console.log('\nTEST 4 — old save ghost self-heals');
{
  const ghostDelivery = makeDelivery({
    id: 'old-ghost',
    contractId: 'old-con',
    truckId: 'missing-lease',
    status: 'on_route',
  });
  const owned = makeOwnedTruck({ status: 'idle' });
  const input = integrityInput({
    trucks: [owned],
    deliveries: [ghostDelivery, makeDelivery({ id: 'keep-del', truckId: owned.id, status: 'on_route' })],
    contracts: [
      makeContract({ id: 'old-con' }),
      makeContract({ id: 'con-1' }),
    ],
  });
  const report = validateVehicleTrackingIntegrity(input);
  const result = reconcileMapTrackingState(input);
  const markers = visibleMarkers(result.activeDeliveries, result.player.trucks);
  assert(
    report.orphanDeliveries.some((item) => item.kind === 'ORPHAN_DELIVERY_MISSING_VEHICLE'),
    'old save ghost classified as orphan delivery',
  );
  assert(
    result.activeDeliveries.find((item) => item.id === 'old-ghost')?.status === 'cancelled',
    'ghost delivery cancelled without recreating the vehicle',
  );
  assert(result.player.trucks.every((truck) => truck.id !== 'missing-lease'), 'missing rental is not recreated');
  assert(
    result.activeDeliveries.find((item) => item.id === 'keep-del')?.status === 'on_route',
    'valid delivery preserved during old-save heal',
  );
  assert(markers.deliveries.length === 1, 'only the valid vehicle remains on the map');
  assert(markers.deliveries[0]?.truckId === owned.id, 'remaining marker is the owned vehicle');
}

console.log('\nTEST 5 — completed delivery marker removed');
{
  const truck = makeOwnedTruck();
  const completed = makeDelivery({ status: 'completed', progress: 1 });
  const markers = visibleMarkers([completed], [truck]);
  assert(markers.deliveries.length === 0, 'completed delivery is not drawn');
}

console.log('\nTEST 6 — duplicate markers deduped by vehicleId');
{
  const truck = makeOwnedTruck();
  const first = makeDelivery({ id: 'dup-a', progress: 0.2 });
  const second = makeDelivery({ id: 'dup-b', progress: 0.8, contractId: 'con-2' });
  const markers = buildVisibleMapMarkers({
    activeDeliveries: [first, second],
    activeTransfers: [],
    validTruckIds: new Set([truck.id]),
  });
  assert(markers.deliveries.length === 1, 'same vehicleId draws a single canvas marker');
  assert(markers.deliveries[0]?.delivery.id === 'dup-a', 'first remaining running job is kept on the canvas');

  const result = reconcileMapTrackingState(
    integrityInput({
      trucks: [truck],
      deliveries: [first, second],
      contracts: [makeContract(), makeContract({ id: 'con-2' })],
    }),
  );
  const kept = result.activeDeliveries.filter((item) => item.status === 'on_route');
  const cancelled = result.activeDeliveries.filter((item) => item.status === 'cancelled');
  assert(kept.length === 1, 'one canonical delivery kept');
  assert(kept[0]?.id === 'dup-b', 'higher progress delivery is the canonical entry');
  assert(cancelled.length === 1, 'extra duplicate delivery cancelled');
  assert(cancelled[0]?.id === 'dup-a', 'lower progress duplicate was the extra');
}

console.log('\nTEST 7 — orphan delivery missing vehicle is classified and recovered');
{
  const ghost = makeDelivery({ truckId: 'gone-truck', contractId: 'gone-con' });
  const input = integrityInput({
    trucks: [],
    deliveries: [ghost],
    contracts: [makeContract({ id: 'gone-con' })],
    playerExtras: {
      money: 40_000,
      drivers: [makeDriver({ assignedTruckId: 'gone-truck' })],
    },
  });
  const report = validateVehicleTrackingIntegrity(input);
  const result = reconcileMapTrackingState(input);
  assert(report.orphanDeliveries[0]?.kind === 'ORPHAN_DELIVERY_MISSING_VEHICLE', 'orphan kind classified');
  assert(report.missingVehicles.includes('gone-truck'), 'missing vehicle id recorded');
  assert(result.activeDeliveries[0]?.status === 'cancelled', 'orphan delivery cancelled via recovery-style cleanup');
  assert(result.activeDeliveries[0]?.failureReason === 'cancelled', 'no fail-penalty failure reason');
  assert(result.contracts[0]?.status === 'failed', 'orphan contract closed');
  assert(result.player.trucks.length === 0, 'vehicle is not silently recreated');
  assert(result.player.money === 40_000, 'orphan cleanup does not charge cash');
  assert(result.player.drivers[0]?.assignedTruckId == null, 'driver assignment to missing truck cleared');
}

console.log('\nTEST 8 — manual sync keeps valid jobs and removes stale only');
{
  const owned = makeOwnedTruck();
  const validDelivery = makeDelivery();
  const stale = makeDelivery({
    id: 'stale-del',
    contractId: 'stale-con',
    truckId: 'expired-lease',
  });
  const input = integrityInput({
    trucks: [owned],
    deliveries: [validDelivery, stale],
    contracts: [makeContract(), makeContract({ id: 'stale-con' })],
    playerExtras: { money: 40_000 },
  });
  const result = reconcileMapTrackingState(input);
  assert(result.activeDeliveries.find((item) => item.id === 'del-1')?.status === 'on_route', 'valid delivery not reset');
  assert(result.activeDeliveries.find((item) => item.id === 'stale-del')?.status === 'cancelled', 'stale delivery removed');
  assert(result.player.trucks.length === 1, 'valid fleet vehicle kept');
  assert(result.player.money === 40_000, 'manual sync does not reset economy');
  assert(result.fixedCount >= 1, 'manual sync reports a fix count');
  const toast = formatMapSyncToast({
    fixedCount: result.fixedCount,
    removedExpiredRentals: 0,
  });
  assert(toast.includes('Harita senkronize edildi'), 'manual toast uses sync wording');
  assert(!toast.toLowerCase().includes('sıfırla'), 'toast does not say reset');
}

console.log('\nTEST 9 — cleaned state stays correct after restart/hydrate-style pass');
{
  const owned = makeOwnedTruck();
  const validDelivery = makeDelivery();
  const stale = makeDelivery({
    id: 'hydrate-ghost',
    contractId: 'hydrate-con',
    truckId: 'gone-rental',
  });
  const first = reconcileMapTrackingState(
    integrityInput({
      trucks: [owned],
      deliveries: [validDelivery, stale],
      contracts: [makeContract(), makeContract({ id: 'hydrate-con' })],
    }),
  );
  const second = reconcileMapTrackingState({
    ...first,
    currentTime: 100,
  });
  const markers = visibleMarkers(second.activeDeliveries, second.player.trucks);
  assert(!second.changed, 'second hydrate-style pass is idempotent');
  assert(second.report.issueCount === 0, 'cleaned save has no remaining map issues');
  assert(markers.deliveries.length === 1, 'cleaned map still shows the valid vehicle after restart');
  assert(
    formatMapSyncToast({ inspectedOnly: true, fixedCount: 0 }) === 'Harita durumu güncel.',
    'healthy inspect toast',
  );
}

console.log('\nExpired rental still associated with tracking state');
{
  const expiredOnRoute = makeRentalTruck({ leaseExpiresAt: 40, status: 'on_route' });
  const expiry = processExpiredRentalTrucks({
    player: { trucks: [expiredOnRoute], drivers: [], trailers: [] },
    activeDeliveries: [],
    currentTime: 100,
    source: 'hydrate-rental-expiry',
  });
  const leftover = makeDelivery({ truckId: expiredOnRoute.id, contractId: 'left-con' });
  const healed = reconcileMapTrackingState(
    integrityInput({
      trucks: expiry.player.trucks,
      deliveries: [leftover],
      contracts: [makeContract({ id: 'left-con' })],
    }),
  );
  const fleetVisible = getVisibleFleetTrucks(healed.player.trucks, 100, healed.activeDeliveries);
  const markers = visibleMarkers(healed.activeDeliveries, healed.player.trucks, 100);
  assert(expiry.player.trucks.length === 0, 'hydrate expiry removes stale on_route rental with no job');
  assert(healed.activeDeliveries[0]?.status === 'cancelled', 'leftover delivery enters recovery/cancel flow');
  assert(fleetVisible.length === 0, 'tracking list no longer includes the expired rental');
  assert(markers.deliveries.length === 0, 'canvas marker for expired rental is gone');
}

console.log('\nToasts and copy');
{
  assert(formatMapSyncToast({ fixedCount: 0 }) === 'Harita senkronize edildi.', 'healthy manual sync toast');
  assert(
    formatMapSyncToast({ fixedCount: 2, removedExpiredRentals: 2 }) === '2 eski araç kaydı temizlendi.',
    'expired-only cleanup toast',
  );
  assert(
    formatMapSyncToast({ inspectedOnly: true, fixedCount: 3 }) === '3 tutarsız kayıt bulundu.',
    'inspect found-issues toast',
  );
}

console.log('\nWiring');
{
  const root = resolve(process.cwd());
  const store = readFileSync(resolve(root, 'src/store/gameStore.ts'), 'utf8');
  const mapScreen = readFileSync(resolve(root, 'src/screens/MapScreen.tsx'), 'utf8');
  const helpMenu = readFileSync(resolve(root, 'src/components/map/MapHelpMenu.tsx'), 'utf8');
  const canvas = readFileSync(resolve(root, 'src/components/map/WorldMapCanvas.tsx'), 'utf8');
  assert(store.includes("processExpiredLeases('hydrate-rental-expiry')"), 'hydrate still expires rentals');
  assert(store.includes("reconcileMapTracking('hydrate')"), 'hydrate also reconciles map tracking');
  assert(store.includes("reconcileMapTracking:"), 'store exposes reconcileMapTracking');
  assert(store.includes("inspectMapTracking:"), 'store exposes inspectMapTracking');
  assert(mapScreen.includes("reconcileMapTracking('map-open')"), 'map open self-heals');
  assert(mapScreen.includes('validTruckIds'), 'map canvas receives canonical vehicle ids');
  assert(canvas.includes('validTruckIds'), 'canvas forwards valid truck ids into markers');
  assert(helpMenu.includes('Haritayı Senkronize Et'), 'manual sync label');
  assert(helpMenu.includes('Araç Durumlarını Kontrol Et'), 'inspect label');
  assert(!helpMenu.includes('Haritayı sıfırla'), 'does not use reset wording');
  assert(helpMenu.includes('filo ve aktif teslimatlarla'), 'sync description matches product copy');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('map-tracking-integrity-regression-test: PASSED\n');
