/**
 * Delivery completion moves truck/driver/trailer to destination for all city pairs.
 * Run: npx tsx scripts/delivery-completion-city-test.ts
 */

import './test-globals';

import { MAP_ROAD_CITY_IDS } from '../src/data/mapRoadNetwork';
import { normalizeCityId } from '../src/data/networkPositions';
import { ROUTES } from '../src/data/routes';
import {
  completeDelivery,
  resolveDeliveryDestinationCityId,
  resolveTruckCityId,
} from '../src/simulation/delivery';
import { syncTrailersWithTruckLocation } from '../src/simulation/trailerOps';
import type {
  Contract,
  Delivery,
  Driver,
  SimulationGameState,
  Trailer,
  Truck,
} from '../src/types/game';

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

function baseTruck(originCityId: string, overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck_1',
    name: 'Test Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.35,
    speed: 80,
    reliability: 85,
    maintenanceCost: 0.12,
    comfort: 70,
    condition: 90,
    purchasePrice: 45_000,
    currentCityId: originCityId,
    homeCityId: originCityId,
    status: 'on_route',
    ...overrides,
  } as Truck;
}

function baseDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver_1',
    name: 'Test Driver',
    experience: 50,
    attention: 50,
    fuelSaving: 50,
    speed: 0,
    morale: 70,
    salaryPerDay: 100,
    hireCost: 0,
    assignedTruckId: 'truck_1',
    status: 'driving',
    ...overrides,
  } as Driver;
}

function baseContract(origin: string, destination: string): Contract {
  const route =
    ROUTES.find(
      (item) =>
        normalizeCityId(item.fromCityId) === normalizeCityId(origin) &&
        normalizeCityId(item.toCityId) === normalizeCityId(destination),
    ) ??
    ({
      id: `${origin}-${destination}`,
      fromCityId: origin,
      toCityId: destination,
      distanceKm: 500,
      difficulty: 0.3,
      tollCost: 0,
    } as Contract);

  return {
    id: `contract_${origin}_${destination}`,
    originCityId: origin,
    destinationCityId: destination,
    productId: 'machinery',
    amount: 10,
    cargoWeight: 10,
    payment: 5000,
    deadlineHours: 72,
    distanceKm: route.distanceKm,
    urgency: 0.3,
    status: 'active',
    createdAt: 0,
    expiresAt: 999,
    requiredLevel: 1,
  };
}

function baseDelivery(origin: string, destination: string): Delivery {
  return {
    id: `delivery_${origin}_${destination}`,
    contractId: `contract_${origin}_${destination}`,
    truckId: 'truck_1',
    driverId: 'driver_1',
    originCityId: origin,
    destinationCityId: destination,
    productId: 'machinery',
    amount: 10,
    distanceKm: 500,
    progress: 1,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 24,
    deadlineTime: 72,
    fuelCost: 400,
    maintenanceCost: 100,
    estimatedProfit: 800,
    travelHours: 20,
    breakdownChance: 0.02,
    accidentChance: 0.01,
    conditionLoss: 2,
  };
}

function simStateForPair(
  origin: string,
  destination: string,
  trailer?: Trailer,
): SimulationGameState {
  return {
    currentDay: 1,
    currentTime: 48,
    player: {
      companyName: 'Test Co',
      money: 50_000,
      companyLevel: 5,
      homeCityId: origin,
    },
    trucks: [baseTruck(origin)],
    drivers: [baseDriver({ currentCityId: origin })],
    warehouses: [],
    cities: {},
    contracts: [baseContract(origin, destination)],
    deliveries: [baseDelivery(origin, destination)],
    trailers: trailer ? [trailer] : undefined,
  } as SimulationGameState & { trailers?: Trailer[] };
}

function runCompletionCase(origin: string, destination: string, withTrailer = false): void {
  const dest = normalizeCityId(destination);
  const trailer: Trailer | undefined = withTrailer
    ? {
        id: 'trailer_1',
        name: 'Test Trailer',
        type: 'standard',
        capacityBonusTons: 10,
        city: origin,
        status: 'in_use',
        attachedTruckId: 'truck_1',
        purchasePrice: 10_000,
      }
    : undefined;

  const state = simStateForPair(origin, destination, trailer);
  const delivery = state.deliveries[0];
  const result = completeDelivery(state, delivery.id);
  const truck = result.trucks.find((item) => item.id === 'truck_1');
  const driver = result.drivers.find((item) => item.id === 'driver_1');
  const completedDelivery = result.deliveries.find((item) => item.id === delivery.id);

  assert(
    normalizeCityId(truck?.currentCityId ?? '') === dest,
    `${origin}→${destination} truck at destination`,
    truck?.currentCityId,
  );
  assert(truck?.status === 'idle', `${origin}→${destination} truck idle`);
  assert(
    normalizeCityId(driver?.currentCityId ?? '') === dest,
    `${origin}→${destination} driver at destination`,
    driver?.currentCityId,
  );
  assert(driver?.status === 'idle', `${origin}→${destination} driver idle`);
  assert(completedDelivery?.status === 'completed', `${origin}→${destination} delivery completed`);
  assert(completedDelivery?.progress === 1, `${origin}→${destination} progress clamped to 1`);

  if (withTrailer && trailer) {
    const synced = syncTrailersWithTruckLocation([trailer], 'truck_1', dest, 'idle');
    assert(
      normalizeCityId(synced[0]?.city ?? '') === dest,
      `${origin}→${destination} trailer synced to destination`,
    );
  }
}

const cityIds = [...MAP_ROAD_CITY_IDS];
const pairs: Array<[string, string]> = [];
for (const from of cityIds) {
  for (const to of cityIds) {
    if (from !== to) pairs.push([from, to]);
  }
}

console.log('\n=== Delivery completion matrix (56 pairs) ===\n');

for (const [origin, destination] of pairs) {
  runCompletionCase(origin, destination);
}

console.log('\n=== Regression cases ===\n');

runCompletionCase('trabzon', 'bursa');
runCompletionCase('bursa', 'trabzon');
runCompletionCase('ankara', 'diyarbakir');
runCompletionCase('diyarbakir', 'ankara');
runCompletionCase('trabzon', 'ankara');
runCompletionCase('ankara', 'trabzon');
runCompletionCase('istanbul', 'antalya');
runCompletionCase('antalya', 'istanbul');
runCompletionCase('adana', 'diyarbakir');
runCompletionCase('diyarbakir', 'adana');

console.log('\n=== Destination source of truth ===\n');
{
  const delivery = baseDelivery('trabzon', 'bursa');
  assert(
    resolveDeliveryDestinationCityId(delivery) === 'bursa',
    'destination from delivery.destinationCityId',
  );
}

console.log('\n=== Idempotent completion ===\n');
{
  const state = simStateForPair('izmir', 'ankara');
  const first = completeDelivery(state, state.deliveries[0].id);
  const second = completeDelivery(first, state.deliveries[0].id);
  const truck = second.trucks[0];
  assert(
    normalizeCityId(truck.currentCityId) === 'ankara',
    'second completeDelivery keeps truck at destination',
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
