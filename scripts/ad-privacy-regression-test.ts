/**
 * Ad privacy / rewarded consent regression tests.
 * Run: npx tsx scripts/ad-privacy-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  AD_PRIVACY_CHECKING_LABEL,
  AD_PRIVACY_NOT_REQUIRED_MESSAGE,
  AD_REWARDED_UNAVAILABLE_MESSAGE,
  resolveAdPrivacyAvailability,
  resolveAdPrivacyState,
  shouldShowAccountPrivacyOptions,
} from '../src/domain/adPrivacyState';
import {
  resolveRewardedAdAvailability,
  rewardedAdAvailabilityHelperText,
  rewardedAdAvailabilityToButtonLabel,
  shouldEnableRewardedAdCta,
} from '../src/domain/rewardedAdAvailability';
import {
  classifyConsentError,
  createTestAdsConsentSnapshot,
  isPublisherMisconfigurationError,
  maskAdMobAppId,
} from '../src/services/adsConsentPolicy';
import {
  __resetAdsConsentTestState,
  __setAdsConsentSnapshotForTests,
  getAdsConsentSnapshot,
  handleRewardedAdRequest,
} from '../src/services/adsConsentService';
import { getRewardedPlacementStatusMessage } from '../src/hooks/useRewardedPlacement';

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const publisherError =
  "Failed to read publisher's account configuration; no form(s) configured for the input app ID.";

async function run(): Promise<void> {
  console.log('\n=== Ad Privacy Regression ===\n');

  console.log('Canonical privacy state');
  {
    const loading = resolveAdPrivacyAvailability(
      createTestAdsConsentSnapshot({ gathered: false }),
      true,
    );
    check(loading.status === 'loading', 'loading → loading availability');
    check(
      rewardedAdAvailabilityToButtonLabel(
        resolveRewardedAdAvailability({ privacy: loading, placementStatus: 'idle' }),
      ) === AD_PRIVACY_CHECKING_LABEL,
      'privacy loading → checking label',
    );

    const notRequired = resolveAdPrivacyAvailability(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: true,
        status: 'NOT_REQUIRED',
      }),
      true,
    );
    check(notRequired.status === 'ready', 'consent not required → ready');
    check(
      resolveRewardedAdAvailability({
        privacy: notRequired,
        placementStatus: 'idle',
        isOnline: true,
      }) === 'loading-ad',
      'consent not required → rewarded preload state',
    );

    const required = resolveAdPrivacyAvailability(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: false,
        status: 'REQUIRED',
      }),
      true,
    );
    check(required.status === 'consent-required', 'consent required → consent-required');
    const requiredAvailability = resolveRewardedAdAvailability({
      privacy: required,
      placementStatus: 'idle',
    });
    check(requiredAvailability === 'loading-ad', 'consent required → ad preload (not privacy CTA)');
    check(
      !rewardedAdAvailabilityToButtonLabel(requiredAvailability).toLowerCase().includes('gizlilik tercih'),
      'consent required → no privacy settings label',
    );

    const ready = resolveAdPrivacyAvailability(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: true,
        status: 'OBTAINED',
      }),
      true,
    );
    check(ready.status === 'ready', 'consent obtained → ready');

    const configError = resolveAdPrivacyAvailability(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: false,
        status: 'ERROR',
        error: publisherError,
        errorCategory: 'publisher-misconfiguration',
      }),
      true,
    );
    check(configError.status === 'config-error', 'publisher misconfiguration → config-error');
    check(
      resolveAdPrivacyState(
        createTestAdsConsentSnapshot({
          gathered: true,
          canRequestAds: false,
          status: 'ERROR',
          error: publisherError,
          errorCategory: 'publisher-misconfiguration',
        }),
        true,
      ) === 'config-error',
      'config-error state distinct from blocked',
    );

    const networkError = resolveAdPrivacyAvailability(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: false,
        status: 'ERROR',
        error: 'network timeout',
        errorCategory: 'network',
      }),
      true,
    );
    check(networkError.status === 'blocked', 'network error → blocked (retryable)');
  }

  console.log('\nPublisher misconfiguration mapping');
  {
    check(
      isPublisherMisconfigurationError(publisherError),
      'detects publisher misconfiguration message',
    );
    check(
      classifyConsentError(publisherError) === 'publisher-misconfiguration',
      'classifies as publisher-misconfiguration',
    );
    check(
      maskAdMobAppId('ca-app-pub-8214453687597896~5560651696').includes('…'),
      'masks app id in logs',
    );
    check(
      maskAdMobAppId('ca-app-pub-8214453687597896~5560651696') !==
        'ca-app-pub-8214453687597896~5560651696',
      'does not log raw app id',
    );
  }

  console.log('\nRewarded availability priority');
  {
    const privacyLoading = { status: 'loading' as const };
    check(
      resolveRewardedAdAvailability({
        privacy: privacyLoading,
        placementStatus: 'ready',
        isOnline: false,
      }) === 'privacy-loading',
      'privacy-loading beats offline',
    );

    const consentRequired = { status: 'consent-required' as const };
    check(
      resolveRewardedAdAvailability({
        privacy: consentRequired,
        placementStatus: 'idle',
        isOnline: true,
      }) === 'loading-ad',
      'consent-required proceeds to ad loading (not privacy CTA)',
    );

    const configErr = { status: 'config-error' as const };
    check(
      resolveRewardedAdAvailability({
        privacy: configErr,
        placementStatus: 'ready',
        isOnline: true,
      }) === 'unavailable',
      'config-error → unavailable',
    );

    const readyPrivacy = { status: 'ready' as const, canRequestAds: true as const };
    check(
      resolveRewardedAdAvailability({
        privacy: readyPrivacy,
        placementStatus: 'ready',
        isOnline: false,
      }) === 'offline',
      'offline after privacy ready',
    );

    check(
      resolveRewardedAdAvailability({
        privacy: readyPrivacy,
        placementStatus: 'ready',
        isOnline: true,
      }) === 'ready',
      'ready ad when privacy + placement ready',
    );
  }

  console.log('\nAccount privacy options visibility');
  {
    check(
      shouldShowAccountPrivacyOptions(
        createTestAdsConsentSnapshot({
          gathered: true,
          canRequestAds: true,
          status: 'OBTAINED',
          privacyOptionsRequirementStatus: 'REQUIRED',
        }),
      ),
      'shows privacy options when REQUIRED',
    );
    check(
      !shouldShowAccountPrivacyOptions(
        createTestAdsConsentSnapshot({
          gathered: true,
          canRequestAds: true,
          status: 'NOT_REQUIRED',
          privacyOptionsRequirementStatus: 'NOT_REQUIRED',
        }),
      ),
      'hides privacy options when NOT_REQUIRED',
    );
    check(
      AD_PRIVACY_NOT_REQUIRED_MESSAGE.includes('gerekmiyor'),
      'not-required copy present',
    );
  }

  console.log('\nhandleRewardedAdRequest');
  {
    __resetAdsConsentTestState();

    __setAdsConsentSnapshotForTests(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: true,
        status: 'NOT_REQUIRED',
        privacyOptionsRequirementStatus: 'NOT_REQUIRED',
      }),
    );
    const allowedResult = await handleRewardedAdRequest();
    check(allowedResult.allowed === true, 'canRequestAds true → allowed without privacy form');

    __setAdsConsentSnapshotForTests(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: false,
        status: 'ERROR',
        error: publisherError,
        errorCategory: 'publisher-misconfiguration',
      }),
    );
    const configResult = await handleRewardedAdRequest();
    check(configResult.allowed === false, 'config error → not allowed');
    check(
      !configResult.allowed && configResult.userMessage === AD_REWARDED_UNAVAILABLE_MESSAGE,
      'config error → user-friendly unavailable message',
    );
    check(
      !configResult.allowed && configResult.reason === 'config-error',
      'config error reason typed',
    );

    const latchedResult = await handleRewardedAdRequest();
    check(
      !latchedResult.allowed && latchedResult.reason === 'config-error',
      'config error latched — no retry loop',
    );

    __resetAdsConsentTestState();
  }

  console.log('\nCTA wiring (rewarded vs account privacy)');
  {
    const adRewardButton = readFileSync('src/components/monetization/AdRewardButton.tsx', 'utf8');
    const dailyOps = readFileSync('src/components/monetization/DashboardDailyOpsBonusCard.tsx', 'utf8');
    const deliveryBoost = readFileSync('src/components/monetization/DeliveryBoostPanel.tsx', 'utf8');
    const accountCenter = readFileSync('src/screens/AccountCenterScreen.tsx', 'utf8');
    const accountPrefs = readFileSync('src/components/accountCenter/AccountPreferencesTab.tsx', 'utf8');

    check(
      adRewardButton.includes('ensureAdsAllowedForReward'),
      'AdRewardButton uses rewarded privacy gate',
    );
    check(!adRewardButton.includes('runPrivacyAction'), 'AdRewardButton does not open privacy settings');
    check(dailyOps.includes('ensureAdsAllowedForReward'), 'DailyOps uses rewarded privacy gate');
    check(!dailyOps.includes('Gizlilik tercihleri açıl'), 'DailyOps removed technical privacy error');
    check(
      deliveryBoost.includes('ensureAdsAllowedForReward'),
      'DeliveryBoost uses rewarded privacy gate',
    );
    check(
      accountCenter.includes('useAccountPrivacyOptions'),
      'AccountCenter uses account privacy options',
    );
    check(accountPrefs.includes('showPrivacyOptions'), 'Account prefs conditional privacy row');
    check(
      getRewardedPlacementStatusMessage({
        status: 'consent-required',
        placement: 'delivery_boost',
      }) === null,
      'placement consent-required message suppressed',
    );
  }

  console.log('\nConsent refresh + stale state');
  {
    __setAdsConsentSnapshotForTests(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: false,
        status: 'REQUIRED',
      }),
    );
    check(getAdsConsentSnapshot().canRequestAds === false, 'snapshot starts blocked');

    __setAdsConsentSnapshotForTests(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: true,
        status: 'OBTAINED',
      }),
    );
    check(
      getAdsConsentSnapshot().canRequestAds === true,
      'snapshot refresh clears stale privacy-required',
    );

    const stillBlocked = resolveAdPrivacyAvailability(
      createTestAdsConsentSnapshot({
        gathered: true,
        canRequestAds: false,
        status: 'REQUIRED',
      }),
      true,
    );
    check(
      stillBlocked.status === 'consent-required',
      'consent-required kept when canRequestAds false',
    );
    __resetAdsConsentTestState();
  }

  console.log('\nCTA enablement + copy');
  {
    check(!shouldEnableRewardedAdCta('privacy-loading'), 'privacy loading CTA disabled');
    check(shouldEnableRewardedAdCta('ready'), 'ready CTA enabled');
    check(shouldEnableRewardedAdCta('unavailable'), 'unavailable CTA enabled for retry');
    check(
      rewardedAdAvailabilityHelperText('offline')?.includes('internet'),
      'offline helper text',
    );
    check(
      AD_REWARDED_UNAVAILABLE_MESSAGE.includes('kullanılamıyor'),
      'unavailable user copy',
    );
  }

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) {
    process.exit(1);
  }
}

void run();
