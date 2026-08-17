/**
 * Sözleşme uygunluk senaryoları — manuel doğrulama için.
 * Çalıştır: npx tsx src/simulation/contractAvailabilityScenarios.ts
 */

import { getContractAvailability, isContractOfferExpired } from './delivery';
import type { Contract, Driver, Truck } from '../types/game';

const DRIVER = {
  id: 'd1',
  name: 'Test Şoför',
  status: 'idle',
  experience: 50,
  attention: 50,
  speed: 50,
  fuelSaving: 0,
  morale: 80,
  salaryPerDay: 100,
  hireCost: 0,
  assignedTruckId: null,
} satisfies Driver;

function baseLeasedTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'lease-1',
    catalogId: 'truck-ford-cargo',
    name: 'Fordan CargoPro (Kiralık)',
    capacity: 18,
    ownershipType: 'leased',
    leaseExpired: false,
    leaseExpiresAt: 10_000,
    currentCityId: 'istanbul',
    homeCityId: 'istanbul',
    status: 'idle',
    fuelConsumptionPerKm: 0.35,
    speed: 68,
    reliability: 70,
    maintenanceCost: 0.14,
    comfort: 55,
    condition: 100,
    purchasePrice: 52_000,
    ...overrides,
  };
}

function baseContract(cargoWeight: number, overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c1',
    originCityId: 'istanbul',
    destinationCityId: 'ankara',
    productId: 'steel',
    cargoWeight,
    amount: cargoWeight,
    payment: 5000,
    status: 'available',
    requiredLevel: 1,
    deadlineHours: 48,
    distanceKm: 450,
    urgency: 0.3,
    expiresAt: 999_999,
    createdAt: 0,
    ...overrides,
  };
}

function assertScenario(
  name: string,
  result: ReturnType<typeof getContractAvailability>,
  expectedReason: string,
  expectedCanStart?: boolean,
): void {
  const pass =
    result.reason === expectedReason &&
    (expectedCanStart == null || result.canStart === expectedCanStart);
  if (!pass) {
    throw new Error(
      `[FAIL] ${name}: expected reason=${expectedReason}, canStart=${expectedCanStart ?? 'any'}; ` +
        `got reason=${result.reason}, canStart=${result.canStart}`,
    );
  }
  console.log(`[PASS] ${name}`);
}

export function runContractAvailabilityScenarios(): void {
  assertScenario(
    'Test 1: idle leased 18t vs 28t contract',
    getContractAvailability(baseContract(28), [baseLeasedTruck()], [DRIVER], 1, 100),
    'NO_TRUCK_WITH_CAPACITY',
    false,
  );

  assertScenario(
    'Test 2: idle leased 18t vs 14t contract',
    getContractAvailability(baseContract(14), [baseLeasedTruck()], [DRIVER], 1, 100),
    'OK',
    true,
  );

  assertScenario(
    'Test 3: busy leased truck at origin',
    getContractAvailability(
      baseContract(14),
      [baseLeasedTruck({ status: 'on_route' })],
      [DRIVER],
      1,
      100,
    ),
    'NO_IDLE_TRUCK_IN_ORIGIN_CITY',
    false,
  );

  assertScenario(
    'Test 4: no truck in Istanbul',
    getContractAvailability(
      baseContract(14),
      [baseLeasedTruck({ currentCityId: 'izmir', homeCityId: 'izmir' })],
      [DRIVER],
      1,
      100,
    ),
    'NO_TRUCK_IN_ORIGIN_CITY',
    false,
  );

  assertScenario(
    'Test 5: owned + leased both counted (28t fits owned truck)',
    getContractAvailability(
      baseContract(28),
      [
        baseLeasedTruck(),
        {
          ...baseLeasedTruck({
            id: 'owned-1',
            name: 'Nordvik Titan',
            ownershipType: 'owned',
            capacity: 30,
          }),
        },
      ],
      [DRIVER],
      1,
      100,
    ),
    'OK',
    true,
  );

  assertScenario(
    'Test 6: expired lease with capacity fit shows lease expired',
    getContractAvailability(
      baseContract(14),
      [baseLeasedTruck({ leaseExpired: true })],
      [DRIVER],
      1,
      100,
    ),
    'LEASE_EXPIRED',
    false,
  );

  assertScenario(
    'Test 6b: expired lease with insufficient capacity shows tonaj',
    getContractAvailability(
      baseContract(28),
      [baseLeasedTruck({ leaseExpired: true })],
      [DRIVER],
      1,
      100,
    ),
    'NO_TRUCK_WITH_CAPACITY',
    false,
  );

  assertScenario(
    'Test 7: expired offer blocks start even if status still available',
    getContractAvailability(
      baseContract(20, { expiresAt: 50 }),
      [baseLeasedTruck()],
      [DRIVER],
      1,
      100,
    ),
    'CONTRACT_EXPIRED',
    false,
  );

  assertScenario(
    'Test 8: lease expires by time shows lease expired',
    getContractAvailability(
      baseContract(14),
      [baseLeasedTruck({ leaseExpiresAt: 50 })],
      [DRIVER],
      1,
      100,
    ),
    'LEASE_EXPIRED',
    false,
  );

  assertScenario(
    'Test 9: active lease shorter than trip + buffer cannot start',
    getContractAvailability(
      baseContract(14),
      [baseLeasedTruck({ leaseExpiresAt: 104 })],
      [DRIVER],
      1,
      100,
    ),
    'RENTAL_DURATION_INSUFFICIENT',
    false,
  );

  console.log('All contract availability scenarios passed.');
}

runContractAvailabilityScenarios();
