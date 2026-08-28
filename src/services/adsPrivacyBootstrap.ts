/**
 * Canonical iOS/Android ads privacy initialization order.
 *
 * iOS:
 *   1. App Tracking Transparency (before any tracking-dependent SDK work)
 *   2. Ad request configuration (personalized vs non-personalized)
 *   3. Google UMP consent
 *   4. Mobile Ads SDK init + rewarded preload
 *
 * Android: steps 1–2 are no-ops; UMP → SDK init unchanged.
 */

import { Platform } from 'react-native';

import { isAdsEnabled } from '../config/adMob';
import { resolveAttBeforeAdsInitialization } from './attService';
import { gatherAdsConsentIfNeeded } from './adsConsentService';
import {
  applyAdTrackingConfiguration,
  initializeAdProvider,
} from './adProvider';

export type AdsPrivacyBootstrapResult = {
  attResolved: boolean;
  consentGathered: boolean;
  adsInitialized: boolean;
};

export async function initializeAdsPrivacyStack(): Promise<AdsPrivacyBootstrapResult> {
  if (!isAdsEnabled()) {
    await gatherAdsConsentIfNeeded();
    return { attResolved: false, consentGathered: true, adsInitialized: false };
  }

  let attResolved = false;
  if (Platform.OS === 'ios') {
    await resolveAttBeforeAdsInitialization();
    attResolved = true;
    await applyAdTrackingConfiguration();
  }

  await gatherAdsConsentIfNeeded();
  await initializeAdProvider();

  return {
    attResolved,
    consentGathered: true,
    adsInitialized: true,
  };
}
