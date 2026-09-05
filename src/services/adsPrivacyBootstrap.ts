/**
 * Canonical iOS/Android ads privacy initialization order.
 *
 * iOS: no UMP UI; Mobile Ads init → non-personalized rewarded preload.
 * Android: existing Google UMP flow → Mobile Ads init + rewarded preload.
 */

import { Platform } from 'react-native';

import { isAdsEnabled } from '../config/adMob';
import {
  gatherAdsConsentIfNeeded,
  prepareIosNonPersonalizedAdsState,
} from './adsConsentService';
import { initializeAdProvider } from './adProvider';

export type AdsPrivacyBootstrapResult = {
  consentGathered: boolean;
  adsInitialized: boolean;
};

export async function initializeAdsPrivacyStack(): Promise<AdsPrivacyBootstrapResult> {
  if (Platform.OS === 'ios') {
    prepareIosNonPersonalizedAdsState();
    if (!isAdsEnabled()) {
      return { consentGathered: false, adsInitialized: false };
    }
    await initializeAdProvider();
    return { consentGathered: false, adsInitialized: true };
  }

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
