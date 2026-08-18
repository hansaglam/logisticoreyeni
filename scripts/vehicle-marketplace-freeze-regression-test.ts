/**
 * Regression: Araç Pazarı listing eligibility + nested-modal freeze guards.
 * Run: npx tsx scripts/vehicle-marketplace-freeze-regression-test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getVehicleMarketplaceEligibility } from '../src/domain/vehicleMarketplaceEligibility';
import type { Delivery, Driver, Trailer, Truck } from '../src/types/game';

const root = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function baseTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-1',
    name: 'Test',
    capacity: 10,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 80,
    maintenanceCost: 1,
    comfort: 50,
    condition: 90,
    purchasePrice: 100_000,
    ownershipType: 'owned',
    currentCityId: 'istanbul',
    status: 'idle',
    ...overrides,
  };
}

const idleFleet = [baseTruck(), baseTruck({ id: 'truck-2', name: 'Second' })];

// CASE B — active delivery
{
  const deliveries: Delivery[] = [
    {
      id: 'd1',
      contractId: 'c1',
      truckId: 'truck-1',
      driverId: 'drv-1',
      status: 'on_route',
      progress: 0.2,
      startedAt: 0,
      estimatedArrivalAt: 10,
      fromCityId: 'istanbul',
      toCityId: 'ankara',
    } as Delivery,
  ];
  const result = getVehicleMarketplaceEligibility('truck-1', {
    trucks: [baseTruck({ status: 'on_route' }), baseTruck({ id: 'truck-2' })],
    activeDeliveries: deliveries,
  });
  assert.equal(result.eligible, false);
  assert.ok(
    result.reason === 'truck-busy' || result.reason === 'active-job',
    `expected busy reason, got ${result.reason}`,
  );
  assert.match(result.message, /aktif|satışa çıkarılamaz/i);
  console.log('  ✓ CASE B active delivery blocked locally');
}

// CASE C — already listed
{
  const result = getVehicleMarketplaceEligibility('truck-1', {
    trucks: [baseTruck({ status: 'marketplace_locked' }), baseTruck({ id: 'truck-2' })],
    activeListingTruckIds: ['truck-1'],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'already-listed');
  console.log('  ✓ CASE C already-listed blocked locally');
}

// CASE D — unknown vehicle
{
  const result = getVehicleMarketplaceEligibility('missing', {
    trucks: idleFleet,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'truck-not-found');
  console.log('  ✓ CASE D unknown vehicle safe');
}

// Driver / trailer / starter protection
{
  const drivers: Driver[] = [
    {
      id: 'drv-1',
      name: 'Ali',
      experience: 10,
      attention: 50,
      fuelSaving: 50,
      speed: 0,
      morale: 50,
      salaryPerDay: 100,
      status: 'idle',
      assignedTruckId: 'truck-1',
      currentCityId: 'istanbul',
    } as Driver,
  ];
  assert.equal(
    getVehicleMarketplaceEligibility('truck-1', {
      trucks: idleFleet,
      drivers,
    }).reason,
    'driver-attached',
  );

  const trailers: Trailer[] = [
    {
      id: 'tr-1',
      name: 'Dorse',
      type: 'standard',
      capacityBonusTons: 5,
      purchasePrice: 10_000,
      condition: 80,
      city: 'istanbul',
      status: 'attached',
      attachedTruckId: 'truck-1',
      isOwned: true,
      createdAtGameTime: 0,
    },
  ];
  assert.equal(
    getVehicleMarketplaceEligibility('truck-1', {
      trucks: idleFleet,
      trailers,
    }).reason,
    'trailer-attached',
  );

  assert.equal(
    getVehicleMarketplaceEligibility('truck-1', {
      trucks: [baseTruck()],
    }).reason,
    'starter-protection',
  );
  console.log('  ✓ driver/trailer/starter rules match backend reasons');
}

// Eligible idle owned pair
{
  const result = getVehicleMarketplaceEligibility('truck-1', {
    trucks: idleFleet,
  });
  assert.equal(result.eligible, true);
  console.log('  ✓ CASE A eligible idle owned vehicle');
}

// Source guards — nested modal freeze fix
{
  const screen = read('src/screens/VehicleMarketplaceScreen.tsx');
  assert.match(screen, /showAlertAfterModalClose/);
  assert.match(screen, /getVehicleMarketplaceEligibility/);
  assert.match(screen, /BackHandler\.addEventListener/);
  assert.match(screen, /isCreatingListing/);
  assert.match(screen, /isBuyingVehicle/);
  assert.match(screen, /closeCreateSheet/);
  // Must not open AppDialog while create Modal is still visible on failure path
  assert.doesNotMatch(
    screen,
    /setIsCreatingListing\(true\);\s*try \{\s*const result = await createVehicleListing[\s\S]*showAlert\('İlan oluşturulamadı'/,
  );
  assert.match(screen, /finally \{\s*setIsCreatingListing\(false\)/);
  assert.match(screen, /finally \{\s*endVehicleMarketplaceOperation/);
  assert.doesNotMatch(
    screen,
    /const confirmPurchase = async \(\) => \{[\s\S]*await prepareMarketplacePurchaseFunds\(\)/,
  );

  const sheet = read('src/components/marketplace/VehicleListingCreateSheet.tsx');
  assert.match(sheet, /eligibilityContext/);
  assert.match(sheet, /inlineError/);

  const dialog = read('src/components/ui/AppDialog.tsx');
  assert.match(dialog, /runDialogActionAfterDismiss\(handleDismiss/);

  const safety = read('src/utils/marketplaceUiSafety.ts');
  assert.match(safety, /InteractionManager\.runAfterInteractions/);
  console.log('  ✓ nested Modal + BackHandler + try/finally guards present');
}

console.log('\nvehicle-marketplace-freeze-regression-test: OK');
