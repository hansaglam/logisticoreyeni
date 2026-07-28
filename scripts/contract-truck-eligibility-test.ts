/**
 * Contract truck eligibility — capacity + trailer + driver.
 * Run: npx tsx scripts/contract-truck-eligibility-test.ts
 */

import './test-globals';

import {
  getAttachedTrailerForTruck,
  getEffectiveCargoCapacity,
  getTruckEffectiveCapacityTons,
} from '../src/simulation/capacity';
import {
  evaluateContractTruckEligibility,
  getPrimaryTruckRejectionMessage,
} from '../src/simulation/contractTruckEligibility';
import { getContractAvailability } from '../src/simulation/delivery';
import { buildContractPreview } from '../src/simulation/contractPreview';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import type { Contract, Driver, Trailer, Truck } from '../src/types/game';

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

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck_nordvik',
    name: 'Nordvik Titan',
    capacity: 30,
    fuelConsumptionPerKm: 0.28,
    speed: 78,
    reliability: 88,
    maintenanceCost: 0.22,
    comfort: 75,
    condition: 95,
    purchasePrice: 85_000,
    currentCityId: 'ankara',
    homeCityId: 'ankara',
    status: 'idle',
    catalogId: 'truck-volvo-fh',
    ...overrides,
  } as Truck;
}

function makeHeavyTrailer(overrides: Partial<Trailer> = {}): Trailer {
  return {
    id: 'trailer_heavy_1',
    name: 'Ağır Yük Dorsesi',
    type: 'heavy',
    capacityBonusTons: 70,
    catalogId: 'trailer-heavy',
    purchasePrice: 48_000,
    condition: 100,
    city: 'ankara',
    status: 'attached',
    attachedTruckId: 'truck_nordvik',
    isOwned: true,
    createdAtGameTime: 0,
    ...overrides,
  };
}

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver_1',
    name: 'Ali',
    experience: 50,
    attention: 70,
    fuelSaving: 40,
    speed: 10,
    morale: 80,
    salaryPerDay: 200,
    hireCost: 1000,
    assignedTruckId: 'truck_nordvik',
    status: 'idle',
    level: 2,
    ...overrides,
  } as Driver;
}

function makeBulkContract(tonnage = 71.4): Contract {
  return {
    id: 'c_ankara_adana_bulk',
    originCityId: 'ankara',
    destinationCityId: 'adana',
    productId: 'electronics',
    amount: tonnage,
    cargoWeight: tonnage,
    payment: 40_000,
    deadlineHours: 24,
    distanceKm: 550,
    urgency: 0.4,
    status: 'available',
    createdAt: 100,
    expiresAt: 10_000,
    requiredLevel: 1,
    contractType: 'bulk',
    riskLevel: 'low',
  } as Contract;
}

console.log('\n=== Contract Truck Eligibility Test ===\n');

console.log('A. Suitable heavy haul truck');
{
  const truck = makeTruck();
  const trailer = makeHeavyTrailer();
  const driver = makeDriver();
  const contract = makeBulkContract(71.4);

  const effective = getEffectiveCargoCapacity(truck, [trailer]);
  assert(Math.abs(effective - 100) < 0.01, 'effective capacity = 100t (30+70)');
  assert(
    getTruckEffectiveCapacityTons(truck, [trailer]) === effective,
    'alias matches getTruckEffectiveCapacityTons',
  );

  const eligibility = evaluateContractTruckEligibility({
    contract,
    truck,
    trailers: [trailer],
    drivers: [driver],
  });
  assert(eligibility.eligible === true, 'eligible with heavy trailer + idle driver');
  assert(eligibility.capacityEnough === true, '71.4 <= 100 capacityEnough');
  assert(eligibility.cityMatches === true, 'cityMatches Ankara');
  assert(eligibility.trailerType === 'heavy', 'canonical trailer.type === heavy');
  assert(eligibility.rejectionReasons.length === 0, 'no rejection reasons');

  const availability = getContractAvailability(
    contract,
    [truck],
    [driver],
    11,
    200,
    50,
    'ankara',
    [trailer],
  );
  assert(availability.canStart === true, 'getContractAvailability canStart with trailers');

  const preview = buildContractPreview({
    contract,
    trucks: [truck],
    trailers: [trailer],
    drivers: [driver],
    companyLevel: 11,
    currentTime: 200,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    homeCityId: 'ankara',
  });
  assert(preview.availability.canStart === true, 'preview canStart when trailers passed');
}

