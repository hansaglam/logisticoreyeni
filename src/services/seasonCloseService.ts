/**
 * Phase 7 Step 3 — Trusted closed-season finals client API.
 *
 * Authority: backend getSeasonResult callable → seasons/{seasonKey}/results/{uid}
 * NEVER falls back to mutable historical leaderboard entry documents.
 */

import { httpsCallable } from 'firebase/functions';

import { SEASON_CLOSE_SNAPSHOT_ENABLED } from '../config/backendRoadmap';
import type {
  SeasonHistoryEntry,
  SeasonHistoryFinalLeaderboard,
} from '../domain/progressionFoundation';
import { waitForInitialAuthState } from './authService';
import { withCallableTimeout } from './callableServiceUtils';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
  isFirebaseEnabled,
} from './firebase';

export const SEASON_CLOSE_CALLABLES = {
  getSeasonResult: 'getSeasonResult',
  ensureSeasonFinalized: 'ensureSeasonFinalizedCallable',
} as const;

/** Max closed seasons enriched per history refresh (matches Progress History visible window). */
export const SEASON_HISTORY_FINALS_ENRICH_LIMIT = 6;

export type GetSeasonResultClientReason =
  | 'success'
  | 'feature-disabled'
  | 'firebase-disabled'
  | 'auth-required'
  | 'anonymous-not-allowed'
  | 'invalid-request'
  | 'invalid-season-key'
  | 'season-active'
  | 'season-future'
  | 'finalization-pending'
  | 'not-participated'
  | 'rate-limited'
  | 'malformed-response'
  | 'timeout'
  | 'service-unavailable';

export type ClosedSeasonResultPayload = {
  uid: string;
  seasonKey: string;
  finalScore: number;
  finalRank: number;
  participantCount: number;
  snapshottedAt: number;
  snapshotVersion: number;
};

export type ClosedSeasonMetaPayload = {
  seasonKey: string;
  startsAt: number;
  endsAt: number;
  status: 'closing' | 'closed';
  participantCount: number;
  snapshotVersion: number;
  closedAt: number | null;
};

export type GetSeasonResultClientResponse = {
  ok: boolean;
  reason: GetSeasonResultClientReason;
  seasonKey: string;
  season: ClosedSeasonMetaPayload | null;
  result: ClosedSeasonResultPayload | null;
};

type BackendGetSeasonResultResponse = {
  ok?: boolean;
  reason?: string;
  seasonKey?: string;
  season?: Partial<ClosedSeasonMetaPayload> | null;
  result?: Partial<ClosedSeasonResultPayload> | null;
};

function mapReason(raw: string | undefined): GetSeasonResultClientReason {
  switch (raw) {
    case 'success':
      return 'success';
    case 'feature-disabled':
      return 'feature-disabled';
    case 'unauthenticated':
      return 'auth-required';
    case 'anonymous-not-allowed':
      return 'anonymous-not-allowed';
    case 'invalid-request':
      return 'invalid-request';
    case 'invalid-season-key':
      return 'invalid-season-key';
    case 'season-active':
      return 'season-active';
    case 'season-future':
      return 'season-future';
    case 'finalization-pending':
      return 'finalization-pending';
    case 'not-participated':
      return 'not-participated';
    case 'rate-limited':
      return 'rate-limited';
    case 'service-unavailable':
      return 'service-unavailable';
    default:
      return 'service-unavailable';
  }
}

