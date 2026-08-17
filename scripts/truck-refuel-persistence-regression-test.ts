import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './test-globals';

import {
  calculateTruckRefuelQuote,
  getFuelPercent,
  normalizeTruckFuel,
  validateTruckRefuelRequest,
} from '../src/utils/truckFuel';
import { mergeTruckTickUpdates } from '../src/utils/truckFleetState';
import {
  applyPurchasedFuelToVehicle,
  formatRefuelSuccessMessage,
  formatRemainingRouteFuelWarning,
} from '../src/domain/vehicleFuelApply';
import { updateDeliveryProgressWithFuel } from '../src/simulation/delivery';
import type { Delivery, Truck } from '../src/types/game';
import { getTruckTrackingMetrics } from '../src/utils/truckTrackingMetrics';

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

function closeTo(actual: number, expected: number, epsilon = 0.05): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck_izmir_express',
    name: 'İzmir Express',
    capacity: 40,
    fuelConsumptionPerKm: 0.35,
    fuelTankCapacityL: 400,
    currentFuelL: 45.1,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 120_000,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'idle',
    ...overrides,
  };
}

console.log('\nTruck refuel persistence / race regression');

const unitPrice = 1.79;
const cash = 12_000;
const baseline = makeTruck();
const space = 400 - 45.1;
const fullQuote = calculateTruckRefuelQuote(baseline, space, unitPrice);
assert(closeTo(fullQuote.litersToAdd, 354.9), 'full refill liters match observed modal');
assert(closeTo(fullQuote.newFuelL, 400), 'full refill reaches capacity');
assert(closeTo(fullQuote.totalCost, 635.27, 0.1), 'full refill cost near $635');

const valid = validateTruckRefuelRequest({
  truck: baseline,
  requestedLiters: fullQuote.litersToAdd,
  currentMoney: cash,
  currentUnitPrice: unitPrice,
  expectedUnitPrice: unitPrice,
});
assert(valid.result.success === true, 'full refill validates');
assert(closeTo(valid.quote?.newFuelL ?? 0, 400), 'validated quote commits to 400 L');

const committed = normalizeTruckFuel({
  ...baseline,
  currentFuelL: valid.quote!.newFuelL,
});
assert(closeTo(committed.currentFuelL ?? 0, 400), 'canonical currentFuelL is 400 after commit');
assert(getFuelPercent(committed.currentFuelL ?? 0, committed.fuelTankCapacityL ?? 400) === 100, 'percent is 100');

const partial = calculateTruckRefuelQuote(baseline, 25, unitPrice);
assert(closeTo(partial.newFuelL, 70.1), 'partial +25 L → 70.1 L');

const insufficient = validateTruckRefuelRequest({
  truck: baseline,
  requestedLiters: fullQuote.litersToAdd,
  currentMoney: 10,
  currentUnitPrice: unitPrice,
  expectedUnitPrice: unitPrice,
});
assert(insufficient.result.reason === 'insufficient-funds', 'insufficient cash blocked');

// Race: delivery tick snapshots fleet via get(), user refuels, then tick set() applied.
// Functional set + mergeTruckTickUpdates must keep the refueled value.
const baselineFleet = [
  makeTruck({ id: 'idle-a', currentFuelL: 45.1 }),
  makeTruck({ id: 'en-route-b', status: 'on_route', currentFuelL: 200 }),
];
const tickUpdatedFleet = [
  baselineFleet[0],
  { ...baselineFleet[1], currentFuelL: 190 },
];
const liveAfterRefuel = [
  { ...baselineFleet[0], currentFuelL: 400 },
  baselineFleet[1],
];
const merged = mergeTruckTickUpdates(liveAfterRefuel, baselineFleet, tickUpdatedFleet);
const idleAfterRace = merged.find((truck) => truck.id === 'idle-a');
const routeAfterRace = merged.find((truck) => truck.id === 'en-route-b');
assert(closeTo(idleAfterRace?.currentFuelL ?? 0, 400), 'race merge keeps refueled idle truck at 400');
assert(closeTo(routeAfterRace?.currentFuelL ?? 0, 190), 'race merge still applies en-route fuel burn');

