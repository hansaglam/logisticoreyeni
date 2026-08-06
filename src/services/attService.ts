/**
 * iOS App Tracking Transparency — deferred until rewarded ad attempt.
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

export function getLastAttAuthorizationStatus(): AttAuthorizationStatus {
  return lastAttStatus;
}

export function getAttAdsPersonalizationMode(): 'personalized' | 'non-personalized' | 'unknown' {
  return mapAttStatusToPersonalization(lastAttStatus, Platform.OS);
}

export async function requestAttIfNeededForRewardedAd(): Promise<AttAuthorizationStatus> {
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
    if (attRequestedThisSession) {
      lastAttStatus = 'denied';
      return lastAttStatus;
    }
    attRequestedThisSession = true;
    const result = await tracking.requestTrackingPermissionsAsync();
    if (result.granted || result.status === PermissionStatus.GRANTED) {
      lastAttStatus = 'authorized';
    } else if (result.status === PermissionStatus.DENIED && result.canAskAgain === false) {
      lastAttStatus = 'restricted';
    } else {
      lastAttStatus = 'denied';
    }
    if (isStoreProductionProfile() || isInternalBuildProfile()) {
      console.info('[att]', {
        status: lastAttStatus,
        personalization: getAttAdsPersonalizationMode(),
      });
    }
    return lastAttStatus;
  } catch (error) {
    console.warn('[att] tracking transparency unavailable', error);
    lastAttStatus = 'unavailable';
    return lastAttStatus;
  }
}

export function __resetAttStateForTests(): void {
  lastAttStatus = 'not-determined';
  attRequestedThisSession = false;
}

export function __setAttStatusForTests(status: AttAuthorizationStatus): void {
  lastAttStatus = status;
}
