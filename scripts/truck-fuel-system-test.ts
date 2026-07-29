/**
 * Yakıt sisteminin birleşik kabul/regresyon testi.
 * Run: npx tsx scripts/truck-fuel-system-test.ts
 */

import './test-globals';

import {
  completeDelivery,
  updateDeliveryProgressWithFuel,
} from '../src/simulation/delivery';
import { updateTransferProgressWithFuel } from '../src/simulation/truckTransfer';
import { updateWarehouseStockTransferProgressWithFuel } from '../src/simulation/warehouseStockTransfer';
import { evaluateFuelWarning } from '../src/simulation/fuelWarnings';
import {
  calculateRoadsideFuelQuote,
  resumeRoadsideJob,
  validateRoadsideFuelPurchase,
} from '../src/simulation/roadsideFuel';
import { evaluateRoadsideFuelAssistance } from '../src/simulation/softLockRecovery';
import { shouldSkipDuplicateOfflineApply } from '../src/simulation/offlineProgression';
import {
  calculateTruckRefuelQuote,
  getTruckFuelReadiness,
  normalizeTruckFuel,
  validateTruckRefuelRequest,
} from '../src/utils/truckFuel';
import {
  normalizeSavePayload,
  payloadToStoreState,
  serializeGameState,
} from '../src/storage/saveGame';
import { FINANCE_LEDGER_MAX_COUNT } from '../src/utils/financeLedger';
import type {
  Contract,
  Delivery,
  Driver,
  FinanceLedgerEntry,
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
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function closeTo(actual: number, expected: number, epsilon = 0.001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function makeTruck(currentFuelL: number, status: Truck['status'] = 'on_route'): Truck {
  return {
    id: 'fuel_system_truck',
    catalogId: 'truck-starter-1',
    name: 'Fuel System Truck',
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
    status,
  };
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'fuel_system_delivery',
    contractId: 'fuel_system_contract',
    truckId: 'fuel_system_truck',
    driverId: 'fuel_system_driver',
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
    fuelLitersAtStart: 3,
    fuelLitersTotal: 10,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    lastFuelProcessedAt: 0,
    distanceTraveledKm: 0,
    fuelWarningsEmitted: [],
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
    id: 'fuel_system_transfer',
    truckId: 'fuel_system_truck',
    driverId: 'fuel_system_driver',
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
    lastFuelProcessedAt: 0,
    distanceTraveledKm: 0,
    fuelWarningsEmitted: [],
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
    id: 'fuel_system_warehouse_transfer',
    sourceWarehouseId: 'warehouse_a',
    destinationWarehouseId: 'warehouse_b',
    sourceCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    quantityTons: 5,
    averagePurchasePriceAtStart: 100,
    reservedInventoryCost: 500,
    qualityAtStart: 100,
    truckId: 'fuel_system_truck',
    driverId: 'fuel_system_driver',
    routeDistanceKm: 100,
    progress: 0,
    status: 'active',
    startedAt: 0,
    estimatedCompletionAt: 10,
    fuelLitersAtStart: 3,
    fuelLitersTotal: 10,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    lastFuelProcessedAt: 0,
    distanceTraveledKm: 0,
    fuelWarningsEmitted: [],
    fuelCost: 100,
    driverCost: 0,
    totalCost: 100,
    ...overrides,
  };
}

console.log('\n=== Truck Fuel System Test ===');

console.log('\nA. Refuel transaction');
const idleTruck = makeTruck(70, 'idle');
const quote = calculateTruckRefuelQuote(idleTruck, 50, 1.72);
const refuel = validateTruckRefuelRequest({
  truck: idleTruck,
  requestedLiters: 50,
  currentMoney: 1_000,
  currentUnitPrice: 1.72,
  expectedUnitPrice: 1.72,
});
assert(refuel.result.success && closeTo(quote.newFuelL, 100), 'normal refuel çalışır ve tankı clamp eder');
assert(closeTo(1_000 - quote.totalCost, 948.4), 'refuel cash maliyeti bir kez düşer');
const noCashRefuel = validateTruckRefuelRequest({
  truck: idleTruck,
  requestedLiters: 50,
  currentMoney: 10,
  currentUnitPrice: 1.72,
  expectedUnitPrice: 1.72,
});
assert(noCashRefuel.result.reason === 'insufficient-funds', 'normal refuel yetersiz cash engeli');
const readiness = getTruckFuelReadiness(makeTruck(3), 10, 1.72);
assert(!readiness.canCompleteWithoutRefuel && closeTo(readiness.fuelDeficitL, 7), 'iş öncesi yakıt kontrolü');

console.log('\nB. Out-of-fuel / partial tick / job types');
const partialDelivery = updateDeliveryProgressWithFuel(makeDelivery(), makeTruck(3), 10, 10);
assert(closeTo(partialDelivery.delivery.progress, 0.3), 'delivery partial tick doğru');
assert(partialDelivery.delivery.status === 'paused', 'delivery out-of-fuel pause');
assert(partialDelivery.truck.currentFuelL === 0, 'delivery yakıt sıfır');
const partialTransfer = updateTransferProgressWithFuel(makeTransfer(), makeTruck(3), 10, 10);
assert(closeTo(partialTransfer.transfer.progress, 0.3), 'truck transfer partial tick');
assert(partialTransfer.transfer.status === 'paused', 'truck transfer pause');
const partialWarehouse = updateWarehouseStockTransferProgressWithFuel(
  makeWarehouseTransfer(),
  makeTruck(3),
  10,
  10,
);
assert(closeTo(partialWarehouse.transfer.progress, 0.3), 'warehouse transfer partial tick');
assert(partialWarehouse.transfer.status === 'paused', 'warehouse transfer pause');

console.log('\nC. Offline + second hydrate');
const offlineDelivery = updateDeliveryProgressWithFuel(makeDelivery(), makeTruck(3), 500, 500);
const offlineProgress = offlineDelivery.delivery.progress;
const offlineMileage = offlineDelivery.truck.totalMileageKm ?? 0;
assert(closeTo(offlineProgress, 0.3), 'offline yalnız yakıtın yettiği mesafeye ilerler');
assert(offlineDelivery.delivery.status === 'paused', 'offline completion uygulanmaz');
const offlineSecondPass = updateDeliveryProgressWithFuel(
  offlineDelivery.delivery,
  offlineDelivery.truck,
  500,
  1_000,
);
assert(closeTo(offlineSecondPass.delivery.progress, offlineProgress), 'paused kalan offline süreyi işlemez');
assert(closeTo(offlineSecondPass.truck.totalMileageKm ?? 0, offlineMileage), 'ikinci hydrate mileage tüketmez');
assert(
  shouldSkipDuplicateOfflineApply(1_000, 2_000, 2_000),
  'offline hydrate timestamp duplicate apply engeli',
);
const firstWarning = evaluateFuelWarning(offlineDelivery.delivery, offlineDelivery.truck);
const secondWarning = evaluateFuelWarning(
  { ...offlineDelivery.delivery, fuelWarningsEmitted: firstWarning.fuelWarningsEmitted },
  offlineDelivery.truck,
);
assert(firstWarning.warning?.key === 'out-of-fuel', 'offline sonrası out-of-fuel warning');
assert(secondWarning.warning == null, 'ikinci hydrate warning dedupe');

console.log('\nD. Roadside resume');
const roadsideQuote = calculateRoadsideFuelQuote(offlineDelivery.truck, 25, 1.72);
const roadsidePurchase = validateRoadsideFuelPurchase({
  job: offlineDelivery.delivery,
  truck: offlineDelivery.truck,
  requestedLiters: 25,
  currentMoney: 1_000,
  currentUnitPrice: 1.72,
  expectedUnitPrice: 1.72,
});
assert(roadsidePurchase.result.success && roadsideQuote.source === 'roadside-emergency', 'roadside satın alma');
const resumed = resumeRoadsideJob(offlineDelivery.delivery, 'delivery', { litersAdded: 25 });
const resumedTruck = normalizeTruckFuel({ ...offlineDelivery.truck, currentFuelL: 25, status: 'on_route' });
const continued = updateDeliveryProgressWithFuel(resumed, resumedTruck, 1, 501);
assert(closeTo(resumed.progress, offlineProgress), 'resume progress sıfırlamaz');
assert(continued.delivery.progress > resumed.progress, 'roadside sonrası sonraki tick ilerler');
const assistance = evaluateRoadsideFuelAssistance({
  truck: offlineDelivery.truck,
  money: 0,
  fuelPrice: 1.72,
  currentTime: 100,
});
assert(assistance.allowed, 'soft-lock minimum yardım açılır');
const duplicateAssistance = evaluateRoadsideFuelAssistance({
  truck: offlineDelivery.truck,
  money: 0,
  fuelPrice: 1.72,
  currentTime: 200,
  jobAssistanceGrantedAt: 100,
});
assert(!duplicateAssistance.allowed, 'soft-lock yardımı idempotent');

console.log('\nE. Settlement double charge');
const completedDelivery = makeDelivery({
  progress: 1,
  fuelLitersAtStart: 100,
  fuelLitersTotal: 10,
  fuelConsumedL: 10,
  lastFuelProcessedProgress: 1,
  distanceTraveledKm: 100,
});
const completedTruck = { ...makeTruck(90), totalMileageKm: 100 };
const contract: Contract = {
  id: completedDelivery.contractId,
  originCityId: 'izmir',
  destinationCityId: 'istanbul',
  productId: 'machinery',
  amount: 10,
  cargoWeight: 10,
  payment: 1_000,
  deadlineHours: 24,
  distanceKm: 100,
  urgency: 0.3,
  status: 'active',
  createdAt: 0,
  expiresAt: 100,
  requiredLevel: 1,
};
const driver = {
  id: 'fuel_system_driver',
  name: 'Fuel Driver',
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
const settlementState = completeDelivery(
  {
    currentDay: 1,
    currentTime: 10,
    player: {
      companyName: 'Fuel Test',
      money: 1_000,
      companyLevel: 1,
      homeCityId: 'izmir',
    },
    trucks: [completedTruck],
    drivers: [driver],
    warehouses: [],
    cities: {},
    contracts: [contract],
    deliveries: [completedDelivery],
  } as SimulationGameState,
  completedDelivery.id,
);
assert(closeTo(settlementState.trucks[0].currentFuelL ?? -1, 90), 'settlement yakıtı tekrar düşmez');
assert(closeTo(settlementState.trucks[0].totalMileageKm ?? -1, 100), 'settlement mileage tekrar eklemez');

console.log('\nF. Save/load migration');
const rawPayload = {
  version: 1,
  currentTime: 100,
  player: {
    companyName: 'Legacy Fuel',
    money: 500,
    homeCityId: 'izmir',
    trucks: [
      {
        ...makeTruck(0, 'on_route'),
        currentFuelL: undefined,
        fuelTankCapacityL: undefined,
      },
      { ...makeTruck(-25, 'idle'), id: 'negative_truck', fuelTankCapacityL: 100 },
      { ...makeTruck(999, 'idle'), id: 'overflow_truck', fuelTankCapacityL: 100 },
      {
        ...makeTruck(Number.POSITIVE_INFINITY, 'idle'),
        id: 'infinite_truck',
        fuelTankCapacityL: Number.POSITIVE_INFINITY,
      },
    ],
    drivers: [driver],
    warehouses: [],
    trailers: [],
  },
  activeDeliveries: [
    {
      ...makeDelivery({
        status: 'paused',
        pausedReason: undefined,
        progress: 0.4,
        fuelConsumedL: Number.NaN,
        lastFuelProcessedProgress: undefined,
        lastFuelProcessedAt: undefined,
      }),
      truckId: 'fuel_system_truck',
    },
  ],
  fuelTransactionKeys: Array.from({ length: 50 }, (_, index) => `fuel-key-${index}`),
  lastRoadsideFuelAssistanceAt: 88,
} as Record<string, unknown>;
const migrated = normalizeSavePayload(rawPayload);
const loaded = payloadToStoreState(migrated);
const legacyTruck = loaded.player.trucks.find((truck) => truck.id === 'fuel_system_truck')!;
assert((legacyTruck.fuelTankCapacityL ?? 0) > 0, 'eski save tank kapasitesi hydrate edilir');
assert((legacyTruck.currentFuelL ?? 0) > 0, 'eski save currentFuel class/default ile hydrate edilir');
assert(loaded.player.trucks.find((truck) => truck.id === 'negative_truck')?.currentFuelL === 0, 'negatif fuel normalize');
assert(loaded.player.trucks.find((truck) => truck.id === 'overflow_truck')?.currentFuelL === 100, 'tank overflow clamp');
const infiniteTruck = loaded.player.trucks.find((truck) => truck.id === 'infinite_truck')!;
assert(Number.isFinite(infiniteTruck.fuelTankCapacityL), 'Infinity kapasite normalize');
assert(Number.isFinite(infiniteTruck.currentFuelL), 'Infinity fuel normalize');
const legacyJob = loaded.activeDeliveries[0];
assert(Number.isFinite(legacyJob.fuelConsumedL), 'NaN job fuelConsumed normalize');
assert(closeTo(legacyJob.lastFuelProcessedProgress ?? -1, legacyJob.progress), 'legacy processed progress güvenli baseline');
assert(legacyJob.status === 'on_route' && legacyJob.pausedReason == null, 'pausedReason olmayan legacy job güvenli active default');
assert(loaded.lastRoadsideFuelAssistanceAt === 88, 'emergency cooldown save/load');
assert((loaded.fuelTransactionKeys ?? []).length === 32, 'refuel idempotency anahtarları son N ile sınırlı');

console.log('\nG. Cloud save payload bounds');
const oversizedLedger: FinanceLedgerEntry[] = Array.from(
  { length: FINANCE_LEDGER_MAX_COUNT + 50 },
  (_, index) => ({
    id: `ledger-${index}`,
    time: index,
    type: 'expense',
    category: 'fuel',
    amount: 1,
  }),
);
const cloudPayload = serializeGameState({
  ...loaded,
  financeLedger: oversizedLedger,
  fuelTransactionKeys: Array.from({ length: 80 }, (_, index) => `retry-${index}`),
});
assert(cloudPayload.financeLedger.length === FINANCE_LEDGER_MAX_COUNT, 'cloud ledger mevcut limite uyar');
assert((cloudPayload.fuelTransactionKeys ?? []).length === 32, 'cloud refuel key listesi bounded');
assert(cloudPayload.products.length === 0 && cloudPayload.routes.length === 0, 'static catalog cloud save dışında');
const serialized = JSON.stringify(cloudPayload);
assert(!serialized.includes('snapshotHistory'), 'global snapshot history save edilmez');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
