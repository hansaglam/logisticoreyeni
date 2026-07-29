/**
 * Yakıt uyarıları + roadside emergency fuel domain regresyon testi.
 * Run: npx tsx scripts/roadside-fuel-test.ts
 */

import './test-globals';

import { economyBalance } from '../src/config/balance';
import { evaluateFuelWarning, getFuelWarningForJob } from '../src/simulation/fuelWarnings';
import {
  calculateRoadsideFuelQuote,
  getRoadsideFuelLitersToDestination,
  resumeRoadsideJob,
  validateRoadsideFuelPurchase,
} from '../src/simulation/roadsideFuel';
import { evaluateRoadsideFuelAssistance } from '../src/simulation/softLockRecovery';
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

function closeTo(actual: number, expected: number, epsilon = 0.001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function makeTruck(currentFuelL: number, status: Truck['status'] = 'on_route'): Truck {
  return {
    id: 'roadside_truck',
    name: 'Roadside Test Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 100,
    currentFuelL,
    totalMileageKm: 40,
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

function makeJob(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'roadside_job',
    contractId: 'contract_roadside',
    truckId: 'roadside_truck',
    driverId: 'roadside_driver',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 100,
    progress: 0,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 10,
    deadlineTime: 24,
    fuelCost: 100,
    fuelLitersAtStart: 100,
    fuelLitersTotal: 10,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    distanceTraveledKm: 0,
    maintenanceCost: 20,
    estimatedProfit: 500,
    travelHours: 10,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    fuelWarningsEmitted: [],
    ...overrides,
  };
}

console.log('\n=== Roadside Fuel Test ===');

const low = getFuelWarningForJob(makeJob({ fuelLitersTotal: 10 }), makeTruck(20));
assert(low?.key === 'low-fuel', 'düşük yakıt uyarısı');
assert(low?.message.includes('Yakıt azalıyor.'), 'düşük yakıt mesajı');

const critical = getFuelWarningForJob(makeJob({ fuelLitersTotal: 5 }), makeTruck(8));
assert(critical?.key === 'critical-fuel', 'kritik yakıt uyarısı');
assert(critical?.message === 'Kritik yakıt: %8.', 'kritik yakıt mesajı');

const insufficient = getFuelWarningForJob(makeJob({ fuelLitersTotal: 84 }), makeTruck(31));
assert(insufficient?.key === 'insufficient-range', 'range yetersiz uyarısı');
assert(
  insufficient?.message === 'Mevcut yakıt hedefe ulaşmak için yeterli değil.',
  'range yetersiz mesajı',
);

const stoppedJob = makeJob({
  progress: 0.42,
  status: 'paused',
  pausedReason: 'out-of-fuel',
  fuelLitersTotal: 60,
  fuelLitersAtStart: 25.2,
  fuelConsumedL: 25.2,
  lastFuelProcessedProgress: 0.42,
  distanceTraveledKm: 42,
});
const stoppedTruck = makeTruck(0, 'out_of_fuel');
const out = getFuelWarningForJob(stoppedJob, stoppedTruck);
assert(out?.key === 'out-of-fuel', 'out-of-fuel en yüksek öncelik');
assert(out?.message === 'Yakıt bitti. Araç rota üzerinde durdu.', 'out-of-fuel mesajı');

const firstEvaluation = evaluateFuelWarning(stoppedJob, stoppedTruck);
const secondEvaluation = evaluateFuelWarning(
  { ...stoppedJob, fuelWarningsEmitted: firstEvaluation.fuelWarningsEmitted },
  stoppedTruck,
);
assert(firstEvaluation.warning?.key === 'out-of-fuel', 'ilk threshold bildirimi üretilir');
assert(secondEvaluation.warning == null, 'warning dedupe aynı job için ikinci bildirimi engeller');
assert(
  firstEvaluation.fuelWarningsEmitted.includes('low-fuel') &&
    firstEvaluation.fuelWarningsEmitted.includes('critical-fuel') &&
    firstEvaluation.fuelWarningsEmitted.includes('insufficient-range') &&
    firstEvaluation.fuelWarningsEmitted.includes('out-of-fuel'),
  'öncelik altındaki aşılmış eşikler birlikte işaretlenir',
);

const price = 1.72;
const roadsideQuote = calculateRoadsideFuelQuote(stoppedTruck, 25, price);
assert(closeTo(roadsideQuote.litersToAdd, 25), 'acil yakıt 25 L satın alma');
assert(
  closeTo(
    roadsideQuote.fuelCost,
    25 * price * economyBalance.roadsideFuelPriceMultiplier,
  ),
  'roadside fiyat multiplier uygulanır',
);
assert(
  roadsideQuote.serviceFee === economyBalance.roadsideFuelServiceBaseFee,
  'servis ücreti eklenir',
);
assert(
  closeTo(roadsideQuote.totalCost, roadsideQuote.fuelCost + roadsideQuote.serviceFee),
  'toplam yakıt + servis ücreti',
);
assert(roadsideQuote.source === 'roadside-emergency', 'roadside source işaretlenir');

const purchase = validateRoadsideFuelPurchase({
  job: stoppedJob,
  truck: stoppedTruck,
  requestedLiters: 25,
  currentMoney: 1_000,
  currentUnitPrice: price,
  expectedUnitPrice: price,
});
assert(purchase.result.success && purchase.quote != null, 'acil yakıt satın alma doğrulanır');

const targetLiters = getRoadsideFuelLitersToDestination(stoppedJob);
assert(closeTo(targetLiters, 60 * (1 - 0.42)), 'hedefe yetecek litre gerçek kalan progress');

const resumed = resumeRoadsideJob(stoppedJob, 'delivery', { litersAdded: 25 });
assert(resumed.status === 'on_route' && resumed.pausedReason == null, 'job resume edilir');
assert(closeTo(resumed.progress, stoppedJob.progress), 'resume sırasında progress korunur');
assert(
  closeTo(resumed.distanceTraveledKm ?? 0, stoppedJob.distanceTraveledKm ?? 0),
  'resume sırasında gidilen mesafe korunur',
);
assert(
  closeTo(resumed.fuelLitersAtStart ?? 0, (stoppedJob.fuelLitersAtStart ?? 0) + 25),
  'roadside litre incremental fuel baselineına eklenir',
);
const continued = updateDeliveryProgressWithFuel(
  resumed,
  makeTruck(25, 'on_route'),
  1,
  11,
);
assert(continued.delivery.progress > resumed.progress, 'sonraki tick kaldığı yerden ilerler');
assert(continued.delivery.status === 'on_route', 'yeterli acil yakıtla job aktif kalır');

const assistance = evaluateRoadsideFuelAssistance({
  truck: stoppedTruck,
  money: 0,
  fuelPrice: price,
  currentTime: 100,
});
assert(assistance.allowed, 'nakit yetersizken soft-lock yardımı açılır');
assert(
  assistance.liters === economyBalance.minimumEmergencyFuelLiters,
  'soft-lock yalnız minimum yakıt sağlar',
);

const duplicateAssistance = evaluateRoadsideFuelAssistance({
  truck: stoppedTruck,
  money: 0,
  fuelPrice: price,
  currentTime: 200,
  jobAssistanceGrantedAt: 100,
});
assert(
  !duplicateAssistance.allowed && duplicateAssistance.reason === 'already-used',
  'duplicate assistance aynı job için engellenir',
);

const cooldownAssistance = evaluateRoadsideFuelAssistance({
  truck: stoppedTruck,
  money: 0,
  fuelPrice: price,
  currentTime: 110,
  lastAssistanceAt: 100,
});
assert(
  !cooldownAssistance.allowed && cooldownAssistance.reason === 'cooldown',
  'yardım cooldown ile sınırlandırılır',
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
