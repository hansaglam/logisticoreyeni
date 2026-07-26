/**
 * Trailer System V1 smoke test.
 * Run: npx tsx scripts/trailer-system-smoke-test.ts
 */

import './test-globals';

import { applyTruckUpgrade } from '../src/simulation/truckUpgrades';
import {
  canTruckCarryCargo,
  canTruckCarryContract,
  getCargoWeightClass,
  getMaxPotentialFleetCapacityTons,
  getTruckEffectiveCapacityTons,
  hasEnoughCargoCapacity,
  resolveCapacityDisabledReasonKind,
  buildCapacityDisabledReasonInput,
} from '../src/simulation/capacity';
import {
  attachTrailerToTruckState,
  normalizePlayerTrailers,
  syncTrailersWithTruckLocation,
} from '../src/simulation/trailerOps';
import { createTrailerFromTemplate, TRAILER_MARKET } from '../src/data/trailers';
import {
  getContractAvailability,
  isTruckIdle,
  resolveTruckCityId,
} from '../src/simulation/delivery';
import { ensurePlayableContractSupply } from '../src/simulation/contracts';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import { CITIES } from '../src/data/cities';
import { ROUTES } from '../src/data/routes';
import { PRODUCTS } from '../src/data/products';
import { normalizeLoadedPlayer as normalizePlayerFromSave } from '../src/storage/saveGame';
import type { Contract, Driver, Player, Trailer, Truck } from '../src/types/game';

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
    condition: 88,
    purchasePrice: 125_000,
    ownershipType: 'owned',
    currentCityId: overrides.currentCityId ?? 'izmir',
    homeCityId: overrides.homeCityId ?? 'izmir',
    status: overrides.status ?? 'idle',
    ...overrides,
  };
}

function makeTrailer(id: string, bonus: number, city = 'izmir'): Trailer {
  return createTrailerFromTemplate(TRAILER_MARKET[1], {
    id,
    city,
    createdAtGameTime: 0,
  });
}

function makeContract(weight: number): Contract {
  return {
    id: `c-${weight}`,
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'steel',
    cargoWeight: weight,
    amount: weight,
    payment: 12_000,
    status: 'available',
    requiredLevel: 1,
    deadlineHours: 48,
    distanceKm: 400,
    urgency: 0.3,
    expiresAt: 999_999,
    createdAt: 0,
  };
}

