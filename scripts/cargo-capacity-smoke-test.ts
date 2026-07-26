/**
 * Kargo kapasitesi / tonaj bug düzeltmeleri smoke test.
 * Run: npx tsx scripts/cargo-capacity-smoke-test.ts
 */

import './test-globals';

import { applyTruckUpgrade } from '../src/simulation/truckUpgrades';
import {
  buildCapacityDisabledReasonInput,
  canTruckCarryCargo,
  getCargoWeightClass,
  getCargoWeightClassLabel,
  getMaxFleetCapacityTons,
  getMaxPotentialFleetCapacityTons,
  getSystemMaxFleetCapacityTons,
  getTruckEffectiveCapacityTons,
  hasEnoughCargoCapacity,
  isContractUnreachableByFleet,
  resolveCapacityDisabledReasonKind,
  shouldSpawnBeyondFleetContract,
} from '../src/simulation/capacity';
import {
  canTruckCarryContract,
  getContractAvailability,
  getHighestOwnedTruckCapacity,
} from '../src/simulation/delivery';
import {
  applyCapacityProfileToTonnageRange,
} from '../src/config/levelConfig';
import {
  buildContractAvailabilityCopy,
  getContractAvailabilityLabel,
} from '../src/utils/contractAvailabilityDisplay';
import { buildContractCardBadges } from '../src/utils/contractBadges';
import { generateContracts } from '../src/simulation/contracts';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import { CITIES } from '../src/data/cities';
import { ROUTES } from '../src/data/routes';
import { PRODUCTS } from '../src/data/products';
import type { City, Contract, Driver, Truck } from '../src/types/game';

