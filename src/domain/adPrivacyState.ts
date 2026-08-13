import {
  canRequestAdsFromSnapshot,
  isPrivacyOptionsRequired,
  type AdsConsentSnapshot,
} from '../services/adsConsentPolicy';

export type AdPrivacyState =
  | 'loading'
  | 'not-required'
  | 'required'
  | 'ready'
  | 'blocked'
  | 'config-error';

export type AdPrivacyAvailability =
  | { status: 'loading' }
  | { status: 'ready'; canRequestAds: true }
  | { status: 'consent-required' }
  | { status: 'blocked' }
  | { status: 'config-error' }
  | { status: 'error'; retryable: boolean };

export const AD_REWARDED_UNAVAILABLE_MESSAGE =
  'Reklam şu anda kullanılamıyor. Daha sonra tekrar dene.';
export const AD_REWARDED_LOAD_FAILED_MESSAGE = 'Reklam hazırlanamadı.';
export const AD_PRIVACY_CHECKING_LABEL = 'Reklam seçenekleri hazırlanıyor…';
export const AD_PRIVACY_NOT_REQUIRED_MESSAGE =
  'Ek reklam gizlilik tercihi gerekmiyor.';
export const AD_PRIVACY_OPTIONS_TITLE = 'Gizlilik Tercihlerini Yönet';
export const AD_REWARDED_WATCH_LABEL = 'Reklam İzle';
export const AD_REWARDED_LOADING_LABEL = 'Reklam hazırlanıyor…';
export const AD_REWARDED_OFFLINE_MESSAGE =
  'Reklam yüklemek için internet bağlantısı gerekli.';

/** @deprecated Rewarded CTA no longer routes to privacy settings. */
export const AD_PRIVACY_ACTION_CTA = AD_REWARDED_WATCH_LABEL;
/** @deprecated Use inline consent on rewarded press. */
export const AD_PRIVACY_ACTION_DESCRIPTION = '';
/** @deprecated Use AD_REWARDED_UNAVAILABLE_MESSAGE */
export const AD_PRIVACY_ERROR_MESSAGE = AD_REWARDED_UNAVAILABLE_MESSAGE;
export const AD_PRIVACY_LOADING_LABEL = AD_PRIVACY_CHECKING_LABEL;

export function resolveAdPrivacyState(
  snapshot: AdsConsentSnapshot,
  adsEnabled: boolean,
): AdPrivacyState {
  if (!adsEnabled) {
    return 'not-required';
  }
  if (!snapshot.gathered) {
    return 'loading';
  }
  if (snapshot.errorCategory === 'publisher-misconfiguration') {
    return 'config-error';
  }
  if (snapshot.status === 'ERROR') {
    return snapshot.errorCategory === 'network' ? 'blocked' : 'config-error';
  }
  if (canRequestAdsFromSnapshot(snapshot, adsEnabled)) {
    return 'ready';
  }
  if (snapshot.status === 'NOT_REQUIRED' || snapshot.status === 'MODULE_UNAVAILABLE') {
    return canRequestAdsFromSnapshot(snapshot, adsEnabled) ? 'ready' : 'not-required';
  }
  if (snapshot.status === 'REQUIRED' || snapshot.status === 'UNKNOWN') {
    return 'required';
  }
  if (snapshot.status === 'OBTAINED') {
    return 'blocked';
  }
  return 'required';
}

export function resolveAdPrivacyAvailability(
  snapshot: AdsConsentSnapshot,
  adsEnabled: boolean,
): AdPrivacyAvailability {
  const state = resolveAdPrivacyState(snapshot, adsEnabled);
  switch (state) {
    case 'loading':
      return { status: 'loading' };
    case 'ready':
    case 'not-required':
      return { status: 'ready', canRequestAds: true };
    case 'config-error':
      return { status: 'config-error' };
    case 'blocked':
      return { status: 'blocked' };
    case 'required':
      return { status: 'consent-required' };
    default:
      return { status: 'error', retryable: true };
  }
}

export function shouldShowAccountPrivacyOptions(
  snapshot: AdsConsentSnapshot,
): boolean {
  return isPrivacyOptionsRequired(snapshot);
}
