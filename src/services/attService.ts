/**
 * iOS App Tracking Transparency — resolved once before ads/consent SDK init.
 * Denied/unavailable → non-personalized ads path (AdMob + UMP); game continues.
 */

import { Platform } from 'react-native';

import { isInternalBuildProfile, isStoreProductionProfile } from '../config/buildProfile';
import {
  mapAttStatusToPersonalization,
  type AttAuthorizationStatus,
} from './attPolicy';

export type { AttAuthorizationStatus } from './attPolicy';

let lastAttStatus: AttAuthorizationStatus = 'not-determined';
let attRequestedThisSession = false;
let attBootstrapCompleted = false;

export function getLastAttAuthorizationStatus(): AttAuthorizationStatus {
  return lastAttStatus;
}

export function getAttAdsPersonalizationMode(): 'personalized' | 'non-personalized' | 'unknown' {
  return mapAttStatusToPersonalization(lastAttStatus, Platform.OS);
}

export function shouldRequestNonPersonalizedAdsOnly(): boolean {
  if (Platform.OS !== 'ios') {
    return false;
  }
  return getAttAdsPersonalizationMode() === 'non-personalized';
}

export function hasAttBootstrapCompleted(): boolean {
  return attBootstrapCompleted || Platform.OS !== 'ios';
}

async function readIosAttStatus(): Promise<AttAuthorizationStatus> {
  if (Platform.OS !== 'ios') {
    lastAttStatus = 'unavailable';
    return lastAttStatus;
  }

  try {
    const tracking = await import('expo-tracking-transparency');
    const { PermissionStatus } = tracking;
    const current = await tracking.getTrackingPermissionsAsync();
    if (current.granted || current.status === PermissionStatus.GRANTED) {
      lastAttStatus = 'authorized';
      return lastAttStatus;
    }
    if (current.status === PermissionStatus.DENIED) {
      lastAttStatus = current.canAskAgain === false ? 'restricted' : 'denied';
      return lastAttStatus;
    }
    return 'not-determined';
  } catch (error) {
    console.warn('[att] tracking transparency unavailable', error);
    lastAttStatus = 'unavailable';
    return lastAttStatus;
  }
}

/**
 * Resolve ATT once at ads bootstrap — before UMP / Mobile Ads initialization.
 * Does not block gameplay if denied.
 */
export async function resolveAttBeforeAdsInitialization(): Promise<AttAuthorizationStatus> {
  if (Platform.OS !== 'ios') {
    lastAttStatus = 'unavailable';
    attBootstrapCompleted = true;
    return lastAttStatus;
  }

  if (attBootstrapCompleted) {
    return lastAttStatus;
  }

  const current = await readIosAttStatus();
  if (current !== 'not-determined') {
    attBootstrapCompleted = true;
    return current;
  }

  if (attRequestedThisSession) {
    lastAttStatus = 'denied';
    attBootstrapCompleted = true;
    return lastAttStatus;
  }

  try {
    const tracking = await import('expo-tracking-transparency');
    const { PermissionStatus } = tracking;
    attRequestedThisSession = true;
    const result = await tracking.requestTrackingPermissionsAsync();
    if (result.granted || result.status === PermissionStatus.GRANTED) {
      lastAttStatus = 'authorized';
    } else if (result.status === PermissionStatus.DENIED && result.canAskAgain === false) {
      lastAttStatus = 'restricted';
    } else {
      lastAttStatus = 'denied';
    }
  } catch (error) {
    console.warn('[att] requestTrackingPermissionsAsync failed', error);
    lastAttStatus = 'unavailable';
  } finally {
    attBootstrapCompleted = true;
  }

  if (isStoreProductionProfile() || isInternalBuildProfile()) {
    console.info('[att]', {
      stage: 'bootstrap',
      status: lastAttStatus,
      personalization: getAttAdsPersonalizationMode(),
    });
  }

  return lastAttStatus;
}

/** Idempotent — ATT is resolved at bootstrap; rewarded flow must not re-prompt. */
export async function requestAttIfNeededForRewardedAd(): Promise<AttAuthorizationStatus> {
  if (Platform.OS !== 'ios') {
    lastAttStatus = 'unavailable';
    return lastAttStatus;
  }

  if (!attBootstrapCompleted) {
    return resolveAttBeforeAdsInitialization();
  }

  return lastAttStatus;
}

export function __resetAttStateForTests(): void {
  lastAttStatus = 'not-determined';
  attRequestedThisSession = false;
  attBootstrapCompleted = false;
}

export function __setAttStatusForTests(status: AttAuthorizationStatus): void {
  lastAttStatus = status;
  attBootstrapCompleted = true;
}
