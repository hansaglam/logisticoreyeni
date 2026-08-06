/**
 * Backend-authoritative username callables.
 */

import { httpsCallable } from 'firebase/functions';

import {
  validateUsernameFormat,
  type UsernameClientReason,
} from '../domain/usernameValidation';
import { isAuthSessionReady } from './authService';
import {
  getAuthUidSnapshot,
  isAuthContextStale,
  logUsernameService,
  mapBackendReasonToUsernameFailure,
  mapFirebaseCallableToUsernameFailure,
  withCallableTimeout,
  type UsernameFailureReason,
} from './callableServiceUtils';
import { FIREBASE_FUNCTIONS_REGION, getFirebaseFunctionsSafe } from './firebase';
import { notifyUsernameProfileChanged } from './usernameProfileEvents';
import { submitCurrentLeaderboardScore } from './leaderboardService';

const CALLABLES = {
  setUsername: 'setUsername',
  checkUsernameAvailability: 'checkUsernameAvailability',
  getUsernameProfile: 'getUsernameProfile',
} as const;

export type UsernameProfile = {
  username: string | null;
  usernameSetupCompleted: boolean;
  usernameChangeCount: number;
  usernameUpdatedAtMs: number | null;
  suggestedUsername: string;
  nextChangeAvailableAtMs: number | null;
};

export type SetUsernameClientResult =
  | {
      ok: true;
      username: string;
      usernameNormalized: string;
      setupCompleted: boolean;
      changeCount: number;
      nextChangeAvailableAtMs: number | null;
    }
  | { ok: false; reason: UsernameClientReason; nextChangeAvailableAtMs?: number | null };

export type CheckUsernameClientResult =
  | {
      ok: true;
      available: boolean;
      usernameNormalized: string;
      reason?: UsernameClientReason;
    }
  | { ok: false; reason: UsernameClientReason };

function toClientReason(reason: UsernameFailureReason): UsernameClientReason {
  if (reason === 'function-not-found' || reason === 'function-unavailable') {
    return 'function-not-found';
  }
  if (reason === 'network-error') {
    return 'network-error';
  }
  if (reason === 'timeout') {
    return 'timeout';
  }
  if (reason === 'unauthenticated') {
    return 'auth-required';
  }
  if (reason === 'malformed-response' || reason === 'unknown') {
    return 'service-unavailable';
  }
  if (reason === 'app-check-failed') {
    return 'app-check-failed';
  }
  if (reason === 'permission-denied') {
    return 'permission-denied';
  }
  if (reason === 'invalid-argument') {
    return 'invalid-request';
  }
  return reason as UsernameClientReason;
}

function mapReason(raw: unknown): UsernameClientReason {
  return toClientReason(mapBackendReasonToUsernameFailure(raw));
}

export async function fetchUsernameProfile(): Promise<
  | { ok: true; profile: UsernameProfile }
  | { ok: false; reason: UsernameClientReason }
> {
  const uidAtStart = getAuthUidSnapshot();
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    logUsernameService({
      stage: 'fetch-profile',
      functionName: CALLABLES.getUsernameProfile,
      region: FIREBASE_FUNCTIONS_REGION,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: 'function-unavailable',
    });
    return { ok: false, reason: 'function-not-found' };
  }
  try {
    const callable = httpsCallable(functions, CALLABLES.getUsernameProfile);
    const response = await withCallableTimeout(callable({}));
    if (isAuthContextStale(uidAtStart)) {
      logUsernameService({
        stage: 'fetch-profile',
        functionName: CALLABLES.getUsernameProfile,
        authReady: isAuthSessionReady(),
        result: 'skipped',
        failureReason: 'auth-context-stale',
      });
      return { ok: false, reason: 'auth-required' };
    }
    const data = response.data as Record<string, unknown>;
    if (data?.ok !== true) {
      const reason = mapReason(data?.reason);
      logUsernameService({
        stage: 'fetch-profile',
        functionName: CALLABLES.getUsernameProfile,
        authReady: isAuthSessionReady(),
        result: 'failure',
        failureReason: reason,
      });
      return { ok: false, reason };
    }
    logUsernameService({
      stage: 'fetch-profile',
      functionName: CALLABLES.getUsernameProfile,
      authReady: isAuthSessionReady(),
      result: 'success',
    });
    return {
      ok: true,
      profile: {
        username: typeof data.username === 'string' ? data.username : null,
        usernameSetupCompleted: data.usernameSetupCompleted === true,
        usernameChangeCount: Math.max(0, Math.floor(Number(data.usernameChangeCount) || 0)),
        usernameUpdatedAtMs:
          typeof data.usernameUpdatedAtMs === 'number' ? data.usernameUpdatedAtMs : null,
        suggestedUsername:
          typeof data.suggestedUsername === 'string' ? data.suggestedUsername : '',
        nextChangeAvailableAtMs:
          typeof data.nextChangeAvailableAtMs === 'number'
            ? data.nextChangeAvailableAtMs
            : null,
      },
    };
  } catch (error) {
    const reason = toClientReason(mapFirebaseCallableToUsernameFailure(error));
    logUsernameService({
      stage: 'fetch-profile',
      functionName: CALLABLES.getUsernameProfile,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: reason,
    });
    return { ok: false, reason };
  }
}

