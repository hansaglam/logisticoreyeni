import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  VEHICLE_MARKETPLACE_ENABLED,
  isVehicleMarketplaceMutationAllowed,
  resolveVehicleMarketplaceFeatureFlag,
} from '../src/config/backendRoadmap';
import {
  DEFAULT_MARKETPLACE_FILTERS,
  filterAndSortMarketplaceListings,
  getMarketplaceCardWidth,
  getMarketplaceErrorMessage,
  getMarketplacePriceAssessment,
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

assert.deepEqual(
  resolveVehicleMarketplaceFeatureFlag({ isDevelopment: true }),
  { enabled: true, source: 'dev' },
);
assert.deepEqual(
  resolveVehicleMarketplaceFeatureFlag({ isDevelopment: false, envValue: 'true' }),
  { enabled: true, source: 'env' },
);
assert.deepEqual(
  resolveVehicleMarketplaceFeatureFlag({ isDevelopment: false, envValue: 'false' }),
  { enabled: false, source: 'disabled' },
);
assert.equal(VEHICLE_MARKETPLACE_ENABLED, false, 'Node production test must default closed');
assert.equal(isVehicleMarketplaceMutationAllowed(false), false);
assert.equal(isVehicleMarketplaceMutationAllowed(true), true);
assert.equal(getMarketplaceCardWidth(360), 328, '360px layout must preserve 16px gutters');
assert.equal(getMarketplacePriceAssessment(45_000, 50_000), 'good');
assert.equal(getMarketplacePriceAssessment(50_000, 50_000), 'fair');
assert.equal(getMarketplacePriceAssessment(56_000, 50_000), 'high');

const first = listing('one', 48_000);
const updated = listing('one', 47_000, { version: 2 });
const second = listing('two', 60_000, {
  truckSnapshot: { ...listing('x', 1).truckSnapshot, condition: 95, truckId: 'truck-two' },
});
const merged = mergeMarketplacePage([first], { listings: [updated, second] });
assert.equal(merged.length, 2, 'cursor pages must dedupe listing ids');
assert.equal(merged.find((item) => item.id === 'one')?.version, 2);

const sorted = filterAndSortMarketplaceListings(
  merged,
  { ...DEFAULT_MARKETPLACE_FILTERS, sort: 'condition-desc', minCondition: 90 },
  () => 'Nordvik Titan',
);
assert.deepEqual(sorted.map((item) => item.id), ['two']);

assert.equal(
  getMarketplaceErrorMessage('listing-not-active'),
  'Bu araç başka bir oyuncu tarafından satın alındı.',
);
assert.equal(getMarketplaceErrorMessage('insufficient-funds'), 'Yeterli nakdin yok.');
assert.equal(getMarketplaceErrorMessage('fleet-limit'), 'Filonda boş yer yok.');
assert.equal(
  getMarketplaceErrorMessage('self-purchase'),
  'Kendi ilanını satın alamazsın.',
);
assert.match(getMarketplaceErrorMessage('auth-required'), /hesabını bağla/);
assert.match(
  getMarketplaceErrorMessage('marketplace-state-missing'),
  /henüz hazırlanmadı/,
);
assert.match(
  getMarketplaceErrorMessage('save-conflict'),
  /senkronizasyonu tamamlanmadı/i,
);

const reconciliation = reconcileFleetWithVehicleMarketplace([], {
  marketplaceStateVersion: 2,
  cash: 13_500,
  fleetLimit: 6,
  soldTruckIds: [],
  vehicles: [
    {
      ...first.truckSnapshot,
      status: 'idle',
    },
  ],
});
assert.equal(reconciliation.trucks.length, 1, 'authoritative purchase must add truck');
assert.equal(reconciliation.trucks[0].id, first.truckSnapshot.truckId);
assert.equal(reconciliation.authoritativeCash, 13_500);

const ROOT = resolve(__dirname, '..');
const readSource = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const createSheetSource = readSource('src/components/marketplace/VehicleListingCreateSheet.tsx');
assert.match(createSheetSource, /KeyboardAvoidingView/);
assert.match(createSheetSource, /keyboardShouldPersistTaps="handled"/);
assert.match(createSheetSource, /getBottomInset/);
assert.match(createSheetSource, /scrollToEnd/);

const marketplaceScreenSource = readSource('src/screens/VehicleMarketplaceScreen.tsx');
assert.match(marketplaceScreenSource, /showSuccessAfterModalClose/);
assert.doesNotMatch(marketplaceScreenSource, /backend tarafından kilitlendi/);
assert.match(marketplaceScreenSource, /prepareMarketplacePurchaseFunds/);
assert.match(marketplaceScreenSource, /clientSaveVersion: attempt.clientSaveVersion/);
assert.match(marketplaceScreenSource, /purchaseAuthoritativeCash/);
assert.match(marketplaceScreenSource, /withMarketplacePurchaseTimeout/);
assert.match(marketplaceScreenSource, /purchaseFailed/);

const purchaseSheetSource = readSource('src/components/marketplace/VehicleMarketplaceSheets.tsx');
assert.match(purchaseSheetSource, /Kullanılabilir nakit \(sunucu\)/);
assert.match(purchaseSheetSource, /preparing/);

const purchasePrepSource = readSource('src/domain/vehicleMarketplacePurchasePrep.ts');
assert.match(purchasePrepSource, /prepareMarketplacePurchaseFunds/);
assert.match(purchasePrepSource, /resolveMarketplaceClientSaveVersion/);

const marketplaceUiSafetySource = readSource('src/utils/marketplaceUiSafety.ts');
assert.match(marketplaceUiSafetySource, /showSuccessAfterModalClose/);
assert.match(marketplaceUiSafetySource, /variant: 'success'/);

console.log('[vehicle-marketplace-ui-test] PASS', {
  featureFlagHidden: true,
  devFeatureEnabled: true,
  envFeatureEnabled: true,
  disabledMutationBlocked: true,
  responsiveWidth360: getMarketplaceCardWidth(360),
  dedupedListings: merged.length,
  structuredErrors: 4,
  authoritativeTruckAdded: reconciliation.trucks.length,
  createSheetKeyboardSafe: true,
  successDialogCopy: true,
});
