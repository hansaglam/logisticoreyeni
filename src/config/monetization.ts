/**
 * Monetization M0/M1 — ödüllü reklam slot yapılandırması.
 */

import type { AdRewardSlotId } from '../types/monetization';

export const MONETIZATION_GLOBAL_DAILY_AD_CAP = 5;

export const LOW_LEVEL_MAX_PLAYER_LEVEL = 2;

/** Level <= 2 iken yalnızca bu slotlar açık */
export const LOW_LEVEL_ALLOWED_AD_SLOTS: AdRewardSlotId[] = [
  'daily_ops_bonus',
  'market_analysis',
];

export interface DailyOpsBonusTier {
  minLevel: number;
  maxLevel: number;
  cash: number;
}

export interface MonetizationSlotConfig {
  dailyLimit: number;
  cashByLevel?: DailyOpsBonusTier[];
  bypassCooldownHours?: number;
  unlockGameHours?: number;
  sameProductDailyLimit?: number;
  discountRate?: number;
  maxDiscountCash?: number;
  expiresGameHours?: number;
  progressBoost?: number;
  maxGameHoursEquivalent?: number;
}

export const MONETIZATION_SLOT_CONFIG: Record<AdRewardSlotId, MonetizationSlotConfig> = {
  daily_ops_bonus: {
    dailyLimit: 1,
    cashByLevel: [
      { minLevel: 1, maxLevel: 3, cash: 150 },
      { minLevel: 4, maxLevel: 10, cash: 200 },
      { minLevel: 11, maxLevel: 999, cash: 250 },
    ],
  },
  contract_refresh: {
    dailyLimit: 2,
    bypassCooldownHours: 3,
  },
  market_analysis: {
    dailyLimit: 2,
    unlockGameHours: 24,
    sameProductDailyLimit: 1,
  },
  maintenance_discount: {
    dailyLimit: 2,
    discountRate: 0.3,
    maxDiscountCash: 500,
    expiresGameHours: 24,
  },
  delivery_boost: {
    dailyLimit: 1,
    progressBoost: 0.18,
    maxGameHoursEquivalent: 4,
  },
};

export function getDailyOpsBonusCash(playerLevel: number): number {
  const level = Math.max(1, playerLevel);
  const tiers = MONETIZATION_SLOT_CONFIG.daily_ops_bonus.cashByLevel ?? [];
  for (const tier of tiers) {
    if (level >= tier.minLevel && level <= tier.maxLevel) {
      return tier.cash;
    }
  }
  return 150;
}
