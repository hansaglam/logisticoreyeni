import {
  canRequestAdsFromSnapshot,
  type AdsConsentSnapshot,
} from '../services/adsConsentPolicy';

export type AdPrivacyState =
  | 'loading'
  | 'not-required'
  | 'required'
  | 'ready'
  | 'error';

export type AdPrivacyAvailability =
  | { status: 'loading' }
  | { status: 'ready'; canRequestAds: true }
  | { status: 'action-required'; action: 'open-privacy-options' }
  | { status: 'error'; retryable: boolean };

export const AD_PRIVACY_ACTION_CTA = 'Gizlilik Tercihini Tamamla';
export const AD_PRIVACY_ACTION_DESCRIPTION =
  'Reklam ödüllerini kullanmak için gizlilik ve reklam tercihlerini gözden geçir.';
export const AD_PRIVACY_LOADING_LABEL = 'Reklam seçenekleri hazırlanıyor…';
export const AD_PRIVACY_ERROR_MESSAGE =
  'Gizlilik tercihleri açılamadı. Tekrar deneyin.';
export const AD_REWARDED_WATCH_LABEL = 'Reklam İzle';
export const AD_REWARDED_LOADING_LABEL = 'Reklam hazırlanıyor…';
export const AD_REWARDED_OFFLINE_MESSAGE =
  'Reklam yüklemek için internet bağlantısı gerekli.';

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
  if (snapshot.status === 'ERROR') {
    return 'error';
  }
  if (canRequestAdsFromSnapshot(snapshot, adsEnabled)) {
    return 'ready';
  }
  if (snapshot.status === 'NOT_REQUIRED' || snapshot.status === 'MODULE_UNAVAILABLE') {
    return canRequestAdsFromSnapshot(snapshot, adsEnabled) ? 'ready' : 'required';
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
    case 'error':
      return { status: 'error', retryable: true };
    case 'required':
    default:
      return { status: 'action-required', action: 'open-privacy-options' };
  }
}
