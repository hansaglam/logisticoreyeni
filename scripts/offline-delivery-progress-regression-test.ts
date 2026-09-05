/**
 * Offline active delivery progress/completion regression.
 * Covers both real-time delivery reconciliation (Apple/iOS) and
 * offline/background delivery progression (local gameplay).
 * Run: npx tsx scripts/offline-delivery-progress-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { getMsPerGameHour, realMsToGameHours, simulationTimeScale } from '../src/config/balance';
import { operatingCostBalance } from '../src/config/balance';
import { resolveTruckMapLocation } from '../src/components/map/mapTruckLocation';
import { updateDeliveryProgressWithFuel } from '../src/simulation/delivery';
import {
  ACTIVE_DELIVERY_OFFLINE_MIN_MS,
  buildDeliverySettlementId,
  computeDeliveryCatchUpGameHours,
  countActiveRouteDeliveriesInList,
  estimateRemainingRealMsForDelivery,
  isActiveRouteDelivery,
  reconcileDeliveriesWithRealTime,
  resolveOfflineProgressMinMs,
} from '../src/simulation/deliveryOfflineProgress';
import {
  applyOfflineProgress,
  calculateOfflineElapsed,
  MAX_OFFLINE_PROGRESS_HOURS,
  shouldSkipDuplicateOfflineApply,
} from '../src/simulation/offlineProgression';
import { isDeliveryProgressComplete } from '../src/simulation/delivery';
import { MINUTE_MS } from '../src/simulation/economyClock';
import { updateTransferProgressWithFuel } from '../src/simulation/truckTransfer';
import { updateWarehouseStockTransferProgressWithFuel } from '../src/simulation/warehouseStockTransfer';
import type { Delivery, Truck, TruckTransfer, WarehouseStockTransfer } from '../src/types/game';

const ROOT = process.cwd();

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

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
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

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  const now = Date.now();
  return {
    id: 'delivery_test_1',
    contractId: 'c1',
    truckId: 't1',
    driverId: 'd1',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
    productId: 'fruit',
    amount: 10,
    distanceKm: 330,
    progress: 0,
    status: 'on_route',
    startedAt: 100,
    estimatedArrivalTime: 110,
    deadlineTime: 200,
    fuelCost: 100,
    maintenanceCost: 20,
    estimatedProfit: 500,
    travelHours: 10,
    expectedDurationGameHours: 10,
    startedRealAtMs: now - 60_000,
    lastProgressedRealAtMs: now - 60_000,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    ...overrides,
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

function runRealTimeDeliveryTests(): void {
  console.log('\n--- Real-time delivery reconciliation tests (Apple/iOS) ---\n');

  assert(operatingCostBalance.maxOfflineChargeDays === 0, 'offline fixed costs stay disabled');
  assert(resolveOfflineProgressMinMs(true) === ACTIVE_DELIVERY_OFFLINE_MIN_MS, 'active delivery min 15s');
  assert(resolveOfflineProgressMinMs(false) === 5 * 60_000, 'default min 5m');

  assert(isActiveRouteDelivery(makeDelivery({ status: 'on_route' })), 'on_route is active');
  assert(isActiveRouteDelivery(makeDelivery({ status: 'preparing' })), 'preparing is active');
  assert(!isActiveRouteDelivery(makeDelivery({ status: 'completed' })), 'completed is not active');
  assert(!isActiveRouteDelivery(makeDelivery({ status: 'failed' })), 'failed is not active');
  assert(!isActiveRouteDelivery(makeDelivery({ status: 'cancelled' })), 'cancelled is not active');
  assert(
    countActiveRouteDeliveriesInList([
      makeDelivery({ status: 'on_route' }),
      makeDelivery({ id: 'd2', status: 'completed' }),
      makeDelivery({ id: 'd3', status: 'failed' }),
    ]) === 1,
    'only on_route/preparing count as active deliveries',
  );

  const now = Date.now();
  const started = now - 30_000;
  const testDelivery = makeDelivery({
    progress: 0,
    travelHours: 10,
    expectedDurationGameHours: 10,
    startedRealAtMs: started,
    lastProgressedRealAtMs: started,
  });

  const catchUpHours = computeDeliveryCatchUpGameHours({
    delivery: testDelivery,
    nowMs: now,
    gameSpeed: 1,
  });
  const expectedHours = realMsToGameHours(30_000, 1);
  assert(
    Math.abs(catchUpHours - expectedHours) < 0.0001,
    'catch-up game hours match realMsToGameHours',
    `got=${catchUpHours} expected=${expectedHours}`,
  );

  const reconciled = reconcileDeliveriesWithRealTime({
    deliveries: [testDelivery],
    nowMs: now,
    gameSpeed: 1,
  });
  assert(reconciled.progressedCount === 1, 'reconcile progresses delivery');
  assert(
    (reconciled.deliveries[0]?.progress ?? 0) > 0,
    'progress > 0 after 30s',
  );
  assert(
    reconciled.deliveries[0]?.lastProgressedRealAtMs === now,
    'lastProgressedRealAtMs updated',
  );

  const finishMs = 10 * getMsPerGameHour(1) + 1_000;
  const almostDone = makeDelivery({
    progress: 0,
    travelHours: 10,
    expectedDurationGameHours: 10,
    startedRealAtMs: now - finishMs,
    lastProgressedRealAtMs: now - finishMs,
  });
  const finished = reconcileDeliveriesWithRealTime({
    deliveries: [almostDone],
    nowMs: now,
    gameSpeed: 1,
  });
  assert(finished.completedIds.includes(almostDone.id), 'wall-clock completes delivery');
  assert(
    isDeliveryProgressComplete(finished.deliveries[0]?.progress),
    'completed progress >= threshold',
  );

  const remaining = estimateRemainingRealMsForDelivery(
    makeDelivery({ progress: 0.5, travelHours: 10 }),
    1,
  );
  assert(remaining === 5 * getMsPerGameHour(1), 'remaining real ms for half progress');

  assert(
    buildDeliverySettlementId('delivery_x') === 'settlement_delivery_x',
    'settlement id format',
  );

  const pendingIncidentDelivery = makeDelivery({
    progress: 0.35,
    travelHours: 10,
    expectedDurationGameHours: 10,
    startedRealAtMs: now - 30_000,
    lastProgressedRealAtMs: now - 30_000,
    incident: {
      id: 'inc_pending',
      deliveryId: 'delivery_offline',
      type: 'traffic',
      title: 'Trafik',
      description: 'Test',
      createdAtGameTime: 0,
      triggerProgress: 0.3,
      status: 'pending',
      choices: [
        { id: 'a', label: 'A', description: '', effects: {} },
        { id: 'b', label: 'B', description: '', effects: {} },
      ],
    },
    incidentResolved: false,
    delayDiagnostics: {
      outOfFuelHours: 0,
      incidentPendingHours: 0,
      otherPausedHours: 0,
      fuelOutCount: 0,
    },
  });
  const pendingReconciled = reconcileDeliveriesWithRealTime({
    deliveries: [pendingIncidentDelivery],
    nowMs: now,
    gameSpeed: 1,
  });
  assert(
    pendingReconciled.deliveries[0]?.incident?.status === 'pending',
    'reconcile preserves pending incident',
  );
  assert(
    (pendingReconciled.deliveries[0]?.delayDiagnostics?.incidentPendingHours ?? 0) > 0,
    'reconcile records incident wait during catch-up',
  );
  assert(
    (pendingReconciled.deliveries[0]?.progress ?? 0) === pendingIncidentDelivery.progress,
    'reconcile does not progress delivery while incident pending',
  );

  const elapsedWithDelivery = calculateOfflineElapsed(now - 45_000, now, {
    hasActiveDeliveries: true,
  });
  assert(elapsedWithDelivery.shouldApply, '45s with active delivery applies');

  const storeSrc = readSrc('src/store/gameStore.ts');
  assert(storeSrc.includes('reconcileDeliveriesWithRealTime'), 'store reconciles real-time');
  assert(storeSrc.includes('hasActiveDeliveries'), 'store passes active delivery threshold flag');
  assert(storeSrc.includes('computeRequiredDeliveryCatchUpGameHours'), 'store uses delivery catch-up hours');
  assert(storeSrc.includes('buildDeliverySettlementId'), 'store sets settlementId');
  assert(storeSrc.includes("'offline_skip'"), 'offline fixed costs still skipped');
  assert(
    storeSrc.includes('OFFLINE_CATCHUP_MAX_COST_PERIODS'),
    'periodic offline costs use catch-up constant',
  );
  assert(!storeSrc.includes("title: 'İşletme giderleri işlendi'"), 'no operating cost toast');

  const appSrc = readSrc('src/hooks/useAppStateLifecycle.ts');
  assert(
    appSrc.includes("nextState === 'background' || nextState === 'inactive'"),
    'App records inactive+background',
  );

  const typeSrc = readSrc('src/types/game.ts');
  assert(typeSrc.includes('startedRealAtMs'), 'Delivery has startedRealAtMs');
  assert(typeSrc.includes('lastProgressedRealAtMs'), 'Delivery has lastProgressedRealAtMs');
  assert(typeSrc.includes('settlementId'), 'Delivery has settlementId');
}

function runOfflineProgressTests(): void {
  console.log('\n--- Offline/background progression tests (local gameplay) ---\n');

  const nowMs = 1_800_000_000_000;
  const tenMinutes = applyOfflineProgress({
    nowMs,
    lastSimulatedRealTimeMs: nowMs - 10 * 60_000,
    lastOfflineProgressAppliedAt: nowMs - 20 * 60_000,
    hasActiveDeliveries: false,
    gameState: { gameSpeed: 1, lastSimulationGameSpeed: 1 },
  });
  assert(tenMinutes.elapsed.shouldApply, '10 dakika background süresi uygulanır');
  assert(tenMinutes.simulation.appliedSimulationHours > 0, 'gerçek süre simülasyon saatine dönüşür');
  assert(
    tenMinutes.simulation.appliedSimulationHours <= MAX_OFFLINE_PROGRESS_HOURS,
    'offline simulation 24 saat tavanını aşmaz',
  );

  const activeTwentySeconds = applyOfflineProgress({
    nowMs,
    lastSimulatedRealTimeMs: nowMs - 20_000,
    hasActiveDeliveries: true,
    gameState: { gameSpeed: 1, lastSimulationGameSpeed: 1 },
  });
  assert(activeTwentySeconds.elapsed.shouldApply, '20s active delivery offline applies');
  assert(activeTwentySeconds.elapsed.appliedMs === 20_000, '20s active delivery elapsed preserved');

  const activeFourteenSeconds = applyOfflineProgress({
    nowMs,
    lastSimulatedRealTimeMs: nowMs - 14_000,
    hasActiveDeliveries: true,
    gameState: { gameSpeed: 1, lastSimulationGameSpeed: 1 },
  });
  assert(!activeFourteenSeconds.elapsed.shouldApply, '14s active delivery below threshold');

  const immediateActiveDuplicate = applyOfflineProgress({
    nowMs: nowMs + 1_000,
    lastSimulatedRealTimeMs: nowMs,
    lastOfflineProgressAppliedAt: nowMs,
    hasActiveDeliveries: true,
    gameState: { gameSpeed: 1, lastSimulationGameSpeed: 1 },
  });
  assert(
    immediateActiveDuplicate.duplicatePrevented || !immediateActiveDuplicate.elapsed.shouldApply,
    'immediate active-delivery resume does not double-apply',
  );
  assert(
    immediateActiveDuplicate.simulation.appliedSimulationHours === 0,
    'immediate active-delivery resume produces no extra simulation hours',
  );

  const terminalDeliveryIdleThreshold = calculateOfflineElapsed(nowMs - MINUTE_MS, nowMs, {
    hasActiveDeliveries: false,
  });
  assert(!terminalDeliveryIdleThreshold.shouldApply, 'terminal delivery uses idle 5m threshold');

  const sixteenSecondActive = applyOfflineProgress({
    nowMs: nowMs + 16_000,
    lastSimulatedRealTimeMs: nowMs,
    hasActiveDeliveries: true,
    gameState: { gameSpeed: 1, lastSimulationGameSpeed: 1 },
  });
  assert(sixteenSecondActive.elapsed.shouldApply, '16s active delivery background applies once');
  assert(sixteenSecondActive.elapsed.appliedMs === 16_000, '16s active delivery preserves elapsed');

  const immediateAfterSixteenSecond = applyOfflineProgress({
    nowMs: nowMs + 16_000,
    lastSimulatedRealTimeMs: nowMs,
    lastOfflineProgressAppliedAt: nowMs + 16_000,
    hasActiveDeliveries: true,
    gameState: { gameSpeed: 1, lastSimulationGameSpeed: 1 },
  });
  assert(
    immediateAfterSixteenSecond.duplicatePrevented,
    'immediate resume after 16s active delivery duplicate prevented',
  );
  assert(
    shouldSkipDuplicateOfflineApply(nowMs, nowMs + 16_000, nowMs + 16_000, {
      hasActiveDeliveries: true,
    }),
    'duplicate guard uses 15s active threshold',
  );

  const completionNow = Date.now();
  const finishRealMs = 10 * getMsPerGameHour(1) + 1_000;
  const nearComplete = makeDelivery({
    progress: 0,
    travelHours: 10,
    expectedDurationGameHours: 10,
    startedRealAtMs: completionNow - finishRealMs,
    lastProgressedRealAtMs: completionNow - finishRealMs,
  });
  const firstCompletion = reconcileDeliveriesWithRealTime({
    deliveries: [nearComplete],
    nowMs: completionNow,
    gameSpeed: 1,
  });
  assert(firstCompletion.completedIds.length === 1, 'active delivery completes once during catch-up');
  const settledDelivery = {
    ...firstCompletion.deliveries[0]!,
    status: 'completed' as const,
    settlementId: buildDeliverySettlementId(nearComplete.id),
    settledAt: completionNow,
  };
  const secondPass = reconcileDeliveriesWithRealTime({
    deliveries: [settledDelivery],
    nowMs: completionNow + 20_000,
    gameSpeed: 1,
  });
  assert(secondPass.completedIds.length === 0, 'settled terminal delivery does not settle twice');
  assert(
    countActiveRouteDeliveriesInList([settledDelivery]) === 0,
    'terminal delivery no longer triggers active threshold',
  );
  const postCompletionThreshold = calculateOfflineElapsed(
    completionNow,
    completionNow + MINUTE_MS,
    { hasActiveDeliveries: false },
  );
  assert(!postCompletionThreshold.shouldApply, 'after completion idle 5m threshold applies');

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
  const duplicateDelivery = updateDeliveryProgressWithFuel(completed.delivery, completed.truck, 10, nowMs);
  assert(duplicateDelivery.delivery.progress === completed.delivery.progress, 'aynı processedAt ikinci progress üretmez');
  assert(duplicateDelivery.truck.currentFuelL === completed.truck.currentFuelL, 'aynı tick yakıtı ikinci kez tüketmez');
  assert(duplicateDelivery.delivery.fuelCost === completed.delivery.fuelCost, 'yakıt maliyeti ikinci kez yazılmaz');

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
  assert(cloudRestore.baselineMs === nowMs - 60 * 60_000, 'cloud restore en yeni gecerli timestamp kullanir');
}

function run(): void {
  console.log('\n=== offline-delivery-progress-regression-test ===\n');

  runRealTimeDeliveryTests();
  runOfflineProgressTests();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
