/**
 * Phase 7 Step 5–6 — Client wrappers for season reward entitlement + claim.
 * No materialization callable (ops/Admin SDK only). Fail-closed when flag off.
 */

import { httpsCallable } from 'firebase/functions';

import { SEASON_REWARDS_ENABLED } from '../config/backendRoadmap';
import { waitForInitialAuthState } from './authService';
import { withCallableTimeout } from './callableServiceUtils';
import {
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
  isFirebaseEnabled,
} from './firebase';

export const SEASON_REWARD_CALLABLES = {
  getSeasonRewardEntitlement: 'getSeasonRewardEntitlement',
  claimSeasonReward: 'claimSeasonReward',
} as const;

/** Max closed seasons enriched for rewards per history refresh. */
export const SEASON_HISTORY_REWARD_ENRICH_LIMIT = 6;

export type SeasonRewardEntitlementClientReason =
  | 'eligible_unclaimed'
  | 'claimed'
  | 'no_reward'
  | 'insufficient_participants'
  | 'rewards_disabled'
  | 'pending'
  | 'season_pending'
  | 'season_active'
  | 'season_future'
  | 'feature-disabled'
  | 'firebase-disabled'
  | 'auth-required'
  | 'anonymous-not-allowed'
  | 'invalid-request'
  | 'invalid-season-key'
  | 'rate-limited'
  | 'malformed-response'
  | 'timeout'
  | 'service-unavailable';

export type SeasonRewardEntitlementPayload = {
  tierId: string;
  cashAmount: number;
  finalRank: number;
  status: 'unclaimed' | 'claimed';
  claimedAt: number | null;
};

export type GetSeasonRewardEntitlementClientResponse = {
  ok: boolean;
  reason: SeasonRewardEntitlementClientReason;
  seasonKey: string;
  entitlement: SeasonRewardEntitlementPayload | null;
};

export type ClaimSeasonRewardClientResponse = {
  ok: boolean;
  reason: string;
  seasonKey: string;
  cashBefore: number | null;
  cashAfter: number | null;
  cashAmount: number | null;
  tierId: string | null;
  claimedAt: number | null;
};

const KNOWN_REASONS = new Set<SeasonRewardEntitlementClientReason>([
  'eligible_unclaimed',
  'claimed',
  'no_reward',
  'insufficient_participants',
  'rewards_disabled',
  'pending',
  'season_pending',
  'season_active',
  'season_future',
  'feature-disabled',
  'firebase-disabled',
  'auth-required',
  'anonymous-not-allowed',
  'invalid-request',
  'invalid-season-key',
  'rate-limited',
  'malformed-response',
  'timeout',
  'service-unavailable',
]);

function mapReason(raw: unknown): SeasonRewardEntitlementClientReason {
  if (typeof raw === 'string' && KNOWN_REASONS.has(raw as SeasonRewardEntitlementClientReason)) {
    return raw as SeasonRewardEntitlementClientReason;
  }
  if (raw === 'unauthenticated') return 'auth-required';
  return 'malformed-response';
}

function parseEntitlement(
  value: unknown,
): SeasonRewardEntitlementPayload | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.tierId !== 'string' ||
    record.tierId.length === 0 ||
    typeof record.cashAmount !== 'number' ||
    !Number.isFinite(record.cashAmount) ||
    record.cashAmount <= 0 ||
    typeof record.finalRank !== 'number' ||
    !Number.isInteger(record.finalRank) ||
    record.finalRank < 1 ||
    (record.status !== 'unclaimed' && record.status !== 'claimed')
  ) {
    return null;
  }
  return {
    tierId: record.tierId,
    cashAmount: record.cashAmount,
    finalRank: record.finalRank,
    status: record.status,
    claimedAt:
      record.claimedAt == null
        ? null
        : typeof record.claimedAt === 'number' && Number.isFinite(record.claimedAt)
          ? record.claimedAt
          : null,
  };
}

function normalizeGetResponse(
  seasonKey: string,
  data: Record<string, unknown>,
): GetSeasonRewardEntitlementClientResponse {
  const reason = mapReason(data.reason);
  const entitlement = parseEntitlement(data.entitlement);
  const ok = Boolean(data.ok);
  const key = typeof data.seasonKey === 'string' ? data.seasonKey : seasonKey;

  if (
    (reason === 'eligible_unclaimed' || reason === 'claimed') &&
    (!entitlement ||
      (reason === 'eligible_unclaimed' && entitlement.status !== 'unclaimed') ||
      (reason === 'claimed' && entitlement.status !== 'claimed'))
  ) {
    return {
      ok: false,
      reason: 'malformed-response',
      seasonKey: key,
      entitlement: null,
    };
  }

  return {
    ok,
    reason,
    seasonKey: key,
    entitlement,
  };
}

