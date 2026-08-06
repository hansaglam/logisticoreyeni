import './test-globals';

import { readFileSync } from 'node:fs';

import { calculateDeliverySettlement } from '../src/simulation/delivery';
import {
  createDebugDeliveryIncident,
  normalizeDelivery,
  resolveDeliveryIncident,
} from '../src/simulation/deliveryIncidents';
import {
  applyDeliveryRemainingTimeDelta,
  buildOperationResolutionId,
  canAffordOperationChoice,
  formatOperationChoiceEffectSummary,
  getOperationChoiceNetCashDelta,
  resolveDeliveryOperationChoice,
} from '../src/simulation/deliveryOperationChoice';
import { applyOfflineDeliveries } from '../src/simulation/offlineProgression';
import { getDeliveryBoostAvailability } from '../src/simulation/deliveryBoostAvailability';
import {
  buildDeliveryTimingSnapshot,
  getDeliveryRemainingGameHours,
} from '../src/simulation/deliveryTiming';
import { applyCashTransaction } from '../src/utils/cashPolicy';
import type { Delivery } from '../src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function insuranceDelivery(currentTime = 100): Delivery {
  const base: Delivery = {
    id: 'insurance-delivery',
    contractId: 'contract-1',
    truckId: 'truck-1',
    driverId: 'driver-1',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'machinery',
    amount: 10,
    distanceKm: 500,
    progress: 0.5,
    status: 'on_route',
    startedAt: 80,
    estimatedArrivalTime: currentTime + 2 + 56 / 60,
    deadlineTime: currentTime + 12,
    fuelCost: 300,
    maintenanceCost: 100,
    estimatedProfit: 3_600,
    travelHours: 8,
    breakdownChance: 0.01,
    accidentChance: 0.01,
    conditionLoss: 2,
    incidentGenerated: true,
    incident: createDebugDeliveryIncident(
      {
        id: 'insurance-delivery',
        contractId: 'contract-1',
        truckId: 'truck-1',
        driverId: 'driver-1',
        originCityId: 'izmir',
        destinationCityId: 'ankara',
        productId: 'machinery',
        amount: 10,
        distanceKm: 500,
        progress: 0.5,
        status: 'on_route',
        startedAt: 80,
        estimatedArrivalTime: currentTime + 2 + 56 / 60,
        deadlineTime: currentTime + 12,
        fuelCost: 300,
        maintenanceCost: 100,
        estimatedProfit: 3_600,
        travelHours: 8,
        breakdownChance: 0.01,
        accidentChance: 0.01,
        conditionLoss: 2,
      },
      currentTime,
      'insurance_penalty',
    ),
  };
  return base;
}

console.log('\n=== delivery-operation-choice-regression-test ===\n');

const currentTime = 100;
const delivery = insuranceDelivery(currentTime);
const payChoice = delivery.incident!.choices.find((c) => c.id === 'pay_processing')!;
const waitChoice = delivery.incident!.choices.find((c) => c.id === 'standard_review')!;

assert(
  formatOperationChoiceEffectSummary(payChoice.effects).includes('$210 maliyet'),
  'UI metni $210 maliyet config’den türetilir',
);
assert(
  formatOperationChoiceEffectSummary(payChoice.effects).includes('15 dk kazan'),
  'UI metni 15 dk kazan config’den türetilir',
);
assert(
  formatOperationChoiceEffectSummary(waitChoice.effects).includes('1 saat gecikme'),
  'UI metni 1 saat gecikme config’den türetilir',
);

const startCash = 23_489;
const startRemaining = getDeliveryRemainingGameHours(delivery, currentTime)!;
assert(Math.abs(startRemaining - (2 + 56 / 60)) < 0.02, 'başlangıç kalan süre ~2s 56dk');

const payResolved = resolveDeliveryOperationChoice({
  delivery,
  choiceId: 'pay_processing',
  currentGameTime: currentTime,
  playerMoney: startCash,
});
assert(payResolved.ok, 'hızlı işlem seçimi uygulanır');
assert(
  getOperationChoiceNetCashDelta(payChoice.effects) === -210,
  'hızlı işlem net nakit −210',
);

const payCashTx = applyCashTransaction({
  currentCash: startCash,
  amount: 210,
  kind: 'voluntary-expense',
  referenceId: 'delivery:insurance-delivery:incident',
  transactionId: buildOperationResolutionId(
    delivery.id,
    delivery.incident!.id,
    'pay_processing',
  ),
});
assert(payCashTx.cashAfter === 23_279, 'hızlı işlem → nakit 23.279');
const payRemaining = getDeliveryRemainingGameHours(payResolved.delivery!, currentTime)!;
assert(
  Math.abs(payRemaining - (2 + 41 / 60)) < 0.02,
  'hızlı işlem → kalan süre ~2s 41dk (−15dk)',
);

const waitDelivery = insuranceDelivery(currentTime);
const waitResolved = resolveDeliveryOperationChoice({
  delivery: waitDelivery,
  choiceId: 'standard_review',
  currentGameTime: currentTime,
  playerMoney: startCash,
});
assert(waitResolved.ok, 'standart bekleme uygulanır');
const waitRemaining = getDeliveryRemainingGameHours(waitResolved.delivery!, currentTime)!;
assert(
  Math.abs(waitRemaining - (3 + 56 / 60)) < 0.02,
  'standart bekleme → kalan süre ~3s 56dk (+1s)',
);

const duplicate = resolveDeliveryIncident(payResolved.delivery!, 'pay_processing', currentTime);
assert(!duplicate.ok, 'aynı event ikinci kez uygulanamaz');

