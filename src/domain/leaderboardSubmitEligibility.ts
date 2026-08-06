import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';
import {
  getAccountStatus,
  isAuthSessionReady,
  type AccountStatus,
} from '../services/authService';

export type LeaderboardSubmitIneligibleReason =
  | 'feature-disabled'
  | 'auth-not-ready'
  | 'user-missing'
  | 'anonymous-user'
  | 'username-missing'
  | 'offline';

export type LeaderboardSubmitEligibility =
  | { eligible: true; uid: string }
  | { eligible: false; reason: LeaderboardSubmitIneligibleReason };

export function getLeaderboardSubmitEligibility(
  account: AccountStatus = getAccountStatus(),
  options?: {
    featureEnabled?: boolean;
    authReady?: boolean;
  },
): LeaderboardSubmitEligibility {
  const featureEnabled = options?.featureEnabled ?? LEADERBOARD_ENABLED;
  const authReady = options?.authReady ?? isAuthSessionReady();

  if (!featureEnabled) {
    return { eligible: false, reason: 'feature-disabled' };
  }
  if (!authReady) {
    return { eligible: false, reason: 'auth-not-ready' };
  }
  if (!account.isReady) {
    return { eligible: false, reason: 'auth-not-ready' };
  }
  if (!account.uid) {
    return { eligible: false, reason: 'user-missing' };
  }
  if (account.isAnonymous || account.provider === 'guest') {
    return { eligible: false, reason: 'anonymous-user' };
  }
  if (account.provider !== 'google' && account.provider !== 'apple') {
    return { eligible: false, reason: 'user-missing' };
  }
  return { eligible: true, uid: account.uid };
}

export function eligibilityReasonToSubmitErrorCode(
  reason: LeaderboardSubmitIneligibleReason,
): string {
  switch (reason) {
    case 'anonymous-user':
      return 'anonymous-not-supported';
    case 'auth-not-ready':
    case 'user-missing':
    case 'offline':
      return 'auth-required';
    case 'username-missing':
      return 'username-required';
    case 'feature-disabled':
      return 'feature-disabled';
    default:
      return 'auth-required';
  }
}

export function isExpectedLeaderboardSubmitSkip(errorCode?: string): boolean {
  return (
    errorCode === 'anonymous-not-supported' ||
    errorCode === 'auth-required' ||
    errorCode === 'feature-disabled' ||
    errorCode === 'username-required'
  );
}
