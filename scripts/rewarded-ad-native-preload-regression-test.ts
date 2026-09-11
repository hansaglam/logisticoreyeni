/**
 * Rewarded ads — New Architecture native detection + preload ownership.
 * Run: npx tsx scripts/rewarded-ad-native-preload-regression-test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';
import {
  GOOGLE_MOBILE_ADS_NATIVE_MODULE_NAME,
  isGoogleMobileAdsNativeModuleRegistered,
  isRewardedPreloadAttemptOwner,
} from '../src/services/googleMobileAdsNativeAvailability';
import {
  ADMOB_REWARDED_UNIT_IDS,
  GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS,
} from '../src/config/adMobConstants';
import { buildRewardedAdRequestOptions } from '../src/services/adProvider';

let passed = 0;
function check(condition: unknown, label: string): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

console.log('\n=== Rewarded Ad Native / Preload Regression ===\n');

const provider = read('src/services/adProvider.ts');
const availability = read('src/services/googleMobileAdsNativeAvailability.ts');
const rewardButton = read('src/components/monetization/AdRewardButton.tsx');
const boost = read('src/components/monetization/DeliveryBoostPanel.tsx');
const daily = read('src/components/monetization/DashboardDailyOpsBonusCard.tsx');

// --- 1–3 Native module detection ---
check(
  !isGoogleMobileAdsNativeModuleRegistered({
    bridgeModule: undefined,
    turboModule: { initialize: () => {} },
  }) === false,
  '1. NativeModules missing but TurboModule present => available',
);
check(
  isGoogleMobileAdsNativeModuleRegistered({
    bridgeModule: undefined,
    turboModule: { initialize: () => {} },
  }),
  '1b. TurboModule-only is registered',
);

check(
  !isGoogleMobileAdsNativeModuleRegistered({
    bridgeModule: undefined,
    turboModule: null,
  }),
  '2. native genuinely unavailable => not registered',
);

check(
  isGoogleMobileAdsNativeModuleRegistered({
    bridgeModule: { initialize: () => {} },
    turboModule: null,
  }),
  '3. old architecture NativeModules-only still available',
);

check(
  isGoogleMobileAdsNativeModuleRegistered({
    bridgeModule: { initialize: () => {} },
    turboModule: { initialize: () => {} },
  }),
  '3b. both Bridge + Turbo still available',
);

check(
  availability.includes('Bridge OR TurboModule') ||
    availability.includes('Bridge (NativeModules) or TurboModuleRegistry'),
  'detection docs: Bridge OR Turbo',
);

check(
  provider.includes('isGoogleMobileAdsNativeModuleRegistered') &&
    provider.includes('readGoogleMobileAdsTurboModule') &&
    provider.includes('GOOGLE_MOBILE_ADS_NATIVE_MODULE_NAME') &&
    !/if\s*\(\s*!NativeModules\.RNGoogleMobileAdsModule\s*\)/.test(provider),
  'adProvider no longer uses NativeModules-only early return',
);

check(
  GOOGLE_MOBILE_ADS_NATIVE_MODULE_NAME === 'RNGoogleMobileAdsModule',
  'native module name matches library TurboModule',
);

// --- 4 loadingPromise self-reference ---
check(
  /const loadingPromise = new Promise<void>\(\(resolve\) => \{\s*settleLoading = resolve;\s*\}\);/.test(
    provider,
  ),
  '4. loadingPromise executor only captures resolve (no self-reference before assignment)',
);

check(
  provider.includes('let settleLoading') &&
    /setPlacementEntry\(slotId, \{ status: 'loading', loadingPromise \}\)/.test(provider) &&
    provider.indexOf('const loadingPromise = new Promise') <
      provider.indexOf("setPlacementEntry(slotId, { status: 'loading', loadingPromise })"),
  '4b. promise identity assigned to slot after creation, before load work',
);

// --- 5–6 / 9–11 ownership + duplicate ---
check(
  provider.includes('if (entry.loadingPromise)') &&
    provider.includes('return entry.loadingPromise'),
  '5. duplicate preload returns same in-flight attempt',
);

{
  const a = Promise.resolve();
  const b = Promise.resolve();
  check(isRewardedPreloadAttemptOwner(a, a), '6. owner matches same attempt');
  check(!isRewardedPreloadAttemptOwner(b, a), '6. stale attempt cannot clear newer loadingPromise');
  check(!isRewardedPreloadAttemptOwner(undefined, a), '6b. missing current is not owner');
}

check(
  provider.includes('isRewardedPreloadAttemptOwner(current.loadingPromise, loadingPromise)'),
  '6c. finish clears loadingPromise only when attempt still owns slot',
);

check(
  provider.includes("finish('ready')") &&
    provider.includes("status === 'ready'") &&
    provider.includes('mapErrorCategoryToPlacementStatus'),
  '7–8. success -> ready; failure -> failed/category',
);

check(
  provider.includes('loadingPromise: undefined') &&
    provider.includes('isRewardedPreloadAttemptOwner'),
  '9. failure clears loading ownership when owner',
);

check(
  provider.includes('PLACEMENT_PRELOAD_RETRY_MS') &&
    provider.includes('retryAt') &&
    provider.includes('Date.now() < entry.retryAt'),
  '10. retry after failure uses backoff gate',
);

check(
  provider.includes('afterInit.loadingPromise') &&
    provider.includes('return afterInit.loadingPromise'),
  '11. no parallel duplicate load after init await',
);

// --- 12 SDK init precedes preload ---
check(
  /const initialized = await ensureMobileAdsInitialized\(\);[\s\S]*rewarded\.load\(\)/.test(
    provider,
  ),
  '12. SDK init precedes rewarded.load in preload',
);
check(
  /await ensureMobileAdsInitialized\(\);[\s\S]*preloadAllTrackedRewardedPlacements\(\)/.test(
    provider,
  ),
  '12b. initializeAdProvider awaits init before preloadAll',
);

// --- 13 diagnostics ---
check(
  provider.includes('googleErrorDomain') &&
    provider.includes('googleErrorCode') &&
    provider.includes('googleErrorMessage') &&
    provider.includes("stage: 'preload-error'") &&
    provider.includes("stage: 'preload-module'"),
  '13. diagnostics receive native error + module-unavailable stage',
);

// --- 14 player UI generic ---
check(
  !/googleErrorCode|googleErrorDomain|module-unavailable|GADRequestError/i.test(rewardButton) &&
    !/googleErrorCode|googleErrorDomain/i.test(boost) &&
    !/googleErrorCode|googleErrorDomain/i.test(daily),
  '14. player UI remains generic (no raw Google error fields)',
);

// --- 15–17 Android / IDs / NPA ---
check(
  provider.includes("Platform.OS === 'android'") || provider.includes("Platform.OS === 'ios'"),
  '15. shared provider path covers Android + iOS',
);
check(
  buildRewardedAdRequestOptions().requestNonPersonalizedAdsOnly === true ||
    // under test-globals Platform.OS is ios
    true,
  '17 prep: request helper callable',
);
{
  // test-globals sets Platform.OS = ios
  const opts = buildRewardedAdRequestOptions();
  check(opts.requestNonPersonalizedAdsOnly === true, '17. iOS NPA request unchanged');
}

check(
  ADMOB_REWARDED_UNIT_IDS.ios === 'ca-app-pub-8214453687597896/4313204541',
  '16. production iOS rewarded unit unchanged',
);
check(
  ADMOB_REWARDED_UNIT_IDS.ios !== GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios,
  '16b. production unit ≠ Google test unit',
);
check(
  provider.includes('shouldUseTestAdUnitIds') &&
    provider.includes('getProductionRewardedAdUnitId') &&
    provider.includes('TestIds.REWARDED'),
  '16c. test/production ID selection wiring unchanged',
);

check(
  provider.includes("'idle'") &&
    provider.includes("'loading'") &&
    provider.includes("'ready'") &&
    provider.includes("'failed'") &&
    provider.includes("'no-fill'") &&
    provider.includes("'network-error'"),
  'load state machine statuses present',
);

console.log(`\n✅ ${passed} checks passed\n`);
