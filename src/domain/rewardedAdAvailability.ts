import type { AdPrivacyAvailability } from './adPrivacyState';
import {
  AD_PRIVACY_ACTION_CTA,
  AD_PRIVACY_LOADING_LABEL,
  AD_REWARDED_LOADING_LABEL,
  AD_REWARDED_OFFLINE_MESSAGE,
  AD_REWARDED_WATCH_LABEL,
} from './adPrivacyState';
import type { RewardedPlacementRuntimeStatus } from '../services/adProvider';

export type RewardedAdAvailability =
  | 'privacy-loading'
  | 'privacy-action-required'
  | 'privacy-error'
  | 'offline'
  | 'loading-ad'
  | 'ready'
  | 'unavailable'
  | 'showing';

export function resolveRewardedAdAvailability(input: {
  privacy: AdPrivacyAvailability;
  placementStatus: RewardedPlacementRuntimeStatus;
  isOnline?: boolean;
}): RewardedAdAvailability {
  if (input.privacy.status === 'loading') {
    return 'privacy-loading';
  }
  if (input.privacy.status === 'error') {
    return 'privacy-error';
  }
  if (input.privacy.status === 'action-required') {
    return 'privacy-action-required';
  }
  if (input.isOnline === false) {
    return 'offline';
  }
  if (input.placementStatus === 'showing') {
    return 'showing';
  }
  if (input.placementStatus === 'ready') {
    return 'ready';
  }
  if (
    input.placementStatus === 'loading' ||
    input.placementStatus === 'idle'
  ) {
    return 'loading-ad';
  }
  return 'unavailable';
}

export function rewardedAdAvailabilityToButtonLabel(
  availability: RewardedAdAvailability,
  options?: { watchLabel?: string; retryLabel?: string },
): string {
  const watchLabel = options?.watchLabel ?? AD_REWARDED_WATCH_LABEL;
  switch (availability) {
    case 'privacy-loading':
      return AD_PRIVACY_LOADING_LABEL;
    case 'privacy-action-required':
      return AD_PRIVACY_ACTION_CTA;
    case 'privacy-error':
      return options?.retryLabel ?? 'Tekrar Dene';
    case 'offline':
      return watchLabel;
    case 'loading-ad':
    case 'showing':
      return AD_REWARDED_LOADING_LABEL;
    case 'ready':
      return watchLabel;
    case 'unavailable':
    default:
      return options?.retryLabel ?? 'Tekrar Dene';
  }
}

export function shouldEnableRewardedAdCta(availability: RewardedAdAvailability): boolean {
  return (
    availability === 'privacy-action-required' ||
    availability === 'privacy-error' ||
    availability === 'ready' ||
    availability === 'unavailable'
  );
}

export function rewardedAdAvailabilityHelperText(
  availability: RewardedAdAvailability,
): string | null {
  if (availability === 'privacy-action-required') {
    return null;
  }
  if (availability === 'offline') {
    return AD_REWARDED_OFFLINE_MESSAGE;
  }
  if (availability === 'loading-ad') {
    return AD_REWARDED_LOADING_LABEL;
  }
  return null;
}
