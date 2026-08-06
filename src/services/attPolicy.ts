/**
 * iOS ATT → ad personalization mapping — headless-safe for CI validators.
 */

export type AttAuthorizationStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unavailable';

export function mapAttStatusToPersonalization(
  status: AttAuthorizationStatus,
  platform: 'ios' | 'android' | 'web' | 'windows' | 'macos',
): 'personalized' | 'non-personalized' | 'unknown' {
  if (platform !== 'ios') {
    return 'unknown';
  }
  if (status === 'authorized') {
    return 'personalized';
  }
  if (status === 'denied' || status === 'restricted') {
    return 'non-personalized';
  }
  return 'unknown';
}
