/**
 * UMP consent decision logic — headless-safe for CI validators.
 */

export type AdsConsentSnapshot = {
  gathered: boolean;
  canRequestAds: boolean;
  status: string | null;
  error: string | null;
};

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
  return snapshot.canRequestAds;
}
