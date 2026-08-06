/**
 * Rewarded ad visibility regression tests.
 * Run: npx tsx scripts/rewarded-ad-visibility-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  getRewardedPlacementConfig,
  placementToSlotId,
  validateProductionRewardedPlacementIds,
} from '../src/config/rewardedPlacements';
import { isAdsEnabled } from '../src/config/adMob';
import {
  eligibilityReasonToUserMessage,
  formatBoostDurationLabel,
  getDeliveryAdBoostEligibility,
} from '../src/simulation/deliveryAdBoost';
import { DELIVERY_AD_BOOST_MAX_USES } from '../src/config/deliveryAdBoost';
import type { Delivery, Truck } from '../src/types/game';
import {
  areAdsFeatureEnabled,
  getRewardedPlacementState,
} from '../src/services/adProvider';
import { getRewardedPlacementStatusMessage } from '../src/hooks/useRewardedPlacement';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery-map-1',
    contractId: 'contract-1',
    truckId: 'truck-1',
    driverId: 'driver-1',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
    productId: 'steel',
    amount: 10,
    distanceKm: 300,
    progress: 0.2,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 20,
    deadlineTime: 30,
    fuelCost: 100,
    fuelLitersAtStart: 200,
    fuelLitersTotal: 120,
    fuelConsumedL: 30,
    maintenanceCost: 0,
    estimatedProfit: 500,
    travelHours: 40,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    ...overrides,
  } as Delivery;
}

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-1',
    catalogId: 'truck-ford-cargo',
    name: 'Test Truck',
    status: 'on_route',
    currentFuelL: 150,
    fuelCapacityL: 200,
    currentCityId: 'izmir',
    ...overrides,
  } as Truck;
}

console.log('\n=== Rewarded Ad Visibility Regression ===\n');

console.log('Placement config');
{
  const deliveryAndroid = getRewardedPlacementConfig({
    placement: 'delivery_boost',
    platform: 'android',
    environment: 'internal',
  });
  const deliveryIos = getRewardedPlacementConfig({
    placement: 'delivery_boost',
    platform: 'ios',
    environment: 'internal',
  });
  const dailyAndroid = getRewardedPlacementConfig({
    placement: 'daily_operations',
    platform: 'android',
    environment: 'internal',
  });
  const dailyIos = getRewardedPlacementConfig({
    placement: 'daily_operations',
    platform: 'ios',
    environment: 'internal',
  });

  assert(deliveryAndroid.placement === 'delivery_boost', 'delivery boost placement android');
  assert(deliveryIos.placement === 'delivery_boost', 'delivery boost placement ios');
  assert(dailyAndroid.placement === 'daily_operations', 'daily operations placement android');
  assert(dailyIos.placement === 'daily_operations', 'daily operations placement ios');
  assert(deliveryAndroid.androidAdUnitId.includes('/'), 'delivery android unit id present');
  assert(deliveryIos.iosAdUnitId.includes('/'), 'delivery ios unit id present');
  assert(dailyAndroid.androidAdUnitId.includes('/'), 'daily android unit id present');
  assert(dailyIos.iosAdUnitId.includes('/'), 'daily ios unit id present');
  assert(
    getRewardedPlacementConfig({
      placement: 'daily_operations',
      environment: 'internal',
    }).useTestId === true,
    'internal test ID selection',
  );
  assert(placementToSlotId('daily_operations') === 'daily_ops_bonus', 'daily_operations slot mapping');
}

console.log('\nProduction ID validation');
{
  const prevProfile = process.env.LOGISTICORE_BUILD_PROFILE;
  const prevTestIds = process.env.EXPO_PUBLIC_ADS_USE_TEST_IDS;
  const prevAdsEnabled = process.env.EXPO_PUBLIC_ADS_ENABLED;
  const prevAdsMode = process.env.EXPO_PUBLIC_ADS_MODE;

  process.env.EXPO_PUBLIC_ADS_ENABLED = 'true';
  process.env.EXPO_PUBLIC_ADS_USE_TEST_IDS = 'false';
  process.env.EXPO_PUBLIC_ADS_MODE = 'production';
  process.env.LOGISTICORE_BUILD_PROFILE = 'production';

  const errors = validateProductionRewardedPlacementIds();
  assert(errors.length === 0, 'production placement IDs valid with defaults');

  process.env.EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_ANDROID_ID = 'invalid';
  const fallbackErrors = validateProductionRewardedPlacementIds();
  assert(
    fallbackErrors.length === 0,
    'invalid env ignored; bundled production IDs still validate',
  );

  process.env.EXPO_PUBLIC_ADS_ENABLED = 'false';
  assert(
    validateProductionRewardedPlacementIds().length === 0,
    'ads disabled skips production validation',
  );

  process.env.LOGISTICORE_BUILD_PROFILE = prevProfile;
  process.env.EXPO_PUBLIC_ADS_USE_TEST_IDS = prevTestIds;
  process.env.EXPO_PUBLIC_ADS_ENABLED = prevAdsEnabled;
  process.env.EXPO_PUBLIC_ADS_MODE = prevAdsMode;
  delete process.env.EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_ANDROID_ID;
}

console.log('\nFail-visible UI wiring');
{
  const deliveryBoostPanel = readFileSync('src/components/monetization/DeliveryBoostPanel.tsx', 'utf8');
  const adRewardButton = readFileSync('src/components/monetization/AdRewardButton.tsx', 'utf8');
  const dailyOpsCard = readFileSync('src/components/monetization/DashboardDailyOpsBonusCard.tsx', 'utf8');
  const mapCard = readFileSync('src/components/map/MapTruckTrackingCard.tsx', 'utf8');

  assert(deliveryBoostPanel.includes('areAdsFeatureEnabled'), 'DeliveryBoostPanel uses ads feature flag');
  assert(!deliveryBoostPanel.includes('isAdProviderAvailable()'), 'DeliveryBoostPanel no provider gate');
  assert(!deliveryBoostPanel.includes('return null;') || deliveryBoostPanel.includes('if (!adsFeatureEnabled)'), 'DeliveryBoostPanel only hides when ads disabled');
  assert(adRewardButton.includes('areAdsFeatureEnabled'), 'AdRewardButton uses ads feature flag');
  assert(!adRewardButton.includes('if (!providerAvailable)'), 'AdRewardButton no provider hide');
  assert(dailyOpsCard.includes('areAdsFeatureEnabled'), 'DailyOps card uses ads feature flag');
  assert(!dailyOpsCard.includes('isAdProviderAvailable()'), 'DailyOps card no provider hide');
  assert(mapCard.includes('DeliveryBoostPanel'), 'map card integrates delivery boost');
  assert(mapCard.includes('compact'), 'map card uses compact boost panel');
}

console.log('\nPlacement state messages');
{
  assert(
    getRewardedPlacementStatusMessage({ status: 'consent-required', placement: 'delivery_boost' }) === null,
    'consent-required handled by canonical privacy state (no duplicate placement message)',
  );
  assert(
    getRewardedPlacementStatusMessage({ status: 'loading', placement: 'delivery_boost' })?.includes(
      'hazırlanıyor',
    ) === true,
    'ad loading UI visible message',
  );
  assert(
    getRewardedPlacementStatusMessage({ status: 'no-fill', placement: 'delivery_boost' })?.includes(
      'uygun reklam',
    ) === true,
    'no-fill UI visible message',
  );
  assert(
    getRewardedPlacementStatusMessage({ status: 'network-error', placement: 'delivery_boost' })?.includes(
      'Bağlantı',
    ) === true,
    'network-error UI visible message',
  );
}

console.log('\nDelivery boost eligibility states');
{
  const delivery = makeDelivery();
  const truck = makeTruck();

  const eligible = getDeliveryAdBoostEligibility({
    delivery,
    truck,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(eligible.eligible === true, 'active delivery eligible when ad ready');

  const consentBlocked = getDeliveryAdBoostEligibility({
    delivery,
    truck,
    adState: { consentReady: false, adLoaded: false },
  });
  assert(consentBlocked.reason === 'consent-not-ready', 'consent-not-ready reason');
  assert(
    eligibilityReasonToUserMessage(consentBlocked).includes('Gizlilik Tercihini Tamamla'),
    'consent-not-ready UI message',
  );

  const adLoading = getDeliveryAdBoostEligibility({
    delivery,
    truck,
    adState: { consentReady: true, adLoaded: false },
  });
  assert(adLoading.reason === 'ad-not-ready', 'ad-not-ready reason');

  const limitReached = getDeliveryAdBoostEligibility({
    delivery: {
      ...delivery,
      deliveryAdBoost: { usedCount: DELIVERY_AD_BOOST_MAX_USES, totalReducedMs: 0, processedRewardIds: [] },
    },
    truck,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(limitReached.reason === 'limit-reached', 'limit reached reason');

  const incidentPending = getDeliveryAdBoostEligibility({
    delivery: {
      ...delivery,
      incident: { type: 'breakdown', status: 'pending' },
      incidentResolved: false,
    } as Delivery,
    truck,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(incidentPending.reason === 'incident-pending', 'incident pending reason');

  const inactive = getDeliveryAdBoostEligibility({
    delivery: { ...delivery, status: 'completed', progress: 1 },
    truck,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(inactive.reason === 'delivery-not-active', 'inactive delivery no boost action');
}

console.log('\nShared provider state');
{
  const deliveryState = getRewardedPlacementState('delivery_boost');
  const dailyState = getRewardedPlacementState('daily_operations');
  assert(deliveryState.placement === 'delivery_boost', 'delivery_boost placement state key');
  assert(dailyState.placement === 'daily_operations', 'daily_operations placement state key');
  assert(
    areAdsFeatureEnabled() === isAdsEnabled(),
    'ads enabled UI visible when feature enabled',
  );
}

console.log('\nReward flow guard');
{
  const adProvider = readFileSync('src/services/adProvider.ts', 'utf8');
  assert(adProvider.includes('RewardedAdEventType.EARNED_REWARD'), 'reward only on EARNED_REWARD');
  assert(adProvider.includes('preloadRewardedPlacement'), 'dismissed triggers preload');
  assert(adProvider.includes('preloadAllTrackedRewardedPlacements'), 'app init preload');
  assert(adProvider.includes('TRACKED_REWARDED_SLOTS'), 'per-placement tracking');
}

console.log('\nLayout');
{
  const mapCard = readFileSync('src/components/map/MapTruckTrackingCard.tsx', 'utf8');
  const deliveryBoostPanel = readFileSync('src/components/monetization/DeliveryBoostPanel.tsx', 'utf8');
  assert(mapCard.includes('minHeight: 44') || deliveryBoostPanel.includes('minHeight: 44'), '44px touch target');
  assert(
    deliveryBoostPanel.includes('numberOfLines={1}') ||
      deliveryBoostPanel.includes('numberOfLines={2}') ||
      deliveryBoostPanel.includes('numberOfLines={3}'),
    'layout text clamp',
  );
  assert(formatBoostDurationLabel(118 * 60_000).includes('sa'), 'duration label hours+minutes');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
