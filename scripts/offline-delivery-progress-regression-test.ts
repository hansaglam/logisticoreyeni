/**
 * Offline active delivery progress/completion regression.
 * Run: npx tsx scripts/offline-delivery-progress-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { getMsPerGameHour, realMsToGameHours } from '../src/config/balance';
import { operatingCostBalance } from '../src/config/balance';
import {
  ACTIVE_DELIVERY_OFFLINE_MIN_MS,
  buildDeliverySettlementId,
  computeDeliveryCatchUpGameHours,
  estimateRemainingRealMsForDelivery,
  reconcileDeliveriesWithRealTime,
  resolveOfflineProgressMinMs,
} from '../src/simulation/deliveryOfflineProgress';
import { calculateOfflineElapsed } from '../src/simulation/offlineProgression';
import { isDeliveryProgressComplete } from '../src/simulation/delivery';
import type { Delivery } from '../src/types/game';

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

function run(): void {
  console.log('\noffline-delivery-progress-regression-test\n');

  assert(operatingCostBalance.maxOfflineChargeDays === 0, 'offline fixed costs stay disabled');
  assert(resolveOfflineProgressMinMs(true) === ACTIVE_DELIVERY_OFFLINE_MIN_MS, 'active delivery min 15s');
  assert(resolveOfflineProgressMinMs(false) === 5 * 60_000, 'default min 5m');

  const now = Date.now();
  const started = now - 30_000;
  const delivery = makeDelivery({
    progress: 0,
    travelHours: 10,
    expectedDurationGameHours: 10,
    startedRealAtMs: started,
    lastProgressedRealAtMs: started,
  });

  const catchUpHours = computeDeliveryCatchUpGameHours({
    delivery,
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
    deliveries: [delivery],
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

  // Enough real time to finish travelHours at normal speed
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

  const elapsedWithDelivery = calculateOfflineElapsed(now - 45_000, now, {
    hasActiveDeliveries: true,
  });
  assert(elapsedWithDelivery.shouldApply, '45s with active delivery applies');

  const storeSrc = readSrc('src/store/gameStore.ts');
  assert(storeSrc.includes('reconcileDeliveriesWithRealTime'), 'store reconciles real-time');
  assert(storeSrc.includes('computeRequiredDeliveryCatchUpGameHours'), 'store uses delivery catch-up hours');
  assert(storeSrc.includes('buildDeliverySettlementId'), 'store sets settlementId');
  assert(storeSrc.includes("reason: 'offline_skip'"), 'offline fixed costs still skipped');
  assert(storeSrc.includes('maxOfflineCostPeriods: 0'), 'periodic offline costs stay 0');
  assert(!storeSrc.includes("title: 'İşletme giderleri işlendi'"), 'no operating cost toast');

  const appSrc = readSrc('App.tsx');
  assert(
    appSrc.includes("nextState === 'background' || nextState === 'inactive'"),
    'App records inactive+background',
  );

  const typeSrc = readSrc('src/types/game.ts');
  assert(typeSrc.includes('startedRealAtMs'), 'Delivery has startedRealAtMs');
  assert(typeSrc.includes('lastProgressedRealAtMs'), 'Delivery has lastProgressedRealAtMs');
  assert(typeSrc.includes('settlementId'), 'Delivery has settlementId');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
