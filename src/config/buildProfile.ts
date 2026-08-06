/**
 * Internal vs store production build profile resolution.
 * Fail-closed: ambiguous release flags → not store production.
 */

export type BuildProfile = 'internal' | 'production';

declare const __DEV__: boolean | undefined;

function readProfileEnv(): string | undefined {
  return process.env.LOGISTICORE_BUILD_PROFILE?.trim().toLowerCase();
}

export function resolveBuildProfile(): BuildProfile {
  const explicit = readProfileEnv();
  if (explicit === 'production' || explicit === 'store') {
    return 'production';
  }
  if (explicit === 'internal') {
    return 'internal';
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return 'internal';
  }
  if (process.env.EXPO_PUBLIC_ADS_USE_TEST_IDS === 'true') {
    return 'internal';
  }
  if (process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true') {
    return 'internal';
  }
  return 'production';
}

export function isInternalBuildProfile(): boolean {
  return resolveBuildProfile() === 'internal';
}

export function isStoreProductionProfile(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return false;
  }
  return resolveBuildProfile() === 'production';
}

export function isAdsConsentDebugGeographyEnabled(): boolean {
  if (!isInternalBuildProfile()) {
    return false;
  }
  return process.env.EXPO_PUBLIC_ADS_CONSENT_DEBUG_EEA === 'true';
}
