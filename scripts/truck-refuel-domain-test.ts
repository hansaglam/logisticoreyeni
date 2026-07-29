/**
 * Kamyon yakıt alma domain regresyon testi.
 * Run: npx tsx scripts/truck-refuel-domain-test.ts
 */

import './test-globals';

import {
  calculateTruckRefuelQuote,
  getTruckFuelReadiness,
  validateTruckRefuelRequest,
} from '../src/utils/truckFuel';
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

function closeTo(actual: number, expected: number, epsilon = 0.001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function makeTruck(currentFuelL: number, status: Truck['status'] = 'idle'): Truck {
  return {
    id: 'truck_refuel_test',
    name: 'Refuel Test Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 180,
    currentFuelL,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status,
  };
}

console.log('\nTruck refuel domain test');

const price = 1.72;
const twentyFive = calculateTruckRefuelQuote(makeTruck(70), 25, price);
assert(closeTo(twentyFive.litersToAdd, 25), '25 L seçimi canonical litreyi kullanır');
assert(closeTo(twentyFive.totalCost, 43), '25 L toplam maliyeti doğru');
assert(closeTo(twentyFive.newFuelL, 95), '25 L sonrası tank seviyesi doğru');

const fifty = calculateTruckRefuelQuote(makeTruck(70), 50, price);
assert(closeTo(fifty.litersToAdd, 50), '50 L seçimi canonical litreyi kullanır');
assert(closeTo(fifty.totalCost, 86), '50 L toplam maliyeti doğru');
assert(closeTo(fifty.newFuelL, 120), '50 L sonrası yakıt özeti doğru');

const full = calculateTruckRefuelQuote(makeTruck(70), 999, price);
assert(closeTo(full.litersToAdd, 110), 'tam dolum boş tank alanına clamp edilir');
assert(closeTo(full.newFuelL, 180), 'tam dolum kapasiteyi geçmez');

const affordableLiters = Math.floor((50 / price) * 1000) / 1000;
const maximum = calculateTruckRefuelQuote(makeTruck(70), affordableLiters, price);
assert(maximum.totalCost <= 50, 'maksimum al oyuncu nakdini geçmez');

const readiness = getTruckFuelReadiness(makeTruck(31), 84, price);
assert(closeTo(readiness.currentFuelL, 31), 'iş öncesi mevcut yakıt');
assert(closeTo(readiness.requiredFuelL, 84), 'iş öncesi gerekli yakıt');
assert(closeTo(readiness.fuelDeficitL, 53), 'iş öncesi yakıt açığı');
assert(!readiness.canCompleteWithoutRefuel, 'yetersiz yakıt işi engeller');
assert(closeTo(readiness.estimatedRefuelCost, 91.16), 'tahmini refuel maliyeti');

const insufficientFunds = validateTruckRefuelRequest({
  truck: makeTruck(70),
  requestedLiters: 50,
  currentMoney: 20,
  currentUnitPrice: price,
  expectedUnitPrice: price,
});
assert(
  insufficientFunds.result.reason === 'insufficient-funds',
  'yetersiz nakit structured reason',
);
assert(
  insufficientFunds.result.message === 'Yakıt almak için yeterli nakdin yok.',
  'yetersiz nakit kullanıcı mesajı',
);

const tankFull = validateTruckRefuelRequest({
  truck: makeTruck(180),
  requestedLiters: 25,
  currentMoney: 1_000,
  currentUnitPrice: price,
  expectedUnitPrice: price,
});
assert(tankFull.result.reason === 'tank-full', 'dolu depo structured reason');

const priceChanged = validateTruckRefuelRequest({
  truck: makeTruck(70),
  requestedLiters: 25,
  currentMoney: 1_000,
  currentUnitPrice: 1.8,
  expectedUnitPrice: price,
});
assert(priceChanged.result.reason === 'price-changed', 'fiyat değişimi structured reason');

const busy = validateTruckRefuelRequest({
  truck: makeTruck(70, 'on_route'),
  requestedLiters: 25,
  currentMoney: 1_000,
  currentUnitPrice: price,
  expectedUnitPrice: price,
});
assert(busy.result.reason === 'truck-busy', 'aktif görev structured reason');

const valid = validateTruckRefuelRequest({
  truck: makeTruck(70),
  requestedLiters: 50,
  currentMoney: 1_000,
  currentUnitPrice: price,
  expectedUnitPrice: price,
});
assert(valid.result.success && valid.quote != null, 'geçerli dolum isteği kabul edilir');
assert(closeTo(valid.quote?.newFuelL ?? 0, 120), 'store action için canonical quote döner');

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) {
  process.exitCode = 1;
}
