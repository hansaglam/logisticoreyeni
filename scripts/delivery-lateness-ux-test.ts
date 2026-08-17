/**
 * Delivery lateness / reputation UX — readiness, diagnostics, copy.
 * Run: npx tsx scripts/delivery-lateness-ux-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';

import { REPUTATION_RULES } from '../src/config/reputationRules';
import { STARTER_DRIVER } from '../src/data/drivers';
import { getRoute } from '../src/data/routes';
import { STARTER_TRUCK } from '../src/data/trucks';
import {
  accumulateDeliveryTickDiagnostics,
  buildDeliverySettlementRecord,
  computeEffectiveTravelHours,
  createEmptyDelayDiagnostics,
  deriveDeliveryDelayCauses,
  findSettlementRecord,
  normalizeDelayDiagnostics,
} from '../src/domain/deliveryDelayDiagnostics';
import { resolveDeliveryHealth } from '../src/domain/deliveryHealthStatus';
import { evaluateDeliveryReadiness } from '../src/domain/deliveryReadiness';
import {
  buildDeliveryResultPresentation,
  buildReputationHistoryDetail,
  formatReadinessSummary,
  LEGACY_SETTLEMENT_UNAVAILABLE,
  punctualityTitle,
} from '../src/domain/deliveryResultPresentation';
import {
  applyDeliveryRemainingTimeDelta,
  deliveryTimeDeltaHoursToRemainingSeconds,
} from '../src/simulation/deliveryOperationChoice';
import { updateDeliveryProgress } from '../src/simulation/delivery';
import { classifyDeliveryPunctuality } from '../src/simulation/reputationSettlement';
import { classifyDeadlineRisk, getDeadlineRiskBadgeLabel } from '../src/utils/deadlineUx';
import { formatGameDuration } from '../src/utils/formatGameDuration';
import type { Contract, Delivery, Truck } from '../src/types/game';

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

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'contract-late-ux',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    payment: 8000,
    deadlineHours: 24,
    distanceKm: 585,
    contractType: 'standard',
    ...overrides,
  } as Contract;
}

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    ...STARTER_TRUCK,
    id: 'truck-late-ux',
    currentFuelL: 400,
    fuelTankCapacityL: 400,
    condition: 90,
    speed: 80,
    status: 'idle',
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery-late-ux',
    contractId: 'contract-late-ux',
    truckId: 'truck-late-ux',
    driverId: STARTER_DRIVER.id,
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    distanceKm: 585,
    progress: 0.4,
    status: 'on_route',
    startedAt: 0,
    travelHours: 10,
    estimatedArrivalTime: 10,
    deadlineTime: 12,
    delayDiagnostics: createEmptyDelayDiagnostics(),
    startReadiness: {
      estimatedTravelHours: 10,
      deadlineHours: 12,
      timeMarginHours: 2,
      deadlineRisk: 'normal',
      requiredFuelL: 80,
      currentFuelL: 200,
    },
    ...overrides,
  } as Delivery;
}

const route = getRoute('izmir', 'ankara');
if (!route) {
  throw new Error('izmir → ankara rota bulunamadı');
}

console.log('\n=== Delivery lateness UX ===\n');

console.log('Reputation balance unchanged');
{
  assert(REPUTATION_RULES.deliveryEarly === 3, 'early +3');
  assert(REPUTATION_RULES.deliveryOnTime === 2, 'on-time +2');
  assert(REPUTATION_RULES.deliveryLateMinor === -2, 'minor late -2');
  assert(REPUTATION_RULES.deliveryLateMajor === -4, 'major late -4');
  assert(REPUTATION_RULES.deliveryFailed === -6, 'failed -6');
  assert(REPUTATION_RULES.contractCancelled === -6, 'cancelled -6');
}

console.log('\nDeadline quality badges');
{
  assert(classifyDeadlineRisk(6, 10) === 'comfortable', 'ETA/deadline < 0.70 → RAHAT');
  assert(classifyDeadlineRisk(8, 10) === 'normal', '0.70–0.85 → NORMAL');
  assert(classifyDeadlineRisk(8.5, 10) === 'risky', '>= 0.85 → RİSKLİ');
  assert(classifyDeadlineRisk(11, 10) === 'impossible', '> 1.0 → YETİŞEMEZ');
  assert(getDeadlineRiskBadgeLabel('comfortable') === 'RAHAT', 'RAHAT label');
  assert(getDeadlineRiskBadgeLabel('risky') === 'RİSKLİ', 'RİSKLİ label');
  assert(getDeadlineRiskBadgeLabel('impossible') === 'YETİŞEMEZ', 'YETİŞEMEZ label');
}

console.log('\nTEST 1 — safe truck + fuel + deadline');
{
  const readiness = evaluateDeliveryReadiness({
    contract: makeContract({ deadlineHours: 24 }),
    truck: makeTruck({ speed: 90, currentFuelL: 400 }),
    driver: STARTER_DRIVER,
    route,
    fuelPricePerLiter: 45,
  });
  assert(readiness.canStart, 'can start when ETA and fuel are safe');
  assert(
    readiness.deadlineRisk === 'comfortable' || readiness.deadlineRisk === 'normal',
    'SAFE/NORMAL deadline quality',
    readiness.deadlineRisk,
  );
  assert(!readiness.reasons.includes('INSUFFICIENT_FUEL'), 'fuel not blocking');
  const summary = formatReadinessSummary(readiness);
  assert(summary.tone === 'safe', 'readiness copy is safe');
  assert(summary.title.includes('zamanında'), 'safe title');
  const punctuality = classifyDeliveryPunctuality({
    actualTravelHours: readiness.etaHours,
    deadlineHours: readiness.deadlineHours,
    estimatedTravelHours: readiness.etaHours,
  });
  assert(punctuality === 'on-time' || punctuality === 'early', 'projected punctuality is success');
  const record = buildDeliverySettlementRecord({
    delivery: makeDelivery({
      travelHours: readiness.etaHours,
      startReadiness: {
        estimatedTravelHours: readiness.etaHours,
        deadlineHours: readiness.deadlineHours,
        timeMarginHours: readiness.timeMarginHours,
        deadlineRisk: readiness.deadlineRisk,
        requiredFuelL: readiness.requiredFuel,
        currentFuelL: readiness.currentFuel,
      },
    }),
    contractId: 'contract-late-ux',
    completedAt: readiness.etaHours,
    actualTravelHours: readiness.etaHours,
    deadlineHours: readiness.deadlineHours,
    punctualityResult: punctuality,
    reputationDelta: punctuality === 'early' ? 3 : 2,
  });
  const presentation = buildDeliveryResultPresentation(record);
  assert(
    presentation.title === 'Erken teslimat' || presentation.title === 'Zamanında teslimat',
    'result explains success',
    presentation.title,
  );
}

console.log('\nTEST 2 — slow truck ETA > deadline is blocked');
{
  const readiness = evaluateDeliveryReadiness({
    contract: makeContract({ deadlineHours: 3 }),
    truck: makeTruck({ speed: 18 }),
    driver: STARTER_DRIVER,
    route,
    fuelPricePerLiter: 45,
  });
  assert(readiness.deadlineRisk === 'impossible', 'classified impossible');
  assert(readiness.reasons.includes('DEADLINE_IMPOSSIBLE'), 'DEADLINE_IMPOSSIBLE reason');
  assert(!readiness.canStart, 'assignment blocked');
  const summary = formatReadinessSummary(readiness);
  assert(summary.tone === 'impossible', 'impossible copy tone');
  assert(summary.title.includes('yetişemez'), 'player-facing yetişemez title');
}

console.log('\nTEST 3 — insufficient fuel is blocked');
{
  const readiness = evaluateDeliveryReadiness({
    contract: makeContract({ deadlineHours: 24 }),
    truck: makeTruck({ currentFuelL: 4 }),
    driver: STARTER_DRIVER,
    route,
    fuelPricePerLiter: 45,
  });
  assert(readiness.reasons.includes('INSUFFICIENT_FUEL'), 'INSUFFICIENT_FUEL reason');
  assert(!readiness.canStart, 'cannot start without fuel');
  assert(readiness.requiredFuel > readiness.currentFuel, 'required > current');
  const summary = formatReadinessSummary(readiness);
  assert(summary.tone === 'fuel', 'fuel copy tone');
  assert(summary.title === 'Yakıt yetersiz', 'fuel title');
  assert(summary.body.includes('yakıt gerekiyor'), 'required liters in body');
}

console.log('\nTEST 4 — 2h out of fuel is recorded and attributed');
{
  const started = makeDelivery({
    pausedReason: 'out-of-fuel',
    status: 'paused',
    delayDiagnostics: createEmptyDelayDiagnostics(),
  });
  const after = accumulateDeliveryTickDiagnostics(started, 2, {
    wasOutOfFuel: false,
    isOutOfFuel: true,
    incidentBlocking: false,
    otherPaused: false,
  });
  assert(after.delayDiagnostics?.outOfFuelHours === 2, 'outOfFuelHours += 2');
  assert(after.delayDiagnostics?.fuelOutCount === 1, 'fuelOutCount increments on first empty');
  const record = buildDeliverySettlementRecord({
    delivery: after,
    contractId: after.contractId,
    completedAt: 14,
    actualTravelHours: 14,
    deadlineHours: 12,
    punctualityResult: 'late-major',
    reputationDelta: -4,
  });
  assert(record.timePausedOutOfFuel === 2, 'settlement keeps out-of-fuel hours');
  assert(record.primaryCause === 'OUT_OF_FUEL', 'primary cause is OUT_OF_FUEL');
  const presentation = buildDeliveryResultPresentation(record);
  assert(
    presentation.causes.some((line) => line.includes('yakıtsız')),
    'result attributes fuel pause',
  );
}

console.log('\nTEST 5 — pending incident wait is recorded');
{
  const started = makeDelivery({
    incident: {
      id: 'inc-1',
      deliveryId: 'delivery-late-ux',
      type: 'traffic',
      title: 'Trafik',
      description: 'Yol tıkalı',
      createdAtGameTime: 0,
      triggerProgress: 0.3,
      status: 'pending',
      choices: [],
    },
    incidentResolved: false,
  });
  const after = accumulateDeliveryTickDiagnostics(started, 1, {
    wasOutOfFuel: false,
    isOutOfFuel: false,
    incidentBlocking: true,
    otherPaused: false,
  });
  assert(after.delayDiagnostics?.incidentPendingHours === 1, 'incidentPendingHours += 1');
  assert(after.estimatedArrivalTime === started.estimatedArrivalTime + 1, 'ETA bumps while waiting');
  const health = resolveDeliveryHealth({
    delivery: after,
    currentTime: 1,
    truck: makeTruck(),
  });
  assert(health.status === 'incident_pending', 'active status is OLAY BEKLİYOR');
  assert(health.deadlinePaused === true, 'deadline paused during incident');
  assert(
    health.detailLine?.includes('durdu'),
    'player is told the clock paused',
  );
  assert(after.deadlineTime === started.deadlineTime + 1, 'deadline extends while waiting');
}

console.log('\nTEST 6 — fuel + incident both shown');
{
  const causes = deriveDeliveryDelayCauses({
    punctuality: 'late-major',
    outOfFuelHours: 1.5,
    incidentPendingHours: 0.8,
    latenessHours: 2.5,
    vehicleEstimatedDurationAtStart: 10,
    deadlineHours: 12,
  });
  assert(causes.primaryCause === 'OUT_OF_FUEL', 'dominant pause is fuel');
  assert(causes.contributingCauses.includes('INCIDENT_WAIT'), 'incident wait is contributing');
  const record = buildDeliverySettlementRecord({
    delivery: makeDelivery({
      delayDiagnostics: {
        outOfFuelHours: 1.5,
        incidentPendingHours: 0.8,
        otherPausedHours: 0,
        fuelOutCount: 1,
      },
    }),
    contractId: 'contract-late-ux',
    completedAt: 14.5,
    actualTravelHours: 14.5,
    deadlineHours: 12,
    punctualityResult: 'late-major',
    reputationDelta: -4,
  });
  const presentation = buildDeliveryResultPresentation(record);
  assert(presentation.causeTitle === 'Başlıca nedenler', 'multiple causes title');
  assert(presentation.causes.some((line) => line.includes('yakıtsız')), 'fuel cause line');
  assert(presentation.causes.some((line) => line.includes('bekledi')), 'incident wait line');
}

console.log('\nTEST 7 — breakdown failure copy');
{
  assert(
    punctualityTitle('failed', 'breakdown') === 'Teslimat başarısız — Araç arızası',
    'breakdown title',
  );
  const record = buildDeliverySettlementRecord({
    delivery: makeDelivery(),
    contractId: 'contract-late-ux',
    completedAt: 4,
    actualTravelHours: 4,
    deadlineHours: 12,
    punctualityResult: 'failed',
    failureReason: 'breakdown',
    reputationDelta: -6,
  });
  assert(record.primaryCause === 'BREAKDOWN', 'primary cause BREAKDOWN');
  assert(record.reputationDelta === -6, 'failure delta is -6');
  const presentation = buildDeliveryResultPresentation(record);
  assert(presentation.title.includes('Araç arızası'), 'result names breakdown');
}

console.log('\nTEST 8 — too late shows actual vs deadline');
{
  assert(
    punctualityTitle('failed', 'too_late') === 'Teslimat başarısız — Çok geç kaldı',
    'too_late title',
  );
  const record = buildDeliverySettlementRecord({
    delivery: makeDelivery({ travelHours: 10 }),
    contractId: 'contract-late-ux',
    completedAt: 21,
    actualTravelHours: 21,
    deadlineHours: 10,
    punctualityResult: 'failed',
    failureReason: 'too_late',
    reputationDelta: -6,
  });
  const presentation = buildDeliveryResultPresentation(record);
  assert(presentation.headline.includes('10s'), 'deadline hours in copy');
  assert(presentation.headline.includes('Efektif'), 'effective hours in copy');
  assert(presentation.headline.includes('başarısız'), 'failed wording');
}

console.log('\nTEST 8b — background clock inflation capped by progress');
{
  const inflated = makeDelivery({
    progress: 0.4,
    travelHours: 10,
    startedAt: 0,
    delayDiagnostics: createEmptyDelayDiagnostics(),
  });
  const effective = computeEffectiveTravelHours(inflated, 275);
  assert(effective <= 4.01, 'effective travel capped by progress', `got=${effective}`);
  assert(effective < 50, 'offline wall-clock does not inflate lateness');
}

console.log('\nTEST 9 — legacy history has no fabricated cause');
{
  const missing = buildReputationHistoryDetail(null);
  assert(missing.unavailable, 'details marked unavailable');
  assert(
    missing.title.length > 0 && missing.causes.length === 0,
    'no fabricated cause list',
  );
  assert(
    findSettlementRecord([], 'delivery-old') == null,
    'old ids without records stay empty',
  );
  assert(
    LEGACY_SETTLEMENT_UNAVAILABLE.includes('ayrıntılı gecikme verisi kaydedilmemiş'),
    'legacy copy exists',
  );
}

console.log('\nTEST 10 — offline out-of-fuel elapsed is derivable');
{
  const beforeHours = 0.2;
  const after = accumulateDeliveryTickDiagnostics(
    makeDelivery({
      pausedReason: 'out-of-fuel',
      delayDiagnostics: {
        outOfFuelHours: beforeHours,
        incidentPendingHours: 0,
        otherPausedHours: 0,
        fuelOutCount: 1,
      },
    }),
    3 + 1 / 3,
    {
      wasOutOfFuel: true,
      isOutOfFuel: true,
      incidentBlocking: false,
      otherPaused: false,
    },
  );
  const delta = (after.delayDiagnostics?.outOfFuelHours ?? 0) - beforeHours;
  assert(Math.abs(delta - (3 + 1 / 3)) < 1e-9, 'offline out-of-fuel delta is exact');
  const note = `Sen yokken İzmir Express yakıtsız kaldı ve ${formatGameDuration(delta)} zaman kaybetti.`;
  assert(note.includes('yakıtsız kaldı'), 'offline summary names fuel pause');
  assert(note.includes('3s'), 'offline summary includes elapsed hours');
}

console.log('\nIncident delay actually stretches remaining travel');
{
  const delivery = makeDelivery({ progress: 0.5, travelHours: 10, estimatedArrivalTime: 5 });
  const delayed = applyDeliveryRemainingTimeDelta(
    delivery,
    deliveryTimeDeltaHoursToRemainingSeconds(2),
    0,
  );
  assert(Math.abs(delayed.travelHours - 14) < 0.05, 'travelHours stretches for +2s remaining');
  const beforeStep = updateDeliveryProgress(delivery, 1);
  const afterStep = updateDeliveryProgress(delayed, 1);
  assert(
    afterStep.progress - delayed.progress < beforeStep.progress - delivery.progress,
    'same tick advances less after delay stretch',
  );
}

console.log('\nSave defaults');
{
  const empty = normalizeDelayDiagnostics(undefined);
  assert(empty.outOfFuelHours === 0, 'default outOfFuelHours');
  assert(empty.incidentPendingHours === 0, 'default incidentPendingHours');
  assert(empty.otherPausedHours === 0, 'default otherPausedHours');
  assert(empty.fuelOutCount === 0, 'default fuelOutCount');
}

console.log('\nUI wiring');
{
  const store = readFileSync('src/store/gameStore.ts', 'utf8');
  const assignment = readFileSync('src/components/ContractAssignmentModal.tsx', 'utf8');
  const health = readFileSync('src/domain/deliveryHealthStatus.ts', 'utf8');
  const fuel = readFileSync('src/simulation/fuelWarnings.ts', 'utf8');
  const app = readFileSync('App.tsx', 'utf8');
  const sheet = readFileSync('src/components/dashboard/ReputationDetailSheet.tsx', 'utf8');
  assert(store.includes('evaluateDeliveryReadiness'), 'startDelivery uses readiness evaluator');
  assert(store.includes("errorCode: 'DEADLINE_IMPOSSIBLE'"), 'store blocks impossible ETA');
  assert(assignment.includes('DeliveryReadinessCard'), 'assignment shows readiness card');
  assert(health.includes('durdu'), 'fuel clock copy paused');
  assert(fuel.includes('ARAÇ YAKITSIZ KALDI'), 'prominent out-of-fuel title');
  assert(app.includes('DeliveryResultSheet'), 'result sheet mounted');
  assert(sheet.includes('LEGACY_SETTLEMENT_UNAVAILABLE'), 'history details handle legacy entries');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
