/**
 * Cross-architecture detection for react-native-google-mobile-ads native binding.
 *
 * Under Bridge (old arch), the module often appears on NativeModules.
 * Under New Architecture / TurboModules, it may ONLY appear via TurboModuleRegistry
 * and be absent from NativeModules — a NativeModules-only check is a false negative.
 *
 * Old arch may register on NativeModules while TurboModuleRegistry.get returns null —
 * requiring BOTH is also a false negative.
 *
 * Safe rule: available if Bridge OR TurboModule is present.
 */

export const GOOGLE_MOBILE_ADS_NATIVE_MODULE_NAME = 'RNGoogleMobileAdsModule';

export type GoogleMobileAdsNativeLookup = {
  /** Bridge / NativeModules map (may be empty under New Architecture). */
  bridgeModule: unknown;
  /**
   * Result of TurboModuleRegistry.get(name) — must use non-enforcing get().
   * Pass `undefined` when TurboModuleRegistry is unavailable.
   */
  turboModule: unknown;
};

/**
 * True when the Google Mobile Ads native module is registered on either
 * the Bridge (NativeModules) or TurboModuleRegistry.
 */
export function isGoogleMobileAdsNativeModuleRegistered(
  lookup: GoogleMobileAdsNativeLookup,
): boolean {
  if (lookup.bridgeModule != null) {
    return true;
  }
  if (lookup.turboModule != null) {
    return true;
  }
  return false;
}

/**
 * Ownership check for in-flight rewarded preload promises.
 * Stale completions must not clear a newer attempt's loadingPromise.
 */
export function isRewardedPreloadAttemptOwner(
  currentLoadingPromise: Promise<unknown> | undefined | null,
  attemptPromise: Promise<unknown>,
): boolean {
  return currentLoadingPromise === attemptPromise;
}
