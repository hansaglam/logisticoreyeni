/**
 * UMP consent decision logic — headless-safe for CI validators.
 */

export type AdsPrivacyOptionsRequirement = 'UNKNOWN' | 'REQUIRED' | 'NOT_REQUIRED';

export type AdsConsentErrorCategory =
  | 'none'
  | 'publisher-misconfiguration'
  | 'network'
  | 'unknown';

export type AdsConsentSnapshot = {
  gathered: boolean;
  canRequestAds: boolean;
  status: string | null;
  privacyOptionsRequirementStatus: AdsPrivacyOptionsRequirement;
  error: string | null;
  errorCategory: AdsConsentErrorCategory;
};

export type AdsConsentPlatform = 'android' | 'ios' | string;

/**
 * Product policy: Google UMP UI is Android-only. iOS never asks for ad
 * personalization consent and always uses non-personalized ad requests.
 */
export function shouldUseGoogleUmpOnPlatform(platform: AdsConsentPlatform): boolean {
  return platform === 'android';
}

export function createIosNonPersonalizedAdsSnapshot(
  adsEnabled: boolean,
): AdsConsentSnapshot {
  return {
    gathered: true,
    canRequestAds: adsEnabled,
    status: 'IOS_NPA_ONLY',
    privacyOptionsRequirementStatus: 'NOT_REQUIRED',
    error: null,
    errorCategory: 'none',
  };
}

export function createEmptyAdsConsentSnapshot(): AdsConsentSnapshot {
  return {
    gathered: false,
    canRequestAds: false,
    status: null,
    privacyOptionsRequirementStatus: 'UNKNOWN',
    error: null,
    errorCategory: 'none',
  };
}

export function createTestAdsConsentSnapshot(
  partial: Partial<AdsConsentSnapshot> & Pick<AdsConsentSnapshot, 'gathered'>,
): AdsConsentSnapshot {
  return {
    ...createEmptyAdsConsentSnapshot(),
    ...partial,
    errorCategory: partial.errorCategory ?? (partial.error ? classifyConsentError(partial.error) : 'none'),
    privacyOptionsRequirementStatus:
      partial.privacyOptionsRequirementStatus ?? 'UNKNOWN',
  };
}

export function isPublisherMisconfigurationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('publisher') && normalized.includes('configuration')
  ) || (
    normalized.includes('no form') && normalized.includes('configured')
  ) || normalized.includes('failed to read publisher');
}

export function classifyConsentError(message: string): AdsConsentErrorCategory {
  if (!message.trim()) {
    return 'unknown';
  }
  if (isPublisherMisconfigurationError(message)) {
    return 'publisher-misconfiguration';
  }
  const normalized = message.toLowerCase();
  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('unavailable') ||
    normalized.includes('offline')
  ) {
    return 'network';
  }
  return 'unknown';
}

export function maskAdMobAppId(appId: string | null | undefined): string {
  if (!appId) {
    return 'missing';
  }
  const trimmed = appId.trim();
  if (trimmed.length <= 12) {
    return '***';
  }
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export function isPrivacyOptionsRequired(
  snapshot: AdsConsentSnapshot,
): boolean {
  return snapshot.privacyOptionsRequirementStatus === 'REQUIRED';
}

export function canRequestAdsFromSnapshot(
  snapshot: AdsConsentSnapshot,
  adsEnabled: boolean,
): boolean {
  if (!adsEnabled) {
    return false;
  }
  if (!snapshot.gathered) {
    return false;
  }
  if (snapshot.errorCategory === 'publisher-misconfiguration') {
    return false;
  }
  return snapshot.canRequestAds;
}
