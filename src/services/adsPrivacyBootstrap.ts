/**
 * Canonical iOS/Android ads privacy initialization order.
 *
 * iOS: non-personalized ad requests only (no ATT / IDFA).
 * Both platforms: Google UMP consent (GDPR/EEA) → Mobile Ads SDK init + rewarded preload.
 */

import { isAdsEnabled } from '../config/adMob';
import { gatherAdsConsentIfNeeded } from './adsConsentService';
import { initializeAdProvider } from './adProvider';

export type AdsPrivacyBootstrapResult = {
  consentGathered: boolean;
  adsInitialized: boolean;
};

export async function initializeAdsPrivacyStack(): Promise<AdsPrivacyBootstrapResult> {
  if (!isAdsEnabled()) {
    await gatherAdsConsentIfNeeded();
    return { consentGathered: true, adsInitialized: false };
  }

  await gatherAdsConsentIfNeeded();
  await initializeAdProvider();

  return {
    consentGathered: true,
    adsInitialized: true,
  };
}