const driver: Driver = {
  id: 'd1',
  name: 'Driver',
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

console.log('Trailer system smoke test\n');

console.log('1. Exact tonnage capacity');
assert(hasEnoughCargoCapacity(45, 45), '45.0 capacity carries 45.0 cargo');
assert(!hasEnoughCargoCapacity(44.9, 45), '44.9 capacity rejects 45.0 cargo');

console.log('\n2. Truck + trailer effective capacity');
const truck = makeTruck({ id: 'truck-1', capacity: 40 });
const standardTrailer = createTrailerFromTemplate(TRAILER_MARKET[0], {
  id: 'trailer-standard',
  city: 'izmir',
  createdAtGameTime: 0,
});
const heavyTrailer = createTrailerFromTemplate(TRAILER_MARKET[1], {
  id: 'trailer-heavy',
  city: 'izmir',
  createdAtGameTime: 0,
});
let attached = attachTrailerToTruckState(
  [standardTrailer],
  'trailer-standard',
  'truck-1',
  [truck],
).trailers;
const effectiveStandard = getTruckEffectiveCapacityTons(truck, attached);
assert(effectiveStandard === 40 + 35, 'truck + standard trailer capacity', `${effectiveStandard}`);

attached = attachTrailerToTruckState([heavyTrailer], 'trailer-heavy', 'truck-1', [truck]).trailers;
const effectiveHeavy = getTruckEffectiveCapacityTons(truck, attached);
assert(canTruckCarryContract(truck, attached, makeContract(100)), 'truck + heavy trailer carries 100t');
assert(effectiveHeavy >= 100, 'effective heavy capacity >= 100', `${effectiveHeavy}`);

console.log('\n3. Attach rules');
const izmirTruck = makeTruck({ id: 't-izmir', currentCityId: 'izmir' });
const ankaraTruck = makeTruck({ id: 't-ankara', currentCityId: 'ankara', homeCityId: 'ankara' });
const idleTrailer = createTrailerFromTemplate(TRAILER_MARKET[0], {
  id: 'trailer-idle',
  city: 'izmir',
  createdAtGameTime: 0,
});
const crossCityAttach = attachTrailerToTruckState(
  [idleTrailer],
  'trailer-idle',
  't-ankara',
  [izmirTruck, ankaraTruck],
);
assert(crossCityAttach.error?.errorCode === 'DIFFERENT_CITY', 'different city attach blocked');

const busyTruck = makeTruck({ id: 't-busy', status: 'on_route' });
const busyAttach = attachTrailerToTruckState(
  [idleTrailer],
  'trailer-idle',
  't-busy',
  [busyTruck],
);
assert(busyAttach.error?.errorCode === 'TRUCK_NOT_IDLE', 'on_route truck attach blocked');

const firstAttach = attachTrailerToTruckState(
  [idleTrailer],
  'trailer-idle',
  't-izmir',
  [izmirTruck],
);
const secondTrailer = createTrailerFromTemplate(TRAILER_MARKET[0], {
  id: 'trailer-2',
  city: 'izmir',
  createdAtGameTime: 0,
});
const alreadyAttached = attachTrailerToTruckState(
  [...firstAttach.trailers, secondTrailer],
  'trailer-2',
  't-izmir',
  [izmirTruck],
);
assert(
  alreadyAttached.error?.errorCode === 'TRUCK_ALREADY_HAS_TRAILER',
  'second trailer to same truck blocked',
);

console.log('\n4. Delivery / transfer trailer location');
let fleetTrailers = firstAttach.trailers;
fleetTrailers = syncTrailersWithTruckLocation(fleetTrailers, 't-izmir', 'istanbul', 'on_route');
assert(
  fleetTrailers[0]?.city === 'istanbul' && fleetTrailers[0]?.status === 'in_use',
  'trailer follows truck on delivery',
);
fleetTrailers = syncTrailersWithTruckLocation(fleetTrailers, 't-izmir', 'istanbul', 'idle');
assert(fleetTrailers[0]?.status === 'attached', 'trailer attached after delivery complete');

console.log('\n5. Availability + disabled reasons');
let upgraded = makeTruck({ id: 'upgraded', capacity: 40 });
for (let i = 0; i < 3; i += 1) {
  upgraded = applyTruckUpgrade(upgraded, 'cargo');
}
const exactAvailability = getContractAvailability(
  makeContract(45),
  [upgraded],
  [driver],
  8,
  100,
  0,
  'izmir',
  [],
);
assert(exactAvailability.canStart, 'upgraded truck takes 45t contract', exactAvailability.reason);

const blockedAvailability = getContractAvailability(
  makeContract(45),
  [makeTruck({ id: 'small', capacity: 44.9 })],
  [driver],
  1,
  100,
  0,
  'izmir',
  [],
);
assert(!blockedAvailability.canStart, '44.9 truck blocked for 45t');

const capacityInput = buildCapacityDisabledReasonInput(
  60,
  [makeTruck({ id: 'local', capacity: 40, currentCityId: 'izmir' })],
  [
    createTrailerFromTemplate(TRAILER_MARKET[0], {
      id: 'idle-trailer',
      city: 'izmir',
      createdAtGameTime: 0,
    }),
  ],
  [makeTruck({ id: 'local', capacity: 40, currentCityId: 'izmir' })],
  isTruckIdle,
  resolveTruckCityId,
  'izmir',
  makeContract(60),
);
assert(
  resolveCapacityDisabledReasonKind(capacityInput) === 'trailer_required',
  'heavy load suggests trailer attach',
  resolveCapacityDisabledReasonKind(capacityInput),
);

console.log('\n6. Cargo weight class');
assert(getCargoWeightClass(72) === 'heavy', 'heavy class');
assert(getCargoWeightClass(113) === 'oversized', 'oversized class');

console.log('\n7. Save migration');
const legacyPlayer = {
  companyName: 'Test',
  money: 10_000,
  companyLevel: 1,
  level: 1,
  xp: 0,
  xpToNextLevel: 100,
  totalXp: 0,
  homeCityId: 'izmir',
  reputation: 50,
  completedContracts: 0,
  trucks: [makeTruck({ id: 'legacy-truck' })],
  drivers: [driver],
  warehouses: [],
} as Player;
const normalized = normalizePlayerFromSave(legacyPlayer);
assert(Array.isArray(normalized.trailers), 'legacy save gets trailers array');
assert(normalized.trailers?.length === 0, 'legacy save trailers default empty');

const brokenTrailer = normalizePlayerTrailers(
  [
    {
      ...makeTrailer('broken', 35),
      attachedTruckId: 'missing-truck',
      status: 'attached',
    },
  ],
  'izmir',
  [makeTruck({ id: 'legacy-truck' })],
);
assert(brokenTrailer[0]?.attachedTruckId == null, 'broken attachedTruckId normalized');

console.log('\n8. Playable contract fallback');
const citiesRecord = Object.fromEntries(CITIES.map((city) => [city.id, city]));
const fleetTrucks = [makeTruck({ id: 'fleet', capacity: 40 })];
const maxCapacity = getMaxPotentialFleetCapacityTons(fleetTrucks, []);
const playable = ensurePlayableContractSupply({
  cities: citiesRecord,
  routes: ROUTES,
  products: PRODUCTS,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  contracts: [],
  currentTime: 0,
  playerLevel: 5,
  trucks: fleetTrucks,
  trailers: [],
  drivers: [driver],
  homeCityId: 'izmir',
  idleTruckOriginCityIds: ['izmir'],
  forceFallback: true,
  ownedMaxTruckCapacity: maxCapacity,
  idleMaxTruckCapacity: maxCapacity,
});
assert(playable.contracts.length >= 2, 'playable contracts generated with tonnage guard', `${playable.contracts.length}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
