/**
 * Delivery Incident V1 smoke test.
 * Run: npx tsx scripts/delivery-incidents-smoke-test.ts
 */

import './test-globals';

import {
  createDebugDeliveryIncident,
  formatIncidentChoiceEffectSummary,
  generateDeliveryIncident,
  getIncidentTriggerProgress,
  maybeRollDeliveryIncident,
  normalizeDelivery,
  resolveDeliveryIncident,
  shouldGenerateDeliveryIncident,
  tryGenerateDeliveryIncident,
} from '../src/simulation/deliveryIncidents';
import type { Contract, Delivery, Player } from '../src/types/game';

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

function basePlayer(overrides: Partial<Player> = {}): Player {
  return {
    companyName: 'Test Co',
    money: 50_000,
    homeCityId: 'izmir',
    completedContracts: 5,
    trucks: [],
    drivers: [],
    warehouses: [],
    level: 5,
    companyLevel: 5,
    ...overrides,
  } as Player;
}

function baseContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'contract_test_1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    cargoWeight: 10,
    distanceKm: 480,
    payment: 5000,
    deadlineHours: 48,
    status: 'active',
    contractType: 'standard',
    ...overrides,
  } as Contract;
}

function baseDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery_test_1',
    contractId: 'contract_test_1',
    truckId: 'truck_1',
    driverId: 'driver_1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'machinery',
    amount: 10,
    distanceKm: 480,
    progress: 0.4,
    status: 'on_route',
    startedAt: 120,
    estimatedArrivalTime: 140,
    deadlineTime: 168,
    fuelCost: 400,
    maintenanceCost: 120,
    estimatedProfit: 900,
    travelHours: 20,
    breakdownChance: 0.02,
    accidentChance: 0.01,
    conditionLoss: 3,
    ...overrides,
  };
}

console.log('\nDelivery Incident V1 smoke tests\n');

console.log('Eligibility gates');
{
  const player = basePlayer({ completedContracts: 1 });
  const delivery = baseDelivery({ progress: 0.4 });
  assert(
    !shouldGenerateDeliveryIncident(delivery, player, baseContract()),
    'completedContracts < 2 ise incident çıkmaz',
  );
}

{
  const delivery = baseDelivery({ travelHours: 3, progress: 0.4 });
  assert(
    !shouldGenerateDeliveryIncident(delivery, basePlayer(), baseContract()),
    'estimatedDuration < 4 ise çıkmaz',
  );
}

{
  const delivery = baseDelivery({ progress: 0.1 });
  assert(
    !shouldGenerateDeliveryIncident(delivery, basePlayer(), baseContract()),
    'progress < 0.2 ise çıkmaz',
  );
}

{
  const delivery = baseDelivery({ progress: 0.9 });
  assert(
    !shouldGenerateDeliveryIncident(delivery, basePlayer(), baseContract()),
    'progress > 0.85 ise çıkmaz',
  );
}

console.log('\nGeneration limits');
{
  const player = basePlayer();
  const contract = baseContract();
  let delivery = baseDelivery({ progress: getIncidentTriggerProgress(baseDelivery()) + 0.01 });

  delivery = maybeRollDeliveryIncident(delivery, contract, player, 150);
  const firstIncidentId = delivery.incident?.id;

  delivery = maybeRollDeliveryIncident(
    { ...delivery, progress: delivery.progress + 0.1 },
    contract,
    player,
    160,
  );

  assert(delivery.incidentGenerated === true, 'incidentGenerated true ise tekrar üretmez');
  assert(
    delivery.incident?.id === firstIncidentId,
    'standard delivery için max 1 incident',
  );
}

