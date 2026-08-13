/**
 * Haftalık liderlik tablosu — backend-authoritative V1
 *
 * Koleksiyon: leaderboards/{seasonKey}/entries/{uid}
 * Yazma yalnız Admin SDK (submitLeaderboardScore callable).
 */

import { httpsCallable, type Functions } from 'firebase/functions';
import { Platform } from 'react-native';

import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';
import { leaderboardConfig } from '../config/leaderboard';
import {
  eligibilityReasonToSubmitErrorCode,
  getLeaderboardSubmitEligibility,
  isExpectedLeaderboardSubmitSkip,
} from '../domain/leaderboardSubmitEligibility';
import { getLeaderboardSeasonKey } from '../utils/leaderboardSeason';
import { getAccountStatus, isAuthSessionReady, waitForInitialAuthState } from './authService';
import {
  getAuthUidSnapshot,
  isAuthContextStale,
  logLeaderboardService,
  mapBackendReasonToLeaderboardFailure,
  mapFirebaseCallableToLeaderboardFailure,
  withCallableTimeout,
  type LeaderboardFailureReason,
} from './callableServiceUtils';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAppSafe,
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
  isFirebaseEnabled,
} from './firebase';
import { ensureServerStateMigrated } from './serverStateMigrationService';
import { SAVE_GAME_VERSION } from '../storage/saveGame';

export const LEADERBOARD_CALLABLES = {
  submit: 'submitLeaderboardScore',
  get: 'getLeaderboard',
} as const;

export type LeaderboardErrorCode =
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'username-required'
  | 'save-not-found'
  | 'invalid-player-state'
  | 'invalid-request'
  | 'rate-limited'
  | 'season-closed'
  | 'score-not-improved'
  | 'service-unavailable'
  | 'firebase-disabled'
  | 'feature-disabled'
  | 'function-not-found'
  | 'function-unavailable'
  | 'network-error'
  | 'timeout'
  | 'permission-denied'
  | 'app-check-failed'
  | 'server-state-missing'
  | 'backend-not-ready'
  | 'malformed-response'
  | 'unknown';

export interface LeaderboardEntry {
  uid: string;
  username: string;
  companyName: string;
  companyScore: number;
  level: number;
  reputation: number;
  completedContracts: number;
  updatedAt: number;
  seasonKey: string;
}

export interface LeaderboardRankedEntry extends LeaderboardEntry {
  rank: number;
}

export interface LeaderboardFetchResult {
  ok: boolean;
  seasonKey: string;
  seasonStartMs?: number;
  seasonEndMs?: number;
  entries: LeaderboardRankedEntry[];
  playerEntry: LeaderboardEntry | null;
  playerRank: number | null;
  hasMore?: boolean;
  totalParticipants?: number;
  error?: string;
  errorCode?: LeaderboardErrorCode | string;
}

export interface LeaderboardSubmitResult {
  ok: boolean;
  updated?: boolean;
  score?: number;
  seasonKey?: string;
  errorCode?: LeaderboardErrorCode | string;
  error?: string;
}

function getLeaderboardFunctions(): Functions | null {
  return getFirebaseFunctionsSafe(FIREBASE_FUNCTIONS_REGION);
}

function callable<TInput, TOutput>(name: string) {
  const firebaseApp = getFirebaseAppSafe();
  const functions = getLeaderboardFunctions();
  if (!firebaseApp || !functions) return null;
  return httpsCallable<TInput, TOutput>(functions, name);
}

function toLeaderboardErrorCode(reason: LeaderboardFailureReason): LeaderboardErrorCode {
  if (reason === 'function-unavailable') {
    return 'function-not-found';
  }
  return reason as LeaderboardErrorCode;
}

function mapCallableError(error: unknown): LeaderboardErrorCode {
  return toLeaderboardErrorCode(mapFirebaseCallableToLeaderboardFailure(error));
}

export function isLeaderboardEligible(): boolean {
  if (!LEADERBOARD_ENABLED) return false;
  const account = getAccountStatus();
  if (!account.isReady || account.isAnonymous) {
    return false;
  }
  return account.provider === 'google' || account.provider === 'apple';
}

