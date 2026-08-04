/** Offline/background delivery progression regression guard. */
import './test-globals';

import { simulationTimeScale } from '../src/config/balance';
import { resolveTruckMapLocation } from '../src/components/map/mapTruckLocation';
import { updateDeliveryProgressWithFuel } from '../src/simulation/delivery';
import {
  applyOfflineProgress,
  MAX_OFFLINE_PROGRESS_HOURS,
} from '../src/simulation/offlineProgression';
import { updateTransferProgressWithFuel } from '../src/simulation/truckTransfer';
import { updateWarehouseStockTransferProgressWithFuel } from '../src/simulation/warehouseStockTransfer';
import type { Delivery, Truck, TruckTransfer, WarehouseStockTransfer } from '../src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function truck(fuel = 100): Truck {
  return {
    id: 'offline-truck',
    name: 'Offline Truck',
    capacity: 25,
    fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 120,
    currentFuelL: fuel,
    totalMileageKm: 34,
    speed: 65,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'on_route',
  };
}

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'offline-delivery',
    contractId: 'offline-contract',
    truckId: 'offline-truck',
    driverId: 'offline-driver',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 100,
    progress: 0.34,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 100,
    deadlineTime: 80,
    fuelCost: 60,
    fuelLitersAtStart: 100,
    fuelLitersTotal: 30,
    fuelConsumedL: 10.2,
    lastFuelProcessedProgress: 0.34,
    lastFuelProcessedAt: 34,
    distanceTraveledKm: 34,
    fuelWarningsEmitted: [],
    maintenanceCost: 20,
    estimatedProfit: 500,
    travelHours: 100,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    ...overrides,
  };
}

function transfer(): TruckTransfer {
  return {
    id: 'offline-transfer',
    truckId: 'offline-truck',
    driverId: 'offline-driver',
    fromCityId: 'izmir',
    toCityId: 'istanbul',
    distanceKm: 100,
    startedAt: 0,
    estimatedArrivalAt: 10,
    progress: 0.34,
    fuelCost: 60,
    fuelLitersAtStart: 100,
    fuelLitersTotal: 30,
    fuelConsumedL: 10.2,
    lastFuelProcessedProgress: 0.34,
    lastFuelProcessedAt: 34,
    distanceTraveledKm: 34,
    driverCost: 0,
    totalCost: 60,
    status: 'active',
  };
}

function warehouseTransfer(): WarehouseStockTransfer {
  return {
    id: 'offline-warehouse-transfer',
    sourceWarehouseId: 'warehouse-a',
    destinationWarehouseId: 'warehouse-b',
    sourceCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    quantityTons: 5,
    averagePurchasePriceAtStart: 100,
    reservedInventoryCost: 500,
    qualityAtStart: 100,
    truckId: 'offline-truck',
    driverId: 'offline-driver',
    routeDistanceKm: 100,
    progress: 0.34,
    status: 'active',
    startedAt: 0,
    estimatedCompletionAt: 10,
    fuelLitersAtStart: 100,
    fuelLitersTotal: 30,
    fuelConsumedL: 10.2,
    lastFuelProcessedProgress: 0.34,
    lastFuelProcessedAt: 34,
    distanceTraveledKm: 34,
    fuelCost: 60,
    driverCost: 0,
    totalCost: 60,
  };
}

console.log('\n=== offline-delivery-progress-regression-test ===\n');

const nowMs = 1_800_000_000_000;
const tenMinutes = applyOfflineProgress({
  nowMs,
  lastSimulatedRealTimeMs: nowMs - 10 * 60_000,
  lastOfflineProgressAppliedAt: nowMs - 20 * 60_000,
  gameState: { gameSpeed: 1, lastSimulationGameSpeed: 1 },
});
assert(tenMinutes.elapsed.shouldApply, '10 dakika background süresi uygulanır');
assert(tenMinutes.simulation.appliedSimulationHours > 0, 'gerçek süre simülasyon saatine dönüşür');
assert(
  tenMinutes.simulation.appliedSimulationHours <= MAX_OFFLINE_PROGRESS_HOURS,
  'offline simulation 24 saat tavanını aşmaz',
);

