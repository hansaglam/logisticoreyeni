/**
 * Contract accept UX + active-job fuel warning source-of-truth.
 * Run: npx tsx scripts/active-job-accept-fuel-warning-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveDeliveryHealth } from '../src/domain/deliveryHealthStatus';
import { getFuelWarningForJob } from '../src/simulation/fuelWarnings';
import { updateDeliveryProgressWithFuel } from '../src/simulation/delivery';
import type { Delivery, Truck } from '../src/types/game';

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
    id: 'truck-accept-fuel',
    name: 'Accept Fuel Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 400,
    currentFuelL: 300,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
    currentCityId: 'ankara',
    homeCityId: 'ankara',
    status: 'on_route',
    ...overrides,
  } as Truck;
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery-accept-fuel',
    contractId: 'contract-accept-fuel',
    truckId: 'truck-accept-fuel',
    driverId: 'driver-accept-fuel',
    originCityId: 'ankara',
    destinationCityId: 'bursa',
    productId: 'machinery',
    amount: 10,
    distanceKm: 380,
    progress: 0,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 8,
    deadlineTime: 16,
    fuelCost: 100,
    fuelLitersAtStart: 300,
    fuelLitersTotal: 80,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    distanceTraveledKm: 0,
    maintenanceCost: 20,
    estimatedProfit: 900,
    travelHours: 8,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    ...overrides,
  };
}

console.log('\nActive job accept / fuel warning regression\n');

{
  const contracts = readFileSync(
    resolve(__dirname, '../src/screens/ContractsScreen.tsx'),
    'utf8',
  );
  assert(
    !/setActiveSegment\('active'\)/.test(contracts),
    'accepting a contract no longer forces Jobs → Active',
  );
  assert(
    contracts.includes('formatJobAcceptedMessage') &&
      contracts.includes('İş alındı'),
    'accept success toast uses İş alındı copy',
  );
  assert(
    contracts.includes("source: 'job_assignment'") ||
      contracts.includes('TruckRefuelSheet'),
    'active card can open city refuel when fuel is only low',
  );
  assert(
    contracts.includes('[ACTIVE_JOB_FUEL]'),
    'active card logs canonical fuel',
  );
}

console.log('\nCASE 1 — 300/400 L after accept');
{
  const truck = makeTruck({ currentFuelL: 300, status: 'on_route' });
  const delivery = makeDelivery({ fuelLitersAtStart: 300, fuelLitersTotal: 80 });
  const health = resolveDeliveryHealth({ delivery, currentTime: 0, truck });
  assert(health.status !== 'out_of_fuel', 'does not use YAKITSIZ');
  assert(!health.showOutOfFuelWarning, 'does not show out-of-fuel warning');
  assert(!health.showRefuelCta, 'does not show Yakıt Al');
  assert(health.label !== 'YAKITSIZ', 'badge is not YAKITSIZ');
}

console.log('\nCASE 2 — 45/400 L enough for remaining route');
{
  const truck = makeTruck({ currentFuelL: 45, status: 'on_route' });
  const delivery = makeDelivery({
    fuelLitersAtStart: 45,
    fuelLitersTotal: 30,
  });
  const health = resolveDeliveryHealth({ delivery, currentTime: 0, truck });
  assert(!health.showOutOfFuelWarning, 'enough fuel is not out-of-fuel');
  assert(!health.showLowFuelWarning, 'enough fuel is not low-fuel warning');
  assert(!health.showRefuelCta, 'no Yakıt Al when remaining route is covered');
}

console.log('\nCASE 3 — 45/400 L not enough for remaining route');
{
  const truck = makeTruck({ currentFuelL: 45, status: 'on_route' });
  const delivery = makeDelivery({
    fuelLitersAtStart: 45,
    fuelLitersTotal: 80,
  });
  const health = resolveDeliveryHealth({ delivery, currentTime: 0, truck });
  assert(!health.showOutOfFuelWarning, 'partial tank is not YAKITSIZ');
  assert(health.label !== 'YAKITSIZ', 'does not label as YAKITSIZ');
  assert(health.showLowFuelWarning, 'shows low-fuel / insufficient warning');
  assert(health.showRefuelCta, 'Yakıt Al is available for insufficient route fuel');
  const warning = getFuelWarningForJob(delivery, truck);
  assert(warning?.key !== 'out-of-fuel', 'fuel warning helper is not out-of-fuel');
  assert(warning?.key === 'insufficient-range', 'fuel warning helper is insufficient-range');
}

console.log('\nCASE 4 — tank hits 0 L');
{
  const truck = makeTruck({ currentFuelL: 0, status: 'out_of_fuel' });
  const delivery = makeDelivery({
    progress: 0.4,
    status: 'paused',
    pausedReason: 'out-of-fuel',
    fuelLitersAtStart: 3,
    fuelLitersTotal: 80,
    fuelConsumedL: 3,
  });
  const health = resolveDeliveryHealth({ delivery, currentTime: 4, truck });
  assert(health.showOutOfFuelWarning, 'empty tank shows out-of-fuel warning');
  assert(health.label === 'YAKITSIZ', 'empty tank badge is YAKITSIZ');
  assert(health.showRefuelCta, 'empty tank shows Yakıt Al');
}

console.log('\nCASE 5 — refuel 0 → 100 L clears stale flags in UI');
{
  const truck = makeTruck({
    currentFuelL: 100,
    status: 'out_of_fuel',
  });
  const delivery = makeDelivery({
    progress: 0.4,
    status: 'paused',
    pausedReason: 'out-of-fuel',
    fuelLitersAtStart: 3,
    fuelLitersTotal: 80,
    fuelConsumedL: 3,
  });
  const health = resolveDeliveryHealth({ delivery, currentTime: 4, truck });
  assert(!health.showOutOfFuelWarning, 'stale out_of_fuel flag does not keep YAKITSIZ');
  assert(health.label !== 'YAKITSIZ', 'badge is not YAKITSIZ after tank has fuel');
  const warning = getFuelWarningForJob(delivery, truck);
  assert(warning?.key !== 'out-of-fuel', 'helper ignores stale out_of_fuel when tank has fuel');

  const resumed = updateDeliveryProgressWithFuel(
    delivery,
    { ...truck, currentFuelL: 100, status: 'out_of_fuel' },
    0.5,
    20,
  );
  assert(resumed.truck.status !== 'out_of_fuel', 'tick clears stale out_of_fuel when tank has fuel');
  assert(resumed.delivery.pausedReason !== 'out-of-fuel', 'tick clears pausedReason after fuel returns');
  assert(resumed.delivery.status === 'on_route', 'delivery can resume');
}

console.log('\nStale snapshot is not used as canonical fuel');
{
  const liveTruck = makeTruck({ currentFuelL: 300, status: 'on_route' });
  const delivery = makeDelivery({
    fuelLitersAtStart: 0,
    startReadiness: {
      estimatedTravelHours: 8,
      deadlineHours: 16,
      timeMarginHours: 8,
      deadlineRisk: 'normal',
      requiredFuelL: 80,
      currentFuelL: 0,
    },
  });
  const health = resolveDeliveryHealth({ delivery, currentTime: 0, truck: liveTruck });
  assert(health.canonicalFuelL === 300, 'canonical fuel comes from live assigned truck');
  assert(!health.showOutOfFuelWarning, 'startReadiness 0 L snapshot does not trigger YAKITSIZ');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
