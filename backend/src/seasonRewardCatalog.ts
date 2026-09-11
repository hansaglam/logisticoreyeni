/**
 * Phase 7 Step 4 — Server-authoritative season reward catalog v1.
 * Amounts are backend authority only — never trust client-submitted tier/cash.
 */

import type { SeasonRewardCatalogTier } from './seasonRewardTypes';
import { SEASON_REWARD_CATALOG_VERSION } from './seasonRewardTypes';

/**
 * Minimum closed-season participants before any rank cash reward applies.
 * Below this: history/results remain valid; cash rewards skipped.
 * Chosen for current small player base (e.g. W34 had 3) to avoid near-universal payouts.
 */
export const SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT = 10;

/**
 * Catalog v1 cash amounts (moderated vs initial product proposal).
 *
 * Economy context (repo):
 * - L1 contract gross ≈ $2k–$8k; typical mid ~$5k
 * - Challenge cash ≈ $500–$2,000
 * - Starter truck $45k; mid truck ~$85k
 * - Proposed #1 $100k ≈ 20 L1 deliveries / ~2 mid trucks → too inflationary for weekly
 *
 * v1 #1 $60k ≈ ~12 typical L1 deliveries / ~1.3× starter truck — prestige without breaking early economy.
 */
export const SEASON_REWARD_CATALOG_V1: readonly SeasonRewardCatalogTier[] = Object.freeze([
  { id: 'rank_1', minRank: 1, maxRank: 1, cashAmount: 60_000 },
  { id: 'rank_2', minRank: 2, maxRank: 2, cashAmount: 40_000 },
  { id: 'rank_3', minRank: 3, maxRank: 3, cashAmount: 25_000 },
  { id: 'rank_4_10', minRank: 4, maxRank: 10, cashAmount: 12_000 },
  { id: 'rank_11_25', minRank: 11, maxRank: 25, cashAmount: 7_500 },
  { id: 'rank_26_50', minRank: 26, maxRank: 50, cashAmount: 4_000 },
]);

export function getSeasonRewardCatalog(catalogVersion: number): readonly SeasonRewardCatalogTier[] | null {
  if (catalogVersion === SEASON_REWARD_CATALOG_VERSION) {
    return SEASON_REWARD_CATALOG_V1;
  }
  return null;
}

export function findSeasonRewardTierForRank(
  catalog: readonly SeasonRewardCatalogTier[],
  finalRank: number,
): SeasonRewardCatalogTier | null {
  for (const tier of catalog) {
    if (finalRank >= tier.minRank && finalRank <= tier.maxRank) {
      return tier;
    }
  }
  return null;
}
