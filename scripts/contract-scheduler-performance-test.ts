/**
 * Contract scheduler performance + semantic parity regression.
 * Run: npx tsx scripts/contract-scheduler-performance-test.ts
 */
import './test-globals';

import { performance } from 'node:perf_hooks';

import { CITIES } from '../src/data/cities';
import { STARTER_DRIVER } from '../src/data/drivers';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { STARTER_TRUCK } from '../src/data/trucks';
import { contractGenerationBalance } from '../src/config/balance';
import {
  buildAvailableDuplicateIndex,
  buildCityProductEconomyIndex,
  getAvailableDuplicateCount,
  lookupRouteBetweenCities,
} from '../src/simulation/contractGenerationIndex';
import {
  countAvailableDuplicates,
  generateContracts,
  getContractDedupeKey,
  processContractGenerationSchedule,
} from '../src/simulation/contracts';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
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

function createMarketFixture(): Record<string, City> {
  const fixture = citiesRecord();
  const origins = new Set(CITIES.slice(0, Math.max(3, Math.ceil(CITIES.length / 3))).map((city) => city.id));
  for (const city of Object.values(fixture)) {
    for (const product of PRODUCTS) {
      const market = city.products[product.id];
      if (!market) continue;
      const basePrice = market.basePrice ?? product.basePrice ?? 100;
      if (origins.has(city.id)) {
        market.stock = 1_000;
        market.targetStock = 160;
        market.currentPrice = basePrice * 0.82;
      } else {
        market.stock = 25;
        market.targetStock = 650;
        market.currentPrice = basePrice * 1.25;
      }
    }
  }
  return fixture;
}

function truckAt(cityId: string): Truck {
  return {
    ...structuredClone(STARTER_TRUCK),
    id: `truck-${cityId}`,
    currentCityId: cityId,
    homeCityId: cityId,
    status: 'idle',
  };
}

type ContractSemantic = {
  originCityId: string;
  destinationCityId: string;
  productId: string;
  amount: number;
  payment: number;
  deadlineHours: number;
  contractType: string;
  requiredLevel: number;
};

function toSemantic(contract: Contract): ContractSemantic {
  return {
    originCityId: contract.originCityId,
    destinationCityId: contract.destinationCityId,
    productId: contract.productId,
    amount: contract.amount,
    payment: contract.payment,
    deadlineHours: contract.deadlineHours,
    contractType: contract.contractType ?? 'standard',
    requiredLevel: contract.requiredLevel ?? 1,
  };
}

function semanticSignature(contracts: Contract[]): string {
  return contracts
    .filter((contract) => contract.status === 'available')
    .map((contract) => JSON.stringify(toSemantic(contract)))
    .sort()
    .join('\n');
}

function withSeededRandom(seed: number, fn: () => void): void {
  let state = seed >>> 0;
  const original = Math.random;
  Math.random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  try {
    fn();
  } finally {
    Math.random = original;
  }
}

function bench(label: string, iterations: number, fn: () => void): number {
  for (let i = 0; i < 3; i += 1) {
    fn();
  }
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  const elapsed = performance.now() - start;
  const avg = elapsed / iterations;
  console.log(`  ${label}: ${avg.toFixed(2)}ms avg (${iterations} runs)`);
  return avg;
}

console.log('\n=== contract-scheduler-performance-test ===\n');

const cities = citiesRecord();
const trucks = [truckAt('izmir')];
const existing: Contract[] = [];

console.log('Index correctness');
const sampleContracts: Contract[] = [
  {
    id: 'a',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'wheat',
    amount: 10,
    cargoWeight: 10,
    payment: 1000,
    deadlineHours: 24,
    distanceKm: 585,
    urgency: 0.5,
    status: 'available',
    createdAt: 0,
    expiresAt: 48,
    requiredLevel: 1,
    contractType: 'standard',
    riskLevel: 'low',
  },
  {
    id: 'b',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'wheat',
    amount: 12,
    cargoWeight: 12,
    payment: 1100,
    deadlineHours: 24,
    distanceKm: 585,
    urgency: 0.5,
    status: 'available',
    createdAt: 0,
    expiresAt: 48,
    requiredLevel: 1,
    contractType: 'standard',
    riskLevel: 'low',
  },
  {
    id: 'c',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'wheat',
    amount: 8,
    cargoWeight: 8,
    payment: 900,
    deadlineHours: 24,
    distanceKm: 480,
    urgency: 0.5,
    status: 'accepted',
    createdAt: 0,
    expiresAt: 48,
    requiredLevel: 1,
    contractType: 'standard',
    riskLevel: 'low',
  },
];

const duplicateIndex = buildAvailableDuplicateIndex(sampleContracts);
assert(
  getAvailableDuplicateCount(duplicateIndex, 'izmir', 'ankara', 'wheat') === 2,
  'duplicate index counts available route-product pairs',
);
assert(
  countAvailableDuplicates(sampleContracts, 'izmir', 'ankara', 'wheat') === 2,
  'duplicate index matches legacy filter count',
);
assert(
  getAvailableDuplicateCount(duplicateIndex, 'izmir', 'istanbul', 'wheat') === 0,
  'accepted contracts excluded from duplicate index',
);

const route = lookupRouteBetweenCities(ROUTES, 'izmir', 'ankara');
assert(route?.distanceKm === 585, 'route lookup uses canonical O(1) index');
assert(
  lookupRouteBetweenCities(ROUTES, 'ankara', 'izmir')?.fromCityId === 'ankara',
  'reverse directed route lookup preserved',
);

