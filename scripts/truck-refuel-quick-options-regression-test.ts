/**
 * City fuel quick-option cleanup: 25 / 50 / 100 / Maksimum Al.
 * Run: npx tsx scripts/truck-refuel-quick-options-regression-test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';
import { calculateTruckRefuelQuote } from '../src/utils/truckFuel';
import type { Truck } from '../src/types/game';

let passed = 0;
function check(condition: unknown, label: string): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function closeTo(actual: number, expected: number, epsilon = 0.001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function makeTruck(currentFuelL: number, capacity = 180): Truck {
  return {
    id: 'truck_quick_opts',
    name: 'Quick Opt Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: capacity,
    currentFuelL,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'idle',
  };
}

/** Mirrors TruckRefuelSheet "Maksimum Al" liters selection. */
function maxPurchasableLiters(
  remainingTankCapacity: number,
  cash: number,
  unitPrice: number,
): number {
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || cash <= 0) return 0;
  const affordable = Math.floor((cash / unitPrice) * 1000) / 1000;
  return Math.min(Math.max(0, remainingTankCapacity), affordable);
}

console.log('\n=== Truck refuel quick options regression ===\n');

const sheet = readFileSync(resolve(process.cwd(), 'src/components/TruckRefuelSheet.tsx'), 'utf8');
const roadside = readFileSync(resolve(process.cwd(), 'src/components/RoadsideFuelSheet.tsx'), 'utf8');

check(!sheet.includes('Tam Doldur'), '1. Tam Doldur removed from city fuel sheet');
check(!sheet.includes("'full'"), 'no leftover full choice id');
check(sheet.includes("label: '25 L'"), 'option 25 L present');
check(sheet.includes("label: '50 L'"), 'option 50 L present');
check(sheet.includes("label: '100 L'"), 'option 100 L present');
check(sheet.includes("label: 'Maksimum Al'"), 'option Maksimum Al present');
check(
  /id: '25'[\s\S]*id: '50'[\s\S]*id: '100'[\s\S]*id: 'max'/.test(sheet),
  '2x2 order: 25 | 50 | 100 | max',
);
check(
  sheet.includes("if (choice === '100') return 100"),
  '100 L requests nominal 100 liters',
);
check(
  sheet.includes('Math.min(availableTankSpace, Math.floor((cash / pricePerLiter)'),
  'Maksimum Al uses tank ∩ cash formula',
);
check(!roadside.includes('Tam Doldur'), '10. roadside sheet unchanged (no Tam Doldur)');
check(
  roadside.includes("['25', '25 L']") && roadside.includes("['50', '50 L']"),
  '10. roadside keeps its own 25/50/destination options (parity: city sheet only)',
);

const price = 1.72;
const spaceFrom70 = 110;

const q25 = calculateTruckRefuelQuote(makeTruck(70), 25, price);
check(closeTo(q25.litersToAdd, 25) && closeTo(q25.newFuelL, 95), '1. 25 L');

const q50 = calculateTruckRefuelQuote(makeTruck(70), 50, price);
check(closeTo(q50.litersToAdd, 50) && closeTo(q50.newFuelL, 120), '2. 50 L');

const q100 = calculateTruckRefuelQuote(makeTruck(70), 100, price);
check(closeTo(q100.litersToAdd, 100) && closeTo(q100.newFuelL, 170), '3. 100 L');
check(closeTo(q100.totalCost, 172), '9. transaction summary total for 100 L');

const q100Cap = calculateTruckRefuelQuote(makeTruck(100), 100, price);
check(closeTo(q100Cap.litersToAdd, 80) && closeTo(q100Cap.newFuelL, 180), '4. 100 L capped by tank space');

const maxByTank = maxPurchasableLiters(40, 10_000, price);
const qMaxTank = calculateTruckRefuelQuote(makeTruck(140), maxByTank, price);
check(closeTo(maxByTank, 40) && closeTo(qMaxTank.newFuelL, 180), '5. maximum limited by tank capacity');

const maxByCash = maxPurchasableLiters(spaceFrom70, 50, price);
const qMaxCash = calculateTruckRefuelQuote(makeTruck(70), maxByCash, price);
check(qMaxCash.totalCost <= 50 + 1e-9, '6. maximum limited by available cash');

check(q100Cap.newFuelL <= 180 && qMaxTank.newFuelL <= 180, '7. no tank overflow');
check(qMaxCash.totalCost >= 0 && q100.totalCost >= 0, '8. no negative cash from quotes');

const unaffordable100 = calculateTruckRefuelQuote(makeTruck(70), 100, price);
check(
  unaffordable100.totalCost > 50,
  'fixed 100 L quote still reports full cost so UI can disable when cash short',
);

check(
  sheet.includes('canAffordQuote') && sheet.includes('canSubmit'),
  'existing affordability / submit gates retained',
);
check(
  sheet.includes("Platform.OS !== 'ios'") && sheet.includes('Platform.OS'),
  '10. shared RN sheet = iOS/Android parity',
);

console.log(`\n✅ ${passed} checks passed\n`);
