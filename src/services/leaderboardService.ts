/**
 * Haftalık liderlik tablosu — backend-authoritative V1
 *
 * Koleksiyon: leaderboards/{seasonKey}/entries/{uid}
 * Yazma yalnız Admin SDK (submitLeaderboardScore callable).
 */

import { httpsCallable, type Functions } from 'firebase/functions';

import { LEADERBOARD_ENABLED } from '../config/backendRoadmap';
import { leaderboardConfig } from '../config/leaderboard';
import { getLeaderboardSeasonKey } from '../utils/leaderboardSeason';
import { getAccountStatus, isAuthSessionReady } from './authService';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAppSafe,
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
  isFirebaseEnabled,
} from './firebase';

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
  | 'network-error';

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

function mapCallableError(error: unknown): LeaderboardErrorCode {
  if (!error || typeof error !== 'object') return 'network-error';
  const code = 'code' in error ? String((error as { code?: string }).code ?? '') : '';
  const message =
    'message' in error ? String((error as { message?: string }).message ?? '') : '';
  const details =
    'details' in error && (error as { details?: unknown }).details
      ? String((error as { details?: unknown }).details)
      : '';
  const blob = `${code} ${message} ${details}`.toLowerCase();
  if (blob.includes('auth-required') || code === 'functions/unauthenticated') {
    return 'auth-required';
  }
  if (blob.includes('anonymous-not-supported')) return 'anonymous-not-supported';
  if (blob.includes('save-not-found')) return 'save-not-found';
  if (blob.includes('invalid-player-state')) return 'invalid-player-state';
  if (blob.includes('rate-limited') || code === 'functions/resource-exhausted') {
    return 'rate-limited';
  }
  if (blob.includes('season-closed')) return 'season-closed';
  if (blob.includes('score-not-improved')) return 'score-not-improved';
  if (code === 'functions/unavailable' || code === 'functions/internal') {
    return 'service-unavailable';
  }
  return 'network-error';
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
  if (!isFirebaseEnabled() || !isAuthSessionReady()) {
    return { ok: false, errorCode: 'auth-required' };
  }
  if (!isLeaderboardEligible()) {
    const account = getAccountStatus();
    return {
      ok: false,
      errorCode: account?.isAnonymous ? 'anonymous-not-supported' : 'auth-required',
    };
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

  const transactionId = createIdempotencyKey('lb-tx');
  const idempotencyKey = options?.idempotencyKey ?? createIdempotencyKey('lb-idem');

  try {
    const response = await fn({
      transactionId,
      idempotencyKey,
      ...(options?.clientSaveVersion != null
        ? { clientSaveVersion: options.clientSaveVersion }
        : {}),
    });
    const data = response.data;
    if (!data?.ok) {
      return {
        ok: false,
        errorCode: (data?.reason as LeaderboardErrorCode) ?? 'service-unavailable',
        error: data?.reason,
      };
    }
    return {
      ok: true,
      updated: Boolean(data.updated),
      score: data.score,
      seasonKey: data.seasonKey,
      errorCode: data.reason === 'score-not-improved' ? 'score-not-improved' : undefined,
    };
  } catch (error) {
    const errorCode = mapCallableError(error);
    if (__DEV__) {
      console.warn('[leaderboard] submit failed', { errorCode, error });
    }
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
  seasonKey: string = getLeaderboardSeasonKey(),
): Promise<LeaderboardFetchResult> {
  if (!LEADERBOARD_ENABLED) {
    return {
      ok: false,
      seasonKey,
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
      seasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode: 'firebase-disabled',
      error: 'firebase-disabled',
    };
  }

  const user = getFirebaseAuthSafe()?.currentUser;
  if (!user) {
    return {
      ok: false,
      seasonKey,
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
      seasonKey,
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
    }
  >(LEADERBOARD_CALLABLES.get);

  if (!fn) {
    return {
      ok: false,
      seasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode: 'firebase-disabled',
    };
  }

  try {
    const response = await fn({
      seasonKey,
      limit: leaderboardConfig.leaderboardSize,
    });
    const data = response.data;
    if (!data?.ok) {
      return {
        ok: false,
        seasonKey: data?.seasonKey ?? seasonKey,
        entries: [],
        playerEntry: null,
        playerRank: null,
        errorCode: (data?.reason as LeaderboardErrorCode) ?? 'service-unavailable',
        error: data?.reason,
      };
    }

    const resolvedSeason = data.seasonKey ?? seasonKey;
    const entries = (data.entries ?? []).map((entry, index) =>
      normalizeEntry(entry, resolvedSeason, typeof entry.rank === 'number' ? entry.rank : index + 1),
    );
    const playerEntry = data.playerEntry
      ? normalizeEntry(
          data.playerEntry,
          resolvedSeason,
          typeof data.playerRank === 'number' ? data.playerRank : undefined,
        )
      : null;

    return {
      ok: true,
      seasonKey: resolvedSeason,
      seasonStartMs: data.seasonStartMs,
      seasonEndMs: data.seasonEndMs,
      entries,
      playerEntry,
      playerRank: data.playerRank ?? null,
      hasMore: Boolean(data.hasMore),
    };
  } catch (error) {
    const errorCode = mapCallableError(error);
    if (__DEV__) {
      console.warn('[leaderboard] fetch failed', { errorCode, error });
    }
    return {
      ok: false,
      seasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      errorCode,
      error: error instanceof Error ? error.message : 'fetch-failed',
    };
  }
}
