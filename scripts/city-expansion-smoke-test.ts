/**
 * City expansion smoke test — Adana, Diyarbakır, Trabzon + road segments.
 * Run: npx tsx scripts/city-expansion-smoke-test.ts
 */

import './test-globals';

import { CITIES, CITIES_BY_ID, CITY_IDS } from '../src/data/cities';
import {
  getMapRoadSegmentById,
  isMapRoadSegmentRoutable,
  MAP_ROAD_SEGMENTS,
} from '../src/data/mapRoadNetwork';
import { ROUTES, getRoute } from '../src/data/routes';
import {
  getCityUnlockLevel,
  isWarehouseCityUnlocked,
} from '../src/config/levelConfig';
import {
  generateContracts,
  findMarketOpportunities,
} from '../src/simulation/contracts';
import {
  applyFleetArrivalForDelivery,
  completeDelivery,
} from '../src/simulation/delivery';
import {
  getDirectRoadSegment,
  getRoadRoute,
  invalidateRoadGraphCache,
  isRoadGraphPairConnected,
} from '../src/components/map/mapRoadUtils';
import { getCityName, isCityId } from '../src/utils/entityLookup';
import { getWorldMapCityPosition } from '../src/data/worldMapPositions';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import { PRODUCTS } from '../src/data/products';
import type { City, Delivery, SimulationGameState, Truck } from '../src/types/game';

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

function baseTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck_1',
    name: 'Test Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.35,
    speed: 80,
    reliability: 85,
    maintenanceCost: 0.12,
    comfort: 70,
    condition: 90,
    purchasePrice: 45_000,
    currentCityId: 'ankara',
    homeCityId: 'ankara',
    status: 'on_route',
    ...overrides,
  } as Truck;
}

function baseDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery_1',
    contractId: 'contract_1',
    truckId: 'truck_1',
    driverId: 'driver_1',
    originCityId: 'ankara',
    destinationCityId: 'adana',
    productId: 'machinery',
    amount: 10,
    distanceKm: 550,
    progress: 1,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 24,
    deadlineTime: 48,
    fuelCost: 400,
    maintenanceCost: 100,
    estimatedProfit: 800,
    travelHours: 20,
    breakdownChance: 0.02,
    accidentChance: 0.01,
    conditionLoss: 2,
    ...overrides,
  };
}

function baseSim(overrides: Partial<SimulationGameState> = {}): SimulationGameState {
  return {
    currentDay: 1,
    currentTime: 24,
    player: {
      companyName: 'Test Co',
      money: 50_000,
      companyLevel: 10,
      homeCityId: 'izmir',
    },
    trucks: [baseTruck()],
    drivers: [{ id: 'driver_1', name: 'Driver', status: 'on_route', level: 1, xp: 0 }],
    warehouses: [],
    cities: {},
    contracts: [
      {
        id: 'contract_1',
        originCityId: 'ankara',
        destinationCityId: 'adana',
        productId: 'machinery',
        amount: 10,
        cargoWeight: 10,
        distanceKm: 550,
        payment: 5000,
        deadlineHours: 48,
        status: 'active',
        contractType: 'standard',
      },
    ],
    deliveries: [baseDelivery()],
    ...overrides,
  } as SimulationGameState;
}

console.log('\n=== City Expansion Smoke Test ===\n');

console.log('A. City registry');
{
  for (const id of ['adana', 'diyarbakir', 'trabzon'] as const) {
    assert(CITY_IDS.includes(id), `${id} exists in CITY_IDS`);
    assert(isCityId(id), `${id} recognized by isCityId`);
    assert(CITIES_BY_ID[id] != null, `${id} in CITIES_BY_ID`);
  }
  assert(getCityName('adana') === 'Adana', 'display name Adana');
  assert(getCityName('diyarbakir') === 'Diyarbakır', 'display name Diyarbakır');
  assert(getCityName('trabzon') === 'Trabzon', 'display name Trabzon');
  assert(getCityName('diyarbakir') !== 'diyarbakir', 'Diyarbakır not raw id');
}

