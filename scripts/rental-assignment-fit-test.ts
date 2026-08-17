/**
 * Kiralık araç iş atama uygunluğu.
 * Run: npx tsx scripts/rental-assignment-fit-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { rentalTruckConfig } from '../src/config/rentalTruck';
import {
  evaluateRentalAssignmentFit,
  formatRentalAssignmentBlockMessage,
  getRentalAssignmentBufferHours,
  getRequiredRentalHours,
} from '../src/domain/rentalAssignmentFit';
import {
  canRentalTruckCoverAssignment,
  getContractAvailability,
  selectIdleTruckForContract,
} from '../src/simulation/delivery';
import { evaluateTruckOption } from '../src/utils/assignmentOptions';
import type { Contract, Truck } from '../src/types/game';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

function leasedTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'lease-1',
    name: 'Kiralık Cargo',
    capacity: 18,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 80,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 80,
    purchasePrice: 0,
    ownershipType: 'leased',
    leaseExpiresAt: 200,
    leaseExpired: false,
    currentCityId: 'istanbul',
    status: 'idle',
    ...overrides,
  };
}

function ownedTruck(): Truck {
  return {
    id: 'owned-1',
    name: 'Owned Truck',
    capacity: 18,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 80,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 80,
    purchasePrice: 50_000,
    ownershipType: 'owned',
    currentCityId: 'istanbul',
    status: 'idle',
  };
}

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c1',
    originCityId: 'istanbul',
    destinationCityId: 'ankara',
    productId: 'steel',
    cargoWeight: 10,
    amount: 10,
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

console.log('\nbuffer rule');
{
  assert(getRentalAssignmentBufferHours(5) === 1, 'eta 5h uses min 1h buffer');
  assert(getRentalAssignmentBufferHours(20) === 2, 'eta 20h uses 10% = 2h buffer');
  assert(getRequiredRentalHours(10) === 11, 'eta 10h requires 11h remaining');
  assert(
    rentalTruckConfig.assignmentBufferMinHours === 1 &&
      rentalTruckConfig.assignmentBufferRatio === 0.1,
    'config is min 1h and 10%',
  );
}

console.log('\nassignment fit');
{
  const now = 100;
  const owned = evaluateRentalAssignmentFit({
    truck: ownedTruck(),
    currentTime: now,
    estimatedTravelHours: 10,
  });
  assert(owned.status === 'not_applicable' && owned.canAssign, 'owned trucks are always assignable');

  const tooShort = evaluateRentalAssignmentFit({
    truck: leasedTruck({ leaseExpiresAt: now + 10 }),
    currentTime: now,
    estimatedTravelHours: 10,
  });
  assert(!tooShort.canAssign && tooShort.status === 'unsuitable', 'remaining == eta is blocked by buffer');
  assert(tooShort.remainingHours === 10, 'remaining hours is 10');
  assert(tooShort.requiredHours === 11, 'required hours includes 1h buffer');

  const exactRequired = evaluateRentalAssignmentFit({
    truck: leasedTruck({ leaseExpiresAt: now + 11 }),
    currentTime: now,
    estimatedTravelHours: 10,
  });
  assert(exactRequired.canAssign, 'remaining == eta + buffer can assign');
  assert(exactRequired.status === 'risky', 'exact required is still risky');

  const comfortable = evaluateRentalAssignmentFit({
    truck: leasedTruck({ leaseExpiresAt: now + 80 }),
    currentTime: now,
    estimatedTravelHours: 10,
  });
  assert(comfortable.canAssign && comfortable.status === 'suitable', 'large remaining is suitable');

  const expired = evaluateRentalAssignmentFit({
    truck: leasedTruck({ leaseExpiresAt: now - 1 }),
    currentTime: now,
    estimatedTravelHours: 8,
  });
  assert(!expired.canAssign && expired.status === 'unsuitable', 'expired lease cannot assign');
}

console.log('\nplayer-facing copy');
{
  const fit = evaluateRentalAssignmentFit({
    truck: leasedTruck({ leaseExpiresAt: 108 }),
    currentTime: 100,
    estimatedTravelHours: 12,
  });
  const message = formatRentalAssignmentBlockMessage(fit);
  assert(
    message.includes('Bu kiralık aracın süresi bu teslimat için yeterli değil.'),
    'block title is explicit',
  );
  assert(message.includes('Kalan süre:'), 'shows remaining hours');
  assert(message.includes('Tahmini teslimat:'), 'shows estimated hours');
}

console.log('\navailability + auto-assign');
{
  const job = contract();
  const shortLease = leasedTruck({ leaseExpiresAt: 104 });
  const availability = getContractAvailability(job, [shortLease], [], 1, 100);
  assert(
    availability.reason === 'RENTAL_DURATION_INSUFFICIENT' && !availability.canStart,
    'availability blocks short rental as the only truck',
  );
  assert(
    !canRentalTruckCoverAssignment(shortLease, job, 100),
    'cover helper rejects short rental',
  );

  const mixed = selectIdleTruckForContract(
    [shortLease, ownedTruck()],
    job,
    undefined,
    100,
    'istanbul',
  );
  assert(mixed?.id === 'owned-1', 'auto-assign skips short rental and picks owned truck');

  const onlyShort = selectIdleTruckForContract([shortLease], job, undefined, 100, 'istanbul');
  assert(onlyShort == null, 'auto-assign picks nothing when rental cannot cover the trip');
}

console.log('\nassignment option UI gate');
{
  const option = evaluateTruckOption(
    leasedTruck({ leaseExpiresAt: 104 }),
    10,
    'istanbul',
    [],
    100,
    [],
    10,
  );
  assert(option.issue === 'rental_duration' && !option.selectable, 'truck option is not selectable');
  assert(option.rentalFit?.remainingHours === 4, 'option exposes remaining hours');
  assert(option.rentalFit?.estimatedTravelHours === 10, 'option exposes estimated hours');
}

console.log('\nwiring');
{
  const store = readFileSync('src/store/gameStore.ts', 'utf8');
  const delivery = readFileSync('src/simulation/delivery.ts', 'utf8');
  const assignment = readFileSync('src/components/ContractAssignmentModal.tsx', 'utf8');
  const sheet = readFileSync('src/components/contracts/ContractQuickActionSheet.tsx', 'utf8');
  assert(store.includes("errorCode: 'RENTAL_DURATION_INSUFFICIENT'"), 'startDelivery hard-blocks rental duration');
  assert(store.includes('evaluateRentalAssignmentFit'), 'startDelivery uses domain evaluator');
  assert(delivery.includes('canRentalTruckCoverAssignment'), 'availability uses rental cover helper');
  assert(assignment.includes('RentalAssignmentFitBanner'), 'assignment modal shows rental banner');
  assert(sheet.includes('RentalAssignmentFitBanner'), 'quick sheet shows rental banner');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
