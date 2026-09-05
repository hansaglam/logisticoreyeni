/**
 * Google UMP consent — production-safe, non-blocking for gameplay boot.
 */

import { Platform } from 'react-native';

import { isAdsConsentDebugGeographyEnabled, isInternalBuildProfile } from '../config/buildProfile';
import { getConfiguredAppId, isAdsEnabled } from '../config/adMob';
import {
  canRequestAdsFromSnapshot,
  classifyConsentError,
  createEmptyAdsConsentSnapshot,
  createIosNonPersonalizedAdsSnapshot,
  isPrivacyOptionsRequired,
  isPublisherMisconfigurationError,
  maskAdMobAppId,
  shouldUseGoogleUmpOnPlatform,
  type AdsConsentSnapshot,
} from './adsConsentPolicy';

export type { AdsConsentSnapshot } from './adsConsentPolicy';

export type RewardedAdPrivacyRequestResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'config-error' | 'blocked' | 'network' | 'in-flight' | 'ads-disabled';
      userMessage: string;
    };

export type AccountPrivacyOptionsResult =
  | { ok: true; canRequestAds: boolean }
  | { ok: false; reason: 'not-required' | 'module-unavailable' | 'config-error' | 'failed'; userMessage: string };

declare const __DEV__: boolean | undefined;

const AD_UNAVAILABLE =
  'Reklam şu anda kullanılamıyor. Daha sonra tekrar dene.';

let snapshot: AdsConsentSnapshot = createEmptyAdsConsentSnapshot();
const consentListeners = new Set<() => void>();
let privacyActionInFlight = false;
let configErrorLatched = false;

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
  if (!isSupportedPlatform() || !shouldUseGoogleUmpOnPlatform(Platform.OS)) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  } catch {
    return null;
  }
}

function getConsentDebugOptions(
  mod: typeof import('react-native-google-mobile-ads'),
): import('react-native-google-mobile-ads').AdsConsentInfoOptions | undefined {
  return isAdsConsentDebugGeographyEnabled()
    ? { debugGeography: mod.AdsConsentDebugGeography.EEA }
    : undefined;
}

function mapConsentInfo(
  info: import('react-native-google-mobile-ads').AdsConsentInfo,
  error: string | null = null,
): AdsConsentSnapshot {
  const errorCategory = error ? classifyConsentError(error) : 'none';
  return {
    gathered: true,
    canRequestAds: info.canRequestAds,
    status: String(info.status),
    privacyOptionsRequirementStatus: String(
      info.privacyOptionsRequirementStatus,
    ) as AdsConsentSnapshot['privacyOptionsRequirementStatus'],
    error,
    errorCategory,
  };
}

function logPublisherConfigError(error: string): void {
  const appId = getConfiguredAppId(Platform.OS === 'ios' ? 'ios' : 'android');
  const appIdMasked = maskAdMobAppId(appId);
  console.warn('[ads-privacy-config-error]', {
    platform: Platform.OS,
    appIdPresent: appIdMasked !== 'missing',
    appIdMasked,
    errorCategory: 'publisher-misconfiguration',
    errorCode: 'publisher-misconfiguration',
  });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[ads-privacy-config-error:detail]', error.slice(0, 240));
  }
}

function applyConsentFailure(message: string): AdsConsentSnapshot {
  const errorCategory = classifyConsentError(message);
  if (errorCategory === 'publisher-misconfiguration') {
    configErrorLatched = true;
    logPublisherConfigError(message);
  }
  return updateSnapshot({
    gathered: true,
    canRequestAds: false,
    status: 'ERROR',
    privacyOptionsRequirementStatus: snapshot.privacyOptionsRequirementStatus,
    error: message,
    errorCategory,
  });
}

async function refreshConsentSnapshotFromNative(): Promise<AdsConsentSnapshot> {
  if (Platform.OS === 'ios') {
    return prepareIosNonPersonalizedAdsState();
  }
  const mod = getConsentModule();
  if (!mod) {
    return updateSnapshot({
      gathered: true,
      canRequestAds: true,
      status: 'MODULE_UNAVAILABLE',
      privacyOptionsRequirementStatus: 'NOT_REQUIRED',
      error: null,
      errorCategory: 'none',
    });
  }
  const info = await mod.AdsConsent.getConsentInfo();
  return updateSnapshot(mapConsentInfo(info));
}

