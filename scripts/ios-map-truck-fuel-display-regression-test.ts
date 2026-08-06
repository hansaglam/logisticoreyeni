/**
 * iOS Map Truck Fuel Display P0 regression.
 * Run: npx tsx scripts/ios-map-truck-fuel-display-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import type { Truck } from '../src/types/game';
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
