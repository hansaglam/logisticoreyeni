/**
 * Apple 5.1.2(i): iOS must never invoke or expose Google UMP consent UI.
 * Run: npx tsx scripts/ios-ump-removal-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createIosNonPersonalizedAdsSnapshot,
  shouldUseGoogleUmpOnPlatform,
} from '../src/services/adsConsentPolicy';
import { shouldShowAccountPrivacyOptions } from '../src/domain/adPrivacyState';

const read = (path: string) => readFileSync(path, 'utf8');

const consentService = read('src/services/adsConsentService.ts');
const bootstrap = read('src/services/adsPrivacyBootstrap.ts');
const adProvider = read('src/services/adProvider.ts');
const accountScreen = read('src/screens/AccountCenterScreen.tsx');
const accountPreferences = read('src/components/accountCenter/AccountPreferencesTab.tsx');
const appConfig = read('app.config.js');
const packageJson = read('package.json');
const infoPlist = read('ios/LogistiCore/Info.plist');
const podfileLock = read('ios/Podfile.lock');

assert.equal(shouldUseGoogleUmpOnPlatform('ios'), false, 'iOS UMP policy disabled');
assert.equal(shouldUseGoogleUmpOnPlatform('android'), true, 'Android UMP policy unchanged');

const iosState = createIosNonPersonalizedAdsSnapshot(true);
assert.equal(iosState.gathered, true);
assert.equal(iosState.canRequestAds, true);
assert.equal(iosState.status, 'IOS_NPA_ONLY');
assert.equal(iosState.privacyOptionsRequirementStatus, 'NOT_REQUIRED');
assert.equal(iosState.errorCategory, 'none');

assert.equal(
  shouldShowAccountPrivacyOptions(
    {
      ...iosState,
      privacyOptionsRequirementStatus: 'REQUIRED',
    },
    'ios',
  ),
  false,
  'iOS cannot expose UMP privacy-options UI even with stale REQUIRED state',
);
assert.equal(
  shouldShowAccountPrivacyOptions(
    {
      ...iosState,
      privacyOptionsRequirementStatus: 'REQUIRED',
    },
    'android',
  ),
  true,
  'Android privacy-options behavior remains available',
);

assert.match(
  consentService,
  /if \(!isSupportedPlatform\(\) \|\| !shouldUseGoogleUmpOnPlatform\(Platform\.OS\)\)/,
  'native AdsConsent module is unreachable on iOS',
);
assert.match(
  consentService,
  /export async function gatherAdsConsentIfNeeded[\s\S]*?if \(Platform\.OS === 'ios'\) \{\s*return prepareIosNonPersonalizedAdsState\(\);/,
  'iOS gather path returns before AdsConsent.gatherConsent',
);
assert.match(
  consentService,
  /export async function openAccountPrivacyOptions[\s\S]*?if \(Platform\.OS === 'ios'\)[\s\S]*?reason: 'not-required'/,
  'iOS privacy-options path returns before requestInfoUpdate/showPrivacyOptionsForm',
);
assert.match(
  bootstrap,
  /if \(Platform\.OS === 'ios'\)[\s\S]*?prepareIosNonPersonalizedAdsState\(\)[\s\S]*?await initializeAdProvider\(\)/,
  'iOS bootstrap is NPA state → Mobile Ads initialization',
);
assert.ok(
  bootstrap.indexOf("if (Platform.OS === 'ios')") <
    bootstrap.lastIndexOf('await gatherAdsConsentIfNeeded()'),
  'iOS bootstrap exits before Android UMP call site',
);
assert.match(
  accountScreen,
  /shouldShowAccountPrivacyOptions\([\s\S]*?Platform\.OS/,
  'Account Center privacy-options UI is platform-gated',
);
assert.match(
  accountScreen,
  /adsPrivacyOptionsSupported=\{Platform\.OS === 'android'\}/,
  'Account Center enables the UMP settings row only on Android',
);
assert.match(
  accountPreferences,
  /\{adsPrivacyOptionsSupported \? \(/,
  'iOS renders no UMP privacy-options or consent status row',
);

assert.match(adProvider, /Platform\.OS === 'ios'[\s\S]*?requestNonPersonalizedAdsOnly: true/);
assert.equal(appConfig.includes('expo-tracking-transparency'), false);
assert.equal(appConfig.includes('userTrackingUsageDescription'), false);
assert.equal(packageJson.includes('expo-tracking-transparency'), false);
assert.equal(infoPlist.includes('NSUserTrackingUsageDescription'), false);
assert.equal(podfileLock.includes('ExpoTrackingTransparency'), false);

console.log('ios-ump-removal-regression-test: PASSED');
