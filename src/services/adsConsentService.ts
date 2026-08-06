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

const consentListeners = new Set<() => void>();
let privacyActionInFlight = false;

function notifyConsentListeners(): void {
  for (const listener of consentListeners) {
    listener();
  }
}

function updateSnapshot(next: AdsConsentSnapshot): AdsConsentSnapshot {
  snapshot = next;
  notifyConsentListeners();
  return snapshot;
}

export function subscribeAdsConsentState(listener: () => void): () => void {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
}

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
  snapshot = updateSnapshot({
    gathered: false,
    canRequestAds: false,
    status: null,
    error: null,
  });
}

export async function gatherAdsConsentIfNeeded(): Promise<AdsConsentSnapshot> {
  if (!isAdsEnabled()) {
    return updateSnapshot({
      gathered: true,
      canRequestAds: false,
      status: 'ADS_DISABLED',
      error: null,
    });
  }

  const mod = getConsentModule();
  if (!mod) {
    return updateSnapshot({
      gathered: true,
      canRequestAds: true,
      status: 'MODULE_UNAVAILABLE',
      error: null,
    });
  }

  const options =
    isAdsConsentDebugGeographyEnabled()
      ? { debugGeography: mod.AdsConsentDebugGeography.EEA }
      : undefined;

  try {
    const info = await mod.AdsConsent.gatherConsent(options);
    const next = updateSnapshot({
      gathered: true,
      canRequestAds: info.canRequestAds,
      status: String(info.status),
      error: null,
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[ads-consent]', {
        status: info.status,
        canRequestAds: info.canRequestAds,
        isConsentFormAvailable: info.isConsentFormAvailable,
        debugEea: isAdsConsentDebugGeographyEnabled(),
      });
    }
    await refreshAdsAfterConsentChange();
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const next = updateSnapshot({
      gathered: true,
      canRequestAds: false,
      status: 'ERROR',
      error: message,
    });
    console.warn('[ads-consent] gatherConsent failed — ads blocked, game continues', message);
    return next;
  }
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
    updateSnapshot({
      gathered: true,
      canRequestAds: info.canRequestAds,
      status: String(info.status),
      error: null,
    });
    await refreshAdsAfterConsentChange();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function refreshAdsAfterConsentChange(): Promise<void> {
  const { refreshAdsAfterConsentChange: refresh } = await import('./adProvider');
  await refresh();
}

/** Rewarded CTA ve Hesap Merkezi için ortak gizlilik tercihi akışı. */
export async function completeAdPrivacyAction(options?: {
  onNavigateToPreferences?: () => void | Promise<void>;
}): Promise<{ ok: boolean; canRequestAds: boolean; error?: string }> {
  if (privacyActionInFlight) {
    return {
      ok: false,
      canRequestAds: canRequestAdsAfterConsent(),
      error: 'in-flight',
    };
  }
  privacyActionInFlight = true;
  try {
    const privacyOptions = await showAdsPrivacyOptionsForm();
    if (!privacyOptions.ok) {
      await gatherAdsConsentIfNeeded();
    } else {
      await refreshAdsAfterConsentChange();
    }

    if (!canRequestAdsAfterConsent() && options?.onNavigateToPreferences) {
      await options.onNavigateToPreferences();
      await gatherAdsConsentIfNeeded();
    }

    const canRequestAds = canRequestAdsAfterConsent();
    notifyConsentListeners();
    return {
      ok: canRequestAds || privacyOptions.ok,
      canRequestAds,
      error: canRequestAds ? undefined : privacyOptions.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, canRequestAds: false, error: message };
  } finally {
    privacyActionInFlight = false;
  }
}

/** Test helper — simulate consent states without native SDK. */
export function __setAdsConsentSnapshotForTests(next: AdsConsentSnapshot): void {
  updateSnapshot(next);
}
