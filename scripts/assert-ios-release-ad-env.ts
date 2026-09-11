/**
 * Fail-closed gate before iOS Release/Archive Metro embed.
 * Invoked from ios/scripts/apply-release-bundle-env.sh.
 *
 * Ensures store archives never bake EXPO_PUBLIC_ADS_USE_TEST_IDS=true
 * or Google sample rewarded unit IDs.
 */
import { resolve } from 'node:path';

import {
  ADMOB_REWARDED_UNIT_IDS,
  GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS,
  isGoogleSampleAdMobUnitId,
} from '../src/config/adMobConstants';
import { validateStoreProductionEnv } from '../src/config/storeProductionPolicy';
import { loadBuildProfileEnv } from './build-env';

const ROOT = resolve(__dirname, '..');

function fail(message: string): never {
  console.error(`[assert-ios-release-ad-env] FAIL: ${message}`);
  process.exit(1);
}

const profile = process.env.LOGISTICORE_BUILD_PROFILE?.trim().toLowerCase();
if (profile !== 'production') {
  fail(
    `LOGISTICORE_BUILD_PROFILE must be "production" for iOS Release/Archive (got "${profile ?? ''}")`,
  );
}

const env = loadBuildProfileEnv(ROOT, 'production');
env.LOGISTICORE_BUILD_PROFILE = 'production';

// Mirror into process.env so any subsequent Expo config read sees production.
for (const [key, value] of Object.entries(env)) {
  process.env[key] = value;
}
process.env.LOGISTICORE_BUILD_PROFILE = 'production';

const errors = validateStoreProductionEnv({ env });
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
  }
  fail('store production env validation failed');
}

if (env.EXPO_PUBLIC_ADS_USE_TEST_IDS === 'true') {
  fail('EXPO_PUBLIC_ADS_USE_TEST_IDS must be false for iOS store archive');
}

if (ADMOB_REWARDED_UNIT_IDS.ios === GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios) {
  fail('production iOS rewarded unit must not equal Google sample rewarded ID');
}

if (isGoogleSampleAdMobUnitId(ADMOB_REWARDED_UNIT_IDS.ios)) {
  fail(`production iOS rewarded unit is Google sample: ${ADMOB_REWARDED_UNIT_IDS.ios}`);
}

console.log('[assert-ios-release-ad-env] OK');
console.log('[assert-ios-release-ad-env] profile=production');
console.log('[assert-ios-release-ad-env] ADS_USE_TEST_IDS=', env.EXPO_PUBLIC_ADS_USE_TEST_IDS);
console.log('[assert-ios-release-ad-env] iosRewardedUnit=', ADMOB_REWARDED_UNIT_IDS.ios);
