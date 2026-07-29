/**
 * Filo performans ve ikinci el ekonomi kabul testi.
 * Run: npx tsx scripts/fleet-economy-balance-test.ts
 */

import './test-globals';

import { STARTER_TRUCK, TRUCK_MARKET } from '../src/data/trucks';
import { TRAILER_MARKET, createTrailerFromTemplate } from '../src/data/trailers';
import { getRoute } from '../src/data/routes';
import {
  calculateTruckResaleValue,
  calculateTruckValueScore,
  calculateTrailerResaleValue,
} from '../src/simulation/fleetManagement';
import {
  calculateAverageSpeed,
  updateDeliveryProgressWithFuel,
} from '../src/simulation/delivery';
import { calculateTransferDurationHours } from '../src/simulation/truckTransfer';
import { applyTruckUpgrade } from '../src/simulation/truckUpgrades';
import { calculateActualSpeedKmh } from '../src/utils/vehiclePerformance';
import { calculateVehicleSpeed } from '../src/utils/vehiclePerformance';
import { getTruckTrackingMetrics } from '../src/utils/truckTrackingMetrics';
import type { Delivery, Driver, Route, Truck } from '../src/types/game';

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

function closeTo(actual: number, expected: number, epsilon = 0.001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

const driver: Driver = {
  id: 'fleet-test-driver',
  name: 'Test Driver',
  experience: 50,
  attention: 50,
  speed: 0,
  fuelSaving: 0,
  salaryPerDay: 100,
  status: 'driving',
};

const route: Route = {
  id: 'fleet-test-route',
  fromCityId: 'izmir',
  toCityId: 'ankara',
  distanceKm: 500,
  difficulty: 0,
  tollCost: 0,
};

function asOwnedTruck(template: (typeof TRUCK_MARKET)[number], suffix = ''): Truck {
  return {
    ...template,
    id: `${template.id}${suffix}`,
    catalogId: template.id,
    ownershipType: 'owned',
    currentCityId: 'izmir',
    status: 'idle',
    totalMileageKm: 0,
  };
}

function makeDelivery(truck: Truck): Delivery {
  const fuelLitersTotal = route.distanceKm * truck.fuelConsumptionPerKm;
  return {
    id: 'fleet-speed-delivery',
    contractId: 'fleet-speed-contract',
    truckId: truck.id,
    driverId: driver.id,
    originCityId: route.fromCityId,
    destinationCityId: route.toCityId,
    productId: 'machinery',
    amount: 10,
    distanceKm: route.distanceKm,
    progress: 0,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 10,
    deadlineTime: 20,
    fuelCost: 0,
    fuelLitersAtStart: fuelLitersTotal,
    fuelLitersTotal,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    lastFuelProcessedAt: 0,
    distanceTraveledKm: 0,
    currentSpeedKmh: 0,
    maintenanceCost: 0,
    estimatedProfit: 0,
    travelHours: 10,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 0,
  };
}

console.log('\n=== Fleet Economy & Performance Balance Test ===\n');

console.log('Truck price/value table:');
const catalog = [STARTER_TRUCK, ...TRUCK_MARKET];
for (const truck of catalog) {
  const score = calculateTruckValueScore(truck);
  console.log(
    `  ${truck.name.padEnd(20)} price=$${truck.purchasePrice.toLocaleString()} score=${score.valueScore.toFixed(1)} $/pt=${score.pricePerValuePoint}`,
  );
  assert(
    Number.isFinite(score.valueScore) && score.valueScore > 0,
    `${truck.name}: finite positive value score`,
  );
}

const starterScore = calculateTruckValueScore(STARTER_TRUCK);
const firstMarketScore = calculateTruckValueScore(TRUCK_MARKET[0]);
assert(
  firstMarketScore.valueScore > starterScore.valueScore,
  'first paid truck provides a measurable operating upgrade',
);
for (let index = 1; index < TRUCK_MARKET.length; index += 1) {
  const previous = calculateTruckValueScore(TRUCK_MARKET[index - 1]);
  const current = calculateTruckValueScore(TRUCK_MARKET[index]);
  assert(
    current.valueScore > previous.valueScore,
    `${TRUCK_MARKET[index].name}: higher price provides higher total value`,
  );
}
assert(
  calculateTruckResaleValue({
    ...STARTER_TRUCK,
    ownershipType: 'leased',
  }) === 0,
  'leased truck has no resale value',
);
assert(
  calculateTruckResaleValue({
    basePrice: Number.POSITIVE_INFINITY,
    condition: Number.NaN,
    mileageKm: Number.NEGATIVE_INFINITY,
  }) === 0,
  'invalid resale inputs normalize safely',
);

for (const template of TRUCK_MARKET) {
  const truck = asOwnedTruck(template);
  const immediate = calculateTruckResaleValue(truck);
  assert(immediate < truck.purchasePrice, `${truck.name}: immediate resale below purchase`);
  assert(immediate >= 0 && Number.isFinite(immediate), `${truck.name}: resale finite/non-negative`);

  const highMileage = calculateTruckResaleValue({
    ...truck,
    totalMileageKm: 10_000,
  });
  assert(highMileage < immediate, `${truck.name}: 10,000 km lowers resale`);

  let previous = Infinity;
  for (const condition of [100, 75, 50, 25]) {
    const value = calculateTruckResaleValue({ ...truck, condition });
    assert(value <= previous, `${truck.name}: condition ${condition}% monotonic`);
    previous = value;
  }

  let loopCash = truck.purchasePrice;
  for (let cycle = 0; cycle < 5; cycle += 1) {
    loopCash -= truck.purchasePrice;
    loopCash += calculateTruckResaleValue({ ...truck, id: `${truck.id}-${cycle}` });
  }
  assert(loopCash < truck.purchasePrice, `${truck.name}: buy/sell loop cannot create money`);
}

let upgraded = asOwnedTruck(TRUCK_MARKET[1], '-upgraded');
upgraded = applyTruckUpgrade(upgraded, 'engine');
upgraded = applyTruckUpgrade(upgraded, 'fuelEfficiency');
const upgradedResale = calculateTruckResaleValue(upgraded);
const plainResale = calculateTruckResaleValue(asOwnedTruck(TRUCK_MARKET[1], '-plain'));
assert(upgradedResale > plainResale, 'upgrade contributes partial resale value');
assert(upgradedResale < upgraded.purchasePrice, 'upgrade resale remains below base purchase price');

for (const template of TRAILER_MARKET) {
  const trailer = createTrailerFromTemplate(template, {
    id: `${template.id}-test`,
    city: 'izmir',
    createdAtGameTime: 0,
  });
  const immediate = calculateTrailerResaleValue(trailer);
  const used = calculateTrailerResaleValue(
    { ...trailer, condition: 50 },
    { currentGameTime: 24 * 365 * 2 },
  );
  assert(immediate < trailer.purchasePrice, `${trailer.name}: immediate resale below purchase`);
  assert(used < immediate, `${trailer.name}: condition/age depreciation`);
  assert(Number.isFinite(used) && used >= 0, `${trailer.name}: resale finite/non-negative`);
}

const speedTruck: Truck = {
  ...STARTER_TRUCK,
  id: 'fleet-speed-truck',
  condition: 100,
  currentFuelL: 500,
  fuelTankCapacityL: 500,
  totalMileageKm: 0,
  status: 'on_route',
};
const effectiveSpeed = calculateAverageSpeed(speedTruck, driver, route);
const trailerSpeed = calculateVehicleSpeed({
  truck: speedTruck,
  driver,
  route,
  trailer: {
    type: 'heavy',
  },
}).effectiveSpeedKmh;
assert(trailerSpeed < effectiveSpeed, 'attached heavy trailer lowers effective speed');
const durationHours = calculateTransferDurationHours(route.distanceKm, effectiveSpeed);
assert(
  closeTo(effectiveSpeed * durationHours, route.distanceKm),
  'speed × duration equals route distance',
  `${effectiveSpeed} × ${durationHours}`,
);

const delivery = makeDelivery(speedTruck);
const tick = updateDeliveryProgressWithFuel(delivery, speedTruck, 1, 1);
const expectedDistance = 50;
const expectedFuel = expectedDistance * speedTruck.fuelConsumptionPerKm;
assert(closeTo(tick.delivery.distanceTraveledKm ?? 0, expectedDistance), 'tick mileage equals progress distance');
assert(closeTo(tick.delivery.fuelConsumedL ?? 0, expectedFuel), 'fuel equals mileage × L/km');
assert(closeTo(tick.delivery.currentSpeedKmh ?? 0, expectedDistance), 'actual speed derives from tick distance/time');

const tracking = getTruckTrackingMetrics({
  truck: tick.truck,
  delivery: tick.delivery,
  driver,
  route,
});
assert(
  tracking.currentSpeedKmh === Math.round(tick.delivery.currentSpeedKmh ?? 0),
  'tracking card uses actual tick speed',
);

const pausedDelivery = {
  ...tick.delivery,
  status: 'paused' as const,
  pausedReason: 'out-of-fuel' as const,
  currentSpeedKmh: 80,
};
const pausedTracking = getTruckTrackingMetrics({
  truck: { ...tick.truck, status: 'out_of_fuel' },
  delivery: pausedDelivery,
  driver,
  route,
});
assert(pausedTracking.currentSpeedKmh === 0, 'paused/out-of-fuel speed is zero');
assert(
  calculateActualSpeedKmh({
    distanceDeltaKm: 100,
    elapsedHoursDelta: 1,
    paused: true,
  }) === 0,
  'domain paused speed is zero',
);

const forward = getRoute('izmir', 'ankara');
const reverse = getRoute('ankara', 'izmir');
assert(Boolean(forward && reverse), 'forward and reverse route exist');
assert(
  Boolean(forward && reverse && closeTo(forward.distanceKm, reverse.distanceKm)),
  'reverse route has the same distance',
);

assert(
  catalog.every((truck) => {
    const value = calculateTruckResaleValue(truck);
    return Number.isFinite(value) && value >= 0 && value < truck.purchasePrice;
  }),
  'all catalog resale prices are finite, non-negative and below purchase',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
