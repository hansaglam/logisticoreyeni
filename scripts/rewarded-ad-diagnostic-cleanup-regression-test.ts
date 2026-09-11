/**
 * Assert rewarded-ad diagnostic UI + production hatch are fully removed.
 * Run: npx tsx scripts/rewarded-ad-diagnostic-cleanup-regression-test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';
import { validateStoreProductionEnv } from '../src/config/storeProductionPolicy';

let passed = 0;
function check(condition: unknown, label: string): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

console.log('\n=== Rewarded Ad Diagnostic Cleanup Regression ===\n');

const root = process.cwd();
check(
  !existsSync(resolve(root, 'src/screens/RewardedAdDiagnosticScreen.tsx')),
  'RewardedAdDiagnosticScreen deleted',
);
check(
  !existsSync(resolve(root, 'ios/scripts/apply-production-ad-diagnostic-env.sh')),
  'production diagnostic env script deleted',
);
check(
  !existsSync(resolve(root, 'ios/.enable-production-ad-diagnostic')),
  'diagnostic marker file absent',
);

const management = read('src/components/management/useManagementPanelData.ts');
const more = read('src/screens/MoreScreen.tsx');
const app = read('App.tsx');
const buildProfile = read('src/config/buildProfile.ts');
const provider = read('src/services/adProvider.ts');
const quickAccess = read('src/navigation/quickAccessTypes.ts');
const managementNav = read('src/navigation/managementNavigation.ts');
const applyRelease = read('ios/scripts/apply-release-bundle-env.sh');
const podfile = read('ios/Podfile');
const pbx = read('ios/LogistiCore.xcodeproj/project.pbxproj');
const iosGitignore = read('ios/.gitignore');
const appConfig = read('app.config.js');
const envProduction = read('.env.production');
const envExample = read('.env.example');

check(!management.includes('Ad Diagnostic'), 'management card removed');
check(!management.includes('adDiagnostic'), 'management adDiagnostic id removed');
check(!more.includes('RewardedAdDiagnosticScreen'), 'MoreScreen has no diagnostic screen');
check(!more.includes('ad-diagnostic'), 'MoreScreen has no diagnostic route');
check(!app.includes('adDiagnostic') && !app.includes('ad-diagnostic'), 'App navigation entry removed');
check(!quickAccess.includes('adDiagnostic'), 'quickAccess type cleaned');
check(!managementNav.includes('ad-diagnostic'), 'managementNavigation type cleaned');

check(
  !buildProfile.includes('isRewardedAdDiagnosticUiAllowed') &&
    !buildProfile.includes('isProductionRewardedAdDiagnosticMode') &&
    !buildProfile.includes('ENABLE_REWARDED_AD_DIAGNOSTIC'),
  'buildProfile diagnostic UI gates removed',
);

check(
  !provider.includes('retryRewardedLoadForDiagnostic') &&
    !provider.includes('subscribeRewardedLoadDiagnostic') &&
    !provider.includes('isRewardedAdDiagnosticUiAllowed'),
  'provider UI-only diagnostic APIs removed',
);

check(
  provider.includes('export type RewardedAdLoadDiagnostic') &&
    provider.includes('[rewarded-ad-failed]') &&
    provider.includes('getLastRewardedLoadDiagnostic'),
  'sanitized failure logging + in-memory snapshot preserved',
);

check(
  !applyRelease.includes('apply-production-ad-diagnostic') &&
    !podfile.includes('enable-production-ad-diagnostic') &&
    !pbx.includes('apply-production-ad-diagnostic') &&
    !iosGitignore.includes('enable-production-ad-diagnostic') &&
    !appConfig.includes('rewardedAdDiagnosticEnabled') &&
    !appConfig.includes('ENABLE_REWARDED_AD_DIAGNOSTIC') &&
    !envProduction.includes('ENABLE_REWARDED_AD_DIAGNOSTIC') &&
    !envExample.includes('ENABLE_REWARDED_AD_DIAGNOSTIC'),
  'production diagnostic hatch wiring fully removed',
);

check(
  validateStoreProductionEnv({
    env: {
      EXPO_PUBLIC_ADS_ENABLED: 'true',
      EXPO_PUBLIC_ADS_USE_TEST_IDS: 'false',
      EXPO_PUBLIC_ENABLE_REWARDED_AD_DIAGNOSTIC: 'true',
    },
  }).some((e) => e.includes('EXPO_PUBLIC_ENABLE_REWARDED_AD_DIAGNOSTIC')),
  'store policy rejects leftover diagnostic flag',
);

check(
  validateStoreProductionEnv({
    env: {
      EXPO_PUBLIC_ADS_ENABLED: 'true',
      EXPO_PUBLIC_ADS_USE_TEST_IDS: 'false',
      LOGISTICORE_ALLOW_PRODUCTION_DIAGNOSTICS: 'true',
    },
  }).some((e) => e.includes('LOGISTICORE_ALLOW_PRODUCTION_DIAGNOSTICS')),
  'store policy rejects leftover allow hatch',
);

check(
  provider.includes('isGoogleMobileAdsNativeModuleRegistered') &&
    provider.includes('isRewardedPreloadAttemptOwner') &&
    provider.includes('requestNonPersonalizedAdsOnly'),
  'core ad system fixes preserved',
);

console.log(`\n✅ ${passed} checks passed\n`);