function parseResultPayload(
  value: Partial<ClosedSeasonResultPayload> | null | undefined,
  expectedSeasonKey: string,
): ClosedSeasonResultPayload | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.uid !== 'string' || value.uid.length === 0) return null;
  if (typeof value.seasonKey !== 'string' || value.seasonKey !== expectedSeasonKey) return null;
  if (typeof value.finalScore !== 'number' || !Number.isFinite(value.finalScore) || value.finalScore < 0) {
    return null;
  }
  if (typeof value.finalRank !== 'number' || !Number.isFinite(value.finalRank) || value.finalRank < 1) {
    return null;
  }
  if (
    typeof value.participantCount !== 'number' ||
    !Number.isFinite(value.participantCount) ||
    value.participantCount < 0
  ) {
    return null;
  }
  if (
    typeof value.snapshottedAt !== 'number' ||
    !Number.isFinite(value.snapshottedAt) ||
    value.snapshottedAt < 0
  ) {
    return null;
  }
  if (
    typeof value.snapshotVersion !== 'number' ||
    !Number.isFinite(value.snapshotVersion) ||
    value.snapshotVersion < 1
  ) {
    return null;
  }
  return {
    uid: value.uid,
    seasonKey: value.seasonKey,
    finalScore: Math.floor(value.finalScore),
    finalRank: Math.floor(value.finalRank),
    participantCount: Math.floor(value.participantCount),
    snapshottedAt: Math.floor(value.snapshottedAt),
    snapshotVersion: Math.floor(value.snapshotVersion),
  };
}

function parseSeasonMeta(
  value: Partial<ClosedSeasonMetaPayload> | null | undefined,
  expectedSeasonKey: string,
): ClosedSeasonMetaPayload | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.seasonKey !== 'string' || value.seasonKey !== expectedSeasonKey) return null;
  if (value.status !== 'closing' && value.status !== 'closed') return null;
  if (typeof value.startsAt !== 'number' || !Number.isFinite(value.startsAt)) return null;
  if (typeof value.endsAt !== 'number' || !Number.isFinite(value.endsAt)) return null;
  if (typeof value.participantCount !== 'number' || !Number.isFinite(value.participantCount)) {
    return null;
  }
  if (typeof value.snapshotVersion !== 'number' || !Number.isFinite(value.snapshotVersion)) {
    return null;
  }
  return {
    seasonKey: value.seasonKey,
    startsAt: Math.floor(value.startsAt),
    endsAt: Math.floor(value.endsAt),
    status: value.status,
    participantCount: Math.max(0, Math.floor(value.participantCount)),
    snapshotVersion: Math.max(1, Math.floor(value.snapshotVersion)),
    closedAt:
      value.closedAt == null || !Number.isFinite(Number(value.closedAt))
        ? null
        : Math.floor(Number(value.closedAt)),
  };
}

export function mapSeasonResultToFinalLeaderboard(
  response: GetSeasonResultClientResponse,
): SeasonHistoryFinalLeaderboard {
  if (response.ok && response.reason === 'success' && response.result) {
    return {
      state: 'available',
      finalScore: response.result.finalScore,
      finalRank: response.result.finalRank,
      participantCount: response.result.participantCount,
      snapshotVersion: response.result.snapshotVersion,
    };
  }
  if (response.reason === 'not-participated') {
    return { state: 'not_ranked' };
  }
  if (response.reason === 'finalization-pending') {
    return { state: 'pending' };
  }
  return { state: 'unavailable' };
}

/**
 * Fetch the authenticated caller's immutable closed-season result.
 * Request body contains seasonKey only.
 */
