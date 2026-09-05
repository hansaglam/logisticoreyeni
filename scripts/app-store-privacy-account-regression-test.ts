/**
 * App Store privacy (iOS no UMP/no tracking + NPA ads) + account deletion regression.
 * Run: npx tsx scripts/app-store-privacy-account-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

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

  console.log('No-tracking ads policy');
  {
    const adProvider = read('src/services/adProvider.ts');
    const appConfig = read('app.config.js');
    check(
      adProvider.includes("Platform.OS === 'ios'") &&
        adProvider.includes('requestNonPersonalizedAdsOnly: true'),
      'iOS rewarded requests always use NPA',
    );
    check(adProvider.includes('buildRewardedAdRequestOptions'), 'rewarded requests use privacy-aware options');
    check(!appConfig.includes('expo-tracking-transparency'), 'expo-tracking-transparency removed from app config');
    check(
      !appConfig.includes('userTrackingUsageDescription') &&
        !appConfig.includes('userTrackingPermission'),
      'no ATT usage strings in app config',
    );
    check(
      !read('ios/LogistiCore/Info.plist').includes('NSUserTrackingUsageDescription'),
      'NSUserTrackingUsageDescription removed from Info.plist',
    );
    check(!read('package.json').includes('expo-tracking-transparency'), 'expo-tracking-transparency dependency removed');
  }

  console.log('\nCanonical ads init order');
  {
    const bootstrap = read('src/services/adsPrivacyBootstrap.ts');
    const consentService = read('src/services/adsConsentService.ts');
    const app = `${read('App.tsx')}\n${read('src/hooks/usePostStartupLifecycle.ts')}`;
    const consentIdx = bootstrap.lastIndexOf('await gatherAdsConsentIfNeeded()');
    const initIdx = bootstrap.lastIndexOf('await initializeAdProvider()');
    check(!bootstrap.includes('resolveAttBeforeAdsInitialization'), 'ATT bootstrap removed');
    check(!bootstrap.includes('applyAdTrackingConfiguration'), 'ATT tracking config removed');
    check(
      bootstrap.includes("Platform.OS === 'ios'") &&
        bootstrap.indexOf('prepareIosNonPersonalizedAdsState()') <
          bootstrap.indexOf('await initializeAdProvider()'),
      'iOS skips UMP and prepares NPA state before Mobile Ads init',
    );
    check(consentIdx >= 0 && consentIdx < initIdx, 'Android keeps UMP before Mobile Ads init');
    check(
      consentService.includes("!shouldUseGoogleUmpOnPlatform(Platform.OS)"),
      'iOS cannot obtain the native UMP module through the consent service',
    );
    check(
      consentService.includes("if (Platform.OS === 'ios')") &&
        consentService.includes("reason: 'not-required'"),
      'iOS privacy-options action fails closed without showing UMP UI',
    );
    check(app.includes('initializeAdsPrivacyStack'), 'App uses ads privacy bootstrap');
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
    check(
      deletion.includes('resolveAppleAuthorizationCodeForDeletion') &&
        read('backend/src/accountDeletion.ts').includes('ACCOUNT_DELETE_STAGE_APPLE_REVOKE'),
      'Apple revocation in deletion flow',
    );
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