console.log('\nResolve effects');
{
  const player = basePlayer();
  const contract = baseContract();
  const triggerProgress = 0.45;
  const incident = createDebugDeliveryIncident(
    baseDelivery({ progress: triggerProgress }),
    150,
    'traffic',
  );
  const delivery = baseDelivery({
    progress: triggerProgress,
    incidentGenerated: true,
    incident,
  });

  const remainingBefore =
    (1 - delivery.progress) * Math.max(delivery.travelHours, 0.1);
  const resolved = resolveDeliveryIncident(delivery, 'alt_route', 151);
  assert(resolved.ok, 'resolve choice effects uygular');
  assert(resolved.effects?.cashDelta === -250, 'cashDelta uygulanır');
  assert(resolved.delivery?.incident?.status === 'resolved', 'incident resolved olur');
  assert(resolved.delivery?.incidentResolved === true, 'incidentResolved true olur');
  const remainingAfter =
    (1 - (resolved.delivery?.progress ?? 0)) * Math.max(resolved.delivery?.travelHours ?? 0, 0.1);
  assert(
    remainingAfter < remainingBefore - 0.5,
    'deliveryTimeDeltaHours remaining travel’i kısaltır',
  );

  const second = resolveDeliveryIncident(resolved.delivery!, 'wait', 152);
  assert(!second.ok, 'aynı incident ikinci kez resolve edilmez');
}

console.log('\nSave/load normalize');
{
  const incident = generateDeliveryIncident(
    baseDelivery(),
    basePlayer(),
    'seed',
    100,
    0.5,
  );
  const normalized = normalizeDelivery(
    baseDelivery({
      incident,
      incidentGenerated: true,
      incidentResolved: false,
    }),
  );
  assert(normalized.incident?.choices.length === 2, 'normalize incident bozulmaz');
  assert(normalized.incidentGenerated === true, 'incidentGenerated korunur');

  const broken = normalizeDelivery(
    baseDelivery({
      incident: { foo: 'bar' } as unknown as Delivery['incident'],
    }),
  );
  assert(broken.incident == null, 'bozuk incident temizlenir');
}

console.log('\nCompleted delivery guard');
{
  const incident = generateDeliveryIncident(baseDelivery(), basePlayer(), 'seed', 100, 0.5);
  const completed = baseDelivery({
    status: 'completed',
    progress: 1,
    incident,
    incidentGenerated: true,
  });
  const result = resolveDeliveryIncident(completed, incident.choices[0].id, 200);
  assert(!result.ok, 'completed delivery incident resolve edilemez');
}

console.log('\nDeterministic generation');
{
  const delivery = baseDelivery({ id: 'delivery_det_1', startedAt: 240 });
  const contract = baseContract({ id: 'contract_det_1' });
  const seed = `${delivery.id}:${delivery.contractId}:${Math.floor(delivery.startedAt / 24)}`;
  const first = tryGenerateDeliveryIncident(
    delivery,
    contract,
    basePlayer(),
    seed,
    100,
    0.45,
  );
  const second = tryGenerateDeliveryIncident(
    delivery,
    contract,
    basePlayer(),
    seed,
    100,
    0.45,
  );
  assert(
    (first?.type ?? null) === (second?.type ?? null),
    'deterministik seed aynı olayı üretir',
  );
}

console.log('\nEffect label formatting');
{
  assert(
    formatIncidentChoiceEffectSummary({
      cashDelta: -180,
      deliveryTimeDeltaHours: 0.5,
      truckConditionDelta: 1,
    }) === '$180 maliyet · 30 dk gecikme · Kondisyon +1',
    'maintenance-style effect labels',
  );
  assert(
    formatIncidentChoiceEffectSummary({ truckConditionDelta: -3 }) === 'Ücretsiz · Kondisyon -3',
    'free choice with condition penalty',
  );
  assert(
    formatIncidentChoiceEffectSummary({ deliveryTimeDeltaHours: 2 }) === '2 saat gecikme',
    'delay-only label',
  );
  assert(
    formatIncidentChoiceEffectSummary({
      cashDelta: -250,
      deliveryTimeDeltaHours: -1,
    }) === '$250 maliyet · 1 saat kazan',
    'cost with time gain label',
  );
}

console.log('\nDebug manual inject helper');
{
  const delivery = baseDelivery({ progress: 0.5 });
  const incident = createDebugDeliveryIncident(delivery, 200, 'traffic');
  assert(incident.status === 'pending', 'debug incident pending olur');
  assert(incident.type === 'traffic', 'debug incident type seçilebilir');
  assert(incident.deliveryId === delivery.id, 'debug incident deliveryId doğru');
}

console.log(`\n${'='.repeat(48)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
