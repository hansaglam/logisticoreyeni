/**
 * Canonical ağır taşıt hız, mesafe ve ETA denge testi.
 * Run: npx tsx scripts/vehicle-speed-eta-balance-test.ts
 */

import './test-globals';

import { vehicleSpeedBalance } from '../src/config/balance';
import {
  calculateActualSpeedKmh,
  calculateEffectiveVehicleSpeed,
  calculateVehicleTravelMetrics,
  MAX_OPERATIONAL_SPEED_KMH,
} from '../src/utils/vehiclePerformance';
import type { Driver, Route, Trailer, Truck, VehicleClass } from '../src/types/game';

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

function closeTo(actual: number, expected: number, epsilon = 0.02): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function makeTruck(
  vehicleClass: VehicleClass,
  speed: number,
  condition = 100,
  status: Truck['status'] = 'on_route',
): Truck {
  return {
    id: `speed-${vehicleClass}`,
    catalogId: `speed-${vehicleClass}`,
    name: vehicleClass,
    vehicleClass,
    capacity: vehicleClass === 'special-heavy' ? 40 : 30,
    fuelConsumptionPerKm: 0.32,
    speed,
    reliability: 90,
    maintenanceCost: 0.2,
    comfort: 70,
    condition,
    purchasePrice: 80_000,
    currentCityId: 'izmir',
    status,
  };
}

function makeDriver(tier: Driver['tier'], speed = 0): Driver {
  return {
    id: `driver-${tier}`,
    name: tier ?? 'driver',
    tier,
    experience: 60,
    attention: 75,
    fuelSaving: 40,
    speed,
    morale: 80,
    salaryPerDay: 150,
    hireCost: 0,
    assignedTruckId: null,
    status: 'driving',
  };
}

function makeTrailer(type: Trailer['type'], capacityBonusTons = 35): Trailer {
  return {
    id: `trailer-${type}`,
    name: type,
    type,
    capacityBonusTons,
    purchasePrice: 30_000,
    condition: 100,
    city: 'izmir',
    status: 'attached',
    isOwned: true,
    createdAtGameTime: 0,
  };
}

const route300: Route = {
  id: 'route-300',
  fromCityId: 'izmir',
  toCityId: 'ankara',
  distanceKm: 300,
  difficulty: 0.5,
  tollCost: 0,
};
const reverseRoute300: Route = {
  ...route300,
  id: 'route-300-reverse',
  fromCityId: route300.toCityId,
  toCityId: route300.fromCityId,
};
const motorwayRoute = { ...route300, roadType: 'motorway' as const };

const mediumTruck = makeTruck('medium-truck', 70);
const tractor = makeTruck('tractor', 65);
const heavyTruck = makeTruck('heavy-truck', 62);
const specialHeavy = makeTruck('special-heavy', 55);
const standardDriver = makeDriver('standard');

console.log('\n=== Vehicle Speed & ETA Balance Test ===\n');

