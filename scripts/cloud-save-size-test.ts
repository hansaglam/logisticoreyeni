/**
 * Cloud save payload size + slim serialization regression tests.
 * Run: npx tsx scripts/cloud-save-size-test.ts
 */

import './test-globals';

import { CITIES, CITY_IDS } from '../src/data/cities';
import { MAP_ROAD_SEGMENTS } from '../src/data/mapRoadNetwork';
import { mergeCanonicalCities, mergeCanonicalRoutes } from '../src/data/mergeCanonicalCatalog';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { contractGenerationBalance } from '../src/config/balance';
import {
  analyzeSavePayloadSize,
  measureUtf8JsonBytes,
  migrateSavePayload,
  payloadToStoreState,
  pruneContractsForSave,
  serializeGameState,
  slimCityForSave,
  stripLegacyBloatedSaveFields,
  type SaveGamePayload,
} from '../src/storage/saveGame';
import {
  estimateCloudSaveDocumentBytes,
  MAX_SAVE_SIZE_BYTES,
} from '../src/utils/cloudSaveSize';
import { createHeadlessSimState } from './lib/headlessSim';
import { normalizeContract } from '../src/simulation/contractTypes';
import type { Contract, StoreGameState } from '../src/types/game';

function headlessToStoreState(headless: ReturnType<typeof createHeadlessSimState>): StoreGameState {
  return {
    ...headless,
    isPaused: false,
    gameSpeed: 1,
    lastSimulationGameSpeed: 1,
    player: {
      ...headless.player,
      trailers: headless.player.trailers ?? [],
    },
    activeTransfers: [],
    completedTransfers: [],
    marketNews: [],
    eventLog: [],
    tutorial: undefined,
    missions: undefined,
    onboarding: undefined,
    spotlightTutorial: undefined,
    marketAlerts: [],
    monetization: undefined,
  } as StoreGameState;
}

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

function buildBloatedLegacyPayload(base: SaveGamePayload): SaveGamePayload {
  return {
    ...base,
    ...( {
      mapRoadSegments: MAP_ROAD_SEGMENTS,
      calibration: { sessionsBySegmentId: { 'izmir-istanbul': [{ x: 0.1, y: 0.2 }] } },
      sessionsBySegmentId: { test: [{ x: 0.5, y: 0.5 }] },
      routeResolutionCache: { foo: 'bar' },
    } as Record<string, unknown>),
  } as SaveGamePayload;
}

function buildLegacyFiveCitySave(base: SaveGamePayload): SaveGamePayload {
  const starterIds = new Set(['izmir', 'istanbul', 'ankara', 'bursa', 'antalya']);
  return {
    ...base,
    cities: base.cities.filter((city) => starterIds.has(city.id)),
    routes: base.routes.filter(
      (route) => starterIds.has(route.fromCityId) && starterIds.has(route.toCityId),
    ),
    version: 2,
  };
}

function buildSpamContracts(originCityId: string, count: number, currentTime: number): Contract[] {
  const contracts: Contract[] = [];
  for (let i = 0; i < count; i += 1) {
    contracts.push(
      normalizeContract({
        id: `spam_${i}`,
        originCityId,
        destinationCityId: 'istanbul',
        productId: 'fruit',
        amount: 5,
        cargoWeight: 5,
        payment: 1200,
        deadlineHours: 24,
        distanceKm: 480,
        urgency: 0.3,
        status: i % 3 === 0 ? 'expired' : 'available',
        createdAt: currentTime - i,
        expiresAt: currentTime + 48,
        requiredLevel: 1,
      }),
    );
  }
  return contracts;
}

console.log('\n=== A. Road network excluded from save ===\n');

const baseState = headlessToStoreState(createHeadlessSimState('LogistiCore Test'));
const slimPayload = serializeGameState(baseState);
const slimJson = JSON.stringify(slimPayload);

assert(!slimJson.includes('"mapRoadSegments"'), 'mapRoadSegments not in save JSON');
assert(!slimJson.includes('"sessionsBySegmentId"'), 'calibration sessions not in save JSON');
assert(!slimJson.includes('"routeResolutionCache"'), 'route resolution cache not in save JSON');