function normalizeEntry(
  raw: Record<string, unknown>,
  seasonKey: string,
  rank?: number,
): LeaderboardRankedEntry {
  const entry: LeaderboardRankedEntry = {
    uid: typeof raw.uid === 'string' ? raw.uid : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    companyName:
      typeof raw.companyName === 'string' ? raw.companyName : 'LogistiCore Lojistik',
    companyScore: typeof raw.companyScore === 'number' ? raw.companyScore : 0,
    level: typeof raw.level === 'number' ? raw.level : 1,
    reputation: typeof raw.reputation === 'number' ? raw.reputation : 0,
    completedContracts:
      typeof raw.completedContracts === 'number' ? raw.completedContracts : 0,
    updatedAt:
      typeof raw.updatedAtMs === 'number'
        ? raw.updatedAtMs
        : typeof raw.updatedAt === 'number'
          ? raw.updatedAt
          : Date.now(),
    seasonKey: typeof raw.seasonKey === 'string' ? raw.seasonKey : seasonKey,
    rank: typeof rank === 'number' ? rank : typeof raw.rank === 'number' ? raw.rank : 0,
  };
  return entry;
}

function createIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`.slice(0, 120);
}

const SUBMIT_MIN_INTERVAL_MS = 60_000;
let lastSuccessfulSubmitAt = 0;
let lastSubmittedScore: number | undefined;
const skippedSubmitLogAt = new Map<string, number>();
const SKIPPED_SUBMIT_LOG_COOLDOWN_MS = 60_000;
let backendConfigLogged = false;

function shouldLogLeaderboardDiagnostics(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function logLeaderboardBackendConfigOnce(): void {
  if (!shouldLogLeaderboardDiagnostics() || backendConfigLogged) {
    return;
  }
  backendConfigLogged = true;
  const account = getAccountStatus();
  const app = getFirebaseAppSafe();
  console.info('[leaderboard-backend-config]', {
    platform: Platform.OS,
    projectId: app?.options.projectId ?? null,
    functionsRegion: FIREBASE_FUNCTIONS_REGION,
    authenticated: account.isReady && Boolean(account.uid),
    anonymous: account.isAnonymous,
    seasonKeySource: 'server',
  });
}

function logLeaderboardCrossPlatform(payload: {
  submitSuccess?: boolean;
  serverSeasonKey?: string;
  entryCount?: number;
  totalParticipants?: number;
  currentUserRank?: number | null;
  errorCode?: string;
}): void {
  if (!shouldLogLeaderboardDiagnostics()) {
    return;
  }
  const account = getAccountStatus();
  const app = getFirebaseAppSafe();
  console.info('[leaderboard-cross-platform]', {
    platform: Platform.OS,
    projectId: app?.options.projectId ?? null,
    uidPresent: Boolean(account.uid),
    anonymous: account.isAnonymous,
    usernamePresent: null,
    serverSeasonKey: payload.serverSeasonKey ?? null,
    submitSuccess: payload.submitSuccess ?? null,
    entryCount: payload.entryCount ?? null,
    totalParticipants: payload.totalParticipants ?? null,
    currentUserRank: payload.currentUserRank ?? null,
    errorCode: payload.errorCode ?? null,
  });
}

function logLeaderboardSubmitSkipped(reason: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const now = Date.now();
  const lastLoggedAt = skippedSubmitLogAt.get(reason) ?? 0;
  if (now - lastLoggedAt < SKIPPED_SUBMIT_LOG_COOLDOWN_MS) {
    return;
  }
  skippedSubmitLogAt.set(reason, now);
  console.info('[leaderboard-submit-skipped]', { reason });
}

function isValidFetchPayload(data: Record<string, unknown> | undefined): boolean {
  return Boolean(data && data.ok === true && typeof data.seasonKey === 'string');
}

/**
 * Canonical leaderboard upsert — server state migration + trusted submit.
 */
export async function submitCurrentLeaderboardScore(options?: {
  force?: boolean;
  clientSaveVersion?: number;
}): Promise<LeaderboardSubmitResult> {
  if (!LEADERBOARD_ENABLED) {
    return { ok: false, errorCode: 'feature-disabled' };
  }

  const eligibility = getLeaderboardSubmitEligibility();
  if (!eligibility.eligible) {
    logLeaderboardSubmitSkipped(eligibility.reason);
    return {
      ok: false,
      errorCode: eligibilityReasonToSubmitErrorCode(eligibility.reason),
    };
  }

  await waitForInitialAuthState();

  const now = Date.now();
  if (
    !options?.force &&
    now - lastSuccessfulSubmitAt < SUBMIT_MIN_INTERVAL_MS &&
    lastSubmittedScore != null
  ) {
    return {
      ok: true,
      updated: false,
      score: lastSubmittedScore,
    };
  }

  await ensureServerStateMigrated();

  const result = await submitLeaderboardScore({
    clientSaveVersion: options?.clientSaveVersion ?? SAVE_GAME_VERSION,
    idempotencyKey: createIdempotencyKey('lb-upsert'),
  });
  if (result.ok) {
    lastSuccessfulSubmitAt = now;
    if (typeof result.score === 'number') {
      lastSubmittedScore = result.score;
    }
  }
  return result;
}

export function resetLeaderboardSubmitCache(): void {
  lastSuccessfulSubmitAt = 0;
  lastSubmittedScore = undefined;
}

/**
 * Trusted backend skor gönderimi. Client raw score göndermez.
 */
export async function submitLeaderboardScore(options?: {
  clientSaveVersion?: number;
  idempotencyKey?: string;
}): Promise<LeaderboardSubmitResult> {
  if (!LEADERBOARD_ENABLED) {
    return { ok: false, errorCode: 'feature-disabled' };
  }

  const eligibility = getLeaderboardSubmitEligibility();
  if (!eligibility.eligible) {
    logLeaderboardSubmitSkipped(eligibility.reason);
    return {
      ok: false,
      errorCode: eligibilityReasonToSubmitErrorCode(eligibility.reason),
    };
  }

  if (!isFirebaseEnabled() || !isAuthSessionReady()) {
    return { ok: false, errorCode: 'auth-required' };
  }

  const fn = callable<
    {
      transactionId: string;
      idempotencyKey: string;
      clientSaveVersion?: number;
    },
    {
      ok: boolean;
      reason?: string;
      updated?: boolean;
      score?: number;
      seasonKey?: string;
    }
  >(LEADERBOARD_CALLABLES.submit);

  if (!fn) {
    return { ok: false, errorCode: 'firebase-disabled' };
  }

  logLeaderboardBackendConfigOnce();

  const transactionId = createIdempotencyKey('lb-tx');
  const idempotencyKey = options?.idempotencyKey ?? createIdempotencyKey('lb-idem');
  const uidAtStart = getAuthUidSnapshot();

  try {
    const response = await withCallableTimeout(
      fn({
        transactionId,
        idempotencyKey,
        ...(options?.clientSaveVersion != null
          ? { clientSaveVersion: options.clientSaveVersion }
          : {}),
      }),
    );
    if (isAuthContextStale(uidAtStart)) {
      logLeaderboardService({
        stage: 'submit',
        functionName: LEADERBOARD_CALLABLES.submit,
        authReady: isAuthSessionReady(),
        result: 'skipped',
        failureReason: 'auth-context-stale',
      });
      return { ok: false, errorCode: 'auth-required' };
    }
    const data = response.data;
    if (!data?.ok) {
      const errorCode = toLeaderboardErrorCode(mapBackendReasonToLeaderboardFailure(data?.reason));
      logLeaderboardService({
        stage: 'submit',
        functionName: LEADERBOARD_CALLABLES.submit,
        authReady: isAuthSessionReady(),
        result: 'failure',
        failureReason: errorCode,
      });
      return {
        ok: false,
        errorCode,
        error: data?.reason,
      };
    }
    logLeaderboardService({
      stage: 'submit',
      functionName: LEADERBOARD_CALLABLES.submit,
      authReady: isAuthSessionReady(),
      result: 'success',
    });
    logLeaderboardCrossPlatform({
      submitSuccess: true,
      serverSeasonKey: data.seasonKey,
    });
    return {
      ok: true,
      updated: Boolean(data.updated),
      score: data.score,
      seasonKey: data.seasonKey,
      errorCode: data.reason === 'score-not-improved' ? 'score-not-improved' : undefined,
    };
  } catch (error) {
    const errorCode = mapCallableError(error);
    logLeaderboardService({
      stage: 'submit',
      functionName: LEADERBOARD_CALLABLES.submit,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: errorCode,
    });
    return {
      ok: false,
      errorCode,
      error: error instanceof Error ? error.message : 'submit-failed',
    };
  }
}

/** @deprecated Client Firestore write kaldırıldı — submitLeaderboardScore kullanın. */
export async function syncLeaderboardEntry(_input: {
  uid: string;
  companyName: string;
  companyScore: number;
  level: number;
  reputation: number;
  completedContracts: number;
  seasonKey?: string;
}): Promise<boolean> {
  const result = await submitLeaderboardScore();
  return result.ok;
}

export async function fetchWeeklyLeaderboard(
  _uid: string | null,
  _seasonKey?: string,
): Promise<LeaderboardFetchResult> {
  const fallbackSeasonKey = getLeaderboardSeasonKey();
  if (!LEADERBOARD_ENABLED) {
    return {
      ok: false,
      seasonKey: fallbackSeasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode: 'feature-disabled',
      error: 'feature-disabled',
    };
  }
  if (!isFirebaseEnabled()) {
    return {
      ok: false,
      seasonKey: fallbackSeasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode: 'firebase-disabled',
      error: 'firebase-disabled',
    };
  }

  await waitForInitialAuthState();

  const user = getFirebaseAuthSafe()?.currentUser;
  if (!user) {
    return {
      ok: false,
      seasonKey: fallbackSeasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode: 'auth-required',
      error: 'auth-required',
    };
  }
  if (user.isAnonymous) {
    return {
      ok: false,
      seasonKey: fallbackSeasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode: 'anonymous-not-supported',
      error: 'anonymous-not-supported',
    };
  }

  const fn = callable<
    { seasonKey?: string; limit?: number },
    {
      ok: boolean;
      reason?: string;
      seasonKey?: string;
      seasonStartMs?: number;
      seasonEndMs?: number;
      entries?: Array<Record<string, unknown>>;
      playerEntry?: Record<string, unknown> | null;
      playerRank?: number | null;
      hasMore?: boolean;
      totalParticipants?: number;
    }
  >(LEADERBOARD_CALLABLES.get);

  if (!fn) {
    return {
      ok: false,
      seasonKey: fallbackSeasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode: 'firebase-disabled',
    };
  }

  logLeaderboardBackendConfigOnce();

  const uidAtStart = getAuthUidSnapshot();

  try {
    const response = await withCallableTimeout(
      fn({
        limit: leaderboardConfig.leaderboardSize,
      }),
    );
    if (isAuthContextStale(uidAtStart)) {
      logLeaderboardService({
        stage: 'fetch',
        functionName: LEADERBOARD_CALLABLES.get,
        authReady: isAuthSessionReady(),
        result: 'skipped',
        failureReason: 'auth-context-stale',
      });
      return {
        ok: false,
        seasonKey: fallbackSeasonKey,
        entries: [],
        playerEntry: null,
        playerRank: null,
        errorCode: 'auth-required',
        error: 'auth-context-stale',
      };
    }
    const data = response.data;
    if (!isValidFetchPayload(data as Record<string, unknown>)) {
      const errorCode: LeaderboardErrorCode = data?.ok === false
        ? toLeaderboardErrorCode(mapBackendReasonToLeaderboardFailure(data?.reason))
        : 'malformed-response';
      logLeaderboardService({
        stage: 'fetch',
        functionName: LEADERBOARD_CALLABLES.get,
        authReady: isAuthSessionReady(),
        result: 'failure',
        failureReason: errorCode,
      });
      return {
        ok: false,
        seasonKey:
          typeof data?.seasonKey === 'string' ? data.seasonKey : fallbackSeasonKey,
        entries: [],
        playerEntry: null,
        playerRank: null,
        errorCode,
        error: data?.reason ?? 'malformed-response',
      };
    }

    const resolvedSeason = data.seasonKey ?? fallbackSeasonKey;
    const seenRanks = new Set<number>();
    const entries = (data.entries ?? [])
      .map((entry, index) =>
        normalizeEntry(entry, resolvedSeason, typeof entry.rank === 'number' ? entry.rank : index + 1),
      )
      .filter((entry) => {
        if (!entry.uid || !entry.username) {
          return false;
        }
        if (seenRanks.has(entry.rank)) {
          return false;
        }
        seenRanks.add(entry.rank);
        return true;
      });
    const playerEntry = data.playerEntry
      ? normalizeEntry(
          data.playerEntry,
          resolvedSeason,
          typeof data.playerRank === 'number' ? data.playerRank : undefined,
        )
      : null;

    logLeaderboardService({
      stage: 'fetch',
      functionName: LEADERBOARD_CALLABLES.get,
      authReady: isAuthSessionReady(),
      result: 'success',
    });
    logLeaderboardCrossPlatform({
      serverSeasonKey: resolvedSeason,
      entryCount: entries.length,
      totalParticipants:
        typeof data.totalParticipants === 'number' ? data.totalParticipants : entries.length,
      currentUserRank: data.playerRank ?? null,
    });

    return {
      ok: true,
      seasonKey: resolvedSeason,
      seasonStartMs: data.seasonStartMs,
      seasonEndMs: data.seasonEndMs,
      entries,
      playerEntry: playerEntry?.uid ? playerEntry : null,
      playerRank: data.playerRank ?? null,
      hasMore: Boolean(data.hasMore),
      totalParticipants:
        typeof data.totalParticipants === 'number' ? data.totalParticipants : entries.length,
    };
  } catch (error) {
    const errorCode = mapCallableError(error);
    logLeaderboardService({
      stage: 'fetch',
      functionName: LEADERBOARD_CALLABLES.get,
      authReady: isAuthSessionReady(),
      result: 'failure',
      failureReason: errorCode,
    });
    return {
      ok: false,
      seasonKey: fallbackSeasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode,
      error: error instanceof Error ? error.message : 'fetch-failed',
    };
  }
}
