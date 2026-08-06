/**
 * Ad privacy / rewarded consent regression tests.
 * Run: npx tsx scripts/ad-privacy-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AD_PRIVACY_ACTION_CTA,
  AD_PRIVACY_ACTION_DESCRIPTION,
  AD_PRIVACY_ERROR_MESSAGE,
  AD_PRIVACY_LOADING_LABEL,
  resolveAdPrivacyAvailability,
  resolveAdPrivacyState,
} from '../src/domain/adPrivacyState';
import {
  resolveRewardedAdAvailability,
  rewardedAdAvailabilityHelperText,
  rewardedAdAvailabilityToButtonLabel,
  shouldEnableRewardedAdCta,
} from '../src/domain/rewardedAdAvailability';
import {
  __setAdsConsentSnapshotForTests,
  getAdsConsentSnapshot,
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

console.log('\n=== Ad Privacy Regression ===\n');

console.log('Canonical privacy state');
{
  const loading = resolveAdPrivacyAvailability(
    { gathered: false, canRequestAds: false, status: null, error: null },
    true,
  );
  check(loading.status === 'loading', 'loading → loading availability');
  check(
    rewardedAdAvailabilityToButtonLabel(
      resolveRewardedAdAvailability({ privacy: loading, placementStatus: 'idle' }),
    ) === AD_PRIVACY_LOADING_LABEL,
    'privacy loading → preparing text',
  );

  const notRequired = resolveAdPrivacyAvailability(
    { gathered: true, canRequestAds: true, status: 'NOT_REQUIRED', error: null },
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
    { gathered: true, canRequestAds: false, status: 'REQUIRED', error: null },
    true,
  );
  check(required.status === 'action-required', 'consent required → action-required');
  check(
    rewardedAdAvailabilityToButtonLabel(
      resolveRewardedAdAvailability({ privacy: required, placementStatus: 'idle' }),
    ) === AD_PRIVACY_ACTION_CTA,
    'consent required → action CTA label',
  );

  const ready = resolveAdPrivacyAvailability(
    { gathered: true, canRequestAds: true, status: 'OBTAINED', error: null },
    true,
  );
  check(ready.status === 'ready', 'consent obtained → ready');

  const error = resolveAdPrivacyAvailability(
    { gathered: true, canRequestAds: false, status: 'ERROR', error: 'boom' },
    true,
  );
  check(error.status === 'error', 'consent error → error (not action-required)');
  check(
    resolveAdPrivacyState(
      { gathered: true, canRequestAds: false, status: 'ERROR', error: 'boom' },
      true,
    ) === 'error',
    'consent error state is error',
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

  const actionRequired = { status: 'action-required' as const, action: 'open-privacy-options' as const };
  check(
    resolveRewardedAdAvailability({
      privacy: actionRequired,
      placementStatus: 'ready',
      isOnline: false,
    }) === 'privacy-action-required',
    'privacy-action-required beats offline',
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

  check(
    resolveRewardedAdAvailability({
      privacy: readyPrivacy,
      placementStatus: 'loading',
      isOnline: true,
    }) === 'loading-ad',
    'loading-ad when placement loading',
  );
}

console.log('\nDuplicate warning prevention');
{
  const actionRequired = { status: 'action-required' as const, action: 'open-privacy-options' as const };
  const availability = resolveRewardedAdAvailability({
    privacy: actionRequired,
    placementStatus: 'consent-required',
  });
  check(availability === 'privacy-action-required', 'placement consent-required maps to privacy action');
  check(
    getRewardedPlacementStatusMessage({ status: 'consent-required', placement: 'delivery_boost' }) === null,
    'placement message suppressed for consent-required',
  );
  check(
    rewardedAdAvailabilityHelperText('privacy-action-required') === null,
    'helper text null for privacy-action-required (description shown once)',
  );
  check(
    AD_PRIVACY_ACTION_DESCRIPTION.includes('gizlilik'),
    'single canonical description present',
  );
}

console.log('\nCTA enablement + handlers');
{
  check(shouldEnableRewardedAdCta('privacy-action-required'), 'privacy CTA enabled');
  check(shouldEnableRewardedAdCta('privacy-error'), 'privacy error CTA enabled for retry');
  check(!shouldEnableRewardedAdCta('privacy-loading'), 'privacy loading CTA disabled');

  const adRewardButton = readFileSync('src/components/monetization/AdRewardButton.tsx', 'utf8');
  const dailyOps = readFileSync('src/components/monetization/DashboardDailyOpsBonusCard.tsx', 'utf8');
  const deliveryBoost = readFileSync('src/components/monetization/DeliveryBoostPanel.tsx', 'utf8');
  const accountCenter = readFileSync('src/screens/AccountCenterScreen.tsx', 'utf8');

  check(adRewardButton.includes('runPrivacyAction'), 'AdRewardButton privacy handler wired');
  check(dailyOps.includes('runPrivacyAction'), 'DailyOps card privacy handler wired');
  check(deliveryBoost.includes('runPrivacyAction'), 'DeliveryBoostPanel privacy handler wired');
  check(accountCenter.includes('useAdPrivacyAction'), 'AccountCenter uses canonical privacy handler');
  check(accountCenter.includes('completeAdPrivacyAction') === false, 'AccountCenter does not call raw form directly');

  check(
    !dailyOps.includes('Gizlilik tercihi gerekli'),
    'DailyOps removed legacy duplicate CTA copy',
  );
  check(
    deliveryBoost.includes('stopPropagation'),
    'DeliveryBoostPanel guards parent navigation',
  );
}

console.log('\nConsent refresh + stale state');
{
  __setAdsConsentSnapshotForTests({
    gathered: true,
    canRequestAds: false,
    status: 'REQUIRED',
    error: null,
  });
  const before = getAdsConsentSnapshot();
  check(before.canRequestAds === false, 'snapshot starts blocked');

  __setAdsConsentSnapshotForTests({
    gathered: true,
    canRequestAds: true,
    status: 'OBTAINED',
    error: null,
  });
  const after = getAdsConsentSnapshot();
  check(after.canRequestAds === true, 'snapshot refresh clears stale privacy-required');

  const stillBlocked = resolveAdPrivacyAvailability(
    { gathered: true, canRequestAds: false, status: 'REQUIRED', error: null },
    true,
  );
  check(stillBlocked.status === 'action-required', 'action-required kept when canRequestAds false');
}

console.log('\nOffline + error copy');
{
  check(
    rewardedAdAvailabilityHelperText('offline')?.includes('internet'),
    'offline helper text',
  );
  check(AD_PRIVACY_ERROR_MESSAGE.includes('Tekrar deneyin'), 'privacy error retry copy');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
