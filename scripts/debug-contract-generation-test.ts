/**
 * Debug contract generation + store/selector E2E.
 * Run: npx tsx scripts/debug-contract-generation-test.ts
 */

import './test-globals';

import { CITIES, CITY_IDS } from '../src/data/cities';
import { ROUTES } from '../src/data/routes';
import { PRODUCTS } from '../src/data/products';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import {
  finalizeDebugContractTraces,
  generateContractForRoute,
  generateDebugContractsFromCurrentCity,
  inspectDebugContractPair,
  resolveDebugOriginCityId,
} from '../src/simulation/debugContractGeneration';
import {
  mergeCanonicalCities,
  mergeCanonicalRoutes,
} from '../src/data/mergeCanonicalCatalog';
import {
  getMapRoadSegmentById,
  isMapRoadSegmentRoutable,
} from '../src/data/mapRoadNetwork';
import {
  getRoadGraphAdjacency,
  getRoadRoute,
  invalidateRoadGraphCache,
  isRoadGraphPairConnected,
} from '../src/components/map/mapRoadUtils';
import {
  getCityUnlockLevel,
  isWarehouseCityUnlocked,
} from '../src/config/levelConfig';
import {
  getRouteBetweenCities,
  mergeContractLists,
} from '../src/simulation/contracts';
import { selectAvailableContractsForUi } from '../src/utils/contractsUiSelector';
import type { Contract, Truck } from '../src/types/game';

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

function truckAt(cityId: string, id = 'truck_1'): Truck {
  return {
    id,
    name: 'Debug Truck',
    capacity: 40,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 95,
    purchasePrice: 50_000,
    currentCityId: cityId,
    homeCityId: cityId,
    status: 'idle',
  } as Truck;
}

const STARTER_IDS = ['izmir', 'istanbul', 'ankara', 'bursa', 'antalya'];

console.log('\n=== Debug Contract Generation Test ===\n');

console.log('A. Road graph — ankara-adana');
{
  invalidateRoadGraphCache();
  const seg = getMapRoadSegmentById('ankara-adana');
  assert(!!seg, 'ankara-adana segment exists');
  assert(seg?.isCalibrated === true, 'ankara-adana isCalibrated');
  assert((seg?.points.length ?? 0) >= 2, 'ankara-adana points >= 2');
  assert(!!seg && isMapRoadSegmentRoutable(seg), 'ankara-adana routable');

  const adjacency = getRoadGraphAdjacency();
  const included = (adjacency.get('ankara') ?? []).some((e) => e.toCityId === 'adana');
  assert(included, 'ankara-adana included in graph adjacency');
  assert(isRoadGraphPairConnected('ankara', 'adana'), 'Ankara → Adana connected');
  assert(isRoadGraphPairConnected('adana', 'ankara'), 'Adana → Ankara connected');

  const fwd = getRoadRoute('ankara', 'adana');
  const rev = getRoadRoute('adana', 'ankara');
  assert((fwd?.length ?? 0) >= 2, 'Ankara → Adana route points filled');
  assert((rev?.length ?? 0) >= 2, 'Adana → Ankara route points filled');
}

console.log('\nB. Eligibility — Adana unlock');
{
  assert(getCityUnlockLevel('adana') === 5, 'Adana unlock level is 5');
  assert(isWarehouseCityUnlocked('adana', 5), 'Adana eligible at L5');
  assert(!isWarehouseCityUnlocked('adana', 4), 'Adana locked at L4');

  const locked = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 3,
    currentTime: 240,
    maxTruckCapacity: 25,
    respectCityUnlockRules: true,
  });
  assert(!locked.createdDestinations.includes('adana'), 'respectRules: Adana locked at L3');
  assert(
    locked.skippedDestinations.some(
      (s) => s.destinationCityId === 'adana' && s.reason === 'locked',
    ),
    'respectRules: skip reason locked',
  );

  const forced = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 3,
    currentTime: 241,
    maxTruckCapacity: 25,
    respectCityUnlockRules: false,
  });
  assert(forced.forceUnlockCities === true, 'force mode flag set');
  assert(
    forced.createdDestinations.includes('adana'),
    'force debug: Adana eligible at L3',
  );
}

