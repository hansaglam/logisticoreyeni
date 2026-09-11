/**
 * Rewarded ad build-profile matrix + production safety regression.
 * Run: npx tsx scripts/rewarded-ad-build-profile-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ADMOB_REWARDED_UNIT_IDS,
  GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS,
  isGoogleSampleAdMobUnitId,
} from '../src/config/adMobConstants';
import {
  validateInternalProfileEnv,
  validateStoreProductionEnv,
} from '../src/config/storeProductionPolicy';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function check(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }
  console.log(`  ✓ ${label}`);
}

console.log('\n=== Rewarded Ad Build Profile Regression ===\n');

console.log('Official Google test rewarded IDs (SDK TestIds.REWARDED)');
{
  check(
    GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios ===
      'ca-app-pub-3940256099942544/1712485313',
    '1. iOS DEV/INTERNAL expected Google rewarded test ID',
  );
  check(
    GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.android ===
      'ca-app-pub-3940256099942544/5224354917',
    '3. Android DEV/INTERNAL expected Google rewarded test ID',
  );
  const sdkTestIds = read('node_modules/react-native-google-mobile-ads/src/TestIds.ts');
  check(
    sdkTestIds.includes(GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios),
    'SDK TestIds.REWARDED includes iOS official test unit',
  );
  check(
    sdkTestIds.includes(GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.android),
    'SDK TestIds.REWARDED includes Android official test unit',
  );
}

console.log('\nProduction real IDs');
{
  check(
    ADMOB_REWARDED_UNIT_IDS.ios === 'ca-app-pub-8214453687597896/4313204541',
    '2. iOS production real rewarded unit',
  );
  check(
    ADMOB_REWARDED_UNIT_IDS.android === 'ca-app-pub-8214453687597896/1840898530',
    '4. Android production real rewarded unit',
  );
  check(!isGoogleSampleAdMobUnitId(ADMOB_REWARDED_UNIT_IDS.ios), 'iOS prod ≠ Google sample');
  check(
    !isGoogleSampleAdMobUnitId(ADMOB_REWARDED_UNIT_IDS.android),
    'Android prod ≠ Google sample',
  );
}

console.log('\nRuntime selection wiring');
{
  const adProvider = read('src/services/adProvider.ts');
  check(adProvider.includes('TestIds.REWARDED'), 'DEV/test path uses SDK TestIds.REWARDED');
  check(adProvider.includes('shouldUseTestAdUnitIds'), 'test-id gate consulted');
  check(adProvider.includes('getProductionRewardedAdUnitId'), 'production path uses real units');
  check(
    !adProvider.includes('GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios'),
    'no hardcoded iOS demo fallback in provider',
  );

  const adMob = read('src/config/adMob.ts');
  check(adMob.includes('EXPO_PUBLIC_ADS_USE_TEST_IDS'), 'Expo env participates');
  check(adMob.includes('LOGISTICORE_BUILD_PROFILE'), 'build profile participates');
  check(adMob.includes('isDevEnvironment'), '__DEV__ participates as fallback mode');
  check(
    adMob.includes('shouldShowTestAdLabel') && adMob.includes('return false'),
    'UI test label permanently disabled',
  );
}

console.log('\n5–6 Production rejects Google test / missing IDs');
{
  const baseEnv = {
    EXPO_PUBLIC_ADS_ENABLED: 'true',
    EXPO_PUBLIC_ADS_USE_TEST_IDS: 'false',
  };
  const googleTestErrors = validateStoreProductionEnv({
    env: baseEnv,
    adMobRewardedUnitIds: {
      ios: GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios,
      android: GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.android,
    },
  });
  check(
    googleTestErrors.some((e) => e.includes('sample/test')),
    '5. production rejects Google test rewarded IDs',
  );

  const missingErrors = validateStoreProductionEnv({
    env: baseEnv,
    adMobRewardedUnitIds: {
      ios: '',
      android: '',
    },
  });
  check(
    missingErrors.some((e) => e.includes('Missing/invalid production rewarded')),
    '6. production rejects missing rewarded IDs',
  );

  const useTestIdsErrors = validateStoreProductionEnv({
    env: { ...baseEnv, EXPO_PUBLIC_ADS_USE_TEST_IDS: 'true' },
  });
  check(
    useTestIdsErrors.some((e) => e.includes('EXPO_PUBLIC_ADS_USE_TEST_IDS')),
    'production rejects ADS_USE_TEST_IDS=true',
  );

  const healthy = validateStoreProductionEnv({ env: baseEnv });
  check(
    !healthy.some((e) => e.includes('rewarded') || e.includes('AdMob')),
    'healthy production constants pass AdMob checks',
  );
}

console.log('\nProfile matrix expectations');
{
  const internalErrors = validateInternalProfileEnv({
    EXPO_PUBLIC_ADS_ENABLED: 'true',
    EXPO_PUBLIC_ADS_USE_TEST_IDS: 'true',
    EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED: 'true',
    EXPO_PUBLIC_ENABLE_SEASONS: 'true',
    EXPO_PUBLIC_ENABLE_CHALLENGES: 'true',
    EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION: 'true',
    EXPO_PUBLIC_ENABLE_COMPANY_STATS: 'true',
    EXPO_PUBLIC_ENABLE_ACHIEVEMENTS: 'true',
    EXPO_PUBLIC_ENABLE_SEASON_HISTORY: 'true',
    EXPO_PUBLIC_ENABLE_INBOX: 'true',
    EXPO_PUBLIC_ENABLE_MARKET_ALERTS: 'true',
    EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER: 'true',
    EXPO_PUBLIC_ENABLE_V11_ANALYTICS: 'true',
  });
  check(internalErrors.length === 0, 'INTERNAL expects USE_TEST_IDS=true');

  const internalWithoutTest = validateInternalProfileEnv({
    EXPO_PUBLIC_ADS_ENABLED: 'true',
    EXPO_PUBLIC_ADS_USE_TEST_IDS: 'false',
    EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED: 'true',
    EXPO_PUBLIC_ENABLE_SEASONS: 'true',
    EXPO_PUBLIC_ENABLE_CHALLENGES: 'true',
    EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION: 'true',
    EXPO_PUBLIC_ENABLE_COMPANY_STATS: 'true',
    EXPO_PUBLIC_ENABLE_ACHIEVEMENTS: 'true',
    EXPO_PUBLIC_ENABLE_SEASON_HISTORY: 'true',
    EXPO_PUBLIC_ENABLE_INBOX: 'true',
    EXPO_PUBLIC_ENABLE_MARKET_ALERTS: 'true',
    EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER: 'true',
    EXPO_PUBLIC_ENABLE_V11_ANALYTICS: 'true',
  });
  check(
    internalWithoutTest.some((e) => e.includes('ADS_USE_TEST_IDS')),
    'INTERNAL without test IDs fails validation',
  );

  const envInternal = read('.env.internal');
  const envProduction = read('.env.production');
  check(
    /EXPO_PUBLIC_ADS_USE_TEST_IDS=true/.test(envInternal),
    'DEV/INTERNAL env file forces test IDs',
  );
  check(
    /EXPO_PUBLIC_ADS_USE_TEST_IDS=false/.test(envProduction),
    'PRODUCTION env file disables test IDs',
  );
}

console.log('\n7 No user-facing Test reklamı copy');
{
  const button = read('src/components/monetization/AdRewardButton.tsx');
  const daily = read('src/components/monetization/DashboardDailyOpsBonusCard.tsx');
  const boost = read('src/components/monetization/DeliveryBoostPanel.tsx');
  check(!/Test reklam/i.test(button), 'AdRewardButton has no Test reklam copy');
  check(!/Test reklam/i.test(daily), 'DailyOps card has no Test reklamı copy');
  check(!/Test reklam/i.test(boost), 'DeliveryBoost has no Test reklam copy');
  check(boost.includes('Reklam İzle'), 'DeliveryBoost keeps Reklam İzle');
}

console.log('\n8 Reward logic / test-device config');
{
  const adProvider = read('src/services/adProvider.ts');
  check(adProvider.includes('RewardedAdEventType.EARNED_REWARD'), 'reward callback unchanged');
  check(
    !/testDevice|addTestDevice|setRequestConfiguration\([^)]*testDevice/i.test(adProvider),
    'no AdMob testDeviceIdentifiers configured (SDK test units used instead)',
  );
}

console.log('\nPlacement production validation rejects samples');
{
  const placements = read('src/config/rewardedPlacements.ts');
  check(
    placements.includes('isGoogleSampleAdMobUnitId'),
    'placement production validator rejects Google samples',
  );
}

console.log('\niOS Release archive env gate');
{
  const applyScript = read('ios/scripts/apply-release-bundle-env.sh');
  const assertScript = read('scripts/assert-ios-release-ad-env.ts');
  const verifyArchive = read('scripts/verifyIosArchiveAdConfig.ts');
  const pbx = read('ios/LogistiCore.xcodeproj/project.pbxproj');
  const podfile = read('ios/Podfile');
  const appConfig = read('app.config.js');
  check(
    applyScript.includes('LOGISTICORE_BUILD_PROFILE=production'),
    '4. Release apply script forces production profile',
  );
  check(
    applyScript.includes('*Debug*'),
    'Debug path leaves profile for DEV/internal test ads',
  );
  check(
    assertScript.includes('EXPO_PUBLIC_ADS_USE_TEST_IDS') &&
      assertScript.includes('must be false'),
    '5. production + USE_TEST_IDS=true fails assert gate',
  );
  check(
    assertScript.includes('GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS') ||
      assertScript.includes('isGoogleSampleAdMobUnitId'),
    '6. production + Google test ID fails assert gate',
  );
  check(
    verifyArchive.includes('buildProfile') && verifyArchive.includes('useTestIds'),
    '7. archive verifier checks Expo embedded ads config',
  );
  check(
    pbx.includes('apply-release-bundle-env.sh'),
    'Xcode Bundle RN phase sources apply-release-bundle-env.sh',
  );
  check(
    /LOGISTICORE_BUILD_PROFILE = production/.test(pbx) &&
      /name = Release/.test(pbx),
    '1. Xcode Release configuration sets LOGISTICORE_BUILD_PROFILE=production',
  );
  check(
    /LOGISTICORE_BUILD_PROFILE = internal/.test(pbx),
    '6b. Xcode Debug configuration sets LOGISTICORE_BUILD_PROFILE=internal',
  );
  check(
    podfile.includes("LOGISTICORE_BUILD_PROFILE'] = 'production'") &&
      podfile.includes('pods_project.targets'),
    '2. Podfile post_install mirrors production profile onto Pods/EXConstants',
  );
  check(
    appConfig.includes('isXcodeIosReleaseBuildContext') &&
      appConfig.includes('requires LOGISTICORE_BUILD_PROFILE=production'),
    '7. Release missing profile cannot silently resolve internal',
  );
  check(
    !applyScript.includes('apply-production-ad-diagnostic-env.sh') &&
      !podfile.includes('.enable-production-ad-diagnostic') &&
      !assertScript.includes('LOGISTICORE_ALLOW_PRODUCTION_DIAGNOSTICS') &&
      !appConfig.includes('rewardedAdDiagnosticEnabled'),
    'production rewarded-ad diagnostic hatch fully removed',
  );
  check(
    !/EXPO_PUBLIC_ENABLE_REWARDED_AD_DIAGNOSTIC/.test(read('.env.production')),
    'committed production has no rewarded-ad diagnostic env key',
  );
  check(
    ADMOB_REWARDED_UNIT_IDS.android === 'ca-app-pub-8214453687597896/1840898530',
    '8. Android production rewarded unit unchanged',
  );
  check(
    ADMOB_REWARDED_UNIT_IDS.ios === 'ca-app-pub-8214453687597896/4313204541',
    '8b. production rewarded ID is real',
  );
  check(
    ADMOB_REWARDED_UNIT_IDS.ios !== GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS.ios,
    '9. Google test rewarded ID not active in production constants',
  );
}

console.log('\n✅ ALL PASS\n');