export function getAdsConsentSnapshot(): AdsConsentSnapshot {
  return snapshot;
}

export function canRequestAdsAfterConsent(): boolean {
  if (Platform.OS === 'ios') {
    return isAdsEnabled();
  }
  return canRequestAdsFromSnapshot(snapshot, isAdsEnabled());
}

/** iOS fail-closed policy: no UMP UI, no personalization, NPA requests only. */
export function prepareIosNonPersonalizedAdsState(): AdsConsentSnapshot {
  return updateSnapshot(createIosNonPersonalizedAdsSnapshot(isAdsEnabled()));
}

export function resetAdsConsentForDebug(): void {
  if (!isInternalBuildProfile()) {
    return;
  }
  if (Platform.OS === 'ios') {
    prepareIosNonPersonalizedAdsState();
    return;
  }
  const mod = getConsentModule();
  mod?.AdsConsent.reset();
  configErrorLatched = false;
  snapshot = updateSnapshot(createEmptyAdsConsentSnapshot());
}

async function refreshAdsAfterConsentChange(): Promise<void> {
  const { refreshAdsAfterConsentChange: refresh } = await import('./adProvider');
  await refresh();
}

export async function gatherAdsConsentIfNeeded(): Promise<AdsConsentSnapshot> {
  if (!isAdsEnabled()) {
    return updateSnapshot({
      gathered: true,
      canRequestAds: false,
      status: 'ADS_DISABLED',
      privacyOptionsRequirementStatus: 'NOT_REQUIRED',
      error: null,
      errorCategory: 'none',
    });
  }

  if (Platform.OS === 'ios') {
    return prepareIosNonPersonalizedAdsState();
  }

  if (configErrorLatched) {
    return snapshot;
  }

  const mod = getConsentModule();
  if (!mod) {
    return updateSnapshot({
      gathered: true,
      canRequestAds: true,
      status: 'MODULE_UNAVAILABLE',
      privacyOptionsRequirementStatus: 'NOT_REQUIRED',
      error: null,
      errorCategory: 'none',
    });
  }

  const options = getConsentDebugOptions(mod);

  try {
    const info = await mod.AdsConsent.gatherConsent(options);
    const next = updateSnapshot(mapConsentInfo(info));
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[ads-consent]', {
        status: info.status,
        canRequestAds: info.canRequestAds,
        privacyOptionsRequirementStatus: info.privacyOptionsRequirementStatus,
        isConsentFormAvailable: info.isConsentFormAvailable,
        debugEea: isAdsConsentDebugGeographyEnabled(),
      });
    }
    if (next.canRequestAds) {
      await refreshAdsAfterConsentChange();
    }
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const next = applyConsentFailure(message);
    console.warn('[ads-consent] gatherConsent failed — ads blocked, game continues');
    return next;
  }
}

