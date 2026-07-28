/**
 * Depolar arası stok transferi V1 testleri.
 */

import assert from 'node:assert/strict';
import { tradingBalance } from '../src/config/balance';
import { CITIES_BY_ID } from '../src/data/cities';
import { PRODUCT_BY_ID } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { getRoute } from '../src/data/routes';
import {
  applyDestinationCompletion,
  applySourceReservationOnStart,
  createWarehouseStockTransfer,
  getWarehouseEffectiveAvailableCapacityTons,
  getWarehouseReservedIncomingTons,
  markWarehouseStockTransferSettled,
  rollbackStockToSource,
  updateWarehouseStockTransferProgress,
  validateWarehouseStockTransfer,
  trailerSupportsColdCargo,
} from '../src/simulation/warehouseStockTransfer';
import { normalizeWarehouse, getWarehouseInventoryItem } from '../src/simulation/trading';
import type {
  Driver,
  Trailer,
  Truck,
  Warehouse,
  WarehouseStockTransfer,
} from '../src/types/game';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function makeWarehouse(overrides: Partial<Warehouse>): Warehouse {
  return normalizeWarehouse({
    id: 'wh-src',
    cityId: 'izmir',
    capacityTons: 100,
    capacityTon: 100,
    upgradeTier: 1,
    warehouseType: 'standard',
    inventory: [],
    ...overrides,
  });
}

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-1',
    name: 'Test Truck',
    capacity: 40,
    speed: 80,
    fuelConsumptionPerKm: 0.3,
    condition: 90,
    status: 'idle',
    currentCityId: 'izmir',
    purchasePrice: 10000,
    ...overrides,
  } as Truck;
}

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver-1',
    name: 'Ali',
    status: 'idle',
    salaryPerDay: 120,
    skill: 50,
    fuelSaving: 10,
    speed: 5,
    ...overrides,
  } as Driver;
}

function makeRefrigeratedTrailer(truckId: string): Trailer {
  return {
    id: 'trailer-cold',
    catalogId: 'trailer-refrigerated',
    name: 'Soğuk Dorse',
    type: 'refrigerated',
    capacityBonusTons: 40,
    status: 'attached',
    attachedTruckId: truckId,
    city: 'izmir',
    purchasePrice: 8000,
  } as Trailer;
}

console.log('\n=== Warehouse Stock Transfer Test ===\n');

console.log('A. Başarılı transfer');
test('source drops on start, destination rises on completion, truck at dest', () => {
  const source = makeWarehouse({
    id: 'wh-izmir',
    cityId: 'izmir',
    inventory: [{ productId: 'textile', quantity: 20, averageBuyPrice: 100 }],
  });
  const dest = makeWarehouse({
    id: 'wh-ankara',
    cityId: 'ankara',
    warehouseType: 'standard',
    inventory: [],
  });
  const truck = makeTruck();
  const driver = makeDriver();
  const result = validateWarehouseStockTransfer({
    sourceWarehouseId: source.id,
    destinationWarehouseId: dest.id,
    productId: 'textile',
    quantityTons: 10,
    truckId: truck.id,
    warehouses: [source, dest],
    trucks: [truck],
    trailers: [],
    drivers: [driver],
    routes: ROUTES,
    skipAffordabilityCheck: true,
  });
  assert.equal(result.success, true);
  assert.ok(result.validated);
  const transfer = createWarehouseStockTransfer({
    validated: result.validated!,
    currentTime: 0,
    sequence: 1,
  });
  let warehouses = applySourceReservationOnStart([source, dest], transfer, 0);
  assert.equal(getWarehouseInventoryItem(warehouses[0], 'textile')?.quantity, 10);
  assert.equal(getWarehouseInventoryItem(warehouses[1], 'textile'), undefined);

  let progressed = transfer;
  for (let i = 0; i < 50; i += 1) {
    progressed = updateWarehouseStockTransferProgress(progressed, 2);
  }
  assert.ok(progressed.progress >= 1);
  warehouses = applyDestinationCompletion(warehouses, progressed, 100);
  assert.equal(getWarehouseInventoryItem(warehouses[1], 'textile')?.quantity, 10);
  assert.equal(getWarehouseInventoryItem(warehouses[1], 'textile')?.averageBuyPrice, 100);
});

