/**
 * Phase 7 Step 6 — Pure season reward UI mapping (no I/O, no catalog authority).
 */

import type {
  GetSeasonRewardEntitlementClientResponse,
  SeasonRewardEntitlementPayload,
} from '../../services/seasonRewardService';

export type SeasonRewardUiState =
  | 'hidden'
  | 'eligible_unclaimed'
  | 'claimed'
  | 'no_reward'
  | 'insufficient_participants'
  | 'pending'
  | 'unavailable'
  | 'guest';

export type SeasonRewardUiModel = {
  state: SeasonRewardUiState;
  seasonKey: string;
  cashAmount: number | null;
  finalRank: number | null;
  showClaimCta: boolean;
  primaryText: string | null;
  secondaryText: string | null;
};

export function mapSeasonRewardEntitlementToUi(
  response: GetSeasonRewardEntitlementClientResponse | null | undefined,
  options?: { isGuest?: boolean },
): SeasonRewardUiModel {
  const seasonKey =
    typeof response?.seasonKey === 'string' ? response.seasonKey : '';
  if (options?.isGuest) {
    return {
      state: 'guest',
      seasonKey,
      cashAmount: null,
      finalRank: null,
      showClaimCta: false,
      primaryText: null,
      secondaryText: null,
    };
  }
  if (!response) {
    return {
      state: 'unavailable',
      seasonKey,
      cashAmount: null,
      finalRank: null,
      showClaimCta: false,
      primaryText: 'Sezon ödülü şu an alınamadı.',
      secondaryText: null,
    };
  }
  if (response.reason === 'rewards_disabled' || response.reason === 'feature-disabled') {
    return {
      state: 'hidden',
      seasonKey: response.seasonKey,
      cashAmount: null,
      finalRank: null,
      showClaimCta: false,
      primaryText: null,
      secondaryText: null,
    };
  }
  if (response.reason === 'anonymous-not-allowed' || response.reason === 'auth-required') {
    return {
      state: 'guest',
      seasonKey: response.seasonKey,
      cashAmount: null,
      finalRank: null,
      showClaimCta: false,
      primaryText: null,
      secondaryText: null,
    };
  }
  if (
    response.reason === 'pending' ||
    response.reason === 'season_pending' ||
    response.reason === 'season_active' ||
    response.reason === 'season_future'
  ) {
    return {
      state: 'pending',
      seasonKey: response.seasonKey,
      cashAmount: null,
      finalRank: null,
      showClaimCta: false,
      primaryText: 'Sezon ödülü hazırlanıyor.',
      secondaryText: null,
    };
  }
  if (response.reason === 'insufficient_participants') {
    return {
      state: 'insufficient_participants',
      seasonKey: response.seasonKey,
      cashAmount: null,
      finalRank: null,
      showClaimCta: false,
      primaryText: 'Bu sezonda ödül dağıtımı için yeterli katılımcı yoktu.',
      secondaryText: null,
    };
  }
  if (response.reason === 'no_reward') {
    return {
      state: 'no_reward',
      seasonKey: response.seasonKey,
      cashAmount: null,
      finalRank: null,
      showClaimCta: false,
      primaryText: 'Bu sezonda sıralama ödülü oluşmadı.',
      secondaryText: null,
    };
  }

  const entitlement = sanitizeEntitlementForUi(response);
  if (response.reason === 'eligible_unclaimed' && entitlement?.status === 'unclaimed') {
    return {
      state: 'eligible_unclaimed',
      seasonKey: response.seasonKey,
      cashAmount: entitlement.cashAmount,
      finalRank: entitlement.finalRank,
      showClaimCta: true,
      primaryText: 'Sezon Ödülü',
      secondaryText: null,
    };
  }
  if (response.reason === 'claimed' && entitlement?.status === 'claimed') {
    return {
      state: 'claimed',
      seasonKey: response.seasonKey,
      cashAmount: entitlement.cashAmount,
      finalRank: entitlement.finalRank,
      showClaimCta: false,
      primaryText: 'Sezon Ödülü',
      secondaryText: 'Alındı',
    };
  }

  return {
    state: 'unavailable',
    seasonKey: response.seasonKey,
    cashAmount: null,
    finalRank: null,
    showClaimCta: false,
    primaryText: 'Sezon ödülü şu an alınamadı.',
    secondaryText: null,
  };
}

/** Never coerce missing/invalid payload into a claimable reward. */
export function sanitizeEntitlementForUi(
  response: GetSeasonRewardEntitlementClientResponse,
): SeasonRewardEntitlementPayload | null {
  const entitlement = response.entitlement;
  if (!entitlement) return null;
  if (
    typeof entitlement.cashAmount !== 'number' ||
    !Number.isFinite(entitlement.cashAmount) ||
    entitlement.cashAmount <= 0 ||
    typeof entitlement.finalRank !== 'number' ||
    !Number.isInteger(entitlement.finalRank) ||
    entitlement.finalRank < 1 ||
    typeof entitlement.tierId !== 'string' ||
    entitlement.tierId.length === 0 ||
    (entitlement.status !== 'unclaimed' && entitlement.status !== 'claimed')
  ) {
    return null;
  }
  return entitlement;
}

export function shouldFetchSeasonRewards(featureEnabled: boolean): boolean {
  return featureEnabled === true;
}
