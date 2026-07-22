/**
 * Contract availability / sorting smoke test — çoklu boşta kamyon + aktif teslimat senaryosu.
 * Run: npx tsx scripts/contract-availability-smoke-test.ts
 */

import './test-globals';

import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import { buildContractPreview } from '../src/simulation/contractPreview';
import { countPlayableContracts, isPlayableContract } from '../src/simulation/contracts';
import { getContractAvailability } from '../src/simulation/delivery';
import {
  compareContractsBySmartScore,
  getContractSortTier,
} from '../src/utils/contractSorting';
import type { Contract, Delivery, Driver, Truck } from '../src/types/game';

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

function makeTruck(id: string, cityId: string, status: Truck['status'] = 'idle'): Truck {
  return {
    id,
    catalogId: `truck-${id}`,
    name: `Truck ${id}`,
    capacity: 25,
    fuelConsumptionPerKm: 0.32,
    speed: 72,
    reliability: 75,
    maintenanceCost: 0.18,
    comfort: 60,
    condition: 88,
    purchasePrice: 45_000,
    ownershipType: 'owned',
    currentCityId: cityId,
    homeCityId: cityId,
    status,
  };
}

function makeDriver(id: string, status: Driver['status'] = 'idle'): Driver {
  return {
    id,
    name: `Driver ${id}`,
    status,
    experience: 50,
    attention: 50,
    speed: 50,
    fuelSaving: 0,
    morale: 80,
    salaryPerDay: 100,
    hireCost: 0,
    assignedTruckId: null,
  };
}

function makeContract(
  id: string,
  originCityId: string,
  destinationCityId: string,
): Contract {
  return {
    id,
    originCityId,
    destinationCityId,
    productId: 'steel',
    cargoWeight: 12,
    amount: 12,
    payment: 8000,
    status: 'available',
    requiredLevel: 1,
    deadlineHours: 48,
    distanceKm: 400,
    urgency: 0.3,
    expiresAt: 999_999,
    createdAt: 0,
  };
}

const trucks: Truck[] = [
  makeTruck('active', 'izmir', 'on_route'),
  makeTruck('antalya', 'antalya'),
  makeTruck('izmir', 'izmir'),
  makeTruck('ankara', 'ankara'),
];

const drivers: Driver[] = [
  makeDriver('d-active', 'driving'),
  makeDriver('d-antalya'),
  makeDriver('d-izmir'),
  makeDriver('d-ankara'),
];

const activeDelivery: Delivery = {
  id: 'delivery-1',
  contractId: 'active-contract',
  truckId: 'active',
  driverId: 'd-active',
  originCityId: 'izmir',
  destinationCityId: 'istanbul',
  productId: 'steel',
  amount: 12,
  distanceKm: 480,
  progress: 0.4,
  status: 'on_route',
  startedAt: 100,
  estimatedArrivalTime: 500,
  deadlineTime: 600,
  fuelCost: 400,
  maintenanceCost: 120,
  estimatedProfit: 900,
  travelHours: 20,
  breakdownChance: 0.02,
  accidentChance: 0.01,
  conditionLoss: 3,
};

const contracts: Contract[] = [
  makeContract('c-istanbul', 'istanbul', 'izmir'),
  makeContract('c-antalya', 'antalya', 'ankara'),
  makeContract('c-izmir', 'izmir', 'antalya'),
  makeContract('c-ankara', 'ankara', 'bursa'),
];

const context = {
  playerMoney: 50_000,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  playerReputation: 0,
  homeCityId: 'izmir',
};

console.log('Contract availability smoke test\n');

const istanbulAvailability = getContractAvailability(
  contracts[0],
  trucks,
  drivers,
  1,
  200,
  0,
  context.homeCityId,
);
assert(
  !istanbulAvailability.canStart,
  'İstanbul → İzmir işi şu an alınamaz (İstanbul’da boşta kamyon yok)',
  `reason=${istanbulAvailability.reason}`,
);
assert(
  istanbulAvailability.reason === 'NO_TRUCK_IN_ORIGIN_CITY' ||
    istanbulAvailability.reason === 'NO_IDLE_TRUCK_IN_ORIGIN_CITY',
  'İstanbul işi kamyon yokluğu nedeniyle kilitli',
  `reason=${istanbulAvailability.reason}`,
);

for (const contract of contracts.slice(1)) {
  const availability = getContractAvailability(
    contract,
    trucks,
    drivers,
    1,
    200,
    0,
    context.homeCityId,
  );
  assert(
    availability.canStart,
    `${contract.originCityId} çıkışlı iş alınabilir`,
    `reason=${availability.reason}`,
  );
  assert(
    isPlayableContract(contract, trucks, drivers, 1, 200, context),
    `${contract.originCityId} çıkışlı iş playable sayılır`,
  );
}

const playableCount = countPlayableContracts(contracts, trucks, drivers, 1, 200, context);
assert(playableCount === 3, 'Uygun iş sayısı 3 olmalı', `got=${playableCount}`);

const previewById = new Map(
  contracts.map((contract) => [
    contract.id,
    buildContractPreview({
      contract,
      globalEconomy: DEFAULT_GLOBAL_ECONOMY,
      trucks,
      drivers,
      companyLevel: 1,
      currentTime: 200,
      homeCityId: context.homeCityId,
    }),
  ]),
);

const sortCtx = {
  trucks,
  drivers,
  playerLevel: 1,
  activeDeliveries: [activeDelivery],
  previewById,
  fallbackHomeCityId: context.homeCityId,
};

const sorted = [...contracts].sort((a, b) => compareContractsBySmartScore(a, b, sortCtx));
const playableOrigins = sorted
  .slice(0, 3)
  .map((contract) => contract.originCityId)
  .sort();
assert(
  JSON.stringify(playableOrigins) === JSON.stringify(['ankara', 'antalya', 'izmir']),
  'Liste önce uygun işleri gösterir',
  `first3=${playableOrigins.join(',')}`,
);

const istanbulTier = getContractSortTier(contracts[0], sortCtx);
const antalyaTier = getContractSortTier(contracts[1], sortCtx);
assert(istanbulTier === 3, 'İstanbul işi sonraki rota önerisi katmanında (tier 3)', `tier=${istanbulTier}`);
assert(antalyaTier === 1, 'Antalya işi şimdi alınabilir katmanında (tier 1)', `tier=${antalyaTier}`);
assert(antalyaTier < istanbulTier, 'Uygun işler rota önerisinin üstünde sıralanır');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
