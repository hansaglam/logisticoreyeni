/**
 * iOS Map Truck Fuel Display P0 regression.
 * Run: npx tsx scripts/ios-map-truck-fuel-display-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import type { Delivery, Truck } from '../src/types/game';
import {
  formatFuelPercentLabel,
  getDefaultFuelFillRatio,
  getDefaultFuelTankCapacityL,
  getFuelPercent,
  getTruckFuelPercent,
  getTruckFuelSnapshot,
  normalizeTruckFuel,
  toFuelNumber,
} from '../src/utils/truckFuel';
import { getTruckTrackingMetrics } from '../src/utils/truckTrackingMetrics';

const ROOT = process.cwd();

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function baseTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-bursa-1',
    name: 'Bursa Runner',
    capacity: 25,
    fuelConsumptionPerKm: 0.32,
    speed: 72,
    reliability: 75,
    maintenanceCost: 0.18,
    comfort: 60,
    condition: 88,
    purchasePrice: 45_000,
    ownershipType: 'owned',
    currentCityId: 'bursa',
    homeCityId: 'izmir',
    status: 'idle',
    ...overrides,
  };
}

function run(): void {
  console.log('\nios-map-truck-fuel-display-regression-test\n');

  // --- Canonical helpers ---
  assert(toFuelNumber('180') === 180, 'toFuelNumber accepts numeric string');
  assert(toFuelNumber('') === null, 'toFuelNumber rejects empty string (not Number("")===0)');
  assert(toFuelNumber('  ') === null, 'toFuelNumber rejects whitespace string');
  assert(toFuelNumber(null) === null, 'toFuelNumber rejects null');
  assert(toFuelNumber(undefined) === null, 'toFuelNumber rejects undefined');
  assert(toFuelNumber(Number.NaN) === null, 'toFuelNumber rejects NaN');
  assert(toFuelNumber(Number.POSITIVE_INFINITY) === null, 'toFuelNumber rejects Infinity');
  assert(toFuelNumber(0) === 0, 'toFuelNumber keeps explicit 0 liters');

  const missingFuel = baseTruck();
  const missingSnapshot = getTruckFuelSnapshot(missingFuel);
  const expectedCapacity = getDefaultFuelTankCapacityL(missingFuel);
  const expectedFill = Math.round(expectedCapacity * getDefaultFuelFillRatio(missingFuel.id));
  assert(missingSnapshot.capacityLiters === expectedCapacity, 'missing fuel uses default tank capacity');
  assert(missingSnapshot.currentLiters === expectedFill, 'missing fuel uses default fill ratio');
  assert(missingSnapshot.percentage > 0, 'missing fuel does not collapse to 0%', `got ${missingSnapshot.percentage}`);
  assert(missingSnapshot.isValid, 'missing fuel snapshot isValid');

  const stringHydrated = baseTruck({
    currentFuelL: '260' as unknown as number,
    fuelTankCapacityL: '400' as unknown as number,
  });
  const stringSnapshot = getTruckFuelSnapshot(stringHydrated);
  assert(stringSnapshot.currentLiters === 260, 'string currentFuelL coerces to liters');
  assert(stringSnapshot.capacityLiters === 400, 'string fuelTankCapacityL coerces to capacity');
  assert(stringSnapshot.percentage === 65, 'string hydration yields 65%', `got ${stringSnapshot.percentage}`);
  assert(stringSnapshot.percentage !== 0, 'string hydration never yields %0');

  const emptyStringFuel = baseTruck({
    currentFuelL: '' as unknown as number,
    fuelTankCapacityL: '' as unknown as number,
  });
  const emptySnapshot = getTruckFuelSnapshot(emptyStringFuel);
  assert(emptySnapshot.percentage > 0, 'empty-string fuel fields use default fill, not 0');

  const explicitZero = getTruckFuelSnapshot(
    baseTruck({ currentFuelL: 0, fuelTankCapacityL: 400 }),
  );
  assert(explicitZero.percentage === 0, 'explicit 0 liters remains 0%');
  assert(explicitZero.currentLiters === 0, 'explicit 0 liters preserved');

  assert(getFuelPercent(Number.NaN, 400) === 0, 'getFuelPercent NaN current → 0');
  assert(getFuelPercent(200, Number.NaN) === 0, 'getFuelPercent NaN capacity → 0');
  assert(formatFuelPercentLabel(73) === '%73', 'formatFuelPercentLabel prefix style');

  // --- Map idle path matches Fleet snapshot ---
  const idle = normalizeTruckFuel(
    baseTruck({ currentFuelL: 320, fuelTankCapacityL: 400 }),
  );
  const mapMetrics = getTruckTrackingMetrics({ truck: idle });
  const fleetPercent = getTruckFuelPercent(idle);
  const fleetSnapshot = getTruckFuelSnapshot(idle);
  assert(mapMetrics.fuelPercent === fleetPercent, 'Map idle fuelPercent === Fleet getTruckFuelPercent');
  assert(mapMetrics.fuelPercent === fleetSnapshot.percentage, 'Map idle === getTruckFuelSnapshot.percentage');
  assert(mapMetrics.currentFuelL === fleetSnapshot.currentLiters, 'Map liters === Fleet liters');
  assert(mapMetrics.fuelPercent === 80, 'idle truck shows 80%', `got ${mapMetrics.fuelPercent}`);
  assert(mapMetrics.isMoving === false, 'idle truck isMoving false');

  // Mid-job city refill: map/fleet must show the tank, never start-consumed (45.1).
  const refueledOnRoute = normalizeTruckFuel(
    baseTruck({
      currentFuelL: 70.1,
      fuelTankCapacityL: 400,
      status: 'on_route',
    }),
  );
  const staleJob = {
    id: 'del-mid-refuel',
    contractId: 'c1',
    truckId: refueledOnRoute.id,
    driverId: 'd1',
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
    maintenanceCost: 20,
    estimatedProfit: 800,
    travelHours: 8,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
  } as Delivery;
  const mapAfterRefuel = getTruckTrackingMetrics({
    truck: refueledOnRoute,
    delivery: staleJob,
  });
  const fleetAfterRefuel = getTruckFuelSnapshot(refueledOnRoute);
  assert(
    mapAfterRefuel.currentFuelL !== 45.1 && mapAfterRefuel.currentFuelL > 60,
    'map shows tank after refill, not reconstructed 45.1',
    `got ${mapAfterRefuel.currentFuelL}`,
  );
  assert(
    mapAfterRefuel.currentFuelL === fleetAfterRefuel.currentLiters,
    'map liters === fleet liters after mid-job refill',
  );
  assert(
    mapAfterRefuel.fuelPercent === fleetAfterRefuel.percentage,
    'map percent === fleet percent after mid-job refill',
  );

  // --- Source contracts ---
  const fuelSrc = readSrc('src/utils/truckFuel.ts');
  assert(fuelSrc.includes('export type TruckFuelSnapshot'), 'TruckFuelSnapshot type exported');
  assert(fuelSrc.includes('export function getTruckFuelSnapshot'), 'getTruckFuelSnapshot exported');
  assert(fuelSrc.includes('export function toFuelNumber'), 'toFuelNumber exported');
  assert(fuelSrc.includes('export function formatFuelPercentLabel'), 'formatFuelPercentLabel exported');
  assert(
    !/Number\.isFinite\(truck\.currentFuelL\)/.test(fuelSrc),
    'normalize no longer gates on Number.isFinite(truck.currentFuelL) alone',
  );

  const metricsSrc = readSrc('src/utils/truckTrackingMetrics.ts');
  assert(metricsSrc.includes('getTruckFuelSnapshot'), 'truckTrackingMetrics uses canonical snapshot');
  assert(!metricsSrc.includes('Platform.OS'), 'truckTrackingMetrics has no Platform.OS fuel branch');
  assert(
    !metricsSrc.includes('applyFuelConsumptionForProgress'),
    'map tracking does not reconstruct fuel from job start/progress',
  );

  const mapCardSrc = readSrc('src/components/map/MapTruckTrackingCard.tsx');
  assert(mapCardSrc.includes('getTruckTrackingMetrics'), 'Map card uses tracking metrics');
  assert(mapCardSrc.includes('formatFuelPercentLabel'), 'Map card uses shared percent label');
  assert(mapCardSrc.includes('truck.currentFuelL'), 'Map memo compares currentFuelL');
  assert(mapCardSrc.includes('truck.fuelTankCapacityL'), 'Map memo compares fuelTankCapacityL');
  assert(!mapCardSrc.includes('Platform.OS'), 'Map card has no Platform.OS fuel hack');
  assert(
    !/prev\.truck !== next\.truck/.test(mapCardSrc),
    'Map memo no longer relies only on truck reference identity',
  );

  const fleetCardSrc = readSrc('src/components/fleet/OwnedTruckCard.tsx');
  assert(fleetCardSrc.includes('getTruckFuelSnapshot'), 'Fleet card uses canonical snapshot');
  assert(fleetCardSrc.includes('formatFuelPercentLabel'), 'Fleet card uses shared percent label');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
