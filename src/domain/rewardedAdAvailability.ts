import type { AdPrivacyAvailability } from './adPrivacyState';
import {
  AD_PRIVACY_CHECKING_LABEL,
  AD_REWARDED_LOADING_LABEL,
  AD_REWARDED_OFFLINE_MESSAGE,
  AD_REWARDED_UNAVAILABLE_MESSAGE,
  AD_REWARDED_WATCH_LABEL,
} from './adPrivacyState';
import type { RewardedPlacementRuntimeStatus } from '../services/adProvider';

export type RewardedAdAvailability =
  | 'privacy-loading'
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
  if (
    input.privacy.status === 'config-error' ||
    input.privacy.status === 'blocked' ||
    (input.privacy.status === 'error' && !input.privacy.retryable)
  ) {
    return 'unavailable';
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
      return AD_PRIVACY_CHECKING_LABEL;
    case 'offline':
      return watchLabel;
    case 'loading-ad':
    case 'showing':
      return AD_REWARDED_LOADING_LABEL;
    case 'ready':
      return watchLabel;
    case 'unavailable':
    default:
      return options?.retryLabel ?? watchLabel;
  }
}

export function shouldEnableRewardedAdCta(availability: RewardedAdAvailability): boolean {
  return (
    availability !== 'privacy-loading' &&
    availability !== 'showing' &&
    availability !== 'loading-ad'
  );
}

export function rewardedAdAvailabilityHelperText(
  availability: RewardedAdAvailability,
): string | null {
  if (availability === 'offline') {
    return AD_REWARDED_OFFLINE_MESSAGE;
  }
  if (availability === 'loading-ad') {
    return AD_REWARDED_LOADING_LABEL;
  }
  if (availability === 'unavailable') {
    return AD_REWARDED_UNAVAILABLE_MESSAGE;
  }
  return null;
}