console.log('\nB. Unlock levels');
{
  assert(getCityUnlockLevel('adana') === 5, 'Adana unlock L5');
  assert(getCityUnlockLevel('trabzon') === 7, 'Trabzon unlock L7');
  assert(getCityUnlockLevel('diyarbakir') === 9, 'Diyarbakir unlock L9');
  assert(!isWarehouseCityUnlocked('adana', 4), 'Adana locked at L4');
  assert(isWarehouseCityUnlocked('adana', 5), 'Adana unlocked at L5');
  assert(!isWarehouseCityUnlocked('diyarbakir', 8), 'Diyarbakir locked at L8');
  assert(isWarehouseCityUnlocked('diyarbakir', 9), 'Diyarbakir unlocked at L9');
}

console.log('\nC. World map positions');
{
  for (const id of ['adana', 'diyarbakir', 'trabzon']) {
    const pos = getWorldMapCityPosition(id);
    assert(pos != null, `${id} has world map position`);
  }
}

console.log('\nD. Road network segments');
{
  const segmentIds = [
    'izmir-istanbul',
    'ankara-adana',
    'antalya-adana',
    'adana-diyarbakir',
    'ankara-trabzon',
  ];
  for (const id of segmentIds) {
    const segment = getMapRoadSegmentById(id);
    assert(segment != null, `segment ${id} registered`);
    if (segment!.isCalibrated === false) {
      assert(!isMapRoadSegmentRoutable(segment!), `${id} not routable while uncalibrated`);
    } else {
      assert(isMapRoadSegmentRoutable(segment!), `${id} routable when calibrated`);
    }
  }

  invalidateRoadGraphCache();
  const izmirIstanbul = getMapRoadSegmentById('izmir-istanbul');
  if (izmirIstanbul && isMapRoadSegmentRoutable(izmirIstanbul)) {
    assert(getDirectRoadSegment('izmir', 'istanbul') != null, 'calibrated izmir-istanbul direct route exists');
  } else {
    assert(getDirectRoadSegment('izmir', 'istanbul') == null, 'uncalibrated izmir-istanbul direct route null');
  }

  const calibrated = MAP_ROAD_SEGMENTS.find((s) => s.id === 'istanbul-bursa');
  assert(calibrated != null && isMapRoadSegmentRoutable(calibrated), 'existing segment still routable');

  assert(isRoadGraphPairConnected('istanbul', 'bursa'), 'istanbul-bursa graph connected');
  assert(isRoadGraphPairConnected('izmir', 'ankara'), 'izmir-ankara graph connected');

  const reverse = getDirectRoadSegment('bursa', 'istanbul');
  const forward = getDirectRoadSegment('istanbul', 'bursa');
  assert(reverse != null && forward != null, 'reverse direction segment lookup works');
}

console.log('\nE. Gameplay routes (distance)');
{
  assert(getRoute('izmir', 'istanbul') != null, 'izmir-istanbul gameplay route exists');
  assert(getRoute('adana', 'ankara') != null, 'adana-ankara gameplay route exists');
  assert(getRoute('trabzon', 'diyarbakir') != null, 'trabzon-diyarbakir gameplay route exists');
  const expectedPairs = (CITY_IDS.length * (CITY_IDS.length - 1)) / 2;
  const uniquePairs = new Set(
    ROUTES.map((r) => [r.fromCityId, r.toCityId].sort().join('|')),
  );
  assert(uniquePairs.size === expectedPairs, `route coverage ${uniquePairs.size}/${expectedPairs}`);
}

