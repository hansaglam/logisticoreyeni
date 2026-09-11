/**
 * Phase 7 Step 2 — Immutable season-close snapshot types.
 * No reward calculation or claim semantics in this step.
 */

export const SEASON_CLOSE_SNAPSHOT_VERSION = 1;
export const SEASON_CLOSE_PAGE_SIZE = 100;

export type SeasonCloseStatus = 'closing' | 'closed';

export type SeasonCloseCursor = {
  companyScore: number;
  uid: string;
};

export type SeasonCloseMetaDocument = {
  seasonKey: string;
  startsAt: number;
  endsAt: number;
  status: SeasonCloseStatus;
  participantCount: number;
  processedCount: number;
  snapshotVersion: number;
  scoreVersion: number;
  closeCursor: SeasonCloseCursor | null;
  closeStartedAt: number;
  closedAt: number | null;
  /** Frozen at close init via resolveSeasonRewardPolicy — never retrofit after create. */
  rewardsEnabled?: boolean;
  /** Frozen catalog version when rewardsEnabled=true; null when disabled. */
  rewardCatalogVersion?: number | null;
  /** Materialization progress (server-only). */
  rewardMaterializationComplete?: boolean;
  rewardMaterializationCursorUid?: string | null;
};

export type SeasonCloseResultDocument = {
  uid: string;
  seasonKey: string;
  finalScore: number;
  finalRank: number;
  participantCount: number;
  snapshottedAt: number;
  snapshotVersion: number;
  scoreVersion: number;
  /** Reserved on result docs — Step 4+ uses separate rewardEntitlements; do not rewrite create-once results. */
  rewardTier?: null;
  /** Reserved — see rewardEntitlements (Step 4 design). */
  rewardAmount?: null;
  /** Reserved — see rewardEntitlements (Step 4 design). */
  rewardStatus?: null;
};

export type FinalizeSeasonReason =
  | 'success'
  | 'already-closed'
  | 'feature-disabled'
  | 'invalid-season-key'
  | 'season-not-ended'
  | 'season-active'
  | 'season-future'
  | 'integrity-conflict'
  | 'timeout-partial'
  | 'service-unavailable';

export type FinalizeSeasonResult = {
  ok: boolean;
  reason: FinalizeSeasonReason;
  seasonKey: string;
  status: SeasonCloseStatus | null;
  participantCount: number | null;
  processedCount: number | null;
  closedAt: number | null;
  pagesProcessed: number;
  durationMs: number;
};

export type GetSeasonResultReason =
  | 'success'
  | 'feature-disabled'
  | 'unauthenticated'
  | 'anonymous-not-allowed'
  | 'invalid-request'
  | 'invalid-season-key'
  | 'season-active'
  | 'season-future'
  | 'finalization-pending'
  | 'not-participated'
  | 'rate-limited'
  | 'service-unavailable';

export type GetSeasonResultResponse = {
  ok: boolean;
  reason: GetSeasonResultReason;
  seasonKey: string;
  season: {
    seasonKey: string;
    startsAt: number;
    endsAt: number;
    status: SeasonCloseStatus;
    participantCount: number;
    snapshotVersion: number;
    closedAt: number | null;
  } | null;
  result: {
    uid: string;
    seasonKey: string;
    finalScore: number;
    finalRank: number;
    participantCount: number;
    snapshottedAt: number;
    snapshotVersion: number;
  } | null;
};
