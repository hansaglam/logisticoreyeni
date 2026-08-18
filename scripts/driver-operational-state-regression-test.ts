/**
 * Driver assignment / operational state integrity.
 * Run: npx tsx scripts/driver-operational-state-regression-test.ts
 */
import './test-globals';

import {
  buildDriverAssignmentContext,
  getDriverOperationalState,
  reconcileDriverAssignments,
} from '../src/domain/driverOperationalState';
import { evaluateDriverOption } from '../src/utils/assignmentOptions';
import type { Delivery, Driver, Truck } from '../src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-1',
    name: 'Test Truck',
    capacity: 20,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 90,
    maintenanceCost: 0.1,
    comfort: 70,
    condition: 100,
    purchasePrice: 50_000,
    ownershipType: 'owned',
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    status: 'idle',
    ...overrides,
  };
}

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'drv-1',
    name: 'Test Driver',
    experience: 50,
    attention: 50,
    speed: 0,
    fuelSaving: 40,
    morale: 80,
    level: 1,
    salaryPerDay: 500,
    status: 'idle',
    assignedTruckId: null,
    ...overrides,
  } as Driver;
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'del-1',
    contractId: 'con-1',
    truckId: 'truck-1',
    driverId: 'drv-1',
    originCityId: 'izmir',
    destinationCityId: 'istanbul',
    productId: 'electronics',
    cargoWeight: 8,
    amount: 8,
    status: 'on_route',
    progress: 0.2,
    startedAt: 10,
    travelHours: 8,
    fuelCost: 120,
    estimatedArrivalTime: 18,
    ...overrides,
  } as Delivery;
}

function countOnDelivery(drivers: Driver[], context: ReturnType<typeof buildDriverAssignmentContext>): number {
  return drivers.filter(
    (driver) => getDriverOperationalState(driver, context).kind === 'on_delivery',
  ).length;
}

console.log('\nDriver operational state regression\n');

console.log('TEST 1 — one truck, one active delivery, stale driving flags');
{
  const trucks = [makeTruck()];
  const activeDeliveries = [makeDelivery()];
  const drivers = [
    makeDriver({ id: 'drv-1', name: 'Active', status: 'driving', assignedTruckId: 'truck-1' }),
    makeDriver({ id: 'drv-2', name: 'Stale A', status: 'driving' }),
    makeDriver({ id: 'drv-3', name: 'Stale B', status: 'driving' }),
    makeDriver({ id: 'drv-4', name: 'Stale C', status: 'driving' }),
    makeDriver({ id: 'drv-5', name: 'Stale D', status: 'driving' }),
  ];
  const result = reconcileDriverAssignments({ drivers, trucks, activeDeliveries });
  const context = buildDriverAssignmentContext({ trucks, activeDeliveries });
  assert(result.changed, 'reconcile reports changes');
  assert(countOnDelivery(result.drivers, context) === 1, 'exactly one driver on delivery');
  assert(
    getDriverOperationalState(result.drivers[0]!, context).kind === 'on_delivery',
    'canonical delivery driver stays on delivery',
  );
}

console.log('\nTEST 2 — delivery completed removes on-delivery state');
{
  const trucks = [makeTruck()];
  const drivers = [makeDriver({ status: 'driving', assignedTruckId: 'truck-1' })];
  const result = reconcileDriverAssignments({
    drivers,
    trucks,
    activeDeliveries: [],
  });
  const context = buildDriverAssignmentContext({ trucks, activeDeliveries: [] });
  assert(result.drivers[0]?.status === 'idle', 'driver status reset to idle');
  assert(
    getDriverOperationalState(result.drivers[0]!, context).kind !== 'on_delivery',
    'driver no longer on delivery',
  );
}