let simDelivery = insuranceDelivery(currentTime);
const firstChoice = resolveDeliveryOperationChoice({
  delivery: simDelivery,
  choiceId: 'pay_processing',
  currentGameTime: currentTime,
  playerMoney: startCash,
});
const secondChoice = resolveDeliveryOperationChoice({
  delivery: firstChoice.delivery!,
  choiceId: 'standard_review',
  currentGameTime: currentTime,
  playerMoney: startCash,
});
assert(firstChoice.ok && !secondChoice.ok, 'double tap → yalnız bir seçim uygulanır');

assert(
  !canAffordOperationChoice(200, payChoice.effects),
  'para yetersiz → hızlı işlem uygulanamaz (affordance)',
);
const poorPay = resolveDeliveryOperationChoice({
  delivery: insuranceDelivery(currentTime),
  choiceId: 'pay_processing',
  currentGameTime: currentTime,
  playerMoney: 200,
});
assert(!poorPay.ok, 'para yetersiz → resolve reddedilir');
const poorWait = resolveDeliveryOperationChoice({
  delivery: insuranceDelivery(currentTime),
  choiceId: 'standard_review',
  currentGameTime: currentTime,
  playerMoney: 200,
});
assert(poorWait.ok, 'para yetersizken standart bekleme çalışır');

const etaDelivery = insuranceDelivery(currentTime);
const etaResolved = resolveDeliveryOperationChoice({
  delivery: etaDelivery,
  choiceId: 'pay_processing',
  currentGameTime: currentTime,
  playerMoney: startCash,
});
const timing = buildDeliveryTimingSnapshot({
  delivery: etaResolved.delivery!,
  currentGameTime: currentTime,
});
assert(timing.etaLabel.includes('2 sa 41 dk'), 'ETA etiketi canonical süreyle güncellenir');

const settlement = calculateDeliverySettlement({
  contractPayment: 4_000,
  fuelCost: 300,
  maintenanceCost: 100,
  fuelAlreadyPaid: true,
});
assert(
  settlement.cashDeltaOnCompletion === 4_000 - 100,
  'teslimat sonunda event cost tekrar düşülmez (settlement)',
);

const savedPending = normalizeDelivery(JSON.parse(JSON.stringify(delivery)) as Delivery);
assert(savedPending.incident?.status === 'pending', 'save/load pending event korunur');

const savedResolved = normalizeDelivery(
  JSON.parse(JSON.stringify(payResolved.delivery)) as Delivery,
);
assert(savedResolved.incidentResolved === true, 'save/load resolved state korunur');
assert(
  (savedResolved.incidentResolutionHistory?.length ?? 0) === 1,
  'save/load audit kaydı korunur',
);
assert(
  savedResolved.incident?.status === 'resolved',
  'app restart sonrası event tekrar açılmaz',
);

const offlinePending = insuranceDelivery(currentTime);
const offlineResult = applyOfflineDeliveries([offlinePending], 2);
assert(
  offlineResult.deliveries[0].incident?.status === 'pending',
  'offline progression pending event silmez',
);
assert(
  offlineResult.deliveries[0].incidentResolved !== true,
  'offline progression event otomatik resolve etmez',
);
assert(
  (offlineResult.deliveries[0].progress ?? 0) === (offlinePending.progress ?? 0),
  'offline progression pending karar sırasında ilerlemez',
);

const offlineResolved = applyOfflineDeliveries([payResolved.delivery!], 2);
assert(
  offlineResolved.deliveries[0].incidentResolved === true,
  'offline progression resolved sonucu tekrar uygulamaz',
);

const boostBlocked = getDeliveryBoostAvailability({
  delivery,
  currentGameTime: currentTime,
  gameSpeed: 1,
  adState: { isLoaded: true, isShowing: false },
  isOnline: true,
});
assert(
  boostBlocked.status === 'disabled' && boostBlocked.reason === 'blocking-incident',
  'bekleyen karar boost’u bloklar',
);

const boostAfter = getDeliveryBoostAvailability({
  delivery: payResolved.delivery!,
  currentGameTime: currentTime,
  gameSpeed: 1,
  adState: { isLoaded: true, isShowing: false },
  isOnline: true,
});
assert(
  !(boostAfter.status === 'disabled' && boostAfter.reason === 'blocking-incident'),
  'operasyon çözülünce boost incident blokajı kalkar',
);

const clamped = applyDeliveryRemainingTimeDelta(
  { ...delivery, estimatedArrivalTime: currentTime + 0.1 },
  -900,
  currentTime,
);
assert(
  getDeliveryRemainingGameHours(clamped, currentTime)! >= 0,
  'kalan süre 0 altına düşmez',
);

const storeSource = readFileSync('src/store/gameStore.ts', 'utf8');
const offlineSource = readFileSync('src/simulation/offlineProgression.ts', 'utf8');
assert(
  storeSource.includes('resolveDeliveryOperationChoice'),
  'canonical store action mevcut',
);
assert(
  storeSource.includes('buildOperationResolutionId'),
  'idempotent operationResolutionId kullanılır',
);
assert(
  storeSource.includes("'voluntary-expense'"),
  'ücretli seçimler voluntary-expense ile uygulanır',
);
assert(
  offlineSource.includes("delivery.incident?.status === 'pending'") &&
    offlineSource.includes('return delivery'),
  'offline catch-up pending kararı korur',
);

console.log('\ndelivery-operation-choice-regression-test: PASSED');