/** Account Center — privacy options only when UMP marks them required. */
export async function openAccountPrivacyOptions(): Promise<AccountPrivacyOptionsResult> {
  if (!isAdsEnabled()) {
    return {
      ok: false,
      reason: 'not-required',
      userMessage: 'Reklamlar bu yapılandırmada kapalı.',
    };
  }


  if (Platform.OS === 'ios') {
    prepareIosNonPersonalizedAdsState();
    return {
      ok: false,
      reason: 'not-required',
      userMessage: 'iOS reklamları kişiselleştirilmeden gösterilir.',
    };
  }

  if (configErrorLatched || snapshot.errorCategory === 'publisher-misconfiguration') {
    return {
      ok: false,
      reason: 'config-error',
      userMessage: AD_UNAVAILABLE,
    };
  }

  const mod = getConsentModule();
  if (!mod) {
    return {
      ok: false,
      reason: 'module-unavailable',
      userMessage: 'Gizlilik tercihleri bu cihazda kullanılamıyor.',
    };
  }

  try {
    if (!snapshot.gathered) {
      await gatherAdsConsentIfNeeded();
    } else {
      await mod.AdsConsent.requestInfoUpdate(getConsentDebugOptions(mod));
      await refreshConsentSnapshotFromNative();
    }

    if (!isPrivacyOptionsRequired(snapshot)) {
      return {
        ok: false,
        reason: 'not-required',
        userMessage: 'Ek reklam gizlilik tercihi gerekmiyor.',
      };
    }

    await mod.AdsConsent.showPrivacyOptionsForm();
    await refreshConsentSnapshotFromNative();
    await refreshAdsAfterConsentChange();
    return {
      ok: true,
      canRequestAds: canRequestAdsAfterConsent(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isPublisherMisconfigurationError(message)) {
      applyConsentFailure(message);
      return {
        ok: false,
        reason: 'config-error',
        userMessage: AD_UNAVAILABLE,
      };
    }
    return {
      ok: false,
      reason: 'failed',
      userMessage: AD_UNAVAILABLE,
    };
  }
}

/**
 * Canonical rewarded CTA privacy gate — never opens Account privacy options.
 */
export async function handleRewardedAdRequest(): Promise<RewardedAdPrivacyRequestResult> {
  if (!isAdsEnabled()) {
    return {
      allowed: false,
      reason: 'ads-disabled',
      userMessage: AD_UNAVAILABLE,
    };
  }

  if (privacyActionInFlight) {
    return {
      allowed: false,
      reason: 'in-flight',
      userMessage: AD_UNAVAILABLE,
    };
  }

  if (configErrorLatched || snapshot.errorCategory === 'publisher-misconfiguration') {
    return {
      allowed: false,
      reason: 'config-error',
      userMessage: AD_UNAVAILABLE,
    };
  }

  privacyActionInFlight = true;
  try {
    if (Platform.OS === 'ios') {
      prepareIosNonPersonalizedAdsState();
      return { allowed: true };
    }
    if (!snapshot.gathered) {
      await gatherAdsConsentIfNeeded();
    }

    if (canRequestAdsAfterConsent()) {
      return { allowed: true };
    }

    if (getAdsConsentSnapshot().errorCategory === 'publisher-misconfiguration') {
      return {
        allowed: false,
        reason: 'config-error',
        userMessage: AD_UNAVAILABLE,
      };
    }

    if (snapshot.status === 'REQUIRED' || snapshot.status === 'UNKNOWN') {
      await gatherAdsConsentIfNeeded();
      if (canRequestAdsAfterConsent()) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'blocked',
        userMessage: AD_UNAVAILABLE,
      };
    }

    if (snapshot.status === 'NOT_REQUIRED' || snapshot.status === 'MODULE_UNAVAILABLE') {
      await refreshConsentSnapshotFromNative();
      if (canRequestAdsAfterConsent()) {
        return { allowed: true };
      }
    }

    if (snapshot.errorCategory === 'network') {
      return {
        allowed: false,
        reason: 'network',
        userMessage: AD_UNAVAILABLE,
      };
    }

    return {
      allowed: false,
      reason: 'blocked',
      userMessage: AD_UNAVAILABLE,
    };
  } finally {
    privacyActionInFlight = false;
  }
}

/** @deprecated Use openAccountPrivacyOptions for settings, handleRewardedAdRequest for ads. */
export async function completeAdPrivacyAction(): Promise<{
  ok: boolean;
  canRequestAds: boolean;
  error?: string;
}> {
  const result = await handleRewardedAdRequest();
  return {
    ok: result.allowed,
    canRequestAds: canRequestAdsAfterConsent(),
    error: result.allowed ? undefined : 'blocked',
  };
}

/** Test helper — simulate consent states without native SDK. */
export function __setAdsConsentSnapshotForTests(next: AdsConsentSnapshot): void {
  configErrorLatched = next.errorCategory === 'publisher-misconfiguration';
  updateSnapshot(next);
}

export function __resetAdsConsentTestState(): void {
  configErrorLatched = false;
  snapshot = updateSnapshot(createEmptyAdsConsentSnapshot());
}

export { maskAdMobAppId };