console.log('\nB. No driver');
{
  const truck = makeTruck();
  const trailer = makeHeavyTrailer();
  const contract = makeBulkContract(71.4);

  const eligibility = evaluateContractTruckEligibility({
    contract,
    truck,
    trailers: [trailer],
    drivers: [],
  });
  assert(eligibility.eligible === false, 'not eligible without drivers');
  assert(eligibility.rejectionReasons.includes('no-driver'), 'rejection no-driver');
  assert(
    getPrimaryTruckRejectionMessage(eligibility).includes('şoför'),
    'message mentions driver',
  );

  const availability = getContractAvailability(
    contract,
    [truck],
    [],
    11,
    200,
    50,
    'ankara',
    [trailer],
  );
  assert(availability.canStart === false, 'availability false without drivers');
  assert(
    availability.reason === 'NO_DRIVERS',
    'availability reason NO_DRIVERS',
    `got ${availability.reason}`,
  );
}

console.log('\nC. No trailer');
{
  const truck = makeTruck();
  const driver = makeDriver({ assignedTruckId: null });
  const contract = makeBulkContract(71.4);

  const eligibility = evaluateContractTruckEligibility({
    contract,
    truck,
    trailers: [],
    drivers: [driver],
  });
  assert(eligibility.eligible === false, 'not eligible without trailer for 71.4t');
  assert(
    eligibility.rejectionReasons.includes('no-trailer') ||
      eligibility.rejectionReasons.includes('insufficient-capacity') ||
      eligibility.rejectionReasons.includes('insufficient-truck-capacity'),
    'rejection capacity/trailer',
  );
  assert(eligibility.effectiveCapacity < 71.4, 'bare truck capacity < 71.4');

  const withoutTrailers = getContractAvailability(
    contract,
    [truck],
    [driver],
    11,
    200,
    50,
    'ankara',
    [],
  );
  assert(withoutTrailers.canStart === false, 'UI bug repro: no trailers → cannot start');
}

console.log('\nD. Capacity thresholds');
{
  const truck = makeTruck();
  const trailer = makeHeavyTrailer();
  const driver = makeDriver();

  const ok = evaluateContractTruckEligibility({
    contract: makeBulkContract(71.4),
    truck,
    trailers: [trailer],
    drivers: [driver],
  });
  assert(ok.eligible, '100t effective handles 71.4');

  const smallTrailer: Trailer = {
    ...makeHeavyTrailer(),
    capacityBonusTons: 40,
    type: 'standard',
    name: 'Standart Dorse',
  };
  // 30+40=70 < 71.4
  const fail = evaluateContractTruckEligibility({
    contract: makeBulkContract(71.4),
    truck,
    trailers: [smallTrailer],
    drivers: [driver],
  });
  assert(!fail.eligible, '70t effective fails 71.4');
  assert(
    fail.rejectionReasons.includes('insufficient-capacity') ||
      fail.rejectionReasons.includes('insufficient-trailer-capacity'),
    'insufficient capacity reason',
  );
}

console.log('\nE. City match');
{
  const truck = makeTruck({ currentCityId: 'ankara' });
  const trailer = makeHeavyTrailer();
  const driver = makeDriver();
  const eligibility = evaluateContractTruckEligibility({
    contract: makeBulkContract(71.4),
    truck,
    trailers: [trailer],
    drivers: [driver],
  });
  assert(eligibility.cityMatches === true, 'Ankara === ankara canonical');
  assert(eligibility.contractOriginCityId === 'ankara', 'origin canonical id');
  assert(eligibility.truckCityId === 'ankara', 'truck city canonical id');
}

console.log('\nF. Trailer lookup parity with fleet UI');
{
  const truck = makeTruck();
  // Fleet UI previously used attachedTruckId only; status accidentally idle.
  const trailer = makeHeavyTrailer({ status: 'idle', attachedTruckId: 'truck_nordvik' });
  const found = getAttachedTrailerForTruck(truck.id, [trailer]);
  assert(!!found, 'getAttachedTrailerForTruck finds linked trailer even if status idle');
  assert(
    getEffectiveCargoCapacity(truck, [trailer]) >= 100,
    'linked trailer still adds capacity',
  );
}

console.log('\nG. Canonical enum — display name change does not break');
{
  const truck = makeTruck();
  const trailer = makeHeavyTrailer({ name: 'Heavy Haul Trailer Display' });
  const driver = makeDriver();
  const eligibility = evaluateContractTruckEligibility({
    contract: makeBulkContract(71.4),
    truck,
    trailers: [trailer],
    drivers: [driver],
  });
  assert(eligibility.eligible, 'eligible via trailer.type heavy, not display name');
  assert(eligibility.trailerType === 'heavy', 'type remains heavy');
}

console.log(`\nPASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failed > 0) {
  console.error('❌ FAILED');
  process.exit(1);
}
console.log('✅ ALL PASS');