function citiesToRecord(cities: City[]): Record<string, City> {
  return Object.fromEntries(cities.map((city) => [city.id, city]));
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

function makeTruck(overrides: Partial<Truck> & Pick<Truck, 'id'>): Truck {
  return {
    catalogId: overrides.id,
    name: overrides.name ?? overrides.id,
    capacity: overrides.capacity ?? 40,
    fuelConsumptionPerKm: 0.32,
    speed: 72,
    reliability: 75,
    maintenanceCost: 0.18,
    comfort: 60,
    condition: overrides.condition ?? 88,
    purchasePrice: 125_000,
    ownershipType: 'owned',
    currentCityId: overrides.currentCityId ?? 'izmir',
    homeCityId: overrides.homeCityId ?? 'izmir',
    status: overrides.status ?? 'idle',
    upgrades: overrides.upgrades,
    ...overrides,
  };
}

function makeContract(cargoWeight: number, originCityId = 'izmir'): Contract {
  return {
    id: `contract-${cargoWeight}`,
    originCityId,
    destinationCityId: 'istanbul',
    productId: 'steel',
    cargoWeight,
    amount: cargoWeight,
    payment: 10_000,
    status: 'available',
    requiredLevel: 1,
    deadlineHours: 48,
    distanceKm: 400,
    urgency: 0.3,
    expiresAt: 999_999,
    createdAt: 0,
  };
}

function makeDriver(id: string): Driver {
  return {
    id,
    name: id,
    status: 'idle',
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

console.log('Cargo capacity smoke test\n');

console.log('1. hasEnoughCapacity epsilon');
assert(hasEnoughCargoCapacity(45, 45), '45.0 capacity carries 45.0 cargo');
assert(!hasEnoughCargoCapacity(44.9, 45), '44.9 capacity cannot carry 45.0 cargo');
assert(hasEnoughCargoCapacity(45.0000001, 45), 'floating edge: capacity epsilon allows equal load');

console.log('\n2. Upgraded effective capacity');
let upgradedTruck = makeTruck({ id: 'heavy-1', capacity: 40 });
for (let i = 0; i < 3; i += 1) {
  upgradedTruck = applyTruckUpgrade(upgradedTruck, 'cargo');
}
const effectiveCapacity = getTruckEffectiveCapacityTons(upgradedTruck);
assert(effectiveCapacity >= 45, 'max cargo upgrades reach at least 45t effective', `${effectiveCapacity}`);
assert(
  canTruckCarryContract(upgradedTruck, makeContract(45), undefined),
  'upgraded truck accepts exactly 45.0t contract',
);
assert(
  !canTruckCarryContract(upgradedTruck, makeContract(effectiveCapacity + 0.1), undefined),
  'upgraded truck rejects load above effective capacity',
);

console.log('\n3. Availability uses effective capacity');
const trucks: Truck[] = [upgradedTruck];
const drivers: Driver[] = [makeDriver('d1')];
const exactContract = makeContract(45);
const availability = getContractAvailability(exactContract, trucks, drivers, 8, 100, 0, 'izmir');
assert(availability.canStart, '45.0t contract is playable with 45t+ effective truck', availability.reason);

const heavyContract = makeContract(45);
const baseTruck = makeTruck({ id: 'base-1', capacity: 44.9 });
const blocked = getContractAvailability(heavyContract, [baseTruck], drivers, 8, 100, 0, 'izmir');
assert(!blocked.canStart, '44.9t truck cannot take 45.0t job', blocked.reason);
const blockedCopy = buildContractAvailabilityCopy(blocked.reason ?? 'NO_TRUCK_WITH_CAPACITY', {
  cargoWeight: 45,
  fromCityName: 'İzmir',
  bestAvailableTruckCapacity: getTruckEffectiveCapacityTons(baseTruck),
  capacityDisabledReasonKind: 'insufficient',
});
assert(
  blockedCopy.title.includes('Tonaj'),
  'disabled reason shows tonaj message',
  blockedCopy.title,
);

console.log('\n4. Fleet max helpers');
assert(
  getHighestOwnedTruckCapacity(trucks) === getMaxFleetCapacityTons(trucks),
  'highest owned capacity uses effective tons',
);
const systemMax = getSystemMaxFleetCapacityTons();
assert(systemMax > 80 && systemMax < 120, 'system max fleet capacity includes trailers', `${systemMax}`);

console.log('\n5. Capacity disabled reason labels');
const wrongCityContext = buildCapacityDisabledReasonInput(
  30,
  [
    makeTruck({ id: 'local', capacity: 25, currentCityId: 'izmir', homeCityId: 'izmir' }),
    makeTruck({ id: 'remote', capacity: 40, currentCityId: 'ankara', homeCityId: 'ankara' }),
  ],
  [],
  [makeTruck({ id: 'local', capacity: 25, currentCityId: 'izmir', homeCityId: 'izmir' })],
  (truck) => truck.status === 'idle',
  (truck, _home?) => truck.currentCityId ?? 'izmir',
  'izmir',
);
assert(
  resolveCapacityDisabledReasonKind(wrongCityContext) === 'wrong_city',
  'detects suitable truck in another city',
);
const beyondSystemKind = resolveCapacityDisabledReasonKind({
  requiredTons: 120,
  maxIdleAtOriginTons: 45,
  maxFleetCapacityTons: 45,
  maxIdleFleetCapacityTons: 45,
  maxPotentialAtOriginTons: 46,
  hasTruckWithCapacityElsewhere: false,
});
assert(beyondSystemKind === 'beyond_system', '120t classified as beyond system');
const beyondLabel = getContractAvailabilityLabel('NO_TRUCK_WITH_CAPACITY');
assert(beyondLabel === 'Tonaj yetersiz' || beyondLabel != null, 'base capacity label exists');

console.log('\n6. Cargo weight class badges');
assert(getCargoWeightClass(15) === 'light', 'light <= 20');
assert(getCargoWeightClass(45) === 'medium', 'medium <= 45');
assert(getCargoWeightClass(60) === 'heavy', 'heavy <= 80');
assert(getCargoWeightClass(113) === 'oversized', 'oversized > 80');
assert(getCargoWeightClassLabel('heavy') === 'Ağır Yük', 'heavy badge label');
assert(getCargoWeightClassLabel('oversized') === 'Çok Ağır Yük', 'oversized badge label');
const heavyBadges = buildContractCardBadges({
  availability: { canStart: true },
  playerLevel: 5,
  urgent: false,
  riskLevel: 'low',
  riskLabel: 'Düşük',
  cargoWeightTons: 72,
});
assert(
  heavyBadges.some((badge) => badge.label === 'Ağır Yük'),
  'contract card shows heavy cargo badge',
);

console.log('\n7. Generation guard limits unreachable contracts');
const cities = citiesToRecord(CITIES);
const fleetTrucks = [makeTruck({ id: 'fleet', capacity: 40 })];
const ownedMax = getHighestOwnedTruckCapacity(fleetTrucks);
let unreachableCount = 0;
let totalGenerated = 0;
for (let seed = 0; seed < 20; seed += 1) {
  const generated = generateContracts(
    cities,
    ROUTES,
    PRODUCTS,
    DEFAULT_GLOBAL_ECONOMY,
    [],
    {
      currentTime: seed * 10,
      playerLevel: 5,
      playerReputation: 0,
      ownedMaxTruckCapacity: ownedMax,
      idleMaxTruckCapacity: ownedMax,
      maxNewContracts: 12,
      idleTruckOriginCityIds: ['izmir'],
    },
  );
  totalGenerated += generated.length;
  unreachableCount += generated.filter((contract) =>
    isContractUnreachableByFleet(contract.cargoWeight ?? contract.amount ?? 0, ownedMax),
  ).length;
}
const unreachableRatio = totalGenerated > 0 ? unreachableCount / totalGenerated : 0;
assert(
  unreachableRatio <= 0.35,
  'unreachable contracts do not dominate generation',
  `ratio=${unreachableRatio.toFixed(2)} total=${totalGenerated}`,
);

console.log('\n8. Aspirational profile capped to fleet stretch band');
const aspirationalBounds = applyCapacityProfileToTonnageRange(40, 120, 'aspirational', 45, 45);
assert(
  aspirationalBounds != null && aspirationalBounds.maxTonnage <= 60,
  'aspirational tonnage capped near fleet capacity',
  aspirationalBounds ? `${aspirationalBounds.maxTonnage}` : 'null',
);

console.log('\n9. shouldSpawnBeyondFleetContract guard');
assert(
  !shouldSpawnBeyondFleetContract(120, 45, 0, 3),
  '120t blocked for low level player',
);
assert(
  shouldSpawnBeyondFleetContract(30, 45, 0, 5),
  'reachable contract always allowed',
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
