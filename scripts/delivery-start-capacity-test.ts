/**
 * Delivery start capacity — createDelivery + shared eligibility consistency.
 * Run: npx tsx scripts/delivery-start-capacity-test.ts
 */

import './test-globals';

import {
  buildDeliveryStartCapacitySnapshot,
  createDelivery,
  DeliveryError,
} from '../src/simulation/delivery';
import { evaluateContractTruckEligibility } from '../src/simulation/contractTruckEligibility';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import type { Contract, Driver, Product, Route, Trailer, Truck } from '../src/types/game';

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

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver_1',
    name: 'Ali',
    experience: 50,
    attention: 70,
    fuelSaving: 40,
    speed: 10,
    morale: 80,
    salaryPerDay: 200,
    hireCost: 1000,
    assignedTruckId: 'truck_marmara',
    status: 'idle',
    level: 2,
    ...overrides,
  } as Driver;
}

function makeHeavyTrailer(truckId: string, overrides: Partial<Trailer> = {}): Trailer {
  return {
    id: `trailer_heavy_${truckId}`,
    name: 'Ağır Yük Dorsesi',
    type: 'heavy',
    capacityBonusTons: 70,
    catalogId: 'trailer-heavy',
    purchasePrice: 48_000,
    condition: 100,
    city: 'ankara',
    status: 'attached',
    attachedTruckId: truckId,
    isOwned: true,
    createdAtGameTime: 0,
    ...overrides,
  };
}

function makeLightTrailer(truckId: string): Trailer {
  return {
    id: `trailer_light_${truckId}`,
    name: 'Standart Dorse',
    type: 'standard',
    capacityBonusTons: 20,
    catalogId: 'trailer-standard',
    purchasePrice: 18_000,
    condition: 100,
    city: 'ankara',
    status: 'attached',
    attachedTruckId: truckId,
    isOwned: true,
    createdAtGameTime: 0,
  };
}

function makeMarmaraTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck_marmara',
    name: 'Marmara Heavy',
    capacity: 40,
    fuelConsumptionPerKm: 0.42,
    speed: 65,
    reliability: 90,
    maintenanceCost: 0.28,
    comfort: 70,
    condition: 95,
    purchasePrice: 125_000,
    currentCityId: 'ankara',
    homeCityId: 'ankara',
    status: 'idle',
    catalogId: 'truck-heavy-haul',
    ...overrides,
  } as Truck;
}

function makeNordvikTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck_nordvik',
    name: 'Nordvik Titan',
    capacity: 30,
    fuelConsumptionPerKm: 0.28,
    speed: 78,
    reliability: 88,
    maintenanceCost: 0.22,
    comfort: 75,
    condition: 95,
    purchasePrice: 85_000,
    currentCityId: 'ankara',
    homeCityId: 'ankara',
    status: 'idle',
    catalogId: 'truck-volvo-fh',
    ...overrides,
  } as Truck;
}

function makeContract(tonnage = 77): Contract {
  return {
    id: 'c_ankara_adana_77',
    originCityId: 'ankara',
    destinationCityId: 'adana',
    productId: 'electronics',
    amount: tonnage,
    cargoWeight: tonnage,
    payment: 45_000,
    deadlineHours: 24,
    distanceKm: 550,
    urgency: 0.4,
    status: 'available',
    createdAt: 100,
    expiresAt: 10_000,
    requiredLevel: 1,
    contractType: 'bulk',
    riskLevel: 'low',
  } as Contract;
}

const product: Product = {
  id: 'electronics',
  name: 'Elektronik',
  basePrice: 100,
  volatility: 0.2,
  perishability: 0,
  weightPerUnit: 1,
};

const route: Route = {
  id: 'route_ankara_adana',
  originCityId: 'ankara',
  destinationCityId: 'adana',
  distanceKm: 550,
  roadQuality: 0.75,
  trafficFactor: 0.3,
};

function tryCreateDelivery(params: {
  contract: Contract;
  truck: Truck;
  driver: Driver;
  trailers: Trailer[];
}): { ok: true; deliveryId: string } | { ok: false; message: string } {
  try {
    const delivery = createDelivery({
      contract: params.contract,
      truck: params.truck,
      driver: params.driver,
      route,
      product,
      globalEconomy: DEFAULT_GLOBAL_ECONOMY,
      currentTime: 1000,
      sequence: 1,
      trailers: params.trailers,
    });
    return { ok: true, deliveryId: delivery.id };
  } catch (error) {
    const message =
      error instanceof DeliveryError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, message };
  }
}

console.log('\n=== Delivery Start Capacity Test ===\n');

console.log('A. Marmara Heavy + heavy trailer (40 + 70 = 110), contract 77 t');
{
  const truck = makeMarmaraTruck();
  const trailer = makeHeavyTrailer(truck.id);
  const trailers = [trailer];
  const contract = makeContract(77);
  const driver = makeDriver({ assignedTruckId: truck.id });

  const snapshot = buildDeliveryStartCapacitySnapshot({ contract, truck, trailers, product });
  assert(snapshot.rawTruckCapacity === 40, 'Marmara raw capacity 40', String(snapshot.rawTruckCapacity));
  assert(snapshot.trailerCapacity === 70, 'Heavy trailer bonus 70', String(snapshot.trailerCapacity));
  assert(snapshot.effectiveCapacity === 110, 'Effective capacity 110', String(snapshot.effectiveCapacity));
  assert(snapshot.capacityEnough === true, 'Capacity enough for 77 t');

  const result = tryCreateDelivery({ contract, truck, driver, trailers });
  assert(result.ok === true, 'createDelivery succeeds for Marmara + heavy trailer');
}