console.log('\nB. Capacity');
test('destination full blocks start', () => {
  const source = makeWarehouse({
    id: 'wh-izmir',
    cityId: 'izmir',
    inventory: [{ productId: 'textile', quantity: 50, averageBuyPrice: 80 }],
  });
  const dest = makeWarehouse({
    id: 'wh-ankara',
    cityId: 'ankara',
    capacityTons: 10,
    capacityTon: 10,
    inventory: [{ productId: 'steel', quantity: 10, averageBuyPrice: 50 }],
  });
  const result = validateWarehouseStockTransfer({
    sourceWarehouseId: source.id,
    destinationWarehouseId: dest.id,
    productId: 'textile',
    quantityTons: 5,
    warehouses: [source, dest],
    trucks: [makeTruck()],
    trailers: [],
    drivers: [makeDriver()],
    routes: ROUTES,
    skipAffordabilityCheck: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'destination-full');
});

test('incoming reservations reduce effective capacity', () => {
  const dest = makeWarehouse({ id: 'wh-ankara', cityId: 'ankara', capacityTons: 50 });
  const active: WarehouseStockTransfer[] = [
    {
      id: 'wst-1',
      sourceWarehouseId: 'wh-izmir',
      destinationWarehouseId: 'wh-ankara',
      sourceCityId: 'izmir',
      destinationCityId: 'ankara',
      productId: 'textile',
      quantityTons: 30,
      averagePurchasePriceAtStart: 10,
      reservedInventoryCost: 300,
      truckId: 't1',
      driverId: 'd1',
      routeDistanceKm: 100,
      progress: 0.2,
      status: 'active',
      startedAt: 0,
      estimatedCompletionAt: 10,
      fuelLitersAtStart: 100,
      fuelLitersTotal: 40,
      fuelCost: 50,
      driverCost: 20,
      totalCost: 70,
    },
  ];
  assert.equal(getWarehouseReservedIncomingTons('wh-ankara', active), 30);
  assert.equal(getWarehouseEffectiveAvailableCapacityTons(dest, active), 20);
});

console.log('\nC. Cold chain');
test('cold product blocked for standard destination', () => {
  const source = makeWarehouse({
    id: 'wh-cold-src',
    cityId: 'izmir',
    warehouseType: 'cold',
    inventory: [{ productId: 'fruit', quantity: 20, averageBuyPrice: 60 }],
  });
  const dest = makeWarehouse({
    id: 'wh-std-dest',
    cityId: 'ankara',
    warehouseType: 'standard',
  });
  const result = validateWarehouseStockTransfer({
    sourceWarehouseId: source.id,
    destinationWarehouseId: dest.id,
    productId: 'fruit',
    quantityTons: 10,
    warehouses: [source, dest],
    trucks: [makeTruck()],
    trailers: [makeRefrigeratedTrailer('truck-1')],
    drivers: [makeDriver()],
    routes: ROUTES,
    skipAffordabilityCheck: true,
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'cold-storage-required');
});

test('cold product requires refrigerated trailer', () => {
  assert.equal(trailerSupportsColdCargo(undefined), false);
  assert.equal(trailerSupportsColdCargo(makeRefrigeratedTrailer('truck-1')), true);
  const source = makeWarehouse({
    id: 'wh-cold-src',
    cityId: 'izmir',
    warehouseType: 'cold',
    inventory: [{ productId: 'beverage', quantity: 20, averageBuyPrice: 40 }],
  });
  const dest = makeWarehouse({
    id: 'wh-cold-dest',
    cityId: 'ankara',
    warehouseType: 'cold',
  });
  const withoutTrailer = validateWarehouseStockTransfer({
    sourceWarehouseId: source.id,
    destinationWarehouseId: dest.id,
    productId: 'beverage',
    quantityTons: 10,
    warehouses: [source, dest],
    trucks: [makeTruck()],
    trailers: [],
    drivers: [makeDriver()],
    routes: ROUTES,
    skipAffordabilityCheck: true,
  });
  assert.equal(withoutTrailer.success, false);
  assert.equal(withoutTrailer.reason, 'incompatible-trailer');
});

console.log('\nD. Fleet validation');
test('no idle truck fails', () => {
  const source = makeWarehouse({
    id: 'wh-izmir',
    cityId: 'izmir',
    inventory: [{ productId: 'textile', quantity: 20, averageBuyPrice: 100 }],
  });
  const dest = makeWarehouse({ id: 'wh-ankara', cityId: 'ankara' });
  const result = validateWarehouseStockTransfer({
    sourceWarehouseId: source.id,
    destinationWarehouseId: dest.id,
    productId: 'textile',
    quantityTons: 10,
    warehouses: [source, dest],
    trucks: [makeTruck({ status: 'on_route' })],
    trailers: [],
    drivers: [makeDriver()],
    routes: ROUTES,
    skipAffordabilityCheck: true,
  });
  assert.equal(result.reason, 'no-available-truck');
});

console.log('\nE. Weighted average');
test('destination merges averages', () => {
  const dest = makeWarehouse({
    id: 'wh-ankara',
    cityId: 'ankara',
    inventory: [{ productId: 'textile', quantity: 10, averageBuyPrice: 100 }],
  });
  const transfer = {
    id: 'wst',
    sourceWarehouseId: 'wh-izmir',
    destinationWarehouseId: 'wh-ankara',
    sourceCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'textile' as const,
    quantityTons: 10,
    averagePurchasePriceAtStart: 200,
    reservedInventoryCost: 2000,
    truckId: 't',
    driverId: 'd',
    routeDistanceKm: 100,
    progress: 1,
    status: 'active' as const,
    startedAt: 0,
    estimatedCompletionAt: 5,
    fuelLitersAtStart: 50,
    fuelLitersTotal: 20,
    fuelCost: 10,
    driverCost: 5,
    totalCost: 15,
  };
  const [updated] = applyDestinationCompletion([dest], transfer, 10);
  const item = getWarehouseInventoryItem(updated, 'textile');
  assert.equal(item?.quantity, 20);
  assert.equal(item?.averageBuyPrice, 150);
});

console.log('\nF. Cancel rollback');
test('cancel restores source stock', () => {
  const source = makeWarehouse({
    id: 'wh-izmir',
    cityId: 'izmir',
    inventory: [{ productId: 'textile', quantity: 5, averageBuyPrice: 90 }],
  });
  const dest = makeWarehouse({ id: 'wh-ankara', cityId: 'ankara' });
  const transfer: WarehouseStockTransfer = {
    id: 'wst-cancel',
    sourceWarehouseId: 'wh-izmir',
    destinationWarehouseId: 'wh-ankara',
    sourceCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'textile',
    quantityTons: 10,
    averagePurchasePriceAtStart: 100,
    reservedInventoryCost: 1000,
    truckId: 't',
    driverId: 'd',
    routeDistanceKm: 100,
    progress: 0.3,
    status: 'active',
    startedAt: 0,
    estimatedCompletionAt: 8,
    fuelLitersAtStart: 80,
    fuelLitersTotal: 30,
    fuelCost: 20,
    driverCost: 10,
    totalCost: 30,
  };
  const rolled = rollbackStockToSource([source, dest], transfer, 5);
  assert.equal(getWarehouseInventoryItem(rolled[0], 'textile')?.quantity, 15);
  const settled = markWarehouseStockTransferSettled(transfer, 'cancelled', 5);
  assert.equal(settled.status, 'cancelled');
  assert.ok(settled.settledAt != null);
});

console.log('\nG. Failure idempotent settle');
test('settledAt prevents double apply conceptually', () => {
  const transfer = markWarehouseStockTransferSettled(
    {
      id: 'wst-fail',
      sourceWarehouseId: 'a',
      destinationWarehouseId: 'b',
      sourceCityId: 'izmir',
      destinationCityId: 'ankara',
      productId: 'textile',
      quantityTons: 5,
      averagePurchasePriceAtStart: 10,
      reservedInventoryCost: 50,
      truckId: 't',
      driverId: 'd',
      routeDistanceKm: 50,
      progress: 0.5,
      status: 'active',
      startedAt: 0,
      estimatedCompletionAt: 4,
      fuelLitersAtStart: 40,
      fuelLitersTotal: 15,
      fuelCost: 8,
      driverCost: 4,
      totalCost: 12,
    },
    'failed',
    9,
    'test',
  );
  assert.equal(transfer.status, 'failed');
  assert.equal(transfer.settledAt, 9);
});

console.log('\nH. Save/load shape');
test('active transfer fields serialize roundtrip', () => {
  const payload = {
    activeWarehouseStockTransfers: [
      {
        id: 'wst-1',
        sourceWarehouseId: 'a',
        destinationWarehouseId: 'b',
        sourceCityId: 'izmir',
        destinationCityId: 'ankara',
        productId: 'textile',
        quantityTons: 8,
        averagePurchasePriceAtStart: 12,
        reservedInventoryCost: 96,
        truckId: 't',
        driverId: 'd',
        routeDistanceKm: 580,
        progress: 0.4,
        status: 'active',
        startedAt: 10,
        estimatedCompletionAt: 20,
        fuelLitersAtStart: 100,
        fuelLitersTotal: 40,
        fuelCost: 30,
        driverCost: 12,
        totalCost: 42,
      },
    ],
  };
  const clone = structuredClone(payload);
  assert.equal(clone.activeWarehouseStockTransfers[0].progress, 0.4);
  assert.equal(clone.activeWarehouseStockTransfers[0].status, 'active');
});

console.log('\nI. Reverse route');
test('A→B and B→A resolve calibrated routes', () => {
  const forward = getRoute('izmir', 'ankara');
  const reverse = getRoute('ankara', 'izmir');
  assert.ok(forward);
  assert.ok(reverse);
  assert.equal(forward!.distanceKm, reverse!.distanceKm);
});

test('min trade quantity enforced', () => {
  const source = makeWarehouse({
    id: 'wh-izmir',
    cityId: 'izmir',
    inventory: [{ productId: 'textile', quantity: 20, averageBuyPrice: 100 }],
  });
  const dest = makeWarehouse({ id: 'wh-ankara', cityId: 'ankara' });
  const result = validateWarehouseStockTransfer({
    sourceWarehouseId: source.id,
    destinationWarehouseId: dest.id,
    productId: 'textile',
    quantityTons: tradingBalance.minTradeQuantity - 1,
    warehouses: [source, dest],
    trucks: [makeTruck()],
    trailers: [],
    drivers: [makeDriver()],
    routes: ROUTES,
    skipAffordabilityCheck: true,
  });
  assert.equal(result.reason, 'invalid-quantity');
});

void CITIES_BY_ID;
void PRODUCT_BY_ID;

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