console.log('\nTEST 3 — delivery failed releases driver');
{
  const trucks = [makeTruck()];
  const drivers = [makeDriver({ status: 'driving', assignedTruckId: 'truck-1' })];
  const failedDelivery = makeDelivery({ status: 'failed' });
  const result = reconcileDriverAssignments({
    drivers,
    trucks,
    activeDeliveries: [failedDelivery],
  });
  const context = buildDriverAssignmentContext({ trucks, activeDeliveries: [failedDelivery] });
  assert(
    getDriverOperationalState(result.drivers[0]!, context).kind !== 'on_delivery',
    'failed delivery does not keep driver on delivery',
  );
}

console.log('\nTEST 4 — delivery cancelled releases driver');
{
  const trucks = [makeTruck()];
  const drivers = [makeDriver({ status: 'driving', assignedTruckId: 'truck-1' })];
  const cancelledDelivery = makeDelivery({ status: 'cancelled' });
  const result = reconcileDriverAssignments({
    drivers,
    trucks,
    activeDeliveries: [cancelledDelivery],
  });
  const context = buildDriverAssignmentContext({ trucks, activeDeliveries: [cancelledDelivery] });
  assert(
    getDriverOperationalState(result.drivers[0]!, context).kind !== 'on_delivery',
    'cancelled delivery does not keep driver on delivery',
  );
}

console.log('\nTEST 5 — missing truck clears orphan driver assignment');
{
  const trucks: Truck[] = [];
  const drivers = [makeDriver({ status: 'idle', assignedTruckId: 'missing-truck' })];
  const result = reconcileDriverAssignments({ drivers, trucks, activeDeliveries: [] });
  assert(result.drivers[0]?.assignedTruckId == null, 'orphan truck assignment cleared');
  assert(result.summary.orphanAssignments >= 1, 'orphan assignment counted');
}

console.log('\nTEST 6 — old save with four stale TESLİMATTA drivers self-heals');
{
  const trucks = [makeTruck()];
  const activeDeliveries = [makeDelivery({ driverId: 'drv-2', id: 'del-2' })];
  const drivers = [
    makeDriver({ id: 'drv-1', status: 'driving' }),
    makeDriver({ id: 'drv-2', status: 'driving', assignedTruckId: 'truck-1' }),
    makeDriver({ id: 'drv-3', status: 'driving' }),
    makeDriver({ id: 'drv-4', status: 'driving' }),
  ];
  const result = reconcileDriverAssignments({ drivers, trucks, activeDeliveries });
  const context = buildDriverAssignmentContext({ trucks, activeDeliveries });
  assert(countOnDelivery(result.drivers, context) === 1, 'only canonical delivery driver on delivery');
  assert(result.summary.staleDrivingCleared >= 3, 'stale driving flags cleared');
}

console.log('\nTEST 7 — busy driver blocked for new delivery selection');
{
  const trucks = [makeTruck()];
  const activeDeliveries = [makeDelivery({ driverId: 'drv-busy' })];
  const context = buildDriverAssignmentContext({ trucks, activeDeliveries });
  const busyDriver = makeDriver({ id: 'drv-busy', status: 'driving', assignedTruckId: 'truck-1' });
  const option = evaluateDriverOption(busyDriver, context);
  assert(!option.selectable, 'busy driver not selectable');
  assert(
    option.label.includes('teslimatta') || option.label.includes('Teslimatta'),
    'blocked reason mentions active delivery',
    option.label,
  );
}

console.log('\nTEST 8 — stale busy flag without canonical assignment is healed and selectable');
{
  const trucks = [makeTruck()];
  const drivers = [makeDriver({ id: 'drv-free', status: 'driving' })];
  const result = reconcileDriverAssignments({ drivers, trucks, activeDeliveries: [] });
  const context = buildDriverAssignmentContext({ trucks, activeDeliveries: [] });
  const healed = result.drivers[0]!;
  const option = evaluateDriverOption(healed, context);
  assert(option.selectable, 'healed driver is selectable');
  assert(
    getDriverOperationalState(healed, context).kind === 'available',
    'healed driver is available',
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
