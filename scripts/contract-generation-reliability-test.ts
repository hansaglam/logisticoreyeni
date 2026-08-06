/**
 * Contract generation reliability — truck-city minimum guarantee + bootstrap.
 * Run: npx tsx scripts/contract-generation-reliability-test.ts
 */

import './test-globals';

import { CITIES } from '../src/data/cities';
import { STARTER_DRIVER } from '../src/data/drivers';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { STARTER_TRUCK } from '../src/data/trucks';
import { contractGenerationBalance } from '../src/config/balance';
import {
  countAvailableContracts,
  countContractsAtOrBelowLevel,
  countPlayableContracts,
  countPlayableContractsFromOrigin,
  ensureMinimumEligibleContracts,
  expireOldContracts,
  refreshContractsFromMarket,
  shouldRefreshContracts,
} from '../src/simulation/contracts';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import { getIdleTruckOriginCityIds } from '../src/simulation/delivery';
import type { City, Contract, Truck } from '../src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function citiesRecord(): Record<string, City> {
  return Object.fromEntries(CITIES.map((city) => [city.id, structuredClone(city)])) as Record<
    string,
    City
  >;
}

function truckAt(cityId: string, capacity = 25): Truck {
  return {
    ...structuredClone(STARTER_TRUCK),
    id: `truck-${cityId}`,
    currentCityId: cityId,
    homeCityId: cityId,
    status: 'idle',
    capacity,
  };
}

function buildParams(trucks: Truck[], contracts: Contract[] = [], currentTime = 48) {
  const idleTruckOriginCityIds = getIdleTruckOriginCityIds(trucks, trucks[0]?.homeCityId);
  return {
    cities: citiesRecord(),
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    contracts,
    currentTime,
    playerLevel: 1,
    trucks,
    drivers: [structuredClone(STARTER_DRIVER)],
    homeCityId: trucks[0]?.homeCityId ?? 'izmir',
    idleTruckOriginCityIds,
    maxTruckCapacity: trucks[0]?.capacity ?? 25,
    ownedMaxTruckCapacity: trucks[0]?.capacity ?? 25,
    idleMaxTruckCapacity: trucks[0]?.capacity ?? 25,
    playerReputation: 50,
  };
}

function fillPoolWithNonPlayable(originCityId: string, count: number, currentTime: number): Contract[] {
  const contracts: Contract[] = [];
  for (let index = 0; index < count; index += 1) {
    contracts.push({
      id: `filler-${originCityId}-${index}`,
      originCityId,
      destinationCityId: 'ankara',
      productId: 'textile',
      amount: 12,
      cargoWeight: 12,
      payment: 4_000 + index,
      deadlineHours: 12,
      distanceKm: 400,
      urgency: 0.2,
      status: 'available',
      createdAt: currentTime - 2,
      expiresAt: currentTime + 24,
      requiredLevel: 1,
    });
  }
  return contracts;
}

console.log('\n=== Contract Generation Reliability ===\n');

console.log('Scheduler signals');
assert(
  shouldRefreshContracts({
    currentTime: 10,
    availableCount: 0,
    eligibleCount: 0,
    idleTruckCityCount: 1,
  }),
  'empty available → refresh',
);
assert(
  shouldRefreshContracts({
    currentTime: 10,
    availableCount: 12,
    eligibleCount: 0,
    idleTruckCityCount: 1,
  }),
  'eligible zero with idle truck → refresh',
);
assert(
  shouldRefreshContracts({
    currentTime: 100,
    lastContractGenerationTime: Number.NaN,
    lastMarketRefreshTime: 0,
    availableCount: 12,
    eligibleCount: 4,
    idleTruckCityCount: 1,
  }),
  'NaN last generation → refresh',
);
assert(
  shouldRefreshContracts({
    currentTime: 100,
    lastContractGenerationTime: 0,
    lastMarketRefreshTime: -5,
    availableCount: 12,
    eligibleCount: 4,
    idleTruckCityCount: 1,
  }),
  'stale negative market time → refresh',
);

