/**
 * Yakıtsız kalma ve kısmi tick regresyon testi.
 * Run: npx tsx scripts/truck-out-of-fuel-test.ts
 */

import './test-globals';

import {
  completeDelivery,
  updateDeliveryProgressWithFuel,
} from '../src/simulation/delivery';
import { updateTransferProgressWithFuel } from '../src/simulation/truckTransfer';
import { updateWarehouseStockTransferProgressWithFuel } from '../src/simulation/warehouseStockTransfer';
import { resolveTruckMapLocation } from '../src/components/map/mapTruckLocation';
import { getTruckTrackingMetrics } from '../src/utils/truckTrackingMetrics';
import type {
  Contract,
  Delivery,
  Driver,
  SimulationGameState,
  Truck,
  TruckTransfer,
  WarehouseStockTransfer,
} from '../src/types/game';

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

function makeTruck(currentFuelL: number): Truck {
  return {
    id: 'truck_fuel_test',
    name: 'Fuel Test Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 100,
    currentFuelL,
    totalMileageKm: 0,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'on_route',
  } as Truck;
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery_fuel_test',
    contractId: 'contract_fuel_test',
    truckId: 'truck_fuel_test',
    driverId: 'driver_fuel_test',
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
    fuelLitersTotal: 20,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    distanceTraveledKm: 0,
    maintenanceCost: 20,
    estimatedProfit: 500,
    travelHours: 10,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    ...overrides,
  };
}

function makeTransfer(overrides: Partial<TruckTransfer> = {}): TruckTransfer {
  return {
    id: 'transfer_fuel_test',
    truckId: 'truck_fuel_test',
    driverId: 'driver_fuel_test',
    fromCityId: 'izmir',
    toCityId: 'istanbul',
    distanceKm: 100,
    startedAt: 0,
    estimatedArrivalAt: 10,
    progress: 0,
    fuelCost: 100,
    fuelLitersAtStart: 3,
    fuelLitersTotal: 10,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    distanceTraveledKm: 0,
    driverCost: 0,
    totalCost: 100,
    status: 'active',
    ...overrides,
  };
}

function makeWarehouseTransfer(
  overrides: Partial<WarehouseStockTransfer> = {},
): WarehouseStockTransfer {
  return {
    id: 'warehouse_transfer_fuel_test',
    sourceWarehouseId: 'warehouse_a',
    destinationWarehouseId: 'warehouse_b',
    sourceCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    quantityTons: 10,
    averagePurchasePriceAtStart: 100,
    reservedInventoryCost: 1000,
    truckId: 'truck_fuel_test',
    driverId: 'driver_fuel_test',
    routeDistanceKm: 100,
    progress: 0,
    status: 'active',
    startedAt: 0,
    estimatedCompletionAt: 10,
    fuelLitersAtStart: 3,
    fuelLitersTotal: 10,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    distanceTraveledKm: 0,
    fuelCost: 100,
    driverCost: 0,
    totalCost: 100,
    ...overrides,
  };
}

console.log('\n=== Truck Out Of Fuel Test ===');

console.log('\nA. Delivery');
const normalDelivery = updateDeliveryProgressWithFuel(
  makeDelivery(),
  makeTruck(100),
  2,
  2,
);
assert(closeTo(normalDelivery.delivery.progress, 0.2), 'yeterli yakıtla normal progress');
assert(closeTo(normalDelivery.truck.currentFuelL ?? -1, 96), 'normal tick yakıtı bir kez düşer');
assert(closeTo(normalDelivery.truck.totalMileageKm ?? -1, 20), 'mileage gerçek mesafe kadar artar');
const duplicateNormalTick = updateDeliveryProgressWithFuel(
  normalDelivery.delivery,
  normalDelivery.truck,
  2,
  2,
);
assert(
  closeTo(duplicateNormalTick.delivery.progress, normalDelivery.delivery.progress) &&
    closeTo(
      duplicateNormalTick.truck.currentFuelL ?? -1,
      normalDelivery.truck.currentFuelL ?? -2,
    ),
  'aynı tick ikinci kez progress veya yakıt tüketmez',
);

const partialDelivery = updateDeliveryProgressWithFuel(
  makeDelivery({
    fuelLitersAtStart: 3,
    fuelLitersTotal: 10,
  }),
  makeTruck(3),
  5,
);
assert(closeTo(partialDelivery.delivery.progress, 0.3), 'tick ortasında kısmi progress');
assert(partialDelivery.delivery.status === 'paused', 'delivery paused olur');
assert(partialDelivery.delivery.pausedReason === 'out-of-fuel', 'delivery pause nedeni yakıt');
assert(partialDelivery.truck.status === 'out_of_fuel', 'truck out_of_fuel olur');
assert((partialDelivery.truck.currentFuelL ?? -1) === 0, 'yakıt sıfırda kalır');
assert(partialDelivery.delivery.progress < 1, 'delivery completion seviyesine ulaşmaz');

