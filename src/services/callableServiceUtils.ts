/**
 * Shared Firebase callable error mapping, logging, timeout, and auth-stale guards.
 */

import { FIREBASE_FUNCTIONS_REGION } from './firebase';
import { getFirebaseAuthSafe } from './firebase';

export const CALLABLE_TIMEOUT_MS = 25_000;

export type UsernameFailureReason =
  | 'unauthenticated'
  | 'function-not-found'
  | 'function-unavailable'
  | 'permission-denied'
  | 'app-check-failed'
  | 'invalid-argument'
  | 'username-taken'
  | 'username-invalid'
  | 'rate-limited'
  | 'malformed-response'
  | 'network-error'
  | 'timeout'
  | 'unknown'
  | 'username-too-short'
  | 'username-too-long'
  | 'username-reserved'
  | 'username-inappropriate'
  | 'username-change-cooldown'
  | 'username-required'
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'invalid-request'
  | 'service-unavailable';

export type LeaderboardFailureReason =
  | 'unauthenticated'
  | 'function-not-found'
  | 'function-unavailable'
  | 'permission-denied'
  | 'app-check-failed'
  | 'backend-not-ready'
  | 'server-state-missing'
  | 'malformed-response'
  | 'network-error'
  | 'timeout'
  | 'unknown'
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'username-required'
  | 'save-not-found'
  | 'invalid-player-state'
  | 'invalid-request'
  | 'rate-limited'
  | 'season-closed'
  | 'score-not-improved'
  | 'not-ranked-eligible'
  | 'service-unavailable'
  | 'firebase-disabled'
  | 'feature-disabled';

export function getAuthUidSnapshot(): string | null {
  return getFirebaseAuthSafe()?.currentUser?.uid ?? null;
}

export function isAuthContextStale(uidAtStart: string | null): boolean {
  const current = getAuthUidSnapshot();
  if (!uidAtStart || !current) {
    return uidAtStart !== current;
  }
  return uidAtStart !== current;
}

