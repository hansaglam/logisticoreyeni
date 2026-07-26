/**
 * Delivery completion location tests.
 * Run: npx tsx scripts/delivery-completion-location-test.ts
 */

import './test-globals';

import {
  applyFleetArrivalForDelivery,
  completeDelivery,
  isDeliveryProgressComplete,
  normalizeTruckCity,
  resolveTruckCityId,
} from '../src/simulation/delivery';
import {
  isActiveRunningDelivery,
  resolveTruckMapLocation,
  resolveTruckPersistentCityId,
  resolveTruckTrackingCityId,
} from '../src/components/map/mapTruckLocation';
import { normalizeCityId } from '../src/data/networkPositions';
import { getWorldMapCityPosition } from '../src/data/worldMapPositions';
import type { Delivery, Driver, SimulationGameState, Truck } from '../src/types/game';

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

function baseTruck(overrides: Partial<Truck> = {}): Truck {
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
    currentCityId: 'istanbul',
    homeCityId: 'istanbul',
    status: 'on_route',
    ...overrides,
  } as Truck;
}

function baseDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver_1',
    name: 'Test Driver',
    status: 'on_route',
    level: 1,
    xp: 0,
    ...overrides,
  } as Driver;
}

function baseDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery_1',
    contractId: 'contract_1',
    truckId: 'truck_1',
    driverId: 'driver_1',
    originCityId: 'istanbul',
    destinationCityId: 'ankara',
    productId: 'machinery',
    amount: 10,
    distanceKm: 450,
    progress: 1,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 24,
    deadlineTime: 48,
    fuelCost: 400,
    maintenanceCost: 100,
    estimatedProfit: 800,
    travelHours: 20,
    breakdownChance: 0.02,
    accidentChance: 0.01,
    conditionLoss: 2,
    ...overrides,
  };
}

function baseSimState(overrides: Partial<SimulationGameState> = {}): SimulationGameState {
  return {
    currentDay: 1,
    currentTime: 24,
    player: {
      companyName: 'Test Co',
      money: 50_000,
      companyLevel: 3,
      homeCityId: 'istanbul',
    },
    trucks: [baseTruck()],
    drivers: [baseDriver()],
    warehouses: [],
    cities: {},
    contracts: [
      {
        id: 'contract_1',
        originCityId: 'istanbul',
        destinationCityId: 'ankara',
        productId: 'machinery',
        amount: 10,
        cargoWeight: 10,
        distanceKm: 450,
        payment: 5000,
        deadlineHours: 48,
        status: 'active',
        contractType: 'standard',
      },
    ],
    deliveries: [baseDelivery()],
    ...overrides,
  } as SimulationGameState;
}

function completeRoutePair(originCityId: string, destinationCityId: string): void {
  const truck = baseTruck({ currentCityId: originCityId, homeCityId: originCityId });
  const delivery = baseDelivery({
    originCityId,
    destinationCityId,
    progress: 1,
  });
  const contract = {
    id: 'contract_1',
    originCityId,
    destinationCityId,
    productId: 'machinery',
    amount: 10,
    cargoWeight: 10,
    distanceKm: 450,
    payment: 5000,
    deadlineHours: 48,
    status: 'active' as const,
    contractType: 'standard' as const,
  };

  const beforeCity = resolveTruckCityId(truck, 'istanbul');
  assert(beforeCity === normalizeCityId(originCityId), `${originCityId} → ${destinationCityId}: truck starts at origin`);

  const sim = baseSimState({
    trucks: [truck],
    deliveries: [delivery],
    contracts: [contract],
  });
  const next = completeDelivery(sim, delivery.id);
  const afterTruck = next.trucks.find((item) => item.id === truck.id);

  assert(
    afterTruck?.currentCityId === normalizeCityId(destinationCityId),
    `${originCityId} → ${destinationCityId}: truck city is destination after completion`,
    `got ${afterTruck?.currentCityId}`,
  );
  assert(afterTruck?.status === 'idle', `${originCityId} → ${destinationCityId}: truck status idle`);
  assert(
    next.deliveries.find((item) => item.id === delivery.id)?.status === 'completed',
    `${originCityId} → ${destinationCityId}: delivery marked completed`,
  );
}

console.log('\n=== Delivery Completion Location Test ===\n');

console.log('1. Route completion updates persistent truck city');
completeRoutePair('istanbul', 'ankara');
completeRoutePair('ankara', 'istanbul');
completeRoutePair('bursa', 'izmir');

