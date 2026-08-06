/**
 * Monetization M0/M1 — ödüllü reklam slot yapılandırması.
 */

import { calculateDailyOperationSupportReward } from '../domain/dailyOperationSupportReward';
import type { Player } from '../types/game';
import type { AdRewardSlotId } from '../types/monetization';

export const MONETIZATION_GLOBAL_DAILY_AD_CAP = 5;

export const LOW_LEVEL_MAX_PLAYER_LEVEL = 2;

/** Level <= 2 iken yalnızca bu slotlar açık */
export const LOW_LEVEL_ALLOWED_AD_SLOTS: AdRewardSlotId[] = [
  'daily_ops_bonus',
  'market_analysis',
];

export interface MonetizationSlotConfig {
  dailyLimit: number;
  cashByLevel?: never;
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
    dailyLimit: 10,
  },
};

/** @deprecated Oyuncu state'i ile calculateDailyOperationSupportReward kullanın. */
export function getDailyOpsBonusCash(
  player: Pick<Player, 'drivers' | 'warehouses' | 'trucks'>,
): number {
  return calculateDailyOperationSupportReward(player);
}