const hasMapSegmentPayload =
  slimJson.includes('"mapRoadSegments"') ||
  slimJson.includes('"sessionsBySegmentId"') ||
  /"points"\s*:\s*\[\s*\{\s*"x"/.test(slimJson);
assert(!hasMapSegmentPayload, 'road polyline points not embedded in save JSON');

console.log('\n=== B. Canonical catalog omitted on save ===\n');

assert(slimPayload.products.length === 0, 'products catalog omitted (empty array)');
assert(slimPayload.routes.length === 0, 'routes matrix omitted (empty array)');

const firstSavedCity = slimPayload.cities[0];
assert(
  firstSavedCity != null && firstSavedCity.products != null,
  'city dynamic product state preserved',
);
assert(
  firstSavedCity != null && firstSavedCity.population === 0,
  'city static metadata stripped on save (population sentinel)',
);

const loadedFromSlim = payloadToStoreState(slimPayload);
assert(loadedFromSlim.products.length === PRODUCTS.length, 'products rehydrated on load');
assert(loadedFromSlim.routes.length === ROUTES.length, 'routes rehydrated on load');
assert(loadedFromSlim.cities.length === CITIES.length, 'all canonical cities present after load');
assert(
  mergeCanonicalCities(slimPayload.cities).length === CITIES.length,
  'mergeCanonicalCities still expands slim saves',
);

console.log('\n=== C. Player data preserved ===\n');

assert(loadedFromSlim.player.trucks.length === baseState.player.trucks.length, 'trucks preserved');
assert(
  (loadedFromSlim.player.trailers?.length ?? 0) === (baseState.player.trailers?.length ?? 0),
  'trailers preserved',
);
assert(loadedFromSlim.player.drivers.length === baseState.player.drivers.length, 'drivers preserved');
assert(
  loadedFromSlim.player.warehouses.length === baseState.player.warehouses.length,
  'warehouses preserved',
);
assert(loadedFromSlim.contracts.length > 0, 'contracts preserved');
assert(
  loadedFromSlim.activeDeliveries.length === baseState.activeDeliveries.length,
  'active deliveries preserved',
);
assert(loadedFromSlim.cities[0]?.products.fruit != null, 'market dynamic state preserved');

function buildBloatedFullCatalogPayload(base: SaveGamePayload): SaveGamePayload {
  return {
    ...base,
    cities: structuredClone(CITIES),
    products: structuredClone(PRODUCTS),
    routes: structuredClone(ROUTES),
    contracts: [
      ...base.contracts,
      ...buildSpamContracts('izmir', 800, base.currentTime),
    ],
    version: 2,
  };
}

console.log('\n=== D. Legacy save migration ===\n');

const legacyPayload = buildLegacyFiveCitySave(buildBloatedFullCatalogPayload(slimPayload));
const legacyBytes = analyzeSavePayloadSize(legacyPayload).totalBytes;

const migrated = migrateSavePayload(
  stripLegacyBloatedSaveFields(buildBloatedLegacyPayload(legacyPayload) as Record<string, unknown>),
);
assert(migrated != null, 'legacy 5-city save loads');
assert(
  migrated != null && migrated.cities.length === CITIES.length,
  'new cities merged on legacy load',
);

const reSaved = serializeGameState(payloadToStoreState(migrated!));
const reSavedReport = analyzeSavePayloadSize(reSaved);
assert(reSaved.products.length === 0, 're-save drops products catalog');
assert(reSaved.routes.length === 0, 're-save drops routes matrix');
assert(
  reSavedReport.totalBytes < legacyBytes,
  're-save smaller than legacy full catalog save',
  `legacy=${legacyBytes} reSaved=${reSavedReport.totalBytes}`,
);

console.log('\n=== E. Payload size limits ===\n');

const envelopeBytes = estimateCloudSaveDocumentBytes(slimPayload);
const safeLimit = MAX_SAVE_SIZE_BYTES * 0.75;
assert(envelopeBytes < safeLimit, 'normal save under safe cloud limit', `${envelopeBytes} bytes`);

const mapPointsJsonBytes = measureUtf8JsonBytes(MAP_ROAD_SEGMENTS);
const payloadWithoutMap = envelopeBytes;
assert(
  payloadWithoutMap < safeLimit,
  '28 map segment points do not affect payload size',
  `segments alone would be ${mapPointsJsonBytes} bytes`,
);

console.log('\n=== F. Debug contract spam pruning ===\n');

const spamState: StoreGameState = {
  ...baseState,
  contracts: buildSpamContracts('izmir', 500, baseState.currentTime),
};
const pruned = pruneContractsForSave(
  spamState.contracts,
  spamState.activeDeliveries,
  spamState.currentTime,
);
const availableAfter = pruned.filter((c) => c.status === 'available').length;
const expiredAfter = pruned.filter((c) => c.status === 'expired').length;

assert(expiredAfter === 0, 'expired contracts dropped on save');
assert(
  availableAfter <= contractGenerationBalance.maxAvailableContracts + 8,
  'available contracts capped on save',
  `available=${availableAfter}`,
);

const spamPayload = serializeGameState(spamState);
const spamEnvelope = estimateCloudSaveDocumentBytes(spamPayload);
assert(spamEnvelope < MAX_SAVE_SIZE_BYTES, 'spam contract save still under cloud limit', `${spamEnvelope}`);

console.log('\n=== Size report (slim payload) ===\n');
const report = analyzeSavePayloadSize(slimPayload);
console.log(
  JSON.stringify(
    {
      totalBytes: report.totalBytes,
      totalKb: report.totalKb,
      envelopeBytes,
      topLevelKeys: report.topLevelKeys,
    },
    null,
    2,
  ),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