export async function getSeasonResult(seasonKey: string): Promise<GetSeasonResultClientResponse> {
  const key = typeof seasonKey === 'string' ? seasonKey.trim() : '';
  if (!SEASON_CLOSE_SNAPSHOT_ENABLED) {
    return {
      ok: false,
      reason: 'feature-disabled',
      seasonKey: key,
      season: null,
      result: null,
    };
  }
  if (!isFirebaseEnabled()) {
    return {
      ok: false,
      reason: 'firebase-disabled',
      seasonKey: key,
      season: null,
      result: null,
    };
  }
  if (!/^\d{4}-W\d{2}$/.test(key)) {
    return {
      ok: false,
      reason: 'invalid-season-key',
      seasonKey: key,
      season: null,
      result: null,
    };
  }

  await waitForInitialAuthState();
  const user = getFirebaseAuthSafe()?.currentUser;
  if (!user) {
    return {
      ok: false,
      reason: 'auth-required',
      seasonKey: key,
      season: null,
      result: null,
    };
  }
  if (user.isAnonymous) {
    return {
      ok: false,
      reason: 'anonymous-not-allowed',
      seasonKey: key,
      season: null,
      result: null,
    };
  }

  const functions = getFirebaseFunctionsSafe(FIREBASE_FUNCTIONS_REGION);
  if (!functions) {
    return {
      ok: false,
      reason: 'service-unavailable',
      seasonKey: key,
      season: null,
      result: null,
    };
  }

  try {
    const call = httpsCallable<{ seasonKey: string }, BackendGetSeasonResultResponse>(
      functions,
      SEASON_CLOSE_CALLABLES.getSeasonResult,
    );
    // Explicitly only seasonKey — never uid/rank/score.
    const response = await withCallableTimeout(call({ seasonKey: key }));
    const data = (response.data ?? {}) as BackendGetSeasonResultResponse;
    const reason = mapReason(typeof data.reason === 'string' ? data.reason : undefined);
    const season = parseSeasonMeta(data.season ?? null, key);
    const result = parseResultPayload(data.result ?? null, key);

    if (data.ok === true && reason === 'success') {
      if (!result) {
        return {
          ok: false,
          reason: 'malformed-response',
          seasonKey: key,
          season,
          result: null,
        };
      }
      return {
        ok: true,
        reason: 'success',
        seasonKey: key,
        season,
        result,
      };
    }

    if (data.ok === true && reason === 'not-participated') {
      return {
        ok: true,
        reason: 'not-participated',
        seasonKey: key,
        season,
        result: null,
      };
    }

    return {
      ok: false,
      reason,
      seasonKey: key,
      season,
      result: null,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (code.includes('deadline-exceeded') || code.includes('timeout')) {
      return {
        ok: false,
        reason: 'timeout',
        seasonKey: key,
        season: null,
        result: null,
      };
    }
    return {
      ok: false,
      reason: 'service-unavailable',
      seasonKey: key,
      season: null,
      result: null,
    };
  }
}

function applyFinalsToEntry(
  entry: SeasonHistoryEntry,
  finals: SeasonHistoryFinalLeaderboard,
): SeasonHistoryEntry {
  return {
    ...entry,
    finalLeaderboard: finals,
    ...(finals.state === 'available'
      ? {
          finalLeaderboardRank: finals.finalRank,
          finalLeaderboardScore: finals.finalScore,
        }
      : {
          finalLeaderboardRank: undefined,
          finalLeaderboardScore: undefined,
        }),
  };
}

/**
 * Enrich closed-season history with trusted finals.
 * Bounded concurrency; never reads mutable leaderboard collections.
 */
export async function enrichSeasonHistoryWithCloseResults(
  entries: readonly SeasonHistoryEntry[],
  options?: { limit?: number; concurrency?: number },
): Promise<SeasonHistoryEntry[]> {
  if (!SEASON_CLOSE_SNAPSHOT_ENABLED || entries.length === 0) {
    return [...entries];
  }

  const limit = Math.max(0, Math.floor(options?.limit ?? SEASON_HISTORY_FINALS_ENRICH_LIMIT));
  const concurrency = Math.max(1, Math.min(3, Math.floor(options?.concurrency ?? 3)));
  const targets = entries.slice(0, limit);
  const enriched = new Map<string, SeasonHistoryFinalLeaderboard>();

  for (let index = 0; index < targets.length; index += concurrency) {
    const batch = targets.slice(index, index + concurrency);
    const responses = await Promise.all(
      batch.map(async (entry) => {
        const response = await getSeasonResult(entry.seasonKey);
        return { seasonKey: entry.seasonKey, finals: mapSeasonResultToFinalLeaderboard(response) };
      }),
    );
    for (const item of responses) {
      enriched.set(item.seasonKey, item.finals);
    }
  }

  return entries.map((entry) => {
    const finals = enriched.get(entry.seasonKey);
    return finals ? applyFinalsToEntry(entry, finals) : entry;
  });
}