console.log('\nC. Contract generation — Ankara current city L11');
{
  assert(CITY_IDS.includes('adana'), 'CITY_IDS includes adana');
  assert(!!getRouteBetweenCities(ROUTES, 'ankara', 'adana'), 'route distance Ankara→Adana');

  const result = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 11,
    currentTime: 250,
    maxTruckCapacity: 40,
    respectCityUnlockRules: true,
  });

  assert(result.originCityId === 'ankara', 'origin Ankara');
  assert(result.createdDestinations.includes('adana'), 'Adana destination created');
  const adanaContract = result.contracts.find((c) => c.destinationCityId === 'adana');
  assert(!!adanaContract, 'Adana contract object exists');
  assert(adanaContract?.originCityId === 'ankara', 'origin Ankara on Adana contract');
  assert(
    result.contracts.every((c) => c.destinationCityId !== 'ankara'),
    'no Ankara → Ankara',
  );
}

console.log('\nD. E2E store + selector — old 5-city save + L11 Ankara');
{
  const oldCities = CITIES.filter((c) => STARTER_IDS.includes(c.id));
  const oldRoutes = ROUTES.filter(
    (r) => STARTER_IDS.includes(r.fromCityId) && STARTER_IDS.includes(r.toCityId),
  );
  assert(oldCities.length === 5, 'fixture has 5 starter cities');

  // Without merge: Adana must be skipped as invalid-city
  const broken = generateDebugContractsFromCurrentCity({
    cities: oldCities,
    routes: oldRoutes,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 11,
    currentTime: 300,
    maxTruckCapacity: 40,
    respectCityUnlockRules: false,
  });
  // Generator now auto-merges canonical cities — Adana must still be created
  assert(
    broken.createdDestinations.includes('adana'),
    'generator merges missing Adana from old save cities',
  );

  const mergedCities = mergeCanonicalCities(oldCities);
  const mergedRoutes = mergeCanonicalRoutes(oldRoutes);
  assert(mergedCities.some((c) => c.id === 'adana'), 'mergeCanonicalCities adds adana');
  assert(
    mergedRoutes.some((r) => r.id === 'ankara-adana'),
    'mergeCanonicalRoutes adds ankara-adana',
  );

  const existing: Contract[] = [];
  const generated = generateDebugContractsFromCurrentCity({
    cities: mergedCities,
    routes: mergedRoutes,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 11,
    currentTime: 310,
    maxTruckCapacity: 40,
    respectCityUnlockRules: false,
    storeCountBefore: existing.length,
  });

  assert(generated.createdCount > 1, 'batch creates multiple destinations');
  const storeAfter = mergeContractLists(existing, generated.contracts);
  const finalized = finalizeDebugContractTraces({
    result: generated,
    storeContractsBefore: existing,
    storeContractsAfter: storeAfter,
  });

  assert(
    storeAfter.some(
      (c) =>
        c.originCityId === 'ankara' &&
        c.destinationCityId === 'adana' &&
        c.status === 'available',
    ),
    'Ankara→Adana in store after single merge',
  );
  assert(finalized.storedDestinations.includes('adana'), 'Adana survives post-processing');

  const visible = selectAvailableContractsForUi(storeAfter);
  assert(
    visible.some((c) => c.originCityId === 'ankara' && c.destinationCityId === 'adana'),
    'UI selector returns Ankara→Adana',
  );

  const inspect = inspectDebugContractPair(storeAfter, 'ankara', 'adana');
  assert(inspect.visible === true, 'inspect helper visible=true');
  assert(inspect.failureReason == null, 'inspect helper no failure');

  // Batch must not lose earlier destinations when many are created
  assert(
    finalized.storedCount === generated.createdCount,
    'all generated destinations stored in one update',
    `stored=${finalized.storedCount} created=${generated.createdCount}`,
  );
}

