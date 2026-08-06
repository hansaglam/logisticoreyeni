/**
 * Monetization M0/M1 — ödüllü reklam slot tipleri ve persist state.
 * Gerçek reklam SDK bu katmanın üstüne bağlanır.
 */

import type { Player } from './game';

export type AdRewardSlotId =
  | 'daily_ops_bonus'
  | 'contract_refresh'
  | 'market_analysis'
  | 'maintenance_discount'
  | 'delivery_boost';

export interface AdRewardDailyUsage {
  count: number;
  lastGrantedAtGameTime?: number;
  productIdsToday?: string[];
  deliveryIdsToday?: string[];
  truckIdsToday?: string[];
}

export interface MarketAnalysisUnlock {
  productId: string;
  expiresAtGameTime: number;
}

export interface MaintenanceDiscountToken {
  truckId: string;
  discountRate: number;
  maxDiscountCash: number;
  expiresAtGameTime: number;
}

export interface AdRewardRecentGrant {
  slotId: AdRewardSlotId;
  grantedAt: number;
  gameTime: number;
  payloadSummary: string;
}

export interface MonetizationState {
  monetizationVersion: 1;
  dailyResetKey: string;
  adRewardUsage: Partial<Record<AdRewardSlotId, AdRewardDailyUsage>>;
  totalRewardedAdsToday: number;
  premiumAdFree?: boolean;
  marketAnalysisUnlocks?: Record<string, MarketAnalysisUnlock>;
  maintenanceDiscountTokens?: Record<string, MaintenanceDiscountToken>;
  boostedDeliveryIds?: string[];
  lastDeliveryBoostAdAt?: number;
  recentGrants?: AdRewardRecentGrant[];
}

export interface AdRewardGrantContext {
  currentGameTime: number;
  playerLevel: number;
  hasCompletedOnboarding: boolean;
  /** Günlük operasyon desteği ödülü — zorunlu günlük gider hesabı için. */
  playerFleet?: Pick<Player, 'drivers' | 'warehouses' | 'trucks'>;
  selectedProductId?: string;
  selectedTruckId?: string;
  selectedDeliveryId?: string;
  currentRepairCost?: number;
  manualRefreshCooldownRemaining?: number;
}

export interface AdRewardEligibilityResult {
  ok: boolean;
  reason?: string;
}

export type AdRewardGrantEffect =
  | { type: 'cash'; amount: number }
  | { type: 'contract_refresh_bypass' }
  | { type: 'market_analysis_unlock'; productId: string; expiresAtGameTime: number }
  | {
      type: 'maintenance_discount_token';
      truckId: string;
      discountRate: number;
      maxDiscountCash: number;
      expiresAtGameTime: number;
    }
  | { type: 'delivery_boost'; deliveryId: string; appliedReductionMs: number };

export interface ApplyAdRewardGrantResult {
  monetization: MonetizationState;
  effects: AdRewardGrantEffect[];
}
