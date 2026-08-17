import './test-globals';

import { readFileSync } from 'node:fs';

import {
  createDebugDeliveryIncident,
  DELIVERY_INCIDENT_COOLDOWN_HOURS,
  DELIVERY_INCIDENT_TYPES,
  generateDeliveryIncident,
  getIncidentTriggerProgress,
  isDeliveryIncidentCooldownActive,
  maybeRollDeliveryIncident,
  normalizeDelivery,
  resolveDeliveryIncident,
} from '../src/simulation/deliveryIncidents';
import type { Contract, Delivery, Player, Truck } from '../src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function truck(): Truck {
  return {
    id: 'event-truck', name: 'Event Truck', capacity: 20,
    fuelConsumptionPerKm: 0.3, fuelTankCapacityL: 200, currentFuelL: 35,
    totalMileageKm: 10_000, speed: 65, reliability: 80,
    maintenanceCost: 0.1, comfort: 70, condition: 55,
    purchasePrice: 50_000, currentCityId: 'izmir', homeCityId: 'izmir', status: 'on_route',
  };
}

function player(): Player {
  return {
    companyName: 'Event Co', money: 35_000, companyLevel: 5, level: 5,
    xp: 10, xpToNextLevel: 500, totalXp: 2_000, homeCityId: 'izmir',
    reputation: 35, completedContracts: 5, trucks: [truck()], trailers: [],
    drivers: [], warehouses: [],
  };
}

function contract(): Contract {
  return {
    id: 'event-contract', originCityId: 'izmir', destinationCityId: 'ankara',
    productId: 'machinery', amount: 10, payment: 4_000, distanceKm: 500,
    deadlineHours: 12, requiredLevel: 1, contractType: 'standard', status: 'in_progress',
  } as Contract;
}

function delivery(id = 'event-delivery'): Delivery {
  const value: Delivery = {
    id, contractId: 'event-contract', truckId: 'event-truck', driverId: 'driver-1',
    originCityId: 'izmir', destinationCityId: 'ankara', productId: 'machinery', amount: 10,
    distanceKm: 500, progress: 0.5, status: 'on_route', startedAt: 100,
    estimatedArrivalTime: 112, deadlineTime: 115, fuelCost: 300,
    maintenanceCost: 100, estimatedProfit: 3_600, travelHours: 8,
    breakdownChance: 0.01, accidentChance: 0.01, conditionLoss: 2,
  };
  return value;
}

console.log('\n=== random-events-regression-test ===\n');

let generated: Delivery | undefined;
for (let index = 0; index < 200 && !generated?.incident; index += 1) {
  const candidate = delivery(`event-delivery-${index}`);
  candidate.progress = Math.min(0.84, getIncidentTriggerProgress(candidate) + 0.001);
  const rolled = maybeRollDeliveryIncident(candidate, contract(), player(), 140);
  if (rolled.incident) generated = rolled;
}
assert(Boolean(generated?.incident), 'production trigger gerçek bir event üretir');
assert(generated?.incidentGenerated === true, 'başarılı roll tek teslimatı işaretler');
assert((generated?.incident?.choices.length ?? 0) >= 2, 'event en az iki seçim içerir');

const pending = generated!;
const blockedByCooldown = isDeliveryIncidentCooldownActive([pending], 140 + 1);
assert(blockedByCooldown, 'global delivery event cooldown çalışır');
assert(
  !isDeliveryIncidentCooldownActive(
    [pending],
    140 + DELIVERY_INCIDENT_COOLDOWN_HOURS + 0.01,
  ),
  'cooldown süresi sonunda yeni event mümkün olur',
);

const first = generateDeliveryIncident(delivery(), player(), 'repeat-seed', 200, 0.5);
const second = generateDeliveryIncident(
  delivery('event-delivery-2'), player(), 'repeat-seed', 220, 0.5, first.type,
);
assert(first.type !== second.type, 'aynı event tipi art arda seçilmez');

const distinctChoices = first.choices.length >= 2 &&
  JSON.stringify(first.choices[0].effects) !== JSON.stringify(first.choices[1].effects);
assert(distinctChoices, 'iki seçim farklı sonuç üretir');