const partial = updateDeliveryProgressWithFuel(
  delivery(),
  truck(),
  Math.min(10, tenMinutes.simulation.appliedSimulationHours),
  nowMs,
);
assert(partial.delivery.progress > 0.34, '%34 teslimat offline sürede ilerler');
assert(partial.delivery.progress <= 1, 'teslimat progress 0..1 aralığında kalır');
const beforeMarker = resolveTruckMapLocation({ truck: truck(), activeDelivery: delivery() });
const afterMarker = resolveTruckMapLocation({ truck: partial.truck, activeDelivery: partial.delivery });
assert(
  beforeMarker.normalizedPoint?.x !== afterMarker.normalizedPoint?.x ||
    beforeMarker.normalizedPoint?.y !== afterMarker.normalizedPoint?.y,
  'rota marker konumu yeni progress ile değişir',
);

const completed = updateDeliveryProgressWithFuel(delivery({ travelHours: 10, estimatedArrivalTime: 10 }), truck(), 10, nowMs);
assert(completed.delivery.progress === 1, 'yeterli offline sürede teslimat completion noktasına gelir');
const duplicate = updateDeliveryProgressWithFuel(completed.delivery, completed.truck, 10, nowMs);
assert(duplicate.delivery.progress === completed.delivery.progress, 'aynı processedAt ikinci progress üretmez');
assert(duplicate.truck.currentFuelL === completed.truck.currentFuelL, 'aynı tick yakıtı ikinci kez tüketmez');
assert(duplicate.delivery.fuelCost === completed.delivery.fuelCost, 'yakıt maliyeti ikinci kez yazılmaz');

const fuelStop = updateDeliveryProgressWithFuel(delivery(), truck(0.3), 24, nowMs);
assert(fuelStop.delivery.status === 'paused', 'yakıt yolda biterse teslimat durur');
assert(fuelStop.delivery.pausedReason === 'out-of-fuel', 'yakıt duruş nedeni korunur');
assert((fuelStop.truck.currentFuelL ?? -1) === 0, 'yakıt negatif olmaz');

const movedTransfer = updateTransferProgressWithFuel(transfer(), truck(), 10, nowMs);
assert(movedTransfer.transfer.progress === 1, 'boş kamyon transferi offline tamamlanır');
const movedWarehouse = updateWarehouseStockTransferProgressWithFuel(
  warehouseTransfer(),
  truck(),
  10,
  nowMs,
);
assert(movedWarehouse.transfer.progress === 1, 'depo transferi offline tamamlanır');

const duplicatePlan = applyOfflineProgress({
  nowMs,
  lastSimulatedRealTimeMs: nowMs,
  lastOfflineProgressAppliedAt: nowMs,
  gameState: { gameSpeed: 1 },
});
assert(duplicatePlan.duplicatePrevented, 'ikinci hydrate aynı zaman aralığını işlemez');
assert(duplicatePlan.simulation.appliedSimulationHours === 0, 'ikinci hydrate ekstra ilerleme üretmez');

const backwards = applyOfflineProgress({
  nowMs,
  lastSimulatedRealTimeMs: nowMs + 60_000,
  gameState: { gameSpeed: 1 },
});
assert(backwards.simulation.appliedSimulationHours === 0, 'cihaz saati geri/gelecek timestamp güvenli biçimde 0 uygulanır');

const forward = applyOfflineProgress({
  nowMs,
  lastSimulatedRealTimeMs: nowMs - 30 * 24 * 60 * 60_000,
  gameState: { gameSpeed: simulationTimeScale.maxGameSpeed },
});
assert(forward.elapsed.capped, 'aşırı ileri cihaz saati real-time cap uygular');
assert(forward.simulation.appliedSimulationHours === 24, 'ileri saat en fazla 24 simülasyon saati uygular');

const cloudRestore = applyOfflineProgress({
  nowMs,
  lastSimulatedRealTimeMs: nowMs - 60 * 60_000,
  lastSeenRealTimeMs: nowMs - 2 * 60 * 60_000,
  metaLastSimulatedRealTimeMs: nowMs - 90 * 60_000,
  gameState: { gameSpeed: 1 },
});
assert(cloudRestore.baselineMs === nowMs - 60 * 60_000, 'cloud restore en yeni geçerli timestamp’i kullanır');

console.log('\noffline-delivery-progress-regression-test: PASSED');
