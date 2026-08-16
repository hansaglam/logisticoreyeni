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

{
  const store = readFileSync(
    resolve(__dirname, '../src/store/gameStore.ts'),
    'utf8',
  );
  assert(
    store.includes('mergeTruckTickUpdates(\n                live.player.trucks'),
    'delivery/transfer ticks merge against live fleet inside functional set',
  );
  assert(store.includes('[refuelTruck] after-commit'), 'refuel read-back logging present');
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