const resolvable = {
  ...delivery(), incidentGenerated: true,
  incident: createDebugDeliveryIncident(delivery(), 210, 'traffic'),
};
const choiceId = resolvable.incident.choices[0].id;
const resolved = resolveDeliveryIncident(resolvable, choiceId, 211);
assert(resolved.ok && resolved.delivery?.incidentResolved === true, 'seçim sonucu uygulanır');
const duplicate = resolveDeliveryIncident(resolved.delivery!, choiceId, 212);
assert(!duplicate.ok, 'aynı event ikinci kez resolve edilmez');

const hydrated = normalizeDelivery(JSON.parse(JSON.stringify(resolvable)) as Delivery);
assert(hydrated.incident?.status === 'pending', 'save/load pending event’i korur');
const cloudHydrated = normalizeDelivery(JSON.parse(JSON.stringify(hydrated)) as Delivery);
assert(cloudHydrated.incident?.id === hydrated.incident?.id, 'cloud restore event kimliğini korur');

for (const type of DELIVERY_INCIDENT_TYPES) {
  const event = createDebugDeliveryIncident(delivery(), 250, type);
  assert(event.choices.length >= 2, `${type} iki veya daha fazla seçim içerir`);
  for (const choice of event.choices) {
    for (const value of Object.values(choice.effects)) {
      if (typeof value === 'number') assert(Number.isFinite(value), `${type} sonucu finite`);
    }
    assert(Math.abs(choice.effects.cashDelta ?? 0) <= 500, `${type} nakit etkisi bounded`);
    assert(Math.abs(choice.effects.reputationDelta ?? 0) <= 3, `${type} itibar etkisi bounded`);
    assert(Math.abs(choice.effects.truckConditionDelta ?? 0) <= 5, `${type} kondisyon etkisi bounded`);
  }
}

const storeSource = readFileSync('src/store/gameStore.ts', 'utf8');
const modalSource = readFileSync('src/components/delivery/DeliveryIncidentModal.tsx', 'utf8');
const appSource = readFileSync('App.tsx', 'utf8');
const offlineSource = readFileSync('src/simulation/offlineProgression.ts', 'utf8');
const diagnosticsSource = readFileSync('src/domain/deliveryDelayDiagnostics.ts', 'utf8');
assert(storeSource.includes('pendingIncidentReserved'), 'aynı anda yalnız bir pending event ayrılır');
assert(storeSource.includes('!offlineProgressionActive'), 'offline catch-up yeni event üretmez');
assert(
  offlineSource.includes("delivery.incident?.status === 'pending'") &&
    offlineSource.includes('return delivery'),
  'offline pending event silinmez ve ilerlemez',
);
assert(
  storeSource.includes('incidentBlocking: true') &&
    diagnosticsSource.includes('options.incidentBlocking') &&
    diagnosticsSource.includes('currentSpeedKmh:'),
  'bekleyen karar sırasında rota sabit kalır',
);
assert(
  storeSource.includes('getOperationChoiceNetCashDelta') ||
    storeSource.includes('buildOperationResolutionId'),
  'yakıt maliyeti ve tasarrufu doğru cash yönünde uygulanır',
);
assert(appSource.includes('DeliveryIncidentModal'), 'event modalı aktif render zincirine bağlı');
assert(
  !appSource.includes("activeTab === 'dashboard'") ||
    !appSource.match(/DeliveryIncidentModal[\s\S]{0,400}activeTab === 'dashboard'/),
  'incident modalı ana sekmeye kilitli değil',
);
assert(
  appSource.includes('pendingOfflineProgressSummary == null') &&
    appSource.includes('pendingDeliveryResultSummary == null'),
  'modal kritik özet sheetleriyle üst üste binmez',
);
assert(modalSource.includes("maxWidth: 430"), 'modal 360–430 px mobil genişliğe uyumlu');
assert(modalSource.includes("maxHeight: '82%'"), 'modal küçük ekranda bounded ve scroll edilebilir');

console.log(`\nEvent categories: ${DELIVERY_INCIDENT_TYPES.length}`);
console.log('random-events-regression-test: PASSED');
