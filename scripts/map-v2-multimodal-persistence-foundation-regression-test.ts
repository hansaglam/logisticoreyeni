/**
 * Map V2 Step 22 — additive multimodal shipment persistence foundation.
 * Run: npx tsx scripts/map-v2-multimodal-persistence-foundation-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  createTestPersistedMultimodalShipment,
  isExecutablePersistedMultimodalShipment,
  isUnreadablePersistedMultimodalShipment,
  MAX_PERSISTED_MULTIMODAL_SHIPMENTS,
  MULTIMODAL_FEATURE_ROLLOUT,
  normalizeMultimodalShipments,
  selectActiveMultimodalShipments,
  selectMultimodalShipments,
  SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION,
} from '../src/domain/multimodalShipmentPersistence';
import {
  migrateSavePayload,
  normalizeSavePayload,
  payloadToStoreState,
  SAVE_GAME_VERSION,
  serializeGameState,
} from '../src/storage/saveGame';
import { sanitizeForFirestore } from '../src/utils/sanitizeForFirestore';
import { STARTER_HOME_CITY_ID, STARTER_MONEY } from '../src/utils/localSaveMeaning';
import type { Contract, Delivery } from '../src/types/game';
import { STARTER_TRUCK } from '../src/data/trucks';
import { STARTER_DRIVER } from '../src/data/drivers';

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

const LEGACY_DELIVERY: Delivery = {
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

const LEGACY_CONTRACT: Contract = {
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

function v6SaveWithoutShipments(): Record<string, unknown> {
  return {
    version: 6,
    currentTime: 12,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'V6 Co',
      money: 44_000,
      homeCityId: 'izmir',
      level: 2,
      companyLevel: 2,
      xp: 10,
      totalXp: 10,
      reputation: 50,
      completedContracts: 1,
      trucks: [{ ...STARTER_TRUCK, status: 'on_route' }],
      drivers: [{ ...STARTER_DRIVER, status: 'driving' }],
      trailers: [],
      warehouses: [],
    },
    cities: [],
    products: [],
    routes: [],
    contracts: [LEGACY_CONTRACT],
    activeDeliveries: [LEGACY_DELIVERY],
    globalEconomy: { fuelPrice: 35 },
    marketNews: [],
    eventLog: [],
    meta: {
      savedAt: 1,
      currentTime: 12,
      cash: 44_000,
      companyName: 'V6 Co',
      completedContracts: 1,
      appVersion: '1.0.0',
      saveVersion: 6,
    },
  };
}

console.log('\n=== Map V2 Multimodal Persistence Foundation ===\n');

assert(SAVE_GAME_VERSION === 6, 'SAVE_GAME_VERSION remains 6');
assert(SUPPORTED_MULTIMODAL_SHIPMENT_SCHEMA_VERSION === 1, 'nested shipment schema is 1');
assert(MULTIMODAL_FEATURE_ROLLOUT === 'MULTIMODAL_OFF', 'rollout constant MULTIMODAL_OFF');
assert(MAX_PERSISTED_MULTIMODAL_SHIPMENTS === 24, 'in-flight array is capped');

assert(
  existsDoc('docs/architecture/map-v2/MAP_V2_MULTIMODAL_PERSISTENCE_FOUNDATION.md'),
  'persistence foundation doc exists',
);
assert(
  read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 22') &&
    read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('COMPLETE'),
  'migration plan marks Step 22 complete',
);

const deliverySrc = read('src/types/game.ts');
const deliveryBlock = deliverySrc.slice(
  deliverySrc.indexOf('export interface Delivery {'),
  deliverySrc.indexOf('export interface DeliveryAdBoostState'),
);
assert(!deliveryBlock.includes('shipmentSchemaVersion'), 'Delivery has no shipmentSchemaVersion');
assert(!/\blegs\??:/.test(deliveryBlock), 'Delivery has no required legs');
assert(!/\btransfers\??:/.test(deliveryBlock), 'Delivery has no required transfers');

const contractBlock = deliverySrc.slice(
  deliverySrc.indexOf('export interface Contract {'),
  deliverySrc.indexOf('export interface Delivery {'),
);
assert(!contractBlock.includes('ROAD_RAIL_ROAD'), 'Contract has no mandatory multimodal pattern');
assert(!contractBlock.includes('shipmentSchemaVersion'), 'Contract has no shipment schema');

assert(!read('src/screens/MapScreen.tsx').includes("from '../mapV2"), 'production MapScreen unchanged');
assert(read('src/data/routes.ts').includes("route('izmir', 'istanbul', 480, 0.82, 180)"), 'routes.ts unchanged');
assert(!read('src/store/gameStore.ts').includes('startMultimodalShipment'), 'no startMultimodalShipment action');
assert(!read('src/store/gameStore.ts').includes('completeMultimodalShipment'), 'no completeMultimodalShipment action');
assert(!read('src/store/gameStore.ts').includes('settleMultimodalShipment'), 'no settleMultimodalShipment action');
assert(!read('src/simulation/contracts.ts').includes('multimodalShipments'), 'contracts.ts does not write shipments');
assert(!read('src/simulation/delivery.ts').includes('multimodalShipments'), 'delivery.ts does not write shipments');
assert(!read('backend/src/serverState.ts').includes('multimodalShipments'), 'serverState has no shipments');
assert(!read('firestore.rules').includes('multimodalShipments'), 'no Firestore multimodal collection');

const persistSrc = read('src/domain/multimodalShipmentPersistence.ts');
assert(!persistSrc.includes('mapV2/prototypes'), 'persist domain does not import prototypes');
assert(!persistSrc.includes('@shopify/react-native-skia'), 'persist domain has no Skia');
assert(persistSrc.includes('export const MULTIMODAL_FEATURE_ROLLOUT = resolveMultimodalFeatureRollout()'), 'OFF resolved from env (default OFF)');

const liveWriteFiles = [
  'src/storage/saveGame.ts',
  'src/store/gameStore.ts',
  'src/types/game.ts',
  'src/domain/multimodalShipmentPersistence.ts',
];
for (const rel of liveWriteFiles) {
  assert(
    !read(rel).includes('prototypes/productionMultimodal'),
    `${rel} does not depend on persist prototype`,
  );
}

const migratedMissing = migrateSavePayload(v6SaveWithoutShipments());
assert(migratedMissing != null, 'V6 save without field migrates');
assert(migratedMissing!.version === 6, 'migrated envelope still version 6');
assert(Array.isArray(migratedMissing!.multimodalShipments), 'missing field becomes array');
assert(migratedMissing!.multimodalShipments!.length === 0, 'missing field becomes []');
assert(migratedMissing!.activeDeliveries.length === 1, 'legacy Delivery preserved');
assert(migratedMissing!.activeDeliveries[0].id === 'del_legacy_1', 'legacy Delivery id unchanged');
assert(migratedMissing!.contracts[0].id === 'con_legacy_1', 'legacy Contract preserved');
assert(migratedMissing!.player.money === 44_000, 'V6 cash preserved');
assert(!('legs' in migratedMissing!.activeDeliveries[0]), 'Delivery not rewritten with legs');

const hydratedLegacy = payloadToStoreState(migratedMissing!);
assert(hydratedLegacy.multimodalShipments.length === 0, 'store hydrates missing field to []');
assert(hydratedLegacy.activeDeliveries[0].status === 'on_route', 'legacy delivery still on_route');

const emptyCurrent = normalizeSavePayload({
  ...v6SaveWithoutShipments(),
  multimodalShipments: [],
});
assert(emptyCurrent.multimodalShipments!.length === 0, 'explicit [] stays []');

const sample = createTestPersistedMultimodalShipment();
const withSample = normalizeSavePayload({
  ...v6SaveWithoutShipments(),
  multimodalShipments: [sample],
});
assert(withSample.multimodalShipments!.length === 1, 'valid sample loads');
const roundTripState = payloadToStoreState(withSample);
const roundTripPayload = serializeGameState(roundTripState);
const again = migrateSavePayload(roundTripPayload as unknown as Record<string, unknown>);
assert(again != null, 'serialized payload remigrates');
const restored = again!.multimodalShipments![0];
assert(isExecutablePersistedMultimodalShipment(restored), 'round-trip remains executable');
if (isExecutablePersistedMultimodalShipment(restored)) {
  assert(restored.shipmentId === sample.shipmentId, 'round-trip shipmentId');
  assert(restored.contractId === sample.contractId, 'round-trip contractId');
  assert(restored.status === 'ACTIVE', 'round-trip status');
  assert(restored.legs.length === 3, 'round-trip legs');
  assert(restored.transfers.length === 2, 'round-trip transfers');
  assert(restored.legs[1].route.routeReference === 'rail.canonical.izmir-ankara.v1', 'round-trip route ref');
  assert(restored.createdAt === 48, 'round-trip createdAt');
  assert(restored.shipmentSchemaVersion === 1, 'round-trip nested version');
  assert(restored.provenance?.modeSequence?.join('-') === 'ROAD-RAIL-ROAD', 'round-trip provenance');
}

const mixed = normalizeMultimodalShipments([
  sample,
  { not: 'a shipment' },
  42,
  { shipmentSchemaVersion: 1, shipmentId: 'broken' },
]);
assert(mixed.length === 1, 'malformed entries omitted; save array remains loadable');
assert(isExecutablePersistedMultimodalShipment(mixed[0]), 'valid sibling kept');

const future = normalizeMultimodalShipments([
  {
    shipmentSchemaVersion: 99,
    shipmentId: 'future_ship',
    secretFutureField: 'keep-me',
    legs: [{ geometry: [1, 2, 3] }],
  },
]);
assert(future.length === 1, 'unknown schema preserved (not dropped from blob)');
assert(isUnreadablePersistedMultimodalShipment(future[0]), 'unknown schema marked unreadable');
assert(!isExecutablePersistedMultimodalShipment(future[0]), 'unknown schema is not executable');
assert(selectActiveMultimodalShipments({ multimodalShipments: future }).length === 0, 'unreadable excluded from active selector');
if (isUnreadablePersistedMultimodalShipment(future[0])) {
  assert(future[0].opaque.secretFutureField === 'keep-me', 'opaque clone keeps unknown fields');
}

const seaAirPair = normalizeMultimodalShipments([
  createTestPersistedMultimodalShipment({
    shipmentId: 'bad_pair',
    transfers: [
      {
        transferId: 'xfer_illegal',
        transferNodeId: 'transfer.bad',
        fromMode: 'RAIL',
        toMode: 'SEA',
        status: 'PENDING',
      },
    ],
  }),
]);
assert(seaAirPair.length === 0, 'unsupported RAIL↔SEA transfer omits shipment');

const gameStoreSrc = read('src/store/gameStore.ts');
assert(gameStoreSrc.includes('multimodalShipments: [],'), 'new/reset initial state includes []');
assert(gameStoreSrc.includes('const STARTING_MONEY = 20_000;'), 'starter cash constant unchanged');
assert(gameStoreSrc.includes("homeCityId: 'izmir'"), 'starter home city unchanged');
assert(gameStoreSrc.includes('...createInitialGameState()'), 'reset spreads createInitialGameState');
assert(STARTER_MONEY === 20_000 && STARTER_HOME_CITY_ID === 'izmir', 'canonical starter defaults unchanged');

const emptyHydrated = payloadToStoreState(
  normalizeSavePayload({
    version: 6,
    currentTime: 0,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'LogistiCore Lojistik',
      money: 20_000,
      homeCityId: 'izmir',
      trucks: [STARTER_TRUCK],
      drivers: [STARTER_DRIVER],
      trailers: [],
      warehouses: [],
    },
    cities: [],
    products: [],
    routes: [],
    contracts: [],
    activeDeliveries: [],
    globalEconomy: { fuelPrice: 35 },
    marketNews: [],
    eventLog: [],
    meta: {
      savedAt: 1,
      currentTime: 0,
      cash: 20_000,
      companyName: 'LogistiCore Lojistik',
      completedContracts: 0,
      appVersion: '1.0.0',
      saveVersion: 6,
    },
  }),
);
assert(emptyHydrated.multimodalShipments.length === 0, 'fresh-like hydrate has []');
assert(emptyHydrated.player.money === 20_000, 'fresh-like cash preserved');

const serializedInitial = serializeGameState(emptyHydrated);
assert(Array.isArray(serializedInitial.multimodalShipments), 'serialize writes array');
assert(serializedInitial.multimodalShipments!.length === 0, 'new game serialize is []');
assert(!JSON.stringify(serializedInitial).includes('undefined'), 'serialize JSON has no undefined token');

const cloudSanitized = sanitizeForFirestore(serializeGameState(roundTripState));
assert(isRecord(cloudSanitized), 'cloud sanitize returns object');
if (isRecord(cloudSanitized)) {
  assert(Array.isArray(cloudSanitized.multimodalShipments), 'cloud blob includes multimodalShipments');
  const cloudAgain = migrateSavePayload(cloudSanitized);
  assert(cloudAgain?.multimodalShipments?.[0] != null, 'cloud blob remigrates shipment');
}

const sampleBytes = new TextEncoder().encode(JSON.stringify(sample)).length;
assert(sampleBytes < 4_000, `per-shipment JSON is compact (${sampleBytes} bytes)`);
console.log(`  · fixture shipment serialized size: ${sampleBytes} bytes`);

assert(selectMultimodalShipments(emptyHydrated).length === 0, 'selector empty on new-like state');
assert(selectActiveMultimodalShipments(roundTripState).length === 1, 'active selector sees in-flight sample');

const gameplayWriteHits = grepWrites([
  'src/simulation/contracts.ts',
  'src/simulation/delivery.ts',
  'src/screens/MapScreen.tsx',
]);
assert(gameplayWriteHits.length === 0, 'no ROAD/MapScreen path writes multimodalShipments');
assert(
  read('src/screens/ContractsScreen.tsx').includes('multimodalShipments'),
  'Step 29 INTERNAL_TEST UI may read multimodalShipments (not Contract[])',
);

assert(
  !read('src/storage/saveGame.ts').includes('completeMultimodalShipment'),
  'save layer has no settlement executor',
);

const step29Shape = {
  ...sample,
  sourceOfferId: 'railOffer:test',
  executionPolicyVersion: 'multimodal-execution-v1',
  executionStage: 'FIRST_MILE_ROAD',
  currentStageElapsedGameSeconds: 12,
  totalElapsedGameSeconds: 12,
  settlementState: 'NOT_SETTLED',
};
const step29Norm = normalizeMultimodalShipments([step29Shape]);
assert(step29Norm.length === 1 && !('unreadable' in step29Norm[0] && step29Norm[0].unreadable === true), 'Step 29 extra fields normalize');
if (step29Norm[0] && !('unreadable' in step29Norm[0] && step29Norm[0].unreadable)) {
  assert(step29Norm[0].executionStage === 'FIRST_MILE_ROAD', 'execution stage persisted');
  assert(step29Norm[0].settlementState === 'NOT_SETTLED', 'NOT_SETTLED persisted');
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS');

function existsDoc(rel: string): boolean {
  try {
    read(rel);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function grepWrites(rels: string[]): string[] {
  const hits: string[] = [];
  for (const rel of rels) {
    const src = read(rel);
    if (src.includes('multimodalShipments')) {
      hits.push(rel);
    }
  }
  return hits;
}