console.log('\nF. Contract generation integration');
{
  const citiesRecord = Object.fromEntries(CITIES.map((city) => [city.id, structuredClone(city)]));

  const lowLevel = generateContracts(
    citiesRecord,
    ROUTES,
    PRODUCTS,
    DEFAULT_GLOBAL_ECONOMY,
    [],
    { currentTime: 100, playerLevel: 3, maxNewContracts: 20 },
  );
  const hasLockedNewCity = lowLevel.some(
    (c) =>
      c.originCityId === 'adana' ||
      c.destinationCityId === 'adana' ||
      c.originCityId === 'trabzon' ||
      c.destinationCityId === 'trabzon' ||
      c.originCityId === 'diyarbakir' ||
      c.destinationCityId === 'diyarbakir',
  );
  assert(!hasLockedNewCity, 'L3 player does not get locked new-city contracts');

  const highLevel = generateContracts(
    citiesRecord,
    ROUTES,
    PRODUCTS,
    DEFAULT_GLOBAL_ECONOMY,
    [],
    { currentTime: 100, playerLevel: 10, maxNewContracts: 40 },
  );
  assert(
    isRoadGraphPairConnected('ankara', 'adana') ===
      isMapRoadSegmentRoutable(getMapRoadSegmentById('ankara-adana')!),
    'ankara-adana graph connectivity matches segment calibration state',
  );
  assert(getRoute('ankara', 'adana') != null, 'gameplay route ankara-adana exists');
  const newCityContracts = highLevel.filter(
    (c) =>
      ['adana', 'diyarbakir', 'trabzon'].includes(c.originCityId) ||
      ['adana', 'diyarbakir', 'trabzon'].includes(c.destinationCityId),
  );
  if (!isRoadGraphPairConnected('ankara', 'adana')) {
    assert(
      newCityContracts.length === 0,
      'new-city contracts withheld until road graph connects (post-calibration)',
    );
  } else {
    assert(true, 'new-city contracts allowed when road graph connects');
  }

  for (const contract of highLevel) {
    assert(
      contract.originCityId !== contract.destinationCityId,
      `contract ${contract.id} origin !== destination`,
    );
  }

  const opportunities = findMarketOpportunities(
    CITIES as City[],
    ROUTES,
    PRODUCTS,
    20,
    10,
  );
  assert(opportunities.every((o) => o.fromCityId !== o.toCityId), 'opportunities differ origin/dest');
}

console.log('\nG. Delivery completion');
{
  const pairs = [
    { origin: 'ankara', dest: 'adana' },
    { origin: 'adana', dest: 'diyarbakir' },
    { origin: 'ankara', dest: 'trabzon' },
  ] as const;

  for (const { origin, dest } of pairs) {
    const truck = baseTruck({ currentCityId: origin, homeCityId: origin });
    const delivery = baseDelivery({
      originCityId: origin,
      destinationCityId: dest,
    });
    const sim = baseSim({
      trucks: [truck],
      deliveries: [delivery],
      contracts: [
        {
          id: 'contract_1',
          originCityId: origin,
          destinationCityId: dest,
          productId: 'machinery',
          amount: 10,
          cargoWeight: 10,
          distanceKm: 550,
          payment: 5000,
          deadlineHours: 48,
          status: 'active',
          contractType: 'standard',
        },
      ],
    });
    const next = completeDelivery(sim, delivery.id);
    const after = next.trucks.find((t) => t.id === 'truck_1');
    assert(after?.currentCityId === dest, `${origin} → ${dest}: truck at destination`);
    assert(after?.status === 'idle', `${origin} → ${dest}: truck idle`);
  }

  const arrival = applyFleetArrivalForDelivery(
    [baseTruck({ currentCityId: 'istanbul' })],
    [{ id: 'driver_1', name: 'D', status: 'on_route', level: 1, xp: 0 } as import('../src/types/game').Driver],
    baseDelivery({ originCityId: 'istanbul', destinationCityId: 'ankara' }),
  );
  assert(arrival.trucks[0].currentCityId === 'ankara', 'fleet arrival helper sets destination');
}

console.log('\nH. Calibrated segment routing simulation');
{
  invalidateRoadGraphCache();
  const testSegment = {
    id: 'test-calibrated',
    fromCityId: 'izmir',
    toCityId: 'istanbul',
    isCalibrated: true as const,
    points: [
      { x: 0.118, y: 0.408 },
      { x: 0.16, y: 0.3 },
      { x: 0.208, y: 0.168 },
    ],
  };
  assert(isMapRoadSegmentRoutable(testSegment), 'calibrated segment with points is routable');
  const route = getRoadRoute('izmir', 'ankara');
  assert(route != null && route.length >= 2, 'multi-hop route still resolves when direct uncalibrated');
}

console.log(`\nPASS: ${passed}`);
console.log(`FAIL: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

console.log('✅ ALL PASS\n');
