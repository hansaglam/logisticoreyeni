/**
 * AdMob config audit — App ID / Unit ID / native wiring (no RN runtime).
 * Run: npx tsx scripts/ads-config-test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ANDROID_APP_ID = 'ca-app-pub-8214453687597896~5560651696';
const IOS_APP_ID = 'ca-app-pub-8214453687597896~4247570027';
const ANDROID_UNIT = 'ca-app-pub-8214453687597896/1840898530';
const IOS_UNIT = 'ca-app-pub-8214453687597896/4313204541';

const APP_ID_RE = /^ca-app-pub-\d+~\d+$/;
const UNIT_ID_RE = /^ca-app-pub-\d+\/\d+$/;

console.log('\n=== Ads Config Test ===\n');

assert.match(ANDROID_APP_ID, APP_ID_RE, 'android app id format');
assert.match(IOS_APP_ID, APP_ID_RE, 'ios app id format');
assert.match(ANDROID_UNIT, UNIT_ID_RE, 'android unit id format');
assert.match(IOS_UNIT, UNIT_ID_RE, 'ios unit id format');
assert.notEqual(ANDROID_APP_ID, ANDROID_UNIT, 'app id ≠ unit id');

const root = resolve(__dirname, '..');
const adMobSrc = readFileSync(resolve(root, 'src/config/adMob.ts'), 'utf8');
const adMobConstantsSrc = readFileSync(resolve(root, 'src/config/adMobConstants.ts'), 'utf8');
assert.ok(adMobConstantsSrc.includes(ANDROID_APP_ID), 'adMobConstants.ts android app id');
assert.ok(adMobConstantsSrc.includes(IOS_APP_ID), 'adMobConstants.ts ios app id');
assert.ok(adMobConstantsSrc.includes(ANDROID_UNIT), 'adMobConstants.ts android unit');
assert.ok(adMobConstantsSrc.includes(IOS_UNIT), 'adMobConstants.ts ios unit');
assert.ok(adMobSrc.includes("from './adMobConstants'"), 'adMob.ts re-exports constants');
assert.ok(adMobSrc.includes('EXPO_PUBLIC_ADS_USE_TEST_IDS'), 'test ids flag');
assert.ok(adMobSrc.includes('EXPO_PUBLIC_ADS_ENABLED'), 'ads enabled flag');

const appConfig = readFileSync(resolve(root, 'app.config.js'), 'utf8');
assert.match(appConfig, /react-native-google-mobile-ads/, 'config plugin present');
assert.match(appConfig, /androidAppId:\s*'ca-app-pub-/, 'plugin androidAppId');
assert.match(appConfig, /iosAppId:\s*'ca-app-pub-/, 'plugin iosAppId');
assert.match(appConfig, /useTestIds/, 'extra.ads.useTestIds wired');
assert.ok(appConfig.includes(ANDROID_APP_ID), 'plugin androidAppId value');
assert.ok(appConfig.includes(IOS_APP_ID), 'plugin iosAppId value');

const manifest = readFileSync(
  resolve(root, 'android/app/src/main/AndroidManifest.xml'),
  'utf8',
);
assert.match(
  manifest,
  /com\.google\.android\.gms\.ads\.APPLICATION_ID/,
  'Android APPLICATION_ID metadata',
);
assert.match(manifest, /ACCESS_NETWORK_STATE/, 'ACCESS_NETWORK_STATE permission');
assert.ok(manifest.includes(ANDROID_APP_ID), 'manifest app id value');

const adProvider = readFileSync(resolve(root, 'src/services/adProvider.ts'), 'utf8');
assert.ok(
  adProvider.includes('.initialize()') && adProvider.includes('ensureMobileAdsInitialized'),
  'SDK initialize',
);
assert.ok(adProvider.includes('RewardedAdEventType.EARNED_REWARD'), 'earned reward gate');
assert.ok(adProvider.includes('rewardGrantedForImpression'), 'idempotency guard');
assert.ok(adProvider.includes('TestIds.REWARDED'), 'Google test rewarded id');
assert.ok(adProvider.includes('[ads-sdk-init]'), 'init log');
assert.ok(adProvider.includes('[rewarded-ad-failed]'), 'failure log');

const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');
assert.ok(envExample.includes('EXPO_PUBLIC_ADS_USE_TEST_IDS'), '.env.example test flag');
assert.ok(envExample.includes('EXPO_PUBLIC_ADS_ENABLED'), '.env.example enabled flag');

console.log('  ✓ App ID / Unit ID formats');
console.log('  ✓ adMobConstants.ts + adMob.ts re-export');
console.log('  ✓ AndroidManifest APPLICATION_ID + NETWORK_STATE');
console.log('  ✓ adProvider init / lifecycle / test IDs');
console.log('  ✓ .env.example flags');
console.log('\n✅ ALL PASS\n');