// Stranded roadside refill vs tick that still sees 0 L / out_of_fuel (iOS-prone).
const strandedBaseline = [
  makeTruck({ id: 'stranded', status: 'out_of_fuel', currentFuelL: 0 }),
];
const strandedTick = [
  { ...strandedBaseline[0], status: 'out_of_fuel' as const, currentFuelL: 0 },
];
const strandedLiveAfterRoadside = [
  { ...strandedBaseline[0], status: 'on_route' as const, currentFuelL: 400 },
];
const strandedMerged = mergeTruckTickUpdates(
  strandedLiveAfterRoadside,
  strandedBaseline,
  strandedTick,
);
assert(
  closeTo(strandedMerged.find((truck) => truck.id === 'stranded')?.currentFuelL ?? 0, 400),
  'stranded roadside refill is not clobbered by an out-of-fuel tick',
);
assert(
  strandedMerged.find((truck) => truck.id === 'stranded')?.status === 'on_route',
  'stranded refill keeps resumed on_route status',
);

// Simulate the iOS-prone gap: merge must use live fleet at commit time, not a
// pre-get() snapshot taken before a concurrent refuel.
const staleLiveSnapshot = baselineFleet;
const concurrentRefuelLive = [
  { ...baselineFleet[0], currentFuelL: 400 },
  { ...baselineFleet[1], currentFuelL: 190 },
];
const wrongMerge = mergeTruckTickUpdates(staleLiveSnapshot, baselineFleet, tickUpdatedFleet);
const rightMerge = mergeTruckTickUpdates(concurrentRefuelLive, baselineFleet, tickUpdatedFleet);
assert(
  closeTo(wrongMerge.find((t) => t.id === 'idle-a')?.currentFuelL ?? 0, 45.1),
  'stale snapshot merge would keep old fuel (documents the race)',
);
assert(
  closeTo(rightMerge.find((t) => t.id === 'idle-a')?.currentFuelL ?? 0, 400),
  'commit-time live snapshot keeps refuel',
);

const unchangedMerge = mergeTruckTickUpdates(liveAfterRefuel, baselineFleet, baselineFleet);
assert(
  unchangedMerge === liveAfterRefuel,
  'no-op tick returns live fleet reference (does not clobber)',
);

console.log('\nMid-job refill must not roll tank back to start-consumed');
{
  const enRoute = makeTruck({
    id: 'en-route-refuel',
    status: 'on_route',
    currentFuelL: 70.1,
  });
  const delivery: Delivery = {
    id: 'del-refuel',
    contractId: 'con-1',
    truckId: enRoute.id,
    driverId: 'drv-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 480,
    progress: 0.1,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 10,
    deadlineTime: 24,
    fuelCost: 100,
    fuelLitersAtStart: 45.1,
    fuelLitersTotal: 80,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0.1,
    distanceTraveledKm: 48,
    currentSpeedKmh: 70,
    maintenanceCost: 20,
    estimatedProfit: 800,
    travelHours: 8,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
  };
  const continued = updateDeliveryProgressWithFuel(delivery, enRoute, 0.2, 12);
  assert(
    (continued.truck.currentFuelL ?? 0) > 60,
    'tick after +25 L city refill keeps tank near 70, not 45',
    `got ${continued.truck.currentFuelL}`,
  );
  assert(
    (continued.delivery.fuelLitersAtStart ?? 0) >= 70,
    'job fuelLitersAtStart absorbs the refill so later ticks stay consistent',
  );
}