console.log('\nB. Nordvik Titan + heavy trailer (30 + 70 = 100), contract 77 t');
{
  const truck = makeNordvikTruck();
  const trailer = makeHeavyTrailer(truck.id);
  const trailers = [trailer];
  const contract = makeContract(77);
  const driver = makeDriver({ assignedTruckId: truck.id });

  const snapshot = buildDeliveryStartCapacitySnapshot({ contract, truck, trailers, product });
  assert(snapshot.rawTruckCapacity === 30, 'Nordvik raw capacity 30', String(snapshot.rawTruckCapacity));
  assert(snapshot.trailerCapacity === 70, 'Heavy trailer bonus 70', String(snapshot.trailerCapacity));
  assert(snapshot.effectiveCapacity === 100, 'Effective capacity 100', String(snapshot.effectiveCapacity));
  assert(snapshot.capacityEnough === true, 'Capacity enough for 77 t');

  const result = tryCreateDelivery({ contract, truck, driver, trailers });
  assert(result.ok === true, 'createDelivery succeeds for Nordvik + heavy trailer');
}

console.log('\nC. Trailer detached — Marmara raw 40, contract 77 fails with effective 40');
{
  const truck = makeMarmaraTruck();
  const detachedTrailer = makeHeavyTrailer(truck.id, {
    status: 'idle',
    attachedTruckId: undefined,
  });
  const contract = makeContract(77);
  const driver = makeDriver({ assignedTruckId: truck.id });

  const snapshot = buildDeliveryStartCapacitySnapshot({
    contract,
    truck,
    trailers: [detachedTrailer],
    product,
  });
  assert(snapshot.effectiveCapacity === 40, 'Effective capacity falls back to 40', String(snapshot.effectiveCapacity));

  const result = tryCreateDelivery({ contract, truck, driver, trailers: [detachedTrailer] });
  assert(result.ok === false, 'createDelivery fails without attached trailer');
  if (!result.ok) {
    assert(
      result.message.includes('40.0 t efektif kapasite'),
      'Error shows effective capacity 40',
      result.message,
    );
    assert(!result.message.includes('/ 40 ton kapasite'), 'No legacy raw-only message', result.message);
  }
}

console.log('\nD. Insufficient trailer — truck 40 + trailer 20 = 60, contract 77 fails');
{
  const truck = makeMarmaraTruck();
  const trailer = makeLightTrailer(truck.id);
  const contract = makeContract(77);
  const driver = makeDriver({ assignedTruckId: truck.id });

  const snapshot = buildDeliveryStartCapacitySnapshot({
    contract,
    truck,
    trailers: [trailer],
    product,
  });
  assert(snapshot.effectiveCapacity === 60, 'Effective capacity 60', String(snapshot.effectiveCapacity));

  const result = tryCreateDelivery({ contract, truck, driver, trailers: [trailer] });
  assert(result.ok === false, 'createDelivery fails for 60 t effective vs 77 t load');
  if (!result.ok) {
    assert(
      result.message.includes('60.0 t efektif kapasite'),
      'Error shows effective capacity 60',
      result.message,
    );
  }
}

console.log('\nE. UI/motor consistency — eligible === createDelivery success');
{
  const truck = makeMarmaraTruck();
  const trailer = makeHeavyTrailer(truck.id);
  const trailers = [trailer];
  const contract = makeContract(77);
  const driver = makeDriver({ assignedTruckId: truck.id });

  const eligibility = evaluateContractTruckEligibility({
    contract,
    truck,
    drivers: [driver],
    trailers,
    product,
    fallbackHomeCityId: 'ankara',
  });

  assert(
    eligibility.eligible === true,
    'evaluateContractTruckEligibility eligible',
    eligibility.rejectionReasons.join('; '),
  );

  const result = tryCreateDelivery({ contract, truck, driver, trailers });
  assert(result.ok === true, 'createDelivery does not reject when eligibility is true');
}

console.log('\nF. Stale trailer state — modal had trailer, detached before start');
{
  const truck = makeMarmaraTruck();
  const trailerAtOpen = makeHeavyTrailer(truck.id);
  const contract = makeContract(77);
  const driver = makeDriver({ assignedTruckId: truck.id });

  const openSnapshot = buildDeliveryStartCapacitySnapshot({
    contract,
    truck,
    trailers: [trailerAtOpen],
    product,
  });
  assert(openSnapshot.capacityEnough === true, 'Modal-open snapshot had enough capacity');

  const detachedTrailer = { ...trailerAtOpen, status: 'idle' as const, attachedTruckId: undefined };
  const startSnapshot = buildDeliveryStartCapacitySnapshot({
    contract,
    truck,
    trailers: [detachedTrailer],
    product,
  });
  assert(startSnapshot.capacityEnough === false, 'Final validation uses current detached state');

  const result = tryCreateDelivery({ contract, truck, driver, trailers: [detachedTrailer] });
  assert(result.ok === false, 'createDelivery rejects after trailer detached');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
