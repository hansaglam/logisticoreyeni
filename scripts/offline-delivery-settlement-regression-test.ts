/**
 * Offline vs online delivery settlement equivalence.
 * Run: npx tsx scripts/offline-delivery-settlement-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { REPUTATION_RULES } from '../src/config/reputationRules';
import {
  buildDeliverySettlementRecord,
  createEmptyDelayDiagnostics,
  isPendingIncidentBlocking,
  normalizeSettlementHistory,
} from '../src/domain/deliveryDelayDiagnostics';
import {
  buildDeliveryResultPresentation,
  buildOfflineReturnHeadline,
  buildReputationHistoryDetail,
  punctualityTitle,
} from '../src/domain/deliveryResultPresentation';
import {
  RANDOM_FAILURE_MAX_TICK_HOURS,
  expectedReputationDeltaForFailure,
  sanitizeDeliverySettlementRecord,
  shouldAllowRandomDeliveryFailures,
} from '../src/domain/deliveryTerminalState';
import { normalizeDelivery } from '../src/simulation/deliveryIncidents';
import {
  isDeliveryProgressComplete,
  updateDeliveryProgressWithFuel,
} from '../src/simulation/delivery';
import { reconcileDeliveriesWithRealTime } from '../src/simulation/deliveryOfflineProgress';
import {
  calculateDeliveryReputationResult,
  classifyDeliveryPunctuality,
  deliveryFailureReasonToReputationDelta,
} from '../src/simulation/reputationSettlement';
import { formatGameDuration } from '../src/utils/formatGameDuration';
import type { Delivery, Truck } from '../src/types/game';

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

function hours(h: number, m = 0): number {
  return h + m / 60;
}

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-settlement',
    name: 'Nordvik Titan',
    capacity: 25,
    fuelConsumptionPerKm: 0.28,
    fuelTankCapacityL: 400,
    currentFuelL: 380,
    totalMileageKm: 1200,
    speed: 72,
    reliability: 92,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 94,
    purchasePrice: 80_000,
    currentCityId: 'bursa',
    homeCityId: 'bursa',
    status: 'on_route',
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  const travelHours = overrides.travelHours ?? hours(15, 50);
  return {
    id: 'delivery-bursa-antalya',
    contractId: 'contract-bursa-antalya',
    truckId: 'truck-settlement',
    driverId: 'driver-1',
    originCityId: 'bursa',
    destinationCityId: 'antalya',
    productId: 'machinery',
    amount: 12,
    distanceKm: 690,
    progress: 0,
    status: 'on_route',
    startedAt: 0,
    travelHours,
    estimatedArrivalTime: travelHours,
    deadlineTime: hours(15, 50),
    delayDiagnostics: createEmptyDelayDiagnostics(),
    startReadiness: {
      estimatedTravelHours: travelHours,
      deadlineHours: hours(15, 50),
      timeMarginHours: 0,
      deadlineRisk: 'normal',
      requiredFuelL: 120,
      currentFuelL: 380,
    },
    fuelLitersAtStart: 380,
    fuelLitersTotal: 140,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    breakdownChance: 0.12,
    accidentChance: 0.08,
    conditionLoss: 4,
    ...overrides,
  } as Delivery;
}

function snapshotCompare(
  label: string,
  online: { delivery: Delivery; truck: Truck },
  offline: { delivery: Delivery; truck: Truck },
): void {
  assert(
    Math.abs((online.delivery.progress ?? 0) - (offline.delivery.progress ?? 0)) < 0.02,
    `${label} progress matches`,
    `online=${online.delivery.progress} offline=${offline.delivery.progress}`,
  );
  assert(
    Math.abs((online.truck.currentFuelL ?? 0) - (offline.truck.currentFuelL ?? 0)) < 3,
    `${label} fuel matches`,
    `online=${online.truck.currentFuelL} offline=${offline.truck.currentFuelL}`,
  );
  assert(
    Math.abs((online.truck.condition ?? 0) - (offline.truck.condition ?? 0)) < 1,
    `${label} condition matches`,
  );
  assert(online.delivery.status === offline.delivery.status, `${label} status matches`);
  assert(
    (online.delivery.failureReason ?? null) === (offline.delivery.failureReason ?? null),
    `${label} failureReason matches`,
  );
}

function runOnlineTicks(delivery: Delivery, truck: Truck, totalHours: number, stepHours: number) {
  let nextDelivery = delivery;
  let nextTruck = truck;
  let elapsed = 0;
  let processedAt = 0;
  while (elapsed + 1e-9 < totalHours) {
    const step = Math.min(stepHours, totalHours - elapsed);
    processedAt += step;
    const result = updateDeliveryProgressWithFuel(nextDelivery, nextTruck, step, processedAt);
    nextDelivery = result.delivery;
    nextTruck = result.truck;
    elapsed += step;
  }
  return { delivery: nextDelivery, truck: nextTruck };
}

function runOfflineCatchUp(delivery: Delivery, truck: Truck, totalHours: number) {
  return updateDeliveryProgressWithFuel(delivery, truck, totalHours, totalHours);
}

function settleSuccess(delivery: Delivery, actualTravelHours: number, deadlineHours: number) {
  const punctuality = classifyDeliveryPunctuality({
    actualTravelHours,
    deadlineHours,
    estimatedTravelHours: delivery.travelHours,
  });
  const reputation = calculateDeliveryReputationResult({
    contract: { deadlineHours, payment: 4000, type: 'standard' } as never,
    delivery,
    actualTravelHours,
  });
  return buildDeliverySettlementRecord({
    delivery,
    contractId: delivery.contractId,
    completedAt: actualTravelHours,
    actualTravelHours,
    deadlineHours,
    punctualityResult: reputation.punctuality,
    reputationDelta: reputation.delta,
    settledWhileOffline: true,
  });
}

console.log('\n=== Offline delivery settlement ===\n');

console.log('Policy B — no random fail on catch-up');
{
  assert(
    shouldAllowRandomDeliveryFailures({ hoursPassed: 0.05, offline: false, progress: 0.4 }),
    'live tick may roll breakdown',
  );
  assert(
    !shouldAllowRandomDeliveryFailures({ hoursPassed: hours(5, 56), offline: true, progress: 0.37 }),
    'offline catch-up cannot roll breakdown',
  );
  assert(
    !shouldAllowRandomDeliveryFailures({ hoursPassed: 8, offline: false, progress: 0.4 }),
    'large jump cannot roll breakdown even if flag missed',
    `maxTick=${RANDOM_FAILURE_MAX_TICK_HOURS}`,
  );
  assert(
    !shouldAllowRandomDeliveryFailures({ hoursPassed: 0.05, offline: false, progress: 1 }),
    'completed progress cannot roll breakdown',
  );
}

console.log('\nCASE 1 — enough fuel, ETA < deadline, online = offline success');
{
  const delivery = makeDelivery({ travelHours: hours(6), deadlineTime: hours(15, 50) });
  const truck = makeTruck();
  const online = runOnlineTicks(delivery, truck, hours(6), 0.05);
  const offline = runOfflineCatchUp(delivery, truck, hours(6));
  snapshotCompare('case1', online, offline);
  assert(isDeliveryProgressComplete(offline.delivery.progress), 'offline reaches destination');
  assert(offline.delivery.pausedReason !== 'out-of-fuel', 'not out of fuel');
  const record = settleSuccess(offline.delivery, hours(5, 56), hours(15, 50));
  assert(record.failureReason == null, 'success has no failureReason');
  assert(record.terminalStatus === 'completed', 'terminal completed');
  assert(record.reputationDelta > 0, 'success reputation is positive');
  assert(
    !punctualityTitle(record.punctualityResult, record.failureReason).includes('arızası'),
    'success copy is not breakdown',
  );
}

console.log('\nCASE 2 — late-minor online = offline');
{
  const actual = 11;
  const deadline = 10;
  const punctOnline = classifyDeliveryPunctuality({
    actualTravelHours: actual,
    deadlineHours: deadline,
    estimatedTravelHours: 10,
  });
  const punctOffline = classifyDeliveryPunctuality({
    actualTravelHours: actual,
    deadlineHours: deadline,
    estimatedTravelHours: 10,
  });
  assert(punctOnline === 'late-minor', 'online late-minor');
  assert(punctOffline === punctOnline, 'offline same late-minor');
  assert(
    calculateDeliveryReputationResult({
      contract: { deadlineHours: deadline, payment: 1, type: 'standard' } as never,
      delivery: makeDelivery({ travelHours: 10 }),
      actualTravelHours: actual,
    }).delta === REPUTATION_RULES.deliveryLateMinor,
    'late-minor reputation -2',
  );
}

console.log('\nCASE 3 — late-major online = offline');
{
  const actual = 13;
  const deadline = 10;
  const punct = classifyDeliveryPunctuality({
    actualTravelHours: actual,
    deadlineHours: deadline,
    estimatedTravelHours: 10,
  });
  assert(punct === 'late-major', 'late-major band');
  assert(
    calculateDeliveryReputationResult({
      contract: { deadlineHours: deadline, payment: 1, type: 'standard' } as never,
      delivery: makeDelivery({ travelHours: 10 }),
      actualTravelHours: actual,
    }).delta === REPUTATION_RULES.deliveryLateMajor,
    'late-major reputation -4',
  );
}

console.log('\nCASE 4 — critical lateness >2× is too_late / failed mapping');
{
  const mapping = deliveryFailureReasonToReputationDelta('too_late');
  assert(mapping.delta === REPUTATION_RULES.deliveryFailed, 'too_late uses failed mapping');
  assert(mapping.source === 'delivery-failure', 'too_late is failure not cancel');
  const record = buildDeliverySettlementRecord({
    delivery: makeDelivery({ travelHours: 10 }),
    contractId: 'c',
    completedAt: 25,
    actualTravelHours: 25,
    deadlineHours: 10,
    punctualityResult: 'failed',
    failureReason: 'too_late',
    reputationDelta: mapping.delta,
  });
  assert(record.terminalStatus === 'failed', 'too_late terminal failed');
  assert(record.failureReason === 'too_late', 'reason too_late');
  assert(record.reputationDelta === REPUTATION_RULES.deliveryFailed, 'failed reputation delta');
}

console.log('\nCASE 5 — fuel runs out offline → pause, not breakdown');
{
  const delivery = makeDelivery({
    travelHours: 12,
    fuelLitersAtStart: 8,
    fuelLitersTotal: 80,
    lastFuelProcessedProgress: 0,
  });
  const truck = makeTruck({ currentFuelL: 8, fuelTankCapacityL: 80 });
  const offline = runOfflineCatchUp(delivery, truck, 12);
  assert(offline.delivery.pausedReason === 'out-of-fuel' || (offline.truck.currentFuelL ?? 0) <= 0.5, 'out of fuel');
  assert(offline.delivery.failureReason == null, 'out-of-fuel is not a failureReason');
  assert(!isDeliveryProgressComplete(offline.delivery.progress), 'progress stops before destination');
  const presentation = buildDeliveryResultPresentation(
    buildDeliverySettlementRecord({
      delivery: { ...offline.delivery, status: 'on_route' },
      contractId: 'c',
      completedAt: 4,
      actualTravelHours: 4,
      deadlineHours: hours(15, 50),
      punctualityResult: 'on-time',
      reputationDelta: 2,
    }),
  );
  assert(!presentation.title.includes('arızası'), 'fuel pause is not labeled breakdown');
}

console.log('\nCASE 6 — pending incident stays pending');
{
  const now = Date.now();
  const delivery = makeDelivery({
    progress: 0.4,
    lastProgressedRealAtMs: now - 60_000,
    startedRealAtMs: now - 60_000,
    incident: {
      id: 'inc-1',
      deliveryId: 'delivery-bursa-antalya',
      type: 'traffic',
      title: 'Trafik',
      description: 'Bekleyen karar',
      createdAtGameTime: 2,
      triggerProgress: 0.35,
      status: 'pending',
      choices: [
        { id: 'a', label: 'A', description: '', effects: {} },
        { id: 'b', label: 'B', description: '', effects: {} },
      ],
    },
    incidentResolved: false,
  });
  assert(isPendingIncidentBlocking(delivery), 'incident blocks');
  const reconciled = reconcileDeliveriesWithRealTime({
    deliveries: [delivery],
    nowMs: now,
    gameSpeed: 1,
  });
  assert(reconciled.completedIds.length === 0, 'pending incident does not complete');
  assert(reconciled.deliveries[0]?.incident?.status === 'pending', 'incident preserved');
  assert(reconciled.deliveries[0]?.failureReason == null, 'no invented breakdown');
  assert((reconciled.deliveries[0]?.progress ?? 0) === 0.4, 'progress frozen');
}

console.log('\nCASE 7 — genuine breakdown uses failed mapping');
{
  const mapping = deliveryFailureReasonToReputationDelta('breakdown');
  assert(mapping.delta === expectedReputationDeltaForFailure('breakdown'), 'canonical breakdown delta');
  assert(mapping.delta === REPUTATION_RULES.deliveryFailed, 'breakdown uses deliveryFailed');
  assert(mapping.source === 'delivery-failure', 'not cancelled source');
  assert(
    deliveryFailureReasonToReputationDelta('cancelled').delta === REPUTATION_RULES.contractCancelled,
    'cancelled stays on cancel mapping',
  );
  const record = buildDeliverySettlementRecord({
    delivery: makeDelivery({ progress: 0.37 }),
    contractId: 'c',
    completedAt: hours(5, 56),
    actualTravelHours: hours(5, 56),
    deadlineHours: hours(15, 50),
    punctualityResult: 'failed',
    failureReason: 'breakdown',
    reputationDelta: mapping.delta,
  });
  assert(record.failureReason === 'breakdown', 'genuine breakdown stored');
  assert(buildDeliveryResultPresentation(record).title.includes('Araç arızası'), 'breakdown title');
}

console.log('\nCASE 8 — 15h50 planned / 5h56 actual / no delay must not invent breakdown');
{
  const planned = hours(15, 50);
  const actual = hours(5, 56);
  assert(
    !shouldAllowRandomDeliveryFailures({ hoursPassed: actual, offline: true, progress: actual / planned }),
    'this catch-up cannot roll a random fail',
  );
  const delivery = makeDelivery({ travelHours: planned, progress: 1 });
  const record = settleSuccess(delivery, actual, planned);
  assert(record.latenessHours < 1 / 60, 'no delay');
  assert(record.failureReason == null, 'no failureReason');
  assert(record.terminalStatus === 'completed', 'completed terminal');
  assert(record.reputationDelta === REPUTATION_RULES.deliveryEarly, 'early +3');
  const detail = buildReputationHistoryDetail(record);
  assert(detail.latenessLine === 'Gecikme: yok', 'detail delay none');
  assert(!detail.title.includes('arızası'), 'detail is not breakdown');
  assert(detail.plannedLine?.includes(formatGameDuration(planned)), 'planned uses estimated duration');
  const presentation = buildDeliveryResultPresentation(record);
  assert(presentation.title.includes('sen yokken'), 'offline success copy');
}

console.log('\nCASE 9 — stale failureReason on successful completion is cleared');
{
  const dirty = makeDelivery({
    status: 'on_route',
    failureReason: 'breakdown',
    progress: 0.5,
  });
  const cleaned = normalizeDelivery(dirty);
  assert(cleaned.failureReason == null, 'hydrate/normalize drops stale reason');
  const record = buildDeliverySettlementRecord({
    delivery: { ...cleaned, failureReason: 'breakdown', progress: 1 },
    contractId: 'c',
    completedAt: 6,
    actualTravelHours: 6,
    deadlineHours: hours(15, 50),
    punctualityResult: 'early',
    failureReason: 'breakdown',
    reputationDelta: 3,
  });
  assert(record.failureReason == null, 'write-time strips stale reason from success');
  assert(record.terminalStatus === 'completed', 'stale mix becomes completed');
  const hydrated = normalizeSettlementHistory([
    {
      ...record,
      failureReason: 'breakdown',
      punctualityResult: 'early',
    },
  ]);
  assert(hydrated[0]?.failureReason == null, 'old save success ignores stale reason');
  const sanitized = sanitizeDeliverySettlementRecord({
    ...record,
    failureReason: 'breakdown',
    punctualityResult: 'on-time',
  });
  assert(sanitized.failureReason == null, 'sanitize completed+breakdown');
}

console.log('\nCASE 10 — multiple deliveries settle independently');
{
  const now = Date.now();
  const a = makeDelivery({
    id: 'd-a',
    progress: 0,
    travelHours: 4,
    expectedDurationGameHours: 4,
    startedRealAtMs: now - 5 * 15_000,
    lastProgressedRealAtMs: now - 5 * 15_000,
  });
  const b = makeDelivery({
    id: 'd-b',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    progress: 0.2,
    travelHours: 20,
    expectedDurationGameHours: 20,
    startedRealAtMs: now - 30_000,
    lastProgressedRealAtMs: now - 30_000,
  });
  const reconciled = reconcileDeliveriesWithRealTime({
    deliveries: [a, b],
    trucks: [makeTruck({ id: 'truck-settlement', currentFuelL: 380 })],
    nowMs: now,
    gameSpeed: 1,
    currentTime: 5,
  });
  assert(reconciled.completedIds.includes('d-a'), 'short job completes independently');
  assert(!reconciled.completedIds.includes('d-b'), 'long job stays in progress');
  assert((reconciled.deliveries.find((item) => item.id === 'd-b')?.progress ?? 0) > 0.2, 'long job advanced');
  assert(
    reconciled.deliveries.every((item) => item.failureReason == null),
    'neither job invented a failure',
  );
}

console.log('\nOffline return copy');
{
  assert(
    buildOfflineReturnHeadline({ completedDeliveries: 2 }) === 'Sen yokken 2 teslimat tamamlandı.',
    'multi complete headline',
  );
  assert(
    buildOfflineReturnHeadline({
      completedDeliveries: 0,
      deliveryNotes: ['İzmir Express yakıtsız kaldı. Teslimat duraklatıldı.'],
    }).includes('yakıtsız'),
    'fuel pause headline',
  );
}

console.log('\nStore wiring');
{
  const storeSrc = fs.readFileSync(path.join(ROOT, 'src/store/gameStore.ts'), 'utf8');
  assert(storeSrc.includes('shouldAllowRandomDeliveryFailures'), 'updateDeliveries uses shared gate');
  assert(storeSrc.includes('logOfflineDeliveryBefore'), 'offline before log');
  assert(storeSrc.includes('logOfflineDeliverySettlement'), 'offline settlement log');
  assert(storeSrc.includes('settledWhileOffline'), 'settlements mark offline');
  assert(
    storeSrc.includes("reason === 'breakdown' || reason === 'accident'") &&
      storeSrc.includes('completeDeliveryById(deliveryId)'),
    'completed jobs are not failed as random breakdown',
  );
}

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
