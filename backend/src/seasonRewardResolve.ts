/**
 * Phase 7 Step 4 — Pure season reward resolver (no I/O, no mutations).
 */

import { SEASON_CLOSE_SNAPSHOT_VERSION } from './seasonCloseTypes';
import {
  findSeasonRewardTierForRank,
  getSeasonRewardCatalog,
  SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT,
} from './seasonRewardCatalog';
import {
  SEASON_REWARD_CATALOG_VERSION,
  type SeasonRewardResolveInput,
  type SeasonRewardResolveResult,
} from './seasonRewardTypes';

function baseResult(
  partial: Omit<SeasonRewardResolveResult, 'catalogVersion' | 'minimumParticipantCount' | 'cashAmount' | 'tierId'> &
    Partial<Pick<SeasonRewardResolveResult, 'cashAmount' | 'tierId'>>,
): SeasonRewardResolveResult {
  return {
    eligible: partial.eligible,
    tierId: partial.tierId ?? null,
    cashAmount: partial.cashAmount ?? 0,
    catalogVersion: SEASON_REWARD_CATALOG_VERSION,
    minimumParticipantCount: SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT,
    reason: partial.reason,
  };
}

/**
 * Resolve rank cash eligibility from canonical closed-season fields only.
 * Does not read Firestore, mutate players, or accept client-chosen tier/amount.
 */
export function resolveSeasonReward(input: SeasonRewardResolveInput): SeasonRewardResolveResult {
  const catalogVersion =
    typeof input.rewardCatalogVersion === 'number'
      ? input.rewardCatalogVersion
      : SEASON_REWARD_CATALOG_VERSION;

  if (!Number.isInteger(input.finalRank) || input.finalRank < 1) {
    return baseResult({ eligible: false, reason: 'invalid-rank' });
  }
  if (!Number.isInteger(input.participantCount) || input.participantCount < 1) {
    return baseResult({ eligible: false, reason: 'invalid-participant-count' });
  }
  if (input.finalRank > input.participantCount) {
    return baseResult({ eligible: false, reason: 'invalid-rank' });
  }
  if (input.snapshotVersion !== SEASON_CLOSE_SNAPSHOT_VERSION) {
    return baseResult({ eligible: false, reason: 'unsupported-snapshot-version' });
  }

  const catalog = getSeasonRewardCatalog(catalogVersion);
  if (!catalog) {
    return baseResult({ eligible: false, reason: 'unsupported-catalog-version' });
  }

  if (input.participantCount < SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT) {
    return {
      eligible: false,
      tierId: null,
      cashAmount: 0,
      catalogVersion,
      minimumParticipantCount: SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT,
      reason: 'insufficient-participants',
    };
  }

  const tier = findSeasonRewardTierForRank(catalog, input.finalRank);
  if (!tier) {
    return {
      eligible: false,
      tierId: null,
      cashAmount: 0,
      catalogVersion,
      minimumParticipantCount: SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT,
      reason: 'rank-outside-reward-range',
    };
  }

  return {
    eligible: true,
    tierId: tier.id,
    cashAmount: tier.cashAmount,
    catalogVersion,
    minimumParticipantCount: SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT,
    reason: 'eligible',
  };
}

/** Pure entitlement builder — no Firestore. Used by reward entitlement materialization. */
export function buildSeasonRewardEntitlementDraft(params: {
  uid: string;
  seasonKey: string;
  finalRank: number;
  participantCount: number;
  snapshotVersion: number;
  rewardCatalogVersion?: number;
  nowMs: number;
}):
  | { ok: true; entitlement: import('./seasonRewardTypes').SeasonRewardEntitlementDocument }
  | { ok: false; resolve: SeasonRewardResolveResult } {
  const resolve = resolveSeasonReward({
    finalRank: params.finalRank,
    participantCount: params.participantCount,
    snapshotVersion: params.snapshotVersion,
    rewardCatalogVersion: params.rewardCatalogVersion,
  });
  if (!resolve.eligible || !resolve.tierId || resolve.cashAmount <= 0) {
    return { ok: false, resolve };
  }
  return {
    ok: true,
    entitlement: {
      uid: params.uid,
      seasonKey: params.seasonKey,
      resultSnapshotVersion: params.snapshotVersion,
      rewardCatalogVersion: resolve.catalogVersion,
      finalRank: params.finalRank,
      participantCount: params.participantCount,
      tierId: resolve.tierId,
      cashAmount: resolve.cashAmount,
      status: 'unclaimed',
      createdAt: params.nowMs,
      claimedAt: null,
    },
  };
}