console.log('\nPaused out-of-fuel auto-resumes when tank has fuel');
{
  const pausedTruck = makeTruck({
    id: 'paused-resume',
    status: 'out_of_fuel',
    currentFuelL: 25,
  });
  const pausedDelivery: Delivery = {
    id: 'del-paused',
    contractId: 'con-1',
    truckId: pausedTruck.id,
    driverId: 'drv-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 100,
    progress: 0.3,
    status: 'paused',
    pausedReason: 'out-of-fuel',
    startedAt: 0,
    estimatedArrivalTime: 10,
    deadlineTime: 24,
    fuelCost: 100,
    fuelLitersAtStart: 3,
    fuelLitersTotal: 10,
    fuelConsumedL: 3,
    lastFuelProcessedProgress: 0.3,
    distanceTraveledKm: 30,
    maintenanceCost: 20,
    estimatedProfit: 500,
    travelHours: 10,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
  };
  const resumed = updateDeliveryProgressWithFuel(pausedDelivery, pausedTruck, 1, 20);
  assert(resumed.delivery.status === 'on_route', 'fuel in tank resumes paused delivery');
  assert(resumed.truck.status === 'on_route', 'truck leaves out_of_fuel after refill');
  assert(resumed.delivery.progress > 0.3, 'resumed delivery can move again');
}

console.log('\nAtomic applyPurchasedFuelToVehicle');
{
  const idle = makeTruck({ status: 'out_of_fuel', currentFuelL: 0 });
  const delivery: Delivery = {
    id: 'del-apply',
    contractId: 'con-1',
    truckId: idle.id,
    driverId: 'drv-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 100,
    progress: 0.3,
    status: 'paused',
    pausedReason: 'out-of-fuel',
    startedAt: 0,
    estimatedArrivalTime: 10,
    deadlineTime: 24,
    fuelCost: 100,
    fuelLitersAtStart: 3,
    fuelLitersTotal: 10,
    fuelConsumedL: 3,
    lastFuelProcessedProgress: 0.3,
    distanceTraveledKm: 30,
    maintenanceCost: 20,
    estimatedProfit: 500,
    travelHours: 10,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
  };
  const applied = applyPurchasedFuelToVehicle({
    truck: idle,
    newFuelL: 25,
    litersAdded: 25,
    deliveries: [delivery],
    transfers: [],
    warehouseTransfers: [],
  });
  assert(closeTo(applied.fuelAfter, 25), 'apply writes tank');
  assert(applied.truck.status === 'on_route', 'apply resumes truck');
  assert(applied.deliveries[0].status === 'on_route', 'apply resumes delivery');
  assert(applied.resumedJob, 'apply marks resumedJob');
  assert(
    formatRefuelSuccessMessage(applied).includes('25.0 L yakıt eklendi'),
    'success copy includes liters added',
  );
  assert(
    formatRefuelSuccessMessage(applied).includes('Teslimata devam edebilir'),
    'success copy says delivery can continue',
  );
  const mapAfterApply = getTruckTrackingMetrics({
    truck: applied.truck,
    delivery: applied.deliveries[0],
  });
  assert(
    closeTo(mapAfterApply.currentFuelL, 25),
    'map tracking reads applied tank, not stale job start',
  );
  assert(
    formatRemainingRouteFuelWarning({
      ...applied,
      remainingFuelRequiredL: 80,
      remainingDistanceKm: 200,
      currentRangeKm: 50,
      sufficientForRemainingRoute: false,
    })?.includes('Mevcut yakıt rota için yeterli değil') === true,
    'range warning copy when remaining fuel is short',
  );
}

{
  const store = readFileSync(
    resolve(__dirname, '../src/store/gameStore.ts'),
    'utf8',
  );
  assert(
    store.includes('mergeTruckTickUpdates') &&
      store.includes('live.player.trucks'),
    'delivery/transfer ticks merge against live fleet inside functional set',
  );
  assert(store.includes('mergeJobTickUpdates'), 'delivery ticks merge concurrent job refuel/resume');
  assert(store.includes('applyPurchasedFuelToVehicle'), 'city and roadside refuel share one apply helper');
  assert(store.includes('[refuelTruck] after-commit'), 'refuel read-back logging present');
  assert(store.includes('beforeRefuelFuel'), 'refuel logs beforeRefuel fuel');
  assert(
    store.includes('calculateDeliveryFuelLiters'),
    'delivery start uses canonical fuel requirement helper',
  );
  console.log('  ✓ gameStore commit-time live merge + fuel gate source guards');
}

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) {
  process.exitCode = 1;
}
