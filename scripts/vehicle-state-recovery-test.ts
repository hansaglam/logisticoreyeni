/**
 * Stuck / tutarsız araç kurtarma — detect, resolve, senkron ve save wiring.
 * Run: npx tsx scripts/vehicle-state-recovery-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';

import { economyBalance } from '../src/config/balance';
import {
  buildRecoveryOptions,
  detectVehicleStateIssue,
  emptyVehicleRecoveryUsage,
  normalizeVehicleRecoveryUsage,
  resolveVehicleStateIssue,
  type VehicleRecoveryActionId,
  type VehicleRecoveryStateSlice,
  type VehicleStateIssue,
} from '../src/domain/vehicleStateRecovery';
import type { Contract, Delivery, Driver, Player, Trailer, Truck } from '../src/types/game';

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

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-1',
    name: 'Kurtarma Test',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 200,
    currentFuelL: 80,
    totalMileageKm: 100,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
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
    truckId: 'truck-1',
    driverId: 'drv-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 480,
    progress: 0.35,
    status: 'on_route',
    startedAt: 10,
    estimatedArrivalTime: 16,
    deadlineTime: 24,
    fuelCost: 100,
    fuelLitersAtStart: 80,
    fuelLitersTotal: 40,
    fuelConsumedL: 10,
    lastFuelProcessedProgress: 0.35,
    distanceTraveledKm: 168,
    currentSpeedKmh: 72,
    maintenanceCost: 20,
    estimatedProfit: 800,
    travelHours: 6,
    breakdownChance: 0.01,
    accidentChance: 0.01,
    conditionLoss: 2,
    ...overrides,
  };
}

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'drv-1',
    name: 'Ali',
    experience: 40,
    attention: 70,
    fuelSaving: 50,
    speed: 10,
    morale: 80,
    salaryPerDay: 120,
    hireCost: 0,
    assignedTruckId: 'truck-1',
    status: 'driving',
    currentCityId: 'izmir',
    ...overrides,
  };
}

function makeTrailer(overrides: Partial<Trailer> = {}): Trailer {
  return {
    id: 'trl-1',
    name: 'Dorse',
    type: 'standard',
    capacityBonusTons: 5,
    purchasePrice: 8_000,
    condition: 100,
    city: 'bursa',
    status: 'in_use',
    attachedTruckId: 'truck-1',
    isOwned: true,
    createdAtGameTime: 0,
    ...overrides,
  };
}

function makePlayer(truck: Truck, extras: Partial<Player> = {}): Player {
  return {
    companyName: 'Test Lojistik',
    money: 20_000,
    companyLevel: 2,
    level: 2,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    homeCityId: 'izmir',
    reputation: 60,
    completedContracts: 1,
    trucks: [truck],
    drivers: [makeDriver()],
    trailers: [makeTrailer()],
    warehouses: [],
    ...extras,
  };
}

function makeContract(): Contract {
  return {
    id: 'con-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    payment: 1200,
    deadlineTime: 24,
    status: 'active',
    generatedAt: 0,
  } as Contract;
}

function detectFor(truck: Truck, delivery?: Delivery | null, currentTime = 12) {
  return detectVehicleStateIssue({
    truck,
    currentTime,
    homeCityId: 'izmir',
    activeDelivery: delivery,
  });
}

function resolveFor(
  truck: Truck,
  delivery: Delivery | undefined,
  issue: VehicleStateIssue,
  actionId: VehicleRecoveryActionId,
  usage = emptyVehicleRecoveryUsage(),
) {
  const options = buildRecoveryOptions(issue, usage);
  const option = options.find((item) => item.id === actionId);
  if (!option) {
    throw new Error(`option ${actionId} missing for ${issue.kind}`);
  }
  const state: VehicleRecoveryStateSlice = {
    currentTime: 12,
    player: makePlayer(truck),
    activeDeliveries: delivery ? [delivery] : [],
    contracts: [makeContract()],
    activeTransfers: [],
    activeWarehouseStockTransfers: [],
    vehicleRecovery: usage,
  };
  return resolveVehicleStateIssue({
    truckId: truck.id,
    actionId,
    issue,
    option,
    state,
  });
}

console.log('\ndetect kinds');
{
  const healthy = detectFor(
    makeTruck({ status: 'on_route', currentFuelL: 80 }),
    makeDelivery({ currentSpeedKmh: 72, progress: 0.4 }),
  );
  assert(healthy == null, 'healthy on-route delivery is not flagged');

  const stalled = detectFor(
    makeTruck({ status: 'on_route', currentFuelL: 80 }),
    makeDelivery({ currentSpeedKmh: 0, progress: 0.4, status: 'on_route' }),
  );
  assert(stalled?.kind === 'stalled_on_route', 'stalled on_route + speed 0 is detected');
  assert(stalled?.cause.includes('hız'), 'stalled cause mentions speed');

  const undefinedSpeed = detectFor(
    makeTruck({ status: 'on_route', currentFuelL: 80 }),
    makeDelivery({ currentSpeedKmh: undefined, progress: 0.4 }),
  );
  assert(undefinedSpeed == null, 'undefined currentSpeed is not treated as stalled');

  const fuelDesync = detectFor(
    makeTruck({ status: 'on_route', currentFuelL: 0 }),
    makeDelivery({ status: 'on_route', currentSpeedKmh: 0, progress: 0.2 }),
  );
  assert(fuelDesync?.kind === 'out_of_fuel_desync', 'empty tank without pause flow is fuel desync');
  assert(fuelDesync?.title === 'Araç yakıtsız kaldı', 'fuel desync title is player-facing');

  const healthyFuelPause = detectFor(
    makeTruck({ status: 'out_of_fuel', currentFuelL: 0 }),
    makeDelivery({ status: 'paused', pausedReason: 'out-of-fuel', currentSpeedKmh: 0, progress: 0.2 }),
  );
  assert(healthyFuelPause == null, 'working out-of-fuel pause is not flagged');

  const invalidRoute = detectFor(
    makeTruck({ status: 'on_route' }),
    makeDelivery({ originCityId: 'ghost-town', destinationCityId: 'nowhere-city' }),
  );
  assert(invalidRoute?.kind === 'invalid_route_or_marker', 'unknown cities are invalid route/marker');

  const missingProgress = detectFor(
    makeTruck({ status: 'on_route' }),
    makeDelivery({ progress: Number.NaN }),
  );
  assert(missingProgress?.kind === 'invalid_route_or_marker', 'NaN progress is invalid delivery record');

  const idleConflict = detectFor(
    makeTruck({ status: 'idle', currentCityId: 'izmir' }),
    makeDelivery({ status: 'on_route', progress: 0.3, currentSpeedKmh: 60 }),
  );
  assert(idleConflict?.kind === 'idle_vs_active_conflict', 'idle truck + active delivery is a conflict');

  const orphanRoute = detectFor(makeTruck({ status: 'on_route' }), null);
  assert(orphanRoute?.kind === 'idle_vs_active_conflict', 'on_route truck without job is a conflict');

  const arrived = detectFor(
    makeTruck({ status: 'on_route' }),
    makeDelivery({ progress: 1, currentSpeedKmh: 0, status: 'on_route' }),
  );
  assert(arrived?.kind === 'arrived_but_unsettled', 'progress 1 with open delivery is unsettled arrival');

  const rentalStuck = detectFor(
    makeTruck({
      status: 'on_route',
      ownershipType: 'leased',
      leaseExpiresAt: 5,
      currentFuelL: 80,
    }),
    makeDelivery({ status: 'on_route', currentSpeedKmh: 0, progress: 0.4 }),
    20,
  );
  assert(rentalStuck?.kind === 'rental_expired_stuck', 'expired rental that is not moving is stuck');
  assert(rentalStuck?.title.includes('Kiralama'), 'rental stuck title mentions lease');

  const rentalMoving = detectFor(
    makeTruck({
      status: 'on_route',
      ownershipType: 'leased',
      leaseExpiresAt: 5,
      currentFuelL: 80,
    }),
    makeDelivery({ status: 'on_route', currentSpeedKmh: 70, progress: 0.4 }),
    20,
  );
  assert(rentalMoving == null, 'expired rental still moving is not recovery-stuck');

  const warehouseOk = detectVehicleStateIssue({
    truck: makeTruck({ status: 'transferring', currentCityId: 'izmir' }),
    currentTime: 12,
    homeCityId: 'izmir',
    activeWarehouseTransfer: {
      id: 'wh-1',
      sourceWarehouseId: 'w1',
      destinationWarehouseId: 'w2',
      sourceCityId: 'izmir',
      destinationCityId: 'istanbul',
      productId: 'steel',
      quantityTons: 8,
      averagePurchasePriceAtStart: 100,
      reservedInventoryCost: 800,
      truckId: 'truck-1',
      driverId: 'drv-1',
      routeDistanceKm: 480,
      progress: 0.2,
      status: 'active',
      startedAt: 10,
      estimatedCompletionAt: 16,
      fuelLitersAtStart: 80,
      fuelLitersTotal: 30,
      fuelCost: 40,
      driverCost: 20,
      totalCost: 60,
      currentSpeedKmh: 64,
    },
  });
  assert(warehouseOk == null, 'healthy warehouse transfer is not flagged as orphan route');
}

console.log('\nrecovery options');
{
  const issue = detectFor(
    makeTruck({ status: 'on_route', currentFuelL: 0 }),
    makeDelivery({ status: 'on_route', currentSpeedKmh: 0 }),
  );
  const options = buildRecoveryOptions(issue!, emptyVehicleRecoveryUsage());
  assert(
    options.some((item) => item.id === 'call_roadside'),
    'fuel desync offers roadside help',
  );
  assert(
    options.some((item) => item.id === 'tow_to_nearest_city'),
    'every issue can tow to nearest city',
  );
  assert(
    options.every((item) => item.free && item.cashCost === 0),
    'system-caused issues are free',
  );

  const paidIssue: VehicleStateIssue = { ...issue!, systemCaused: false };
  const paid = buildRecoveryOptions(paidIssue, { freeUsed: true, paidCount: 1 });
  assert(paid[0].cashCost === 350 && paid[0].reputationCost === 2, 'later player-caused recovery costs $350 and 2 rep');
  const firstPlayer = buildRecoveryOptions(paidIssue, emptyVehicleRecoveryUsage());
  assert(firstPlayer[0].free, 'first player-caused recovery is free');
}

console.log('\nresolve tow / cancel / roadside / sync');
{
  const stalledTruck = makeTruck({ status: 'on_route', currentFuelL: 40, currentCityId: 'izmir' });
  const stalledDelivery = makeDelivery({ currentSpeedKmh: 0, progress: 0.55 });
  const stalledIssue = detectFor(stalledTruck, stalledDelivery)!;
  const towed = resolveFor(stalledTruck, stalledDelivery, stalledIssue, 'tow_to_nearest_city');
  const parked = towed.player.trucks[0];
  assert(towed.ok, 'tow resolve succeeds');
  assert(parked.status === 'idle', 'towed truck is idle');
  assert(parked.currentCityId === 'istanbul' || parked.currentCityId === 'bursa' || parked.currentCityId === 'izmir', 'tow parks at a real city');
  assert(towed.activeDeliveries[0].status === 'cancelled', 'tow cancels delivery without failDelivery path');
  assert(towed.player.drivers[0].status === 'idle', 'driver is released');
  assert(towed.player.trailers?.[0].city === parked.currentCityId, 'trailer city matches parked truck');
  const afterTow = detectVehicleStateIssue({
    truck: parked,
    currentTime: 12,
    homeCityId: 'izmir',
    activeDelivery: towed.activeDeliveries[0],
  });
  assert(afterTow == null, 'issue is gone after tow');

  const emptyTruck = makeTruck({ status: 'on_route', currentFuelL: 0 });
  const emptyDelivery = makeDelivery({ status: 'on_route', currentSpeedKmh: 0, progress: 0.2 });
  const fuelIssue = detectFor(emptyTruck, emptyDelivery)!;
  const roadside = resolveFor(emptyTruck, emptyDelivery, fuelIssue, 'call_roadside');
  assert(roadside.ok, 'roadside resolve succeeds');
  assert(
    (roadside.player.trucks[0].currentFuelL ?? 0) >= economyBalance.minimumEmergencyFuelLiters,
    'roadside adds emergency fuel',
  );
  assert(roadside.activeDeliveries[0].status === 'on_route', 'roadside resumes delivery');
  assert(roadside.activeDeliveries[0].pausedReason == null, 'roadside clears pause reason');

  const idleTruck = makeTruck({ status: 'idle', currentCityId: 'ankara' });
  const liveDelivery = makeDelivery({ status: 'on_route', progress: 0.3, currentSpeedKmh: 60 });
  const conflict = detectFor(idleTruck, liveDelivery)!;
  const synced = resolveFor(idleTruck, liveDelivery, conflict, 'sync_map_position');
  const syncedTruck = synced.player.trucks[0];
  assert(synced.ok, 'sync map resolve succeeds');
  assert(syncedTruck.status === 'on_route', 'sync puts idle+delivery truck back on_route');
  assert(syncedTruck.currentCityId === 'izmir', 'sync aligns fleet city to delivery origin');
  const afterSync = detectVehicleStateIssue({
    truck: syncedTruck,
    currentTime: 12,
    homeCityId: 'izmir',
    activeDelivery: synced.activeDeliveries[0],
  });
  assert(afterSync == null, 'map/fleet conflict is gone after sync');

  const cancel = resolveFor(idleTruck, liveDelivery, conflict, 'cancel_delivery');
  assert(cancel.activeDeliveries[0].status === 'cancelled', 'controlled cancel closes the job');
  assert(cancel.contracts[0].status === 'failed', 'linked contract is closed');
  assert(cancel.player.trucks[0].status === 'idle', 'cancel parks the truck');

  const depot = resolveFor(stalledTruck, stalledDelivery, stalledIssue, 'return_to_depot');
  assert(depot.player.trucks[0].currentCityId === 'izmir', 'depot return uses home city');
  assert(depot.player.trucks[0].status === 'idle', 'depot return leaves truck idle');
}

console.log('\nsave field roundtrip');
{
  const usage = normalizeVehicleRecoveryUsage({
    freeUsed: true,
    paidCount: 3.8,
    lastResolvedAt: 44,
    lastIssueKind: 'stalled_on_route',
    extra: 'drop-me',
  });
  assert(usage.freeUsed === true, 'usage hydrates freeUsed');
  assert(usage.paidCount === 3, 'usage floors paidCount');
  assert(usage.lastResolvedAt === 44, 'usage keeps lastResolvedAt');
  assert(usage.lastIssueKind === 'stalled_on_route', 'usage keeps lastIssueKind');
  const empty = normalizeVehicleRecoveryUsage(undefined);
  assert(empty.freeUsed === false && empty.paidCount === 0, 'missing usage becomes empty');
}

console.log('\nwiring');
{
  const domain = readFileSync('src/domain/vehicleStateRecovery.ts', 'utf8');
  const store = readFileSync('src/store/gameStore.ts', 'utf8');
  const save = readFileSync('src/storage/saveGame.ts', 'utf8');
  const app = readFileSync('App.tsx', 'utf8');
  const mapCard = readFileSync('src/components/map/MapTruckTrackingCard.tsx', 'utf8');
  const fleetCard = readFileSync('src/components/fleet/OwnedTruckCard.tsx', 'utf8');
  const sheet = readFileSync('src/components/delivery/VehicleRecoverySheet.tsx', 'utf8');
  assert(domain.includes('export function detectVehicleStateIssue'), 'domain exports detectVehicleStateIssue');
  assert(domain.includes('export function buildRecoveryOptions'), 'domain exports buildRecoveryOptions');
  assert(domain.includes('export function resolveVehicleStateIssue'), 'domain exports resolveVehicleStateIssue');
  assert(!domain.includes("from '../components/map/mapRoadUtils'"), 'domain does not import mapRoadUtils');
  assert(store.includes('openVehicleRecovery'), 'store can open recovery sheet');
  assert(store.includes('resolveVehicleStateIssue'), 'store wires resolveVehicleStateIssue');
  assert(store.includes("autoSave('vehicle_recovery')"), 'store autosaves after recovery');
  assert(store.includes('pendingVehicleRecoveryTruckId: null'), 'fresh store clears pending recovery');
  assert(save.includes('vehicleRecovery: normalizeVehicleRecoveryUsage'), 'save serializes vehicleRecovery');
  assert(app.includes('VehicleRecoverySheet'), 'root app mounts recovery sheet');
  assert(mapCard.includes('VehicleRecoveryBanner'), 'map tracking card shows recovery banner');
  assert(fleetCard.includes('VehicleRecoveryBanner'), 'fleet card shows recovery banner');
  assert(sheet.includes('Araç kurtarma'), 'sheet explains recovery to the player');
}

if (failed > 0) {
  console.error(`\nvehicle-state-recovery-test: ${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\nvehicle-state-recovery-test: ${passed} passed`);