const frozenDelivery = updateDeliveryProgressWithFuel(
  partialDelivery.delivery,
  partialDelivery.truck,
  5,
);
assert(
  closeTo(frozenDelivery.delivery.progress, partialDelivery.delivery.progress),
  'yakıtsız ikinci tick progress üretmez',
);
assert(
  closeTo(
    frozenDelivery.truck.totalMileageKm ?? -1,
    partialDelivery.truck.totalMileageKm ?? -2,
  ),
  'yakıtsız ikinci tick duplicate mileage üretmez',
);

console.log('\nB. Map marker');
const markerBefore = resolveTruckMapLocation({
  truck: partialDelivery.truck,
  activeDelivery: partialDelivery.delivery,
});
const markerAfter = resolveTruckMapLocation({
  truck: frozenDelivery.truck,
  activeDelivery: frozenDelivery.delivery,
});
assert(
  markerBefore.kind === 'route' &&
    markerAfter.kind === 'route' &&
    closeTo(markerBefore.normalizedPoint?.x ?? -1, markerAfter.normalizedPoint?.x ?? -2) &&
    closeTo(markerBefore.normalizedPoint?.y ?? -1, markerAfter.normalizedPoint?.y ?? -2),
  'paused delivery marker aynı rota noktasında kalır',
);
const tracking = getTruckTrackingMetrics({
  truck: frozenDelivery.truck,
  delivery: frozenDelivery.delivery,
});
assert(!tracking.isMoving && tracking.currentSpeedKmh === 0, 'paused tracking hızı sıfırdır');

console.log('\nC. Truck transfer');
const partialTransfer = updateTransferProgressWithFuel(
  makeTransfer(),
  { ...makeTruck(3), status: 'transferring' },
  5,
);
assert(closeTo(partialTransfer.transfer.progress, 0.3), 'truck transfer kısmi progress');
assert(partialTransfer.transfer.status === 'paused', 'truck transfer paused olur');
assert(partialTransfer.truck.currentFuelL === 0, 'truck transfer negatif yakıt üretmez');

console.log('\nD. Warehouse stock transfer');
const partialWarehouse = updateWarehouseStockTransferProgressWithFuel(
  makeWarehouseTransfer(),
  { ...makeTruck(3), status: 'transferring' },
  5,
);
assert(closeTo(partialWarehouse.transfer.progress, 0.3), 'warehouse transfer kısmi progress');
assert(partialWarehouse.transfer.status === 'paused', 'warehouse transfer paused olur');
assert(partialWarehouse.truck.currentFuelL === 0, 'warehouse transfer negatif yakıt üretmez');

console.log('\nE. Completion double-consumption guard');
const completedDelivery = makeDelivery({
  progress: 1,
  fuelLitersAtStart: 100,
  fuelLitersTotal: 10,
  fuelConsumedL: 10,
  lastFuelProcessedProgress: 1,
  distanceTraveledKm: 100,
});
const completedTruck = {
  ...makeTruck(90),
  totalMileageKm: 100,
};
const contract: Contract = {
  id: completedDelivery.contractId,
  originCityId: 'izmir',
  destinationCityId: 'istanbul',
  productId: 'machinery',
  amount: 10,
  cargoWeight: 10,
  payment: 1000,
  deadlineHours: 24,
  distanceKm: 100,
  urgency: 0.3,
  status: 'active',
  createdAt: 0,
  expiresAt: 100,
  requiredLevel: 1,
};
const driver = {
  id: 'driver_fuel_test',
  name: 'Test Driver',
  experience: 50,
  attention: 50,
  fuelSaving: 0,
  speed: 0,
  morale: 100,
  salaryPerDay: 100,
  hireCost: 0,
  assignedTruckId: completedTruck.id,
  status: 'driving',
} as Driver;
const state = {
  currentDay: 1,
  currentTime: 10,
  player: {
    companyName: 'Fuel Test',
    money: 1000,
    companyLevel: 1,
    homeCityId: 'izmir',
  },
  trucks: [completedTruck],
  drivers: [driver],
  warehouses: [],
  cities: {},
  contracts: [contract],
  deliveries: [completedDelivery],
} as SimulationGameState;
const completedState = completeDelivery(state, completedDelivery.id);
const truckAfterCompletion = completedState.trucks[0];
assert(closeTo(truckAfterCompletion.currentFuelL ?? -1, 90), 'completion yakıtı ikinci kez düşmez');
assert(closeTo(truckAfterCompletion.totalMileageKm ?? -1, 100), 'completion mileageı ikinci kez eklemez');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