export async function checkUsernameAvailability(
  username: string,
): Promise<CheckUsernameClientResult> {
  const local = validateUsernameFormat(username);
  if (!local.ok) {
    return {
      ok: true,
      available: false,
      usernameNormalized: '',
      reason: local.reason,
    };
  }
  const uidAtStart = getAuthUidSnapshot();
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    logUsernameService({
      stage: 'check-availability',
      functionName: CALLABLES.checkUsernameAvailability,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: 'function-not-found',
      usernameLength: local.username.length,
    });
    return { ok: false, reason: 'function-not-found' };
  }
  try {
    const callable = httpsCallable(functions, CALLABLES.checkUsernameAvailability);
    const response = await withCallableTimeout(callable({ username: local.username }));
    if (isAuthContextStale(uidAtStart)) {
      logUsernameService({
        stage: 'check-availability',
        functionName: CALLABLES.checkUsernameAvailability,
        authReady: isAuthSessionReady(),
        result: 'skipped',
        failureReason: 'auth-context-stale',
        usernameLength: local.username.length,
      });
      return { ok: false, reason: 'auth-required' };
    }
    const data = response.data as Record<string, unknown>;
    if (data?.ok !== true) {
      const reason = mapReason(data?.reason);
      logUsernameService({
        stage: 'check-availability',
        functionName: CALLABLES.checkUsernameAvailability,
        authReady: isAuthSessionReady(),
        result: 'failure',
        failureReason: reason,
        usernameLength: local.username.length,
      });
      return { ok: false, reason };
    }
    logUsernameService({
      stage: 'check-availability',
      functionName: CALLABLES.checkUsernameAvailability,
      authReady: isAuthSessionReady(),
      result: 'success',
      usernameLength: local.username.length,
    });
    return {
      ok: true,
      available: data.available === true,
      usernameNormalized:
        typeof data.usernameNormalized === 'string'
          ? data.usernameNormalized
          : local.usernameNormalized,
      reason: data.reason ? mapReason(data.reason) : undefined,
    };
  } catch (error) {
    const reason = toClientReason(mapFirebaseCallableToUsernameFailure(error));
    logUsernameService({
      stage: 'check-availability',
      functionName: CALLABLES.checkUsernameAvailability,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: reason,
      usernameLength: local.username.length,
    });
    return { ok: false, reason };
  }
}

export async function setUsername(username: string): Promise<SetUsernameClientResult> {
  const local = validateUsernameFormat(username);
  if (!local.ok) {
    return { ok: false, reason: local.reason };
  }
  const uidAtStart = getAuthUidSnapshot();
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    logUsernameService({
      stage: 'set-username',
      functionName: CALLABLES.setUsername,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: 'function-not-found',
      usernameLength: local.username.length,
    });
    return { ok: false, reason: 'function-not-found' };
  }
  try {
    const callable = httpsCallable(functions, CALLABLES.setUsername);
    const response = await withCallableTimeout(callable({ username: local.username }));
    if (isAuthContextStale(uidAtStart)) {
      logUsernameService({
        stage: 'set-username',
        functionName: CALLABLES.setUsername,
        authReady: isAuthSessionReady(),
        result: 'skipped',
        failureReason: 'auth-context-stale',
        usernameLength: local.username.length,
      });
      return { ok: false, reason: 'auth-required' };
    }
    const data = response.data as Record<string, unknown>;
    if (data?.ok !== true) {
      const reason = mapReason(data?.reason);
      logUsernameService({
        stage: 'set-username',
        functionName: CALLABLES.setUsername,
        authReady: isAuthSessionReady(),
        result: 'failure',
        failureReason: reason,
        usernameLength: local.username.length,
      });
      return {
        ok: false,
        reason,
        nextChangeAvailableAtMs:
          typeof data?.nextChangeAvailableAtMs === 'number'
            ? data.nextChangeAvailableAtMs
            : null,
      };
    }
    logUsernameService({
      stage: 'set-username',
      functionName: CALLABLES.setUsername,
      authReady: isAuthSessionReady(),
      result: 'success',
      usernameLength: local.username.length,
    });
    notifyUsernameProfileChanged();
    void submitCurrentLeaderboardScore({ force: true });
    return {
      ok: true,
      username: String(data.username ?? local.username),
      usernameNormalized: String(data.usernameNormalized ?? local.usernameNormalized),
      setupCompleted: data.setupCompleted === true,
      changeCount: Math.max(0, Math.floor(Number(data.changeCount) || 0)),
      nextChangeAvailableAtMs:
        typeof data.nextChangeAvailableAtMs === 'number'
          ? data.nextChangeAvailableAtMs
          : null,
    };
  } catch (error) {
    const reason = toClientReason(mapFirebaseCallableToUsernameFailure(error));
    logUsernameService({
      stage: 'set-username',
      functionName: CALLABLES.setUsername,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: reason,
      usernameLength: local.username.length,
    });
    return { ok: false, reason };
  }
}
