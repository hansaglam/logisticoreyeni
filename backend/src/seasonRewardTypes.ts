/**
 * Phase 7 Step 4–5 — Season reward types (policy + entitlement / claim).
 */

import { SEASON_CLOSE_SNAPSHOT_VERSION } from './seasonCloseTypes';

export const SEASON_REWARD_CATALOG_VERSION = 1;

/** Backend env gate — independent of SEASON_CLOSE_SNAPSHOT_ENABLED. Default OFF. */
export function isSeasonRewardsEnabled(): boolean {
  return process.env.SEASON_REWARDS_ENABLED === 'true';
}

export type SeasonRewardTierId =
  | 'rank_1'
  | 'rank_2'
  | 'rank_3'
  | 'rank_4_10'
  | 'rank_11_25'
  | 'rank_26_50';

export type SeasonRewardCatalogTier = {
  id: SeasonRewardTierId;
  minRank: number;
  maxRank: number;
  cashAmount: number;
};

export type SeasonRewardResolveInput = {
  finalRank: number;
  participantCount: number;
  snapshotVersion: number;
  /** Optional; defaults to current catalog when omitted (resolver uses frozen version when provided). */
  rewardCatalogVersion?: number;
};

export type SeasonRewardResolveReason =
  | 'eligible'
  | 'rank-outside-reward-range'
  | 'insufficient-participants'
  | 'invalid-rank'
  | 'invalid-participant-count'
  | 'unsupported-snapshot-version'
  | 'unsupported-catalog-version'
  | 'feature-disabled';

export type SeasonRewardResolveResult = {
  eligible: boolean;
  tierId: SeasonRewardTierId | null;
  cashAmount: number;
  catalogVersion: number;
  minimumParticipantCount: number;
  reason: SeasonRewardResolveReason;
};

/**
 * Server-created entitlement (Step 5).
 * Path: seasons/{seasonKey}/rewardEntitlements/{uid}
 * Create-once; never rewrite immutable seasons/.../results/{uid}.
 */
export type SeasonRewardEntitlementStatus = 'unclaimed' | 'claimed';

export type SeasonRewardEntitlementDocument = {
  uid: string;
  seasonKey: string;
  resultSnapshotVersion: typeof SEASON_CLOSE_SNAPSHOT_VERSION | number;
  rewardCatalogVersion: number;
  finalRank: number;
  participantCount: number;
  tierId: SeasonRewardTierId;
  cashAmount: number;
  status: SeasonRewardEntitlementStatus;
  createdAt: number;
  claimedAt: number | null;
  claimIdempotencyKey?: string | null;
  version?: number;
};

export type ClaimSeasonRewardRequest = {
  seasonKey: string;
  idempotencyKey: string;
};