console.log('\n2. Progress threshold gates permanent city update');
{
  const truck = baseTruck({ currentCityId: 'istanbul', status: 'on_route' });
  const deliveryIncomplete = baseDelivery({ progress: 0.99, status: 'on_route' });
  const simIncomplete = baseSimState({ trucks: [truck], deliveries: [deliveryIncomplete] });

  assert(!isDeliveryProgressComplete(0.99), 'progress 0.99 is not complete');
  let threw = false;
  try {
    completeDelivery(simIncomplete, deliveryIncomplete.id);
  } catch {
    threw = true;
  }
  assert(threw, 'progress 0.99: completeDelivery does not run yet');
  assert(
    resolveTruckCityId(truck, 'istanbul') === 'istanbul',
    'progress 0.99: truck city remains origin until completion',
  );

  const simComplete = baseSimState({
    trucks: [truck],
    deliveries: [baseDelivery({ progress: 1, status: 'on_route' })],
  });
  const completed = completeDelivery(simComplete, 'delivery_1');
  const completedTruck = completed.trucks.find((item) => item.id === 'truck_1');
  assert(completedTruck?.currentCityId === 'ankara', 'progress 1: truck moves to destination');
  assert(completedTruck?.status === 'idle', 'progress 1: truck becomes idle');
}

console.log('\n3. Atomic fleet arrival helper');
{
  const truck = baseTruck({ currentCityId: 'istanbul', status: 'on_route' });
  const driver = baseDriver({ status: 'on_route' });
  const delivery = baseDelivery({ progress: 0.99, status: 'on_route' });
  const partial = applyFleetArrivalForDelivery([truck], [driver], delivery);
  const arrivedTruck = partial.trucks[0];
  assert(arrivedTruck.currentCityId === 'ankara', 'fleet arrival sets destination city');
  assert(arrivedTruck.status === 'idle', 'fleet arrival sets truck idle');
  assert(partial.drivers[0].status === 'idle', 'fleet arrival sets driver idle');
}

console.log('\n4. Save/load normalization preserves destination city');
{
  const completedTruck = baseTruck({
    currentCityId: 'ankara',
    homeCityId: 'istanbul',
    status: 'idle',
  });
  const normalized = normalizeTruckCity(completedTruck, 'istanbul');
  assert(
    normalized.currentCityId === 'ankara',
    'normalizeTruckCity keeps completed destination as currentCityId',
  );
}

console.log('\n5. Map location resolver');
{
  const truck = baseTruck({ currentCityId: 'ankara', status: 'idle' });
  const activeDelivery = baseDelivery({ progress: 0.5, status: 'on_route' });
  const mapBounds = { width: 1000, height: 562 };

  const onRoute = resolveTruckMapLocation({
    truck,
    activeDelivery,
    mapBounds,
    homeCityId: 'istanbul',
  });
  assert(onRoute.kind === 'route', 'active delivery → route point');
  assert(onRoute.pixelPoint != null, 'active delivery → pixel point');

  const idleAtCity = resolveTruckMapLocation({
    truck,
    mapBounds,
    homeCityId: 'istanbul',
  });
  assert(idleAtCity.kind === 'city', 'no active delivery → city marker');
  assert(idleAtCity.cityId === 'ankara', 'idle resolver uses truck currentCityId, not home');
  const expectedPos = getWorldMapCityPosition('ankara');
  assert(
    idleAtCity.normalizedPoint?.x === expectedPos?.x &&
      idleAtCity.normalizedPoint?.y === expectedPos?.y,
    'idle resolver uses WORLD_MAP_POSITIONS for truck city',
  );

  const staleCompletedDelivery = baseDelivery({ progress: 1, status: 'completed' });
  const afterCompletion = resolveTruckMapLocation({
    truck,
    activeDelivery: staleCompletedDelivery,
    mapBounds,
    homeCityId: 'istanbul',
  });
  assert(
    afterCompletion.kind === 'city' && afterCompletion.cityId === 'ankara',
    'completed delivery record is not used as map location source',
  );
  assert(
    !isActiveRunningDelivery(staleCompletedDelivery),
    'completed delivery excluded from active running filter',
  );
}

console.log('\n6. Tracking card city resolver');
{
  const truck = baseTruck({ currentCityId: 'ankara', status: 'idle' });
  const running = baseDelivery({ progress: 0.4, status: 'on_route' });

  assert(
    resolveTruckTrackingCityId(truck, running, 'istanbul') === 'ankara',
    'active delivery tracking shows destination city id',
  );
  assert(
    resolveTruckTrackingCityId(truck, undefined, 'istanbul') === 'ankara',
    'after completion tracking shows persistent truck city',
  );
  assert(
    resolveTruckPersistentCityId(
      { currentCityId: 'ankara', homeCityId: 'istanbul' },
      'istanbul',
    ) === 'ankara',
    'persistent resolver does not fall back to home when currentCityId is set',
  );
}

console.log(`\nPASS: ${passed}`);
console.log(`FAIL: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

console.log('✅ ALL PASS\n');
