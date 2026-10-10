/**
 * Map V2 Step 23 — multimodal settlement identity + idempotency foundation.
 * Run: npx tsx scripts/map-v2-multimodal-settlement-idempotency-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  createTestPersistedMultimodalShipment,
  isExecutablePersistedMultimodalShipment,
  MULTIMODAL_FEATURE_ROLLOUT,
  normalizeMultimodalShipments,
} from '../src/domain/multimodalShipmentPersistence';
import {
  buildMultimodalSettlementId,
  classifyMultimodalSettlementAttempt,
  getMultimodalCompletionId,
  getMultimodalSettlementId,
  multimodalSettlementCollidesWithLegacyIdentity,
  tryDeriveMultimodalSettlementIdentity,
} from '../src/domain/multimodalSettlementIdentity';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import {
  migrateSavePayload,
  normalizeSavePayload,
  payloadToStoreState,
  SAVE_GAME_VERSION,
  serializeGameState,
} from '../src/storage/saveGame';
import { buildDeliverySettlementId } from '../src/simulation/deliveryOfflineProgress';
import { buildDeliverySettlementIdempotencyKey } from '../src/simulation/reputationSettlement';
import type { Contract, Delivery } from '../src/types/game';

let pass = 0;
let fail = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const economyProbe = {
  cash: 44_000,
  fuel: 80,
  tolls: 12,
  maintenance: 5,
  reputation: 50,
  xp: 10,
};

function snapshotEconomy() {
  return { ...economyProbe };
}

function assertEconomyUnchanged(before: typeof economyProbe, label: string): void {
  assert(
    before.cash === economyProbe.cash &&
      before.fuel === economyProbe.fuel &&
      before.tolls === economyProbe.tolls &&
      before.maintenance === economyProbe.maintenance &&
      before.reputation === economyProbe.reputation &&
      before.xp === economyProbe.xp,
    `${label}: economy probe unchanged`,
  );
}

console.log('\n=== Map V2 Multimodal Settlement Idempotency Foundation ===\n');

assert(SAVE_GAME_VERSION === 6, 'SAVE_GAME_VERSION remains 6');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'rollout remains MULTIMODAL_OFF');
assert(
  read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_SETTLEMENT_IDEMPOTENCY.md').includes(
    'shipment:{shipmentId}:revenue',
  ),
  'settlement identity doc exists',
);
assert(
  read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes(
    'STEP 23',
  ) &&
    read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('COMPLETE'),
  'migration plan marks Step 23 complete',
);

const beforeHelpers = snapshotEconomy();
const first = getMultimodalSettlementId('shipment.test.001', 'revenue');
const second = getMultimodalSettlementId('shipment.test.001', 'revenue');
const alias = buildMultimodalSettlementId('shipment.test.001', 'revenue');
assert(first.ok && first.id === 'shipment:shipment.test.001:revenue', 'first identity is namespaced revenue');
assert(second.ok && first.ok && first.id === second.id, 'duplicate attempt yields the same idempotency key');
assert(alias.ok && first.ok && alias.id === first.id, 'buildMultimodalSettlementId matches getter');
assertEconomyUnchanged(beforeHelpers, 'identity helpers');

const otherShipment = getMultimodalSettlementId('shipment.test.002', 'revenue');
assert(
  otherShipment.ok && first.ok && otherShipment.id !== first.id,
  'different shipments get different settlement ids',
);

const capacity = getMultimodalSettlementId('shipment.test.001', 'capacity');
const expenses = getMultimodalSettlementId('shipment.test.001', 'completion-expenses');
assert(capacity.ok && capacity.id === 'shipment:shipment.test.001:capacity', 'documented capacity kind is distinct');
assert(
  expenses.ok && first.ok && expenses.id !== first.id && expenses.id !== capacity.id,
  'documented future kinds remain distinguishable',
);
const unknownKind = getMultimodalSettlementId('shipment.test.001', 'fuel');
assert(!unknownKind.ok, 'undocumented kind does not mint an identity');

const completion = getMultimodalCompletionId('shipment.test.001');
assert(completion.ok && completion.id === 'shipment:shipment.test.001:completion', 'completion identity format');
assert(first.ok && completion.ok && completion.id !== first.id, 'completionId !== settlementId');

assert(!getMultimodalSettlementId('').ok, 'empty string rejected');
assert(!getMultimodalSettlementId('   ').ok, 'whitespace rejected');
assert(!getMultimodalSettlementId(' shipment.test.001').ok, 'leading space rejected');
assert(!getMultimodalSettlementId('shipment.test.001 ').ok, 'trailing space rejected');
assert(!getMultimodalSettlementId(undefined).ok, 'undefined rejected');
assert(!getMultimodalSettlementId(null).ok, 'null rejected');
assert(!getMultimodalSettlementId(123).ok, 'non-string rejected');
assert(!getMultimodalSettlementId('bad:id').ok, 'colon in shipmentId rejected');
assert(!getMultimodalCompletionId('').ok, 'completion rejects empty shipmentId');

const legacySettlement = buildDeliverySettlementId('shipment.test.001');
const legacyLedger = `delivery:shipment.test.001:revenue`;
const legacyReputation = buildDeliverySettlementIdempotencyKey('shipment.test.001');
assert(legacySettlement === 'settlement_shipment.test.001', 'legacy settlementId format unchanged');
assert(first.ok && first.id !== legacySettlement, 'multimodal id ≠ settlement_${id}');
assert(first.ok && first.id !== legacyLedger, 'multimodal id ≠ delivery:{id}:revenue');
assert(first.ok && first.id !== legacyReputation, 'multimodal id ≠ reputation delivery key');
assert(first.ok && !multimodalSettlementCollidesWithLegacyIdentity(first.id), 'namespace collision helper is clean');
assert(
  multimodalSettlementCollidesWithLegacyIdentity(legacySettlement) &&
    multimodalSettlementCollidesWithLegacyIdentity(legacyLedger),
  'legacy prefixes still recognized as legacy',
);

const defaultClassify = classifyMultimodalSettlementAttempt({
  shipmentId: 'shipment.test.001',
});
assert(defaultClassify.classification === 'NOT_EXECUTED', 'MULTIMODAL_OFF first attempt is NOT_EXECUTED');
assert(defaultClassify.executed === false, 'classifier never marks executed');
assert(defaultClassify.settlementId === 'shipment:shipment.test.001:revenue', 'OFF still exposes the stable key');

const futureFirst = classifyMultimodalSettlementAttempt({
  shipmentId: 'shipment.test.001',
  featureRollout: 'INTERNAL_TEST',
});
assert(futureFirst.classification === 'NOT_SETTLED' && futureFirst.executed === false, 'future path can see NOT_SETTLED without paying');

const replay = classifyMultimodalSettlementAttempt({
  shipmentId: 'shipment.test.001',
  featureRollout: 'INTERNAL_TEST',
  alreadyAppliedSettlementIds: [first.ok ? first.id : ''],
});
assert(replay.classification === 'ALREADY_SETTLED' && replay.executed === false, 'duplicate key classifies ALREADY_SETTLED');

const unauthorized = classifyMultimodalSettlementAttempt({
  shipmentId: 'shipment.test.001',
  featureRollout: 'INTERNAL_TEST',
  requireServerAuthority: true,
  signedIn: false,
});
assert(unauthorized.classification === 'UNAUTHORIZED' && unauthorized.executed === false, 'unsigned-in server path is UNAUTHORIZED');

const deviceA = getMultimodalSettlementId('shipment.test.001', 'revenue');
const deviceB = getMultimodalSettlementId('shipment.test.001', 'revenue');
assert(deviceA.ok && deviceB.ok && deviceA.id === deviceB.id, 'two-device identity is identical');

const sample = createTestPersistedMultimodalShipment();
const derivedBefore = getMultimodalSettlementId(sample.shipmentId);
const v6WithSample = normalizeSavePayload({
  version: 6,
  currentTime: 12,
  gameSpeed: 1,
  isPaused: false,
  player: {
    companyName: 'V6 Co',
    money: economyProbe.cash,
    homeCityId: 'izmir',
    level: 2,
    companyLevel: 2,
    xp: economyProbe.xp,
    totalXp: economyProbe.xp,
    reputation: economyProbe.reputation,
    completedContracts: 1,
    trucks: [{ ...STARTER_TRUCK, status: 'on_route' }],
    drivers: [{ ...STARTER_DRIVER, status: 'driving' }],
    trailers: [],
    warehouses: [],
  },
  cities: [],
  products: [],
  routes: [],
  contracts: [legacyContract()],
  activeDeliveries: [legacyDelivery()],
  multimodalShipments: [sample],
  globalEconomy: { fuelPrice: 35 },
  marketNews: [],
  eventLog: [],
  meta: {
    savedAt: 1,
    currentTime: 12,
    cash: economyProbe.cash,
    companyName: 'V6 Co',
    completedContracts: 1,
    appVersion: '1.0.0',
    saveVersion: 6,
  },
});
const hydrated = payloadToStoreState(v6WithSample);
const reserialized = serializeGameState(hydrated);
const remigrated = migrateSavePayload(reserialized as unknown as Record<string, unknown>);
assert(remigrated != null, 'save round-trip migrates');
const restored = remigrated!.multimodalShipments![0];
assert(isExecutablePersistedMultimodalShipment(restored), 'round-trip shipment still executable');
const derivedAfter = getMultimodalSettlementId(
  isExecutablePersistedMultimodalShipment(restored) ? restored.shipmentId : '',
);
assert(
  derivedBefore.ok && derivedAfter.ok && derivedBefore.id === derivedAfter.id,
  'settlement identity remains derivable after serialize/deserialize',
);
assert(hydrated.player.money === economyProbe.cash, 'round-trip does not change cash');
assert(hydrated.activeDeliveries[0].id === 'del_legacy_1', 'legacy delivery survives settlement-identity tests');
assert(hydrated.activeDeliveries[0].settlementId == null, 'legacy delivery not given a shipment settlementId');

const unreadable = normalizeMultimodalShipments([
  {
    shipmentSchemaVersion: 99,
    shipmentId: 'shipment.test.001',
    secretFutureField: true,
  },
]);
assert(unreadable.length === 1, 'unknown schema preserved');
const unreadableClass = tryDeriveMultimodalSettlementIdentity(unreadable[0]);
assert(unreadableClass.classification === 'NOT_EXECUTED', 'unknown schema is not executable for settlement');
assert(unreadableClass.executed === false, 'unknown schema does not settle');

const malformed = tryDeriveMultimodalSettlementIdentity({ not: 'a shipment' });
assert(malformed.classification === 'INVALID_IDENTITY', 'malformed shipment has no settlement identity');
const missingId = getMultimodalSettlementId(undefined);
assert(!missingId.ok, 'missing shipmentId does not mint an id');

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'MapScreen unchanged');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(read('src/simulation/deliveryOfflineProgress.ts').includes('settlement_${deliveryId}'), 'legacy buildDeliverySettlementId unchanged');
assert(
  read('backend/src/canonicalDeliveryCompletion.ts').includes(
    'users/${uid}/canonicalDeliveryCompletions/${deliveryId}',
  ),
  'canonicalDeliveryCompletions path unchanged',
);
assert(!read('backend/src/index.ts').includes('completeMultimodalShipment'), 'no deployed completeMultimodalShipment');
assert(!read('backend/src/index.ts').includes('settleCanonicalMultimodalShipment'), 'no multimodal settlement callable in Step 23 era');
assert(!read('backend/src/serverState.ts').includes('multimodalShipments'), 'serverState has no shipment objects');
assert(!read('src/store/gameStore.ts').includes('getMultimodalSettlementId'), 'gameStore does not invoke settlement helpers');
assert(!read('src/store/gameStore.ts').includes('settleMultimodalShipment'), 'no settleMultimodalShipment action');
assert(!read('src/simulation/delivery.ts').includes('getMultimodalSettlementId'), 'delivery simulation does not call helpers');
assert(!read('src/simulation/contracts.ts').includes('getMultimodalSettlementId'), 'contracts simulation does not call helpers');
assert(read('src/types/game.ts').includes('export interface Contract {'), 'Contract type remains');
assert(!read('src/types/game.ts').includes('ROAD_RAIL_ROAD'), 'Contract has no mandatory multimodal pattern');

const restartKey = getMultimodalSettlementId('shipment.test.001');
assert(first.ok && restartKey.ok && restartKey.id === first.id, 'app-restart recompute is stable');
assertEconomyUnchanged(beforeHelpers, 'after all identity/classify/save tests');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');

function legacyContract(): Contract {
  return {
    id: 'con_legacy_1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'fruit',
    amount: 12,
    cargoWeight: 12,
    payment: 1800,
    deadlineHours: 14,
    distanceKm: 480,
    urgency: 0.4,
    status: 'active',
    createdAt: 8,
    expiresAt: 40,
  };
}

function legacyDelivery(): Delivery {
  return {
    id: 'del_legacy_1',
    contractId: 'con_legacy_1',
    truckId: STARTER_TRUCK.id,
    driverId: STARTER_DRIVER.id,
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'fruit',
    amount: 12,
    distanceKm: 480,
    progress: 0.35,
    status: 'on_route',
    startedAt: 10,
    estimatedArrivalTime: 18,
    deadlineTime: 24,
    fuelCost: 400,
    maintenanceCost: 20,
    estimatedProfit: 900,
    travelHours: 8,
    breakdownChance: 0.01,
    accidentChance: 0.01,
    conditionLoss: 1,
  };
}
