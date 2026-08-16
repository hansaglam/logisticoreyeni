import {
  INITIAL_REPUTATION,
  REPUTATION_MAX,
  REPUTATION_MIN,
  REPUTATION_TIER_THRESHOLDS,
  type ReputationTier,
} from '../config/reputationRules';
import type { Player, StoreGameState } from '../types/game';

export type ReputationScore = number;

export type ReputationSource =
  | 'delivery-settlement'
  | 'delivery-failure'
  | 'contract-cancelled'
  | 'delivery-operation'
  | 'mission-reward'
  | 'milestone-reward'
  | 'weekly-reward'
  | 'migration';

export type ReputationReason =
  | 'delivery-early'
  | 'delivery-on-time'
  | 'delivery-late-minor'
  | 'delivery-late-major'
  | 'delivery-failed'
  | 'contract-cancelled'
  | 'high-risk-success'
  | 'operation-positive'
  | 'operation-negative'
  | 'mission-reward'
  | 'milestone-reward'
  | 'weekly-reward'
  | 'legacy-migration';

export type ReputationHistoryEntry = {
  id: string;
  delta: number;
  reason: string;
  source: ReputationSource;
  createdAt: number;
  deliveryId?: string;
  contractId?: string;
};

export function clampReputation(value: number): number {
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, value));
}

export function resolveReputationTier(score: number): ReputationTier {
  const clamped = clampReputation(score);
  if (clamped <= REPUTATION_TIER_THRESHOLDS.critical.max) {
    return 'critical';
  }
  if (clamped <= REPUTATION_TIER_THRESHOLDS.weak.max) {
    return 'weak';
  }
  if (clamped <= REPUTATION_TIER_THRESHOLDS.reliable.max) {
    return 'reliable';
  }
  if (clamped <= REPUTATION_TIER_THRESHOLDS.respected.max) {
    return 'respected';
  }
  return 'elite';
}

export function getReputationTierLabel(tier: ReputationTier): string {
  return REPUTATION_TIER_THRESHOLDS[tier].label;
}

export type ReputationSummary = {
  score: number;
  tier: ReputationTier;
  tierLabel: string;
  nextTierAt: number | null;
  progressToNextTier: number;
  recentChange?: number;
};

export function selectReputationSummary(state: Pick<StoreGameState, 'player' | 'reputationHistory'>): ReputationSummary {
  const score = clampReputation(state.player.reputation ?? INITIAL_REPUTATION);
  const tier = resolveReputationTier(score);
  const tierConfig = REPUTATION_TIER_THRESHOLDS[tier];
  const nextTierAt = tier === 'elite' ? null : tierConfig.max + 1;
  const tierStart = tierConfig.min;
  const tierEnd = tierConfig.max;
  const span = Math.max(1, tierEnd - tierStart);
  const progressToNextTier = tier === 'elite' ? 1 : (score - tierStart) / span;
  const recentEntry = state.reputationHistory?.[0];

  return {
    score,
    tier,
    tierLabel: tierConfig.label,
    nextTierAt,
    progressToNextTier: Math.min(1, Math.max(0, progressToNextTier)),
    recentChange: recentEntry?.delta,
  };
}

export function reputationReasonToDisplayText(reason: ReputationReason): string {
  switch (reason) {
    case 'delivery-early':
      return 'Teslimat erken tamamlandı';
    case 'delivery-on-time':
      return 'Teslimat zamanında tamamlandı';
    case 'delivery-late-minor':
      return 'Teslimat hafif gecikti';
    case 'delivery-late-major':
      return 'Teslimat ciddi gecikti';
    case 'delivery-failed':
      return 'Teslimat başarısız oldu';
    case 'contract-cancelled':
      return 'Sözleşme iptal edildi';
    case 'high-risk-success':
      return 'Riskli iş başarıyla tamamlandı';
    case 'operation-positive':
      return 'Operasyon başarıyla çözüldü';
    case 'operation-negative':
      return 'Operasyon olumsuz sonuçlandı';
    case 'mission-reward':
      return 'Görev ödülü';
    case 'milestone-reward':
      return 'Kilometre taşı ödülü';
    case 'weekly-reward':
      return 'Haftalık hedef ödülü';
    case 'legacy-migration':
      return 'Kayıt güncellendi';
    default:
      return 'İtibar değişti';
  }
}

export function normalizePlayerReputation(player: Player): Player {
  return {
    ...player,
    reputation: clampReputation(
      typeof player.reputation === 'number' && Number.isFinite(player.reputation)
        ? player.reputation
        : INITIAL_REPUTATION,
    ),
  };
}