export async function getSeasonRewardEntitlement(
  seasonKey: string,
): Promise<GetSeasonRewardEntitlementClientResponse> {
  const empty = {
    seasonKey,
    entitlement: null as SeasonRewardEntitlementPayload | null,
  };
  if (!SEASON_REWARDS_ENABLED) {
    return { ok: false, reason: 'feature-disabled', ...empty };
  }
  if (!isFirebaseEnabled()) {
    return { ok: false, reason: 'firebase-disabled', ...empty };
  }
  await waitForInitialAuthState();
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  if (!user) {
    return { ok: false, reason: 'auth-required', ...empty };
  }
  if (user.isAnonymous) {
    return { ok: false, reason: 'anonymous-not-allowed', ...empty };
  }
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    return { ok: false, reason: 'firebase-disabled', ...empty };
  }
  try {
    const call = httpsCallable<{ seasonKey: string }, Record<string, unknown>>(
      functions,
      SEASON_REWARD_CALLABLES.getSeasonRewardEntitlement,
    );
    const raw = await withCallableTimeout(call({ seasonKey }));
    return normalizeGetResponse(seasonKey, raw.data ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|deadline/i.test(message)) {
      return { ok: false, reason: 'timeout', ...empty };
    }
    return { ok: false, reason: 'service-unavailable', ...empty };
  }
}

export async function claimSeasonReward(
  seasonKey: string,
  idempotencyKey: string,
): Promise<ClaimSeasonRewardClientResponse> {
  const empty: ClaimSeasonRewardClientResponse = {
    ok: false,
    reason: 'feature-disabled',
    seasonKey,
    cashBefore: null,
    cashAfter: null,
    cashAmount: null,
    tierId: null,
    claimedAt: null,
  };
  if (!SEASON_REWARDS_ENABLED) {
    return empty;
  }
  if (!isFirebaseEnabled()) {
    return { ...empty, reason: 'firebase-disabled' };
  }
  await waitForInitialAuthState();
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  if (!user) {
    return { ...empty, reason: 'auth-required' };
  }
  if (user.isAnonymous) {
    return { ...empty, reason: 'anonymous-not-allowed' };
  }
  const functions = getFirebaseFunctionsSafe();
  if (!functions) {
    return { ...empty, reason: 'firebase-disabled' };
  }
  try {
    const call = httpsCallable<
      { seasonKey: string; idempotencyKey: string },
      Record<string, unknown>
    >(functions, SEASON_REWARD_CALLABLES.claimSeasonReward);
    // Explicitly seasonKey + idempotencyKey only — never uid/rank/amount/tier.
    const raw = await withCallableTimeout(call({ seasonKey, idempotencyKey }));
    const data = raw.data ?? {};
    return {
      ok: Boolean(data.ok),
      reason: typeof data.reason === 'string' ? data.reason : 'malformed-response',
      seasonKey: typeof data.seasonKey === 'string' ? data.seasonKey : seasonKey,
      cashBefore: typeof data.cashBefore === 'number' ? data.cashBefore : null,
      cashAfter: typeof data.cashAfter === 'number' ? data.cashAfter : null,
      cashAmount: typeof data.cashAmount === 'number' ? data.cashAmount : null,
      tierId: typeof data.tierId === 'string' ? data.tierId : null,
      claimedAt: typeof data.claimedAt === 'number' ? data.claimedAt : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|deadline/i.test(message)) {
      return { ...empty, reason: 'timeout' };
    }
    return { ...empty, reason: 'service-unavailable' };
  }
}

/**
 * Bounded reward entitlement fetch for visible season history keys.
 * No polling. Caller owns UI state (not Zustand).
 */
export async function fetchSeasonRewardEntitlementsForHistory(
  seasonKeys: string[],
): Promise<Record<string, GetSeasonRewardEntitlementClientResponse>> {
  const out: Record<string, GetSeasonRewardEntitlementClientResponse> = {};
  if (!SEASON_REWARDS_ENABLED) return out;
  const unique = [...new Set(seasonKeys.filter(Boolean))].slice(
    0,
    SEASON_HISTORY_REWARD_ENRICH_LIMIT,
  );
  const concurrency = 3;
  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (key) => {
        const response = await getSeasonRewardEntitlement(key);
        return [key, response] as const;
      }),
    );
    for (const [key, response] of results) {
      out[key] = response;
    }
  }
  return out;
}
