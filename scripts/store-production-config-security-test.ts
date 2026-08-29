/**
 * B-003 store production / internal profile security tests (headless).
 * Run: npx tsx scripts/store-production-config-security-test.ts
 */

import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadBuildProfileEnv } from './build-env';
import {
  validateInternalProfileEnv,
  validateStoreProductionEnv,
} from '../src/config/storeProductionPolicy';
import { canRequestAdsFromSnapshot } from '../src/services/adsConsentPolicy';

const ROOT = resolve(import.meta.dirname, '..');

function withEnv(
  base: Record<string, string>,
  patch: Record<string, string>,
): Record<string, string> {
  return { ...base, ...patch };
}

async function main() {
  const productionBase = loadBuildProfileEnv(ROOT, 'production');
  const internalBase = loadBuildProfileEnv(ROOT, 'internal');

  assert.equal(validateInternalProfileEnv(internalBase).length, 0);
  assert.equal(validateStoreProductionEnv({ env: productionBase }).length, 0);

  assert.ok(
    validateStoreProductionEnv({
      env: withEnv(productionBase, { EXPO_PUBLIC_ADS_USE_TEST_IDS: 'true' }),
    }).some((e) => e.includes('ADS_USE_TEST_IDS')),
    'production with test IDs fails',
  );

  assert.ok(
    validateStoreProductionEnv({
      env: withEnv(productionBase, { EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED: 'true' }),
    }).some((e) => e.includes('BACKEND_DIAGNOSTICS')),
    'production diagnostics true fails',
  );

  assert.ok(
    validateStoreProductionEnv({
      env: withEnv(productionBase, { EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC: 'true' }),
    }).some((e) => e.includes('ENABLE_TEST_MONEY_SYNC')),
    'production test money sync true fails',
  );

  assert.ok(
    validateStoreProductionEnv({
      env: withEnv(productionBase, { EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'localhost:9099' }),
    }).some((e) => e.includes('localhost')),
    'localhost config fails',
  );

  assert.ok(
    validateStoreProductionEnv({
      env: productionBase,
      adMobRewardedUnitIds: { android: '' },
    }).some((e) => e.includes('rewarded unit')),
    'missing AdMob rewarded unit fails',
  );

  const consentRequired = {
    gathered: true,
    canRequestAds: false,
    status: 'REQUIRED',
    error: null,
  };
  assert.equal(
    canRequestAdsFromSnapshot(consentRequired, true),
    false,
    'UMP required blocks ads',
  );

  const consentObtained = {
    gathered: true,
    canRequestAds: true,
    status: 'OBTAINED',
    error: null,
  };
  assert.equal(
    canRequestAdsFromSnapshot(consentObtained, true),
    true,
    'UMP obtained allows ads',
  );

  const consentError = {
    gathered: true,
    canRequestAds: false,
    status: 'ERROR',
    error: 'network',
  };
  assert.equal(
    canRequestAdsFromSnapshot(consentError, true),
    false,
    'UMP error blocks ads',
  );

  const appConfigSrc = readFileSync(resolve(ROOT, 'app.config.js'), 'utf8');
  const adProviderSrc = readFileSync(resolve(ROOT, 'src/services/adProvider.ts'), 'utf8');
  assert.doesNotMatch(appConfigSrc, /expo-tracking-transparency/);
  assert.doesNotMatch(appConfigSrc, /userTrackingUsageDescription/);
  assert.match(adProviderSrc, /Platform\.OS === 'ios'/);
  assert.match(adProviderSrc, /requestNonPersonalizedAdsOnly: true/);
  assert.match(adProviderSrc, /RewardedAdEventType\.EARNED_REWARD/);
  assert.match(adProviderSrc, /rewardGrantedForImpression/);
  assert.match(adProviderSrc, /canRequestAdsAfterConsent/);

  const backendSrc = readFileSync(resolve(ROOT, 'src/services/backendDiagnostics.ts'), 'utf8');
  assert.match(backendSrc, /isStoreProductionProfile/);

  console.log('[store-production-config-security-test]');
  console.log(
    JSON.stringify(
      {
        status: 'MITIGATED',
        internalProfilePasses: true,
        productionProfilePasses: true,
        productionTestIdsFails: true,
        productionDiagnosticsFails: true,
        missingAdMobRewardedUnitFails: true,
        umpRequiredBlocksAds: true,
        umpObtainedAllowsAds: true,
        umpErrorBlocksAds: true,
        iosNoTrackingAds: true,
        rewardedEarnedRewardOnly: true,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error('[store-production-config-security-test] FAILED', error);
  process.exitCode = 1;
});
