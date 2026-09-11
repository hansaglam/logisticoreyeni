/**
 * DEV-only mock entitlement responses for internal UI state review.
 * Never writes Firestore. Never used as production authority.
 */

import type { GetSeasonRewardEntitlementClientResponse } from '../services/seasonRewardService';

export const SEASON_REWARD_UI_MOCK_STATES = [
  'eligible_unclaimed',
  'claimed',
  'no_reward',
  'insufficient_participants',
  'pending',
  'unavailable',
  'rewards_disabled',
] as const;

export type SeasonRewardUiMockState = (typeof SEASON_REWARD_UI_MOCK_STATES)[number];

export function buildSeasonRewardUiMockResponse(
  state: SeasonRewardUiMockState,
  seasonKey = 'DEV-MOCK',
): GetSeasonRewardEntitlementClientResponse {
  switch (state) {
    case 'eligible_unclaimed':
      return {
        ok: true,
        reason: 'eligible_unclaimed',
        seasonKey,
        entitlement: {
          tierId: 'rank_2',
          cashAmount: 40_000,
          finalRank: 2,
          status: 'unclaimed',
          claimedAt: null,
        },
      };
    case 'claimed':
      return {
        ok: true,
        reason: 'claimed',
        seasonKey,
        entitlement: {
          tierId: 'rank_2',
          cashAmount: 40_000,
          finalRank: 2,
          status: 'claimed',
          claimedAt: Date.now(),
        },
      };
    case 'no_reward':
      return { ok: true, reason: 'no_reward', seasonKey, entitlement: null };
    case 'insufficient_participants':
      return {
        ok: true,
        reason: 'insufficient_participants',
        seasonKey,
        entitlement: null,
      };
    case 'pending':
      return { ok: true, reason: 'pending', seasonKey, entitlement: null };
    case 'unavailable':
      return {
        ok: false,
        reason: 'service-unavailable',
        seasonKey,
        entitlement: null,
      };
    case 'rewards_disabled':
      return { ok: true, reason: 'rewards_disabled', seasonKey, entitlement: null };
  }
}
