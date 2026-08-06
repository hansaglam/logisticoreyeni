/**
 * Rental truck expiry regression tests.
 * Run: npx tsx scripts/rental-truck-expiry-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { rentalTruckConfig } from '../src/config/rentalTruck';
import {
  findActiveDeliveryForTruck,
  getAssignableTrucks,
  getContractEligibleTrucks,
  getRentalTruckStatus,
  getTransferEligibleTrucks,
  getVisibleFleetTrucks,
  isTruckEligibleForNewAssignment,
  processExpiredRentalTrucks,
  returnExpiredRentalTruck,
} from '../src/simulation/rentalTruckLifecycle';
import type { Delivery, Truck } from '../src/types/game';

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
    name: 'Fordan CargoPro',
    capacity: 10,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 80,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 80,
    purchasePrice: 0,
    ownershipType: 'leased',
    leaseExpiresAt: 100,
    leaseExpired: false,
    currentCityId: 'izmir',
    status: 'idle',
    ...overrides,
  };
}

function ownedTruck(): Truck {
  return {
    id: 'owned-1',
    name: 'Owned Truck',
    capacity: 10,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 80,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 80,
    purchasePrice: 50000,
    ownershipType: 'owned',
    currentCityId: 'izmir',
    status: 'idle',
  };
}

function activeDelivery(truckId: string): Delivery {
  return {
    id: 'delivery-1',
    contractId: 'contract-1',
    truckId,
    driverId: 'driver-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'electronics',
    cargoWeight: 5,
    status: 'on_route',
    progress: 0.5,
    startedAt: 50,
    travelHours: 10,
    fuelCost: 100,
    estimatedArrivalTime: 120,
  };
}

console.log('\n=== Rental Truck Expiry Regression ===\n');

console.log('Canonical status');
{
  const owned = ownedTruck();
  assert(getRentalTruckStatus({ truck: owned, nowMs: 200 }).status === 'active', 'owned truck unaffected');
  const active = leasedTruck({ leaseExpiresAt: 200 });
  assert(
    getRentalTruckStatus({ truck: active, nowMs: 100 }).status === 'active',
    'active rental before expiry',
  );
  const expiredIdle = leasedTruck({ leaseExpiresAt: 50 });
  assert(
    getRentalTruckStatus({ truck: expiredIdle, nowMs: 100 }).status === 'expired-idle',
    'expired idle rental',
  );
  const onRoute = leasedTruck({ leaseExpiresAt: 50, status: 'on_route' });
  const delivery = activeDelivery(onRoute.id);
  assert(
    getRentalTruckStatus({ truck: onRoute, nowMs: 100, activeDelivery: delivery }).status ===
      'return-pending',
    'active delivery becomes return-pending',
  );
  assert(
    getRentalTruckStatus({ truck: onRoute, nowMs: 100, activeDelivery: delivery }).remainingMs === 0,
    'no negative remaining duration',
  );
}

console.log('\nFleet selectors');
{
  const trucks = [ownedTruck(), leasedTruck({ leaseExpiresAt: 50 }), leasedTruck({ id: 'lease-2', leaseExpiresAt: 200 })];
  const visible = getVisibleFleetTrucks(trucks, 100, []);
  assert(visible.length === 2, 'expired idle rental hidden from fleet');
  const assignable = getAssignableTrucks(trucks, 100, []);
  assert(!assignable.some((truck) => truck.id === 'lease-1'), 'expired idle not assignable');
  assert(getContractEligibleTrucks(trucks, 100, []).length === 2, 'contract eligible excludes expired');
  assert(
    getTransferEligibleTrucks(trucks, 100, []).every((truck) => truck.status === 'idle'),
    'transfer eligible only idle trucks',
  );
}

console.log('\nProcessor');
{
  const idleResult = processExpiredRentalTrucks({
    player: { trucks: [leasedTruck({ leaseExpiresAt: 50 })], drivers: [], trailers: [] },
    activeDeliveries: [],
    currentTime: 100,
    source: 'game-tick',
  });
  assert(idleResult.changed, 'idle expiry mutates state');
  assert(idleResult.player.trucks.length === 0, 'expired idle truck removed');
  assert(idleResult.notifications.length === 1, 'idle expiry notification once');
  assert(
    idleResult.notifications[0]?.message.includes('Fordan CargoPro'),
    'notification includes truck name',
  );

  const duplicate = processExpiredRentalTrucks({
    player: idleResult.player,
    activeDeliveries: [],
    currentTime: 100,
    source: 'game-tick',
  });
  assert(!duplicate.changed, 'duplicate processor idempotent');

  const deliveryTruck = leasedTruck({ leaseExpiresAt: 50, status: 'on_route' });
  const pendingResult = processExpiredRentalTrucks({
    player: { trucks: [deliveryTruck], drivers: [], trailers: [] },
    activeDeliveries: [activeDelivery(deliveryTruck.id)],
    currentTime: 100,
    source: 'game-tick',
  });
  assert(pendingResult.player.trucks.length === 1, 'active delivery truck not deleted mid-route');
  assert(
    pendingResult.player.trucks[0]?.rentalLifecycle?.returnPendingSince === 100,
    'return-pending flag set',
  );
  assert(
    !isTruckEligibleForNewAssignment(pendingResult.player.trucks[0]!, 100, activeDelivery(deliveryTruck.id)),
    'return-pending not assignable',
  );

  const completedTruck = {
    ...pendingResult.player.trucks[0]!,
    status: 'idle' as const,
  };
  const afterDelivery = processExpiredRentalTrucks({
    player: { trucks: [completedTruck], drivers: [], trailers: [] },
    activeDeliveries: [],
    currentTime: 110,
    source: 'rental-expired-after-delivery',
  });
  assert(afterDelivery.player.trucks.length === 0, 'return-pending removed after delivery');
  assert(
    afterDelivery.notifications.some((item) => item.kind === 'rental-returned'),
    'post-delivery returned notification',
  );
}

console.log('\nReturn action');
{
  const removal = returnExpiredRentalTruck({
    truckId: 'lease-1',
    reason: 'rental-expired-idle',
    currentTime: 100,
    player: {
      trucks: [leasedTruck()],
      drivers: [{ id: 'd1', name: 'Driver', salaryPerDay: 100, status: 'idle', assignedTruckId: 'lease-1' }],
      trailers: [],
    },
  });
  assert(removal.applied, 'return action applied');
  assert(removal.player.trucks.length === 0, 'truck removed from list');
  assert(removal.player.drivers[0]?.assignedTruckId == null, 'driver assignment cleared');
  const second = returnExpiredRentalTruck({
    truckId: 'lease-1',
    reason: 'rental-expired-idle',
    currentTime: 100,
    player: removal.player,
  });
  assert(!second.applied, 'second return is no-op');
}

console.log('\nExpiry warning');
{
  const warningTruck = leasedTruck({ leaseExpiresAt: 110 });
  const warning = processExpiredRentalTrucks({
    player: { trucks: [warningTruck], drivers: [], trailers: [] },
    activeDeliveries: [],
    currentTime: 100,
    source: 'game-tick',
  });
  assert(
    warning.notifications.some((item) => item.kind === 'rental-expiring-soon'),
    'expiring-soon warning emitted',
  );
  const again = processExpiredRentalTrucks({
    player: warning.player,
    activeDeliveries: [],
    currentTime: 101,
    source: 'game-tick',
  });
  assert(
    again.notifications.filter((item) => item.kind === 'rental-expiring-soon').length === 0,
    'expiry warning only once',
  );
  assert(
    rentalTruckConfig.expiryWarningGameHours === 24,
    'warning threshold configured at 24 game hours',
  );
}

console.log('\nIntegration wiring');
{
  const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');
  const notifications = readFileSync('src/services/notifications.ts', 'utf8');
  const app = readFileSync('App.tsx', 'utf8');
  assert(gameStore.includes('processExpiredRentalTrucks'), 'gameStore uses rental processor');
  assert(gameStore.includes("processExpiredLeases('hydrate-rental-expiry')"), 'hydrate path wired');
  assert(notifications.includes('fleet-updates'), 'Android fleet channel exists');
  assert(notifications.includes('sendFleetRentalLocalNotification'), 'local rental notification helper');
  assert(app.includes('isFleetRentalNotificationResponse'), 'notification tap opens fleet');
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
console.log('rental-truck-expiry-regression-test: PASSED\n');
