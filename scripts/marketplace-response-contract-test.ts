/**
 * Marketplace response contract + legacy normalization tests.
 * Run: npx tsx scripts/marketplace-response-contract-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';

import {
  normalizeStoredMarketplaceListing,
  timestampToMillis,
} from '../backend/src/vehicleMarketplaceSerialization';
import {
  parseVehicleMarketplaceListResponse,
  parseVehicleMarketplaceListing,
} from '../src/domain/vehicleMarketplaceResponseParser';

function baseListing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    sellerUid: 'seller-1',
    sellerDisplayName: 'seller_one',
    vehicleType: 'truck',
    truckSnapshot: {
      truckId: 'truck-1',
      templateId: 'truck-ford-cargo',
      currentCityId: 'izmir',
      condition: 88,
      totalMileageKm: 12_000,
      currentFuelL: 100,
      fuelTankCapacityL: 300,
    },
    askingPrice: 50_000,
    recommendedPrice: 48_000,
    marketplaceFeeRate: 0.05,
    status: 'active',
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    expiresAt: 1_800_064_800_000,
    version: 1,
    ...overrides,
  };
}

// 1. valid empty list
{
  const parsed = parseVehicleMarketplaceListResponse({
    ok: true,
    apiVersion: 1,
    listings: [],
    hasMore: false,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.listings, []);
    assert.equal(parsed.data.hasMore, false);
  }
}

// 2. valid one listing
{
  const parsed = parseVehicleMarketplaceListResponse({
    ok: true,
    listings: [baseListing()],
    hasMore: false,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.listings.length, 1);
}

// 3. Firestore Timestamp wire shape
{
  const parsed = parseVehicleMarketplaceListing(
    baseListing({
      createdAt: { _seconds: 1_800_000_000, _nanoseconds: 0 },
      updatedAt: { seconds: 1_800_000_000, nanoseconds: 0 },
      expiresAt: 1_800_064_800_000,
    }),
    0,
  );
  assert.equal(parsed.success, true);
}

// 4. legacy status available -> active
{
  const backend = normalizeStoredMarketplaceListing(
    baseListing({ status: 'available' }) as Record<string, unknown>,
    'listing-legacy',
  );
  assert.equal(backend.ok, true);
  if (backend.ok) assert.equal(backend.listing.status, 'active');
}

// 5. numeric string price normalize
{
  const backend = normalizeStoredMarketplaceListing(
    baseListing({ askingPrice: '52000', recommendedPrice: '50000' }) as Record<string, unknown>,
    'listing-price-string',
  );
  assert.equal(backend.ok, true);
  if (backend.ok) assert.equal(backend.listing.askingPrice, 52_000);
}

// 6. one bad + two good listings -> two returned
{
  const parsed = parseVehicleMarketplaceListResponse({
    ok: true,
    listings: [
      baseListing({ id: 'good-1' }),
      { id: 'bad', status: 'active' },
      baseListing({ id: 'good-2', truckSnapshot: { ...baseListing().truckSnapshot, truckId: 'truck-2' } }),
    ],
    hasMore: false,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.listings.length, 2);
}

// 7. invalid price rejected
{
  const backend = normalizeStoredMarketplaceListing(
    baseListing({ askingPrice: 'not-a-number' }) as Record<string, unknown>,
    'listing-bad-price',
  );
  assert.equal(backend.ok, false);
}

// 8. legacy catalogId + condition 0-1
{
  const backend = normalizeStoredMarketplaceListing(
    {
      id: 'legacy-1',
      sellerUid: 'seller-1',
      status: 'active',
      askingPrice: 40_000,
      recommendedPrice: 39_000,
      marketplaceFeeRate: 0.05,
      version: 1,
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
      expiresAt: 1_800_064_800_000,
      truck: {
        id: 'truck-legacy',
        catalogId: 'truck-ford-cargo',
        cityId: 'izmir',
        condition: 0.82,
        totalMileageKm: 1000,
        currentFuelL: 50,
        fuelTankCapacityL: 200,
      },
    },
    'legacy-1',
  );
  assert.equal(backend.ok, true);
  if (backend.ok) {
    assert.equal(backend.listing.truckSnapshot.templateId, 'truck-ford-cargo');
    assert.equal(backend.listing.truckSnapshot.condition, 82);
  }
}

// 9. timestampToMillis helpers
assert.equal(timestampToMillis({ _seconds: 10, _nanoseconds: 0 }), 10_000);

// 10. unsupported api version
{
  const parsed = parseVehicleMarketplaceListResponse({
    ok: true,
    apiVersion: 99,
    listings: [],
    hasMore: false,
  });
  assert.equal(parsed.success, false);
}

console.log('\n✅ marketplace-response-contract-test PASS\n');
