/**
 * App Store privacy (ATT/UMP) + account deletion regression.
 * Run: npx tsx scripts/app-store-privacy-account-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  __resetAttStateForTests,
  __setAttStatusForTests,
  getAttAdsPersonalizationMode,
  hasAttBootstrapCompleted,
  requestAttIfNeededForRewardedAd,
  shouldRequestNonPersonalizedAdsOnly,
} from '../src/services/attService';
import { mapAttStatusToPersonalization } from '../src/services/attPolicy';

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const read = (path: string) => readFileSync(path, 'utf8');

async function run(): Promise<void> {
  console.log('\n=== App Store Privacy + Account Deletion Regression ===\n');

  console.log('ATT policy mapping');
  {
    check(
      mapAttStatusToPersonalization('authorized', 'ios') === 'personalized',
      'authorized → personalized',
    );
    check(
      mapAttStatusToPersonalization('denied', 'ios') === 'non-personalized',
      'denied → non-personalized',
    );
    check(
      mapAttStatusToPersonalization('restricted', 'ios') === 'non-personalized',
      'restricted → non-personalized',
    );
    __setAttStatusForTests('denied');
    check(shouldRequestNonPersonalizedAdsOnly(), 'denied ATT → NPA flag');
    const adProvider = read('src/services/adProvider.ts');
    check(
      adProvider.includes('requestNonPersonalizedAdsOnly: true'),
      'denied ATT → ad request NPA option wired',
    );
    __setAttStatusForTests('authorized');
    check(!shouldRequestNonPersonalizedAdsOnly(), 'authorized ATT → personalized path');
    check(adProvider.includes('buildRewardedAdRequestOptions'), 'rewarded requests use ATT-aware options');
    __resetAttStateForTests();
  }

  console.log('\nATT bootstrap idempotency');
  {
    __setAttStatusForTests('denied');
    const first = await requestAttIfNeededForRewardedAd();
    const second = await requestAttIfNeededForRewardedAd();
    check(first === 'denied' && second === 'denied', 'rewarded ATT check does not re-prompt');
    check(hasAttBootstrapCompleted(), 'bootstrap marked complete');
    check(getAttAdsPersonalizationMode() === 'non-personalized', 'personalization mode latched');
    __resetAttStateForTests();
  }

  console.log('\nCanonical ads init order');
  {
    const bootstrap = read('src/services/adsPrivacyBootstrap.ts');
    const app = read('App.tsx');
    const attIdx = bootstrap.indexOf('await resolveAttBeforeAdsInitialization()');
    const trackingIdx = bootstrap.indexOf('await applyAdTrackingConfiguration()');
    const consentIdx = bootstrap.lastIndexOf('await gatherAdsConsentIfNeeded()');
    const initIdx = bootstrap.indexOf('await initializeAdProvider()');
    check(attIdx >= 0 && attIdx < consentIdx, 'ATT before UMP in bootstrap');
    check(trackingIdx >= 0 && trackingIdx < consentIdx, 'tracking config before UMP');
    check(consentIdx >= 0 && consentIdx < initIdx, 'UMP before Mobile Ads init');
    check(app.includes('initializeAdsPrivacyStack'), 'App uses ads privacy bootstrap');
    check(
      read('app.config.js').includes('NSUserTrackingUsageDescription') ||
        read('app.config.js').includes('userTrackingPermission'),
      'NSUserTrackingUsageDescription configured',
    );
  }

  console.log('\nAccount deletion discoverability');
  {
    const connectionTab = read('src/components/accountCenter/AccountConnectionTab.tsx');
    const accountScreen = read('src/screens/AccountCenterScreen.tsx');
    const deletion = read('src/utils/accountDeletion.ts');
    const backend = read('backend/src/index.ts');
    check(connectionTab.includes('Hesap ve Gizlilik'), 'account tab privacy section title');
    check(connectionTab.includes('Hesabı Sil'), 'delete CTA on account tab');
    check(accountScreen.includes('onDeleteAccount={vm.handleDeleteAccount}'), 'screen wires delete handler');
    check(!read('src/components/accountCenter/AccountPreferencesTab.tsx').includes('DangerZoneCard'), 'delete not hidden in collapsed danger zone');
    check(deletion.includes('revokeAppleSignInIfNeeded'), 'Apple revocation in deletion flow');
    check(deletion.includes("provider === 'guest'"), 'guest accounts skip cloud callable');
    check(backend.includes('revokeAppleSignInTokens'), 'backend Apple revoke callable');
    check(backend.includes('prepareVehicleMarketplaceAccountDeletion'), 'marketplace cleanup callable retained');
  }

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
}

void run();