export function maskUsernameForLog(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return '(empty)';
  if (trimmed.length <= 2) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 2)}*** (len=${trimmed.length})`;
}

function extractCallableErrorBlob(error: unknown): { code: string; message: string; details: string } {
  if (!error || typeof error !== 'object') {
    return { code: '', message: String(error ?? ''), details: '' };
  }
  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message ?? '') : '';
  const details =
    'details' in error && (error as { details?: unknown }).details != null
      ? String((error as { details?: unknown }).details)
      : '';
  return { code, message, details };
}

export function mapFirebaseCallableToUsernameFailure(error: unknown): UsernameFailureReason {
  const { code, message, details } = extractCallableErrorBlob(error);
  const blob = `${code} ${message} ${details}`.toLowerCase();
  if (code === 'functions/not-found' || blob.includes('not-found')) {
    return 'function-not-found';
  }
  if (code === 'functions/deadline-exceeded' || blob.includes('deadline-exceeded')) {
    return 'timeout';
  }
  if (code === 'functions/unauthenticated' || blob.includes('auth-required')) {
    return 'unauthenticated';
  }
  if (code === 'functions/permission-denied' || blob.includes('permission-denied')) {
    return 'permission-denied';
  }
  if (blob.includes('app-check') || blob.includes('appcheck')) {
    return 'app-check-failed';
  }
  if (code === 'functions/resource-exhausted' || blob.includes('rate-limited')) {
    return 'rate-limited';
  }
  if (code === 'functions/invalid-argument' || blob.includes('invalid-argument')) {
    return 'invalid-argument';
  }
  if (code === 'functions/unavailable' || code === 'functions/internal') {
    return 'function-unavailable';
  }
  if (blob.includes('network') || blob.includes('fetch') || blob.includes('failed to fetch')) {
    return 'network-error';
  }
  return 'network-error';
}

export function mapFirebaseCallableToLeaderboardFailure(error: unknown): LeaderboardFailureReason {
  const { code, message, details } = extractCallableErrorBlob(error);
  const blob = `${code} ${message} ${details}`.toLowerCase();
  if (code === 'functions/not-found' || blob.includes('not-found')) {
    return 'function-not-found';
  }
  if (code === 'functions/deadline-exceeded' || blob.includes('deadline-exceeded')) {
    return 'timeout';
  }
  if (code === 'functions/unauthenticated' || blob.includes('auth-required')) {
    return 'auth-required';
  }
  if (blob.includes('anonymous-not-supported')) {
    return 'anonymous-not-supported';
  }
  if (code === 'functions/permission-denied' || blob.includes('permission-denied')) {
    return 'permission-denied';
  }
  if (blob.includes('app-check') || blob.includes('appcheck')) {
    return 'app-check-failed';
  }
  if (blob.includes('server-state-not-initialized') || blob.includes('server-state-missing')) {
    return 'server-state-missing';
  }
  if (blob.includes('save-not-found')) {
    return 'save-not-found';
  }
  if (blob.includes('invalid-player-state')) {
    return 'invalid-player-state';
  }
  if (blob.includes('username-required')) {
    return 'username-required';
  }
  if (code === 'functions/resource-exhausted' || blob.includes('rate-limited')) {
    return 'rate-limited';
  }
  if (blob.includes('season-closed')) {
    return 'season-closed';
  }
  if (code === 'functions/unavailable' || code === 'functions/internal') {
    return 'function-unavailable';
  }
  if (blob.includes('network') || blob.includes('fetch')) {
    return 'network-error';
  }
  return 'network-error';
}

export function mapBackendReasonToUsernameFailure(raw: unknown): UsernameFailureReason {
  if (typeof raw !== 'string' || raw.length === 0) {
    return 'malformed-response';
  }
  const known: UsernameFailureReason[] = [
    'username-taken',
    'username-invalid',
    'username-too-short',
    'username-too-long',
    'username-reserved',
    'username-inappropriate',
    'username-change-cooldown',
    'username-required',
    'auth-required',
    'anonymous-not-supported',
    'rate-limited',
    'invalid-request',
    'service-unavailable',
    'permission-denied',
    'unauthenticated',
  ];
  if (known.includes(raw as UsernameFailureReason)) {
    return raw as UsernameFailureReason;
  }
  if (raw === 'username-taken') return 'username-taken';
  return 'unknown';
}

export function mapBackendReasonToLeaderboardFailure(raw: unknown): LeaderboardFailureReason {
  if (typeof raw !== 'string' || raw.length === 0) {
    return 'malformed-response';
  }
  const known: LeaderboardFailureReason[] = [
    'auth-required',
    'anonymous-not-supported',
    'username-required',
    'save-not-found',
    'invalid-player-state',
    'invalid-request',
    'rate-limited',
    'season-closed',
    'score-not-improved',
    'not-ranked-eligible',
    'service-unavailable',
    'server-state-missing',
    'backend-not-ready',
    'permission-denied',
  ];
  if (known.includes(raw as LeaderboardFailureReason)) {
    return raw as LeaderboardFailureReason;
  }
  if (raw === 'server-state-not-initialized') {
    return 'server-state-missing';
  }
  return 'unknown';
}

export interface UsernameServiceLogPayload {
  stage: string;
  functionName: string;
  region?: string;
  authReady?: boolean;
  appCheckReady?: boolean;
  result: 'success' | 'failure' | 'skipped';
  failureReason?: string | null;
  usernameLength?: number | null;
}

export function logUsernameService(payload: UsernameServiceLogPayload): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    if (process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED !== 'true') {
      return;
    }
  }
  console.log('[username-service]', {
    stage: payload.stage,
    functionName: payload.functionName,
    region: payload.region ?? FIREBASE_FUNCTIONS_REGION,
    authReady: payload.authReady ?? null,
    appCheckReady: payload.appCheckReady ?? false,
    result: payload.result,
    failureReason: payload.failureReason ?? null,
    usernameLength: payload.usernameLength ?? null,
  });
}

export interface LeaderboardServiceLogPayload {
  stage: string;
  functionName: string;
  region?: string;
  authReady?: boolean;
  appCheckReady?: boolean;
  result: 'success' | 'failure' | 'skipped';
  failureReason?: string | null;
}

export function logLeaderboardService(payload: LeaderboardServiceLogPayload): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    if (process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED !== 'true') {
      return;
    }
  }
  console.log('[leaderboard-service]', {
    stage: payload.stage,
    functionName: payload.functionName,
    region: payload.region ?? FIREBASE_FUNCTIONS_REGION,
    authReady: payload.authReady ?? null,
    appCheckReady: payload.appCheckReady ?? false,
    result: payload.result,
    failureReason: payload.failureReason ?? null,
  });
}

export async function withCallableTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = CALLABLE_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(Object.assign(new Error('callable-timeout'), { code: 'functions/deadline-exceeded' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