const economyIndex = buildCityProductEconomyIndex(Object.values(cities), PRODUCTS);
assert(economyIndex.size === Object.values(cities).length * PRODUCTS.length, 'economy index covers city×product');

console.log('\nDeterministic semantic parity (seeded)');
const seed = 42_026;
let firstSignature = '';
let secondSignature = '';
withSeededRandom(seed, () => {
  const batch = generateContracts(cities, ROUTES, PRODUCTS, DEFAULT_GLOBAL_ECONOMY, [], {
    currentTime: 72,
    maxNewContracts: contractGenerationBalance.maxContractsGeneratedAtOnce,
    playerLevel: 3,
    ownedMaxTruckCapacity: 25,
    idleMaxTruckCapacity: 25,
    idleTruckOriginCityIds: ['izmir'],
    playerReputation: 50,
  });
  firstSignature = semanticSignature(batch);
});
withSeededRandom(seed, () => {
  const batch = generateContracts(cities, ROUTES, PRODUCTS, DEFAULT_GLOBAL_ECONOMY, [], {
    currentTime: 72,
    maxNewContracts: contractGenerationBalance.maxContractsGeneratedAtOnce,
    playerLevel: 3,
    ownedMaxTruckCapacity: 25,
    idleMaxTruckCapacity: 25,
    idleTruckOriginCityIds: ['izmir'],
    playerReputation: 50,
  });
  secondSignature = semanticSignature(batch);
});
assert(firstSignature === secondSignature, 'seeded generation is deterministic across runs');

console.log('\nDedupe + schedule invariants');
let generatedCount = 0;
withSeededRandom(seed + 1, () => {
  const generated = generateContracts(
    createMarketFixture(),
    ROUTES,
    PRODUCTS,
    DEFAULT_GLOBAL_ECONOMY,
    existing,
    {
    currentTime: 120,
    maxNewContracts: 8,
    playerLevel: 2,
    ownedMaxTruckCapacity: 25,
    idleTruckOriginCityIds: ['izmir'],
  });
  const keys = new Set(generated.map((contract) => getContractDedupeKey(contract)));
  generatedCount = generated.length;
  assert(keys.size === generated.length, 'generated batch has no duplicate dedupe keys');
});
assert(generatedCount > 0, 'seeded generation produces at least one contract');

const scheduleResult = processContractGenerationSchedule(
  {
    cities,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    contracts: existing,
    currentTime: 0,
    newTime: contractGenerationBalance.mediumGenerationIntervalHours * 2,
    previousTime: 0,
    lastContractGenerationTime: 0,
    lastMarketRefreshTime: 0,
    lastDailyCleanupTime: 0,
    playerLevel: 1,
    trucks,
    drivers: [structuredClone(STARTER_DRIVER)],
    homeCityId: 'izmir',
    idleTruckOriginCityIds: ['izmir'],
    ownedMaxTruckCapacity: 25,
    idleMaxTruckCapacity: 25,
  },
  { includePlayableCountsInDebug: false },
);
assert(scheduleResult.contracts.length >= 0, 'full schedule refresh completes');
assert(
  scheduleResult.newContracts.every(
    (contract) => contract.status === 'available' && contract.originCityId && contract.destinationCityId,
  ),
  'schedule emits available contracts with route endpoints',
);

console.log('\nPerformance (development machine)');
const genMs = bench('generateContracts full scan', 12, () => {
  generateContracts(createMarketFixture(), ROUTES, PRODUCTS, DEFAULT_GLOBAL_ECONOMY, sampleContracts, {
    currentTime: 96,
    maxNewContracts: contractGenerationBalance.maxContractsGeneratedAtOnce,
    playerLevel: 5,
    ownedMaxTruckCapacity: 25,
    idleMaxTruckCapacity: 25,
    idleTruckOriginCityIds: ['izmir', 'ankara'],
    activeDeliveryDestinationCityIds: ['istanbul'],
    playerReputation: 55,
  });
});

const scheduleMs = bench('processContractGenerationSchedule full refresh', 8, () => {
  processContractGenerationSchedule(
    {
      cities,
      routes: ROUTES,
      products: PRODUCTS,
      globalEconomy: DEFAULT_GLOBAL_ECONOMY,
      contracts: sampleContracts,
      currentTime: 48,
      newTime: 48 + contractGenerationBalance.mediumGenerationIntervalHours * 3,
      previousTime: 48,
      lastContractGenerationTime: 48,
      lastMarketRefreshTime: 48,
      lastDailyCleanupTime: 48,
      playerLevel: 4,
      trucks: [truckAt('izmir'), truckAt('ankara')],
      drivers: [structuredClone(STARTER_DRIVER)],
      homeCityId: 'izmir',
      idleTruckOriginCityIds: ['izmir', 'ankara'],
      ownedMaxTruckCapacity: 25,
      idleMaxTruckCapacity: 25,
    },
    { includePlayableCountsInDebug: false },
  );
});

assert(genMs < 80, `generateContracts under 80ms (got ${genMs.toFixed(1)}ms)`);
assert(scheduleMs < 80, `schedule full refresh under 80ms (got ${scheduleMs.toFixed(1)}ms)`);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}

console.log('contract-scheduler-performance-test: PASSED\n');
