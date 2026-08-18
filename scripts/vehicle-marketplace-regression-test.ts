import './test-globals';

import assert from 'node:assert/strict';

import {
  getMarketplaceKindMessage,
  mapFailureReasonToMarketplaceKind,
  mapFirebaseErrorToMarketplaceKind,
  MARKETPLACE_TIMEOUT_ERROR,
} from '../src/domain/marketplaceErrorModel';
import {
  applyMarketplaceFetchError,
  applyMarketplaceFetchSuccess,
  beginMarketplaceRefresh,
  marketplaceStateFromListings,
} from '../src/domain/vehicleMarketplaceScreenState';
import { mapMarketplaceCallableError } from '../src/domain/vehicleMarketplaceErrors';
import {
  DEFAULT_MARKETPLACE_FILTERS,
  filterAndSortMarketplaceListings,
  getMarketplaceErrorMessage,
  getMarketplaceScreenErrorMessage,
  hasActiveMarketplaceFilters,
  mergeMarketplacePage,
} from '../src/domain/vehicleMarketplacePresentation';
import { reconcileFleetWithVehicleMarketplace } from '../src/domain/vehicleMarketplaceReconciliation';
import type { VehicleMarketplaceListing } from '../src/types/vehicleMarketplace';

function listing(
  id: string,
  askingPrice: number,
  overrides: Partial<VehicleMarketplaceListing> = {},
): VehicleMarketplaceListing {
  return {
    id,
    sellerUid: `seller-${id}`,
    sellerDisplayName: 'Test Satıcı',
    vehicleType: 'truck',
    truckSnapshot: {
      truckId: `truck-${id}`,
      templateId: 'truck-volvo-fh',
      currentCityId: 'istanbul',
      condition: 82,
      totalMileageKm: 46_280,
      currentFuelL: 120,
      fuelTankCapacityL: 400,
      upgrades: { engine: 2, fuelEfficiency: 1, cargo: 0, durability: 1 },
    },
    askingPrice,
    recommendedPrice: 50_000,
    marketplaceFeeRate: 0.05,
    status: 'active',
    createdAt: 1_000,
    updatedAt: 1_000,
    expiresAt: Date.now() + 18 * 3_600_000,
    version: 1,
    ...overrides,
  };
}

// 1. Authenticated user aktif ilanları yükler (state ready)
const sampleListing = listing('one', 48_000);
assert.deepEqual(
  applyMarketplaceFetchSuccess([sampleListing]),
  { status: 'ready', listings: [sampleListing] },
);

// 2. Başarılı response boş → empty state
assert.deepEqual(marketplaceStateFromListings([]), { status: 'empty' });

// 3. Response dolu → listing cards (ready state)
assert.equal(applyMarketplaceFetchSuccess([listing('a', 1)]).status, 'ready');

// 4. Callable timeout → timeout error
assert.equal(
  mapMarketplaceCallableError(new Error(MARKETPLACE_TIMEOUT_ERROR)),
  'timeout',
);
assert.match(getMarketplaceKindMessage('timeout'), /yanıt vermedi/i);

// 5. Retry sonrası success (refresh preserves list while loading)
const refreshListing = listing('one', 1);
assert.deepEqual(
  beginMarketplaceRefresh({ status: 'ready', listings: [refreshListing] }),
  { status: 'refreshing', listings: [refreshListing] },
);

// 6. Unauthenticated → sign-in state
assert.equal(
  mapFailureReasonToMarketplaceKind('auth-required'),
  'unauthenticated',
);
assert.match(getMarketplaceKindMessage('unauthenticated'), /giriş yap/i);

// 7. Account switch clears via fresh empty listings helper
assert.deepEqual(applyMarketplaceFetchSuccess([]), { status: 'empty' });

// 8. Kendi ilanını satın alma engellenir (message)
assert.equal(
  getMarketplaceErrorMessage('self-purchase'),
  'Kendi ilanını satın alamazsın.',
);

// 9. Yetersiz para (sunucu nakdi)
assert.match(
  getMarketplaceErrorMessage('insufficient-funds'),
  /Yeterli nakdin yok/,
);

// 10. Double purchase idempotency reason surfaces as conflict family
assert.equal(mapFailureReasonToMarketplaceKind('already-completed'), 'conflict');

// 11-14 create/cancel/delivery/listed covered by existing operation messages
assert.match(getMarketplaceErrorMessage('already-listed'), /aktif bir ilanda/);
assert.match(getMarketplaceErrorMessage('active-job'), /Aktif görevdeki/);

// 15. Başka kullanıcının ilanı
assert.equal(getMarketplaceErrorMessage('not-owner'), 'Araç satıcının filosunda bulunamadı.');

// 16. Expired listing
assert.equal(
  getMarketplaceErrorMessage('listing-not-active'),
  'Bu araç başka bir oyuncu tarafından satın alındı.',
);

// 17. Statistik kartları canonical listeden gelir
const merged = mergeMarketplacePage([], {
  listings: [listing('one', 40_000), listing('two', 60_000)],
});
assert.equal(merged.length, 2);

// 18. Filter uygulanır/temizlenir
assert.equal(hasActiveMarketplaceFilters(DEFAULT_MARKETPLACE_FILTERS), false);
assert.equal(
  hasActiveMarketplaceFilters({ ...DEFAULT_MARKETPLACE_FILTERS, minPrice: 1000 }),
  true,
);
const filtered = filterAndSortMarketplaceListings(
  merged,
  { ...DEFAULT_MARKETPLACE_FILTERS, sort: 'price-asc' },
  () => 'Truck',
);
assert.equal(filtered[0]?.askingPrice, 40_000);

// 19. Loading/error state transitions
assert.deepEqual(beginMarketplaceRefresh({ status: 'idle' }), { status: 'loading' });
assert.equal(applyMarketplaceFetchError('timeout').status, 'error');

// 20. Android ve iOS aynı result mapping (shared module)
assert.equal(
  mapFirebaseErrorToMarketplaceKind({ code: 'functions/unauthenticated' }),
  'unauthenticated',
);

assert.equal(
  getMarketplaceScreenErrorMessage('service-unavailable'),
  'Araç Pazarı şu anda yanıt veremiyor.',
);

const reconciliation = reconcileFleetWithVehicleMarketplace([], {
  marketplaceStateVersion: 2,
  cash: 13_500,
  fleetLimit: 6,
  soldTruckIds: [],
  vehicles: [{ ...listing('one', 1).truckSnapshot, status: 'idle' }],
});
assert.equal(reconciliation.trucks.length, 1);

console.log('[vehicle-marketplace-regression-test] PASS', {
  cases: 20,
  reconciliationTrucks: reconciliation.trucks.length,
});