console.log('\nSingle truck Bursa');
const bursaTruck = truckAt('bursa', 25);
const bursaParams = buildParams([bursaTruck]);
const bursaResult = ensureMinimumEligibleContracts({
  ...bursaParams,
  contracts: [],
  forceFallback: true,
});
const bursaPlayable = countPlayableContractsFromOrigin(
  bursaResult.contracts,
  'bursa',
  bursaParams.trucks,
  bursaParams.drivers,
  1,
  bursaParams.currentTime,
);
assert(bursaPlayable >= contractGenerationBalance.minAvailableContractsPerIdleTruckCity, 'Bursa → min playable per city', String(bursaPlayable));
assert(
  countAvailableContracts(bursaResult.contracts) >= contractGenerationBalance.minGlobalEligibleContracts ||
    bursaPlayable >= contractGenerationBalance.minAvailableContractsPerIdleTruckCity,
  'Bursa bootstrap produces supply',
);
assert(
  bursaResult.contracts.some(
    (contract) =>
      contract.status === 'available' &&
      contract.originCityId === 'bursa' &&
      (contract.cargoWeight ?? contract.amount ?? 0) <= 25,
  ),
  'Bursa has capacity-fit contract',
);
assert(
  countContractsAtOrBelowLevel(bursaResult.contracts, 1) >=
    contractGenerationBalance.minPlayerLevelEligibleContracts,
  'level-1 eligible contracts',
);

console.log('\nSingle truck İzmir');
const izmirTruck = truckAt('izmir', 25);
const izmirResult = ensureMinimumEligibleContracts({
  ...buildParams([izmirTruck]),
  contracts: [],
  forceFallback: true,
});
const izmirPlayable = countPlayableContractsFromOrigin(
  izmirResult.contracts,
  'izmir',
  izmirResult.contracts.length ? buildParams([izmirTruck]).trucks : [izmirTruck],
  [structuredClone(STARTER_DRIVER)],
  1,
  48,
);
assert(
  izmirPlayable >= contractGenerationBalance.minAvailableContractsPerIdleTruckCity,
  'İzmir → min playable per city',
  String(izmirPlayable),
);

console.log('\nFull pool blocks Bursa playable — make room');
const fullPool = fillPoolWithNonPlayable(
  'istanbul',
  contractGenerationBalance.maxAvailableContracts,
  48,
);
const rescued = ensureMinimumEligibleContracts({
  ...bursaParams,
  contracts: fullPool,
  forceFallback: true,
});
const rescuedBursa = countPlayableContractsFromOrigin(
  rescued.contracts,
  'bursa',
  bursaParams.trucks,
  bursaParams.drivers,
  1,
  bursaParams.currentTime,
);
assert(
  rescuedBursa >= contractGenerationBalance.minAvailableContractsPerIdleTruckCity,
  'full global pool still gets Bursa playable',
  String(rescuedBursa),
);

console.log('\nExpired-only save bootstrap');
const expiredOnly = fillPoolWithNonPlayable('ankara', 4, 10).map((contract) => ({
  ...contract,
  expiresAt: 5,
}));
const expiredClean = expireOldContracts(expiredOnly, 48);
assert(countAvailableContracts(expiredClean) === 0, 'all expired after cleanup');
const afterExpired = ensureMinimumEligibleContracts({
  ...bursaParams,
  contracts: expiredClean,
  forceFallback: true,
});
assert(countAvailableContracts(afterExpired.contracts) > 0, 'bootstrap after all expired');

console.log('\nManual refresh empty list (store emergency path)');
const manualRefresh = refreshContractsFromMarket({
  ...bursaParams,
  contracts: [],
  maxContractsPerRefresh: contractGenerationBalance.bootstrapMaxContractsPerPass,
});
const emergencySupply = ensureMinimumEligibleContracts({
  ...bursaParams,
  contracts: manualRefresh.contracts,
  forceFallback: true,
});
assert(
  countAvailableContracts(emergencySupply.contracts) > 0,
  'emergency bootstrap after manual refresh produces contracts',
);

console.log('\nReverse route invariant — no city-specific hack');
const bursaContracts = bursaResult.contracts.filter(
  (contract) => contract.originCityId === 'bursa' && contract.status === 'available',
);
assert(bursaContracts.length > 0, 'Bursa-origin contracts exist without special-case code');

console.log(`\nPASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