console.log('A. Araç sınıfı taban hızları');
for (const [vehicleClass, baseSpeed] of Object.entries(
  vehicleSpeedBalance.baseAverageSpeedKmh,
)) {
  const truck = makeTruck(vehicleClass as VehicleClass, baseSpeed);
  const result = calculateEffectiveVehicleSpeed({
    truck,
    driver: standardDriver,
    route: motorwayRoute,
  });
  assert(
    closeTo(result.baseSpeedKmh, baseSpeed),
    `${vehicleClass} base ${baseSpeed} km/sa`,
    String(result.baseSpeedKmh),
  );
}
const mediumSpeed = calculateEffectiveVehicleSpeed({
  truck: mediumTruck,
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
const tractorSpeed = calculateEffectiveVehicleSpeed({
  truck: tractor,
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
const heavySpeed = calculateEffectiveVehicleSpeed({
  truck: heavyTruck,
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
const specialHeavySpeed = calculateEffectiveVehicleSpeed({
  truck: specialHeavy,
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
assert(mediumSpeed > tractorSpeed, '300 km kamyon çekiciden hızlı');
assert(tractorSpeed > heavySpeed, 'çekici ağır kamyondan hızlı');
assert(heavySpeed > specialHeavySpeed, 'özel ağır nakliye en yavaş sınıf');

console.log('\nB. Dorse etkileri');
const noTrailer = calculateEffectiveVehicleSpeed({
  truck: tractor,
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
const standardTrailer = calculateEffectiveVehicleSpeed({
  truck: tractor,
  trailer: makeTrailer('standard'),
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
const refrigeratedTrailer = calculateEffectiveVehicleSpeed({
  truck: tractor,
  trailer: makeTrailer('refrigerated', 40),
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
const heavyTrailer = calculateEffectiveVehicleSpeed({
  truck: tractor,
  trailer: makeTrailer('heavy', 70),
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
assert(noTrailer > standardTrailer, 'dorse yok en hızlı');
assert(standardTrailer > refrigeratedTrailer, 'soğutuculu dorse standarttan yavaş');
assert(refrigeratedTrailer > heavyTrailer, 'ağır dorse en büyük cezaya sahip');
assert(
  closeTo(
    calculateEffectiveVehicleSpeed({
      truck: tractor,
      trailer: makeTrailer('heavy'),
      route: motorwayRoute,
    }).trailerMultiplier,
    0.88,
  ),
  'heavy trailer multiplier 0.88',
);

console.log('\nC. Yük, kondisyon ve sürücü');
const empty = calculateEffectiveVehicleSpeed({
  truck: tractor,
  route: motorwayRoute,
  cargoWeightTons: 0,
}).effectiveSpeedKmh;
const halfLoad = calculateEffectiveVehicleSpeed({
  truck: tractor,
  route: motorwayRoute,
  cargoWeightTons: 15,
}).effectiveSpeedKmh;
const fullLoad = calculateEffectiveVehicleSpeed({
  truck: tractor,
  route: motorwayRoute,
  cargoWeightTons: 30,
}).effectiveSpeedKmh;
assert(empty > halfLoad && halfLoad > fullLoad, 'boş > %50 > tam yük hızı');

const condition100 = calculateEffectiveVehicleSpeed({
  truck: makeTruck('tractor', 65, 100),
  route: motorwayRoute,
}).effectiveSpeedKmh;
const condition50 = calculateEffectiveVehicleSpeed({
  truck: makeTruck('tractor', 65, 50),
  route: motorwayRoute,
}).effectiveSpeedKmh;
const condition20 = calculateEffectiveVehicleSpeed({
  truck: makeTruck('tractor', 65, 20),
  route: motorwayRoute,
}).effectiveSpeedKmh;
assert(condition100 > condition50 && condition50 > condition20, '%100 > %50 > %20 kondisyon');

const beginner = calculateEffectiveVehicleSpeed({
  truck: tractor,
  driver: makeDriver('rookie'),
  route: motorwayRoute,
}).effectiveSpeedKmh;
const expert = calculateEffectiveVehicleSpeed({
  truck: tractor,
  driver: makeDriver('expert'),
  route: motorwayRoute,
}).effectiveSpeedKmh;
assert(expert > beginner, 'expert sürücü beginner sürücüden hızlı');
assert(expert <= tractor.speed * 1.05 + 0.1, 'sürücü bonusu +%5 ile sınırlı');

console.log('\nD. Durum ve güvenli sınırlar');
const paused = calculateEffectiveVehicleSpeed({
  truck: tractor,
  route: motorwayRoute,
  status: 'paused',
}).effectiveSpeedKmh;
const outOfFuel = calculateEffectiveVehicleSpeed({
  truck: { ...tractor, status: 'out_of_fuel' },
  route: motorwayRoute,
}).effectiveSpeedKmh;
assert(paused === 0, 'paused speed 0');
assert(outOfFuel === 0, 'out-of-fuel speed 0');

const samples = [
  mediumSpeed,
  tractorSpeed,
  heavySpeed,
  specialHeavySpeed,
  noTrailer,
  standardTrailer,
  refrigeratedTrailer,
  heavyTrailer,
  empty,
  halfLoad,
  fullLoad,
  condition100,
  condition50,
  condition20,
  beginner,
  expert,
];
assert(samples.every((speed) => Number.isFinite(speed)), 'NaN/Infinity yok');
assert(samples.every((speed) => speed >= 0), 'hız 0 altına düşmez');
assert(
  samples.every((speed) => speed <= MAX_OPERATIONAL_SPEED_KMH),
  'normal ağır araç 90 km/sa üstüne çıkmaz',
);

console.log('\nE. Mesafe, süre ve ETA');
const tractorMotorway = calculateEffectiveVehicleSpeed({
  truck: tractor,
  driver: standardDriver,
  route: motorwayRoute,
}).effectiveSpeedKmh;
const metrics300 = calculateVehicleTravelMetrics({
  routeDistanceKm: 300,
  progress: 0,
  effectiveSpeedKmh: tractorMotorway,
});
assert(closeTo(tractorMotorway, 65), '300 km çekici effective speed 65 km/sa');
assert(closeTo(metrics300.realWorldTravelHours, 300 / 65), '300 km süre yaklaşık 4.62 sa');

const heavyTrailerMetrics = calculateVehicleTravelMetrics({
  routeDistanceKm: 300,
  effectiveSpeedKmh: heavyTrailer,
});
assert(
  heavyTrailerMetrics.realWorldTravelHours > metrics300.realWorldTravelHours,
  'ağır dorse 300 km süreyi uzatır',
);

const progressMetrics = calculateVehicleTravelMetrics({
  routeDistanceKm: 300,
  progress: 0.4,
  effectiveSpeedKmh: tractorMotorway,
});
assert(closeTo(progressMetrics.remainingKm, 180), 'remainingKm progress ile tutarlı');
assert(
  closeTo(progressMetrics.remainingTravelHours, 180 / tractorMotorway),
  'ETA = remainingKm / speed',
);
assert(
  progressMetrics.simulationDurationMs > 0 &&
    progressMetrics.simulationDurationMs <
      metrics300.realWorldTravelHours * 60 * 60 * 1000,
  'simulation süresi gerçek operasyon saatinden ayrı',
);

const reverseSpeed = calculateEffectiveVehicleSpeed({
  truck: tractor,
  driver: standardDriver,
  route: { ...reverseRoute300, roadType: 'motorway' },
}).effectiveSpeedKmh;
const reverseMetrics = calculateVehicleTravelMetrics({
  routeDistanceKm: reverseRoute300.distanceKm,
  effectiveSpeedKmh: reverseSpeed,
});
assert(closeTo(reverseMetrics.routeDistanceKm, metrics300.routeDistanceKm), 'reverse route aynı mesafe');
assert(closeTo(reverseMetrics.realWorldTravelHours, metrics300.realWorldTravelHours), 'reverse route aynı süre');

const actualSpeed = calculateActualSpeedKmh({
  distanceDeltaKm: 30,
  elapsedHoursDelta: 0.5,
});
assert(closeTo(actualSpeed, 60), 'currentSpeed actual distance/time değerinden gelir');
assert(
  calculateActualSpeedKmh({
    distanceDeltaKm: 30,
    elapsedHoursDelta: 0.5,
    paused: true,
  }) === 0,
  'paused actual speed 0',
);

console.log('\n=== 300 km Örnekleri ===');
console.log({
  mediumTruckHours: Number((300 / mediumSpeed).toFixed(2)),
  tractorHours: Number(metrics300.realWorldTravelHours.toFixed(2)),
  standardTrailerHours: Number((300 / standardTrailer).toFixed(2)),
  refrigeratedTrailerHours: Number((300 / refrigeratedTrailer).toFixed(2)),
  heavyTrailerHours: Number((300 / heavyTrailer).toFixed(2)),
  fullLoadHours: Number((300 / fullLoad).toFixed(2)),
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