console.log('\nE. Trabzon / Diyarbakır calibrated routes + generation');
{
  invalidateRoadGraphCache();
  for (const segmentId of ['ankara-trabzon', 'adana-diyarbakir'] as const) {
    const seg = getMapRoadSegmentById(segmentId);
    assert(!!seg, `${segmentId} registered`);
    assert(seg?.isCalibrated === true, `${segmentId} calibrated`);
    assert((seg?.points.length ?? 0) >= 2, `${segmentId} routable points`);
    assert(!!seg && isMapRoadSegmentRoutable(seg), `${segmentId} routable`);
  }

  assert(isRoadGraphPairConnected('ankara', 'trabzon'), 'Ankara → Trabzon connected');
  assert(isRoadGraphPairConnected('adana', 'diyarbakir'), 'Adana → Diyarbakır connected');

  const respect = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 11,
    currentTime: 320,
    maxTruckCapacity: 40,
    respectCityUnlockRules: true,
  });
  assert(respect.createdDestinations.includes('trabzon'), 'respectRules: trabzon created at L11');
  assert(
    respect.createdDestinations.includes('diyarbakir'),
    'respectRules: diyarbakir created at L11',
  );

  const trabzonContract = respect.contracts.find((c) => c.destinationCityId === 'trabzon');
  const diyarbakirContract = respect.contracts.find(
    (c) => c.destinationCityId === 'diyarbakir',
  );
  assert(
    !!trabzonContract &&
      Number.isFinite(trabzonContract.distanceKm) &&
      trabzonContract.distanceKm > 0,
    'trabzon finite distance',
  );
  assert(
    !!diyarbakirContract &&
      Number.isFinite(diyarbakirContract.distanceKm) &&
      diyarbakirContract.distanceKm > 0,
    'diyarbakir finite distance',
  );
  assert(
    !!trabzonContract && trabzonContract.deadlineHours > 0,
    'trabzon valid ETA',
  );
  assert(
    !!diyarbakirContract && diyarbakirContract.deadlineHours > 0,
    'diyarbakir valid ETA',
  );

  const locked = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 3,
    currentTime: 322,
    maxTruckCapacity: 40,
    respectCityUnlockRules: true,
  });
  assert(
    locked.skippedDestinations.some(
      (s) => s.destinationCityId === 'trabzon' && s.reason === 'locked',
    ),
    'respectRules: trabzon locked below L7',
  );

  const force = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('ankara')],
    homeCityId: 'ankara',
    playerLevel: 3,
    currentTime: 323,
    maxTruckCapacity: 40,
    respectCityUnlockRules: false,
  });
  assert(force.createdDestinations.includes('trabzon'), 'force mode creates trabzon job');
  assert(force.createdDestinations.includes('diyarbakir'), 'force mode creates diyarbakir job');
}

console.log('\nF. Canonical IDs + reverse');
{
  const result = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('adana')],
    homeCityId: 'adana',
    playerLevel: 11,
    currentTime: 330,
    maxTruckCapacity: 40,
  });
  assert(result.originCityId === 'adana', 'origin Adana canonical');
  assert(result.createdDestinations.includes('ankara'), 'Adana → Ankara created');
  assert(
    result.contracts.every((c) => c.originCityId === 'adana'),
    'contract origins match generator origin',
  );
}

console.log('\nG. İzmir → Adana when graph-connected');
{
  const connected = isRoadGraphPairConnected('izmir', 'adana');
  const result = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('izmir')],
    homeCityId: 'izmir',
    playerLevel: 11,
    currentTime: 340,
    maxTruckCapacity: 40,
    respectCityUnlockRules: true,
  });
  if (connected) {
    assert(result.createdDestinations.includes('adana'), 'İzmir → Adana created when connected');
  } else {
    assert(
      result.skippedDestinations.some(
        (s) => s.destinationCityId === 'adana' && s.reason === 'unreachable',
      ),
      'İzmir → Adana skipped unreachable when disconnected',
    );
  }
}

console.log('\n1. Current city İzmir');
{
  const result = generateDebugContractsFromCurrentCity({
    cities: CITIES,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    trucks: [truckAt('izmir')],
    homeCityId: 'izmir',
    playerLevel: 10,
    currentTime: 200,
    maxTruckCapacity: 40,
  });

  assert(result.originCityId === 'izmir', 'origin is izmir');
  assert(result.createdCount > 0, 'creates at least one contract');
  assert(
    result.contracts.every((c) => c.originCityId === 'izmir'),
    'all contracts originate from izmir',
  );
  assert(
    result.contracts.every((c) => c.destinationCityId !== 'izmir'),
    'no izmir → izmir contract',
  );
}

console.log('\n5. resolveDebugOriginCityId');
{
  assert(
    resolveDebugOriginCityId([truckAt('ankara')], 'izmir') === 'ankara',
    'idle truck city wins over home',
  );
  assert(resolveDebugOriginCityId([], 'izmir') === 'izmir', 'falls back to homeCityId');
}

console.log('\n6. generateContractForRoute rejects same-city');
{
  const ankara = CITIES.find((c) => c.id === 'ankara')!;
  const contract = generateContractForRoute({
    originCity: ankara,
    destinationCity: ankara,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    currentTime: 100,
    playerLevel: 5,
  });
  assert(contract == null, 'same-city route returns null');
}

console.log(`\nPASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failed > 0) {
  console.error('❌ FAILED');
  process.exit(1);
}
console.log('✅ ALL PASS');
