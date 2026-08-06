/**
 * Google UMP consent — production-safe, non-blocking for gameplay boot.
 */

import { Platform } from 'react-native';

import { isAdsConsentDebugGeographyEnabled, isInternalBuildProfile } from '../config/buildProfile';
import { isAdsEnabled } from '../config/adMob';
import {
  canRequestAdsFromSnapshot,
  type AdsConsentSnapshot,
} from './adsConsentPolicy';

export type { AdsConsentSnapshot } from './adsConsentPolicy';

declare const __DEV__: boolean | undefined;

let snapshot: AdsConsentSnapshot = {
  gathered: false,
  canRequestAds: false,
  status: null,
  error: null,
};

function isSupportedPlatform(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

function getConsentModule():
  | typeof import('react-native-google-mobile-ads')
  | null {
  if (!isSupportedPlatform()) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  } catch {
    return null;
  }
}

export function getAdsConsentSnapshot(): AdsConsentSnapshot {
  return snapshot;
}

export function canRequestAdsAfterConsent(): boolean {
  return canRequestAdsFromSnapshot(snapshot, isAdsEnabled());
}

export function resetAdsConsentForDebug(): void {
  if (!isInternalBuildProfile()) {
    return;
  }
  const mod = getConsentModule();
  mod?.AdsConsent.reset();
  snapshot = {
    gathered: false,
    canRequestAds: false,
    status: null,
    error: null,
  };
}

export async function gatherAdsConsentIfNeeded(): Promise<AdsConsentSnapshot> {
  if (!isAdsEnabled()) {
    snapshot = {
      gathered: true,
      canRequestAds: false,
      status: 'ADS_DISABLED',
      error: null,
    };
    return snapshot;
  }

  const mod = getConsentModule();
  if (!mod) {
    snapshot = {
      gathered: true,
      canRequestAds: true,
      status: 'MODULE_UNAVAILABLE',
      error: null,
    };
    return snapshot;
  }

  const options =
    isAdsConsentDebugGeographyEnabled()
      ? { debugGeography: mod.AdsConsentDebugGeography.EEA }
      : undefined;

  try {
    const info = await mod.AdsConsent.gatherConsent(options);
    snapshot = {
      gathered: true,
      canRequestAds: info.canRequestAds,
      status: String(info.status),
      error: null,
    };
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[ads-consent]', {
        status: info.status,
        canRequestAds: info.canRequestAds,
        isConsentFormAvailable: info.isConsentFormAvailable,
        debugEea: isAdsConsentDebugGeographyEnabled(),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    snapshot = {
      gathered: true,
      canRequestAds: false,
      status: 'ERROR',
      error: message,
    };
    console.warn('[ads-consent] gatherConsent failed — ads blocked, game continues', message);
  }

  return snapshot;
}

/** UMP gizlilik seçenekleri formunu yeniden açar. */
export async function showAdsPrivacyOptionsForm(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const mod = getConsentModule();
  if (!mod) {
    return { ok: false, error: 'module-unavailable' };
  }
  try {
    await mod.AdsConsent.showPrivacyOptionsForm();
    const info = await mod.AdsConsent.getConsentInfo();
    snapshot = {
      gathered: true,
      canRequestAds: info.canRequestAds,
      status: String(info.status),
      error: null,
    };
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/** Test helper — simulate consent states without native SDK. */
export function __setAdsConsentSnapshotForTests(next: AdsConsentSnapshot): void {
  snapshot = next;
}
