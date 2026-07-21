/**
 * Ödüllü reklam grant mantığı — saf helper'lar, state değiştirmez (apply hariç pure transforms).
 */

import {
  getDailyOpsBonusCash,
  LOW_LEVEL_ALLOWED_AD_SLOTS,
  LOW_LEVEL_MAX_PLAYER_LEVEL,
  MONETIZATION_GLOBAL_DAILY_AD_CAP,
  MONETIZATION_SLOT_CONFIG,
} from '../config/monetization';
import type {
  AdRewardDailyUsage,
  AdRewardEligibilityResult,
  AdRewardGrantContext,
  AdRewardGrantEffect,
  AdRewardRecentGrant,
  AdRewardSlotId,
  ApplyAdRewardGrantResult,
  MaintenanceDiscountToken,
  MarketAnalysisUnlock,
  MonetizationState,
} from '../types/monetization';

const AD_REWARD_SLOT_IDS: AdRewardSlotId[] = [
  'daily_ops_bonus',
  'contract_refresh',
  'market_analysis',
  'maintenance_discount',
  'delivery_boost',
];

const MAX_RECENT_GRANTS = 20;

function isAdRewardSlotId(value: string): value is AdRewardSlotId {
  return (AD_REWARD_SLOT_IDS as string[]).includes(value);
}

function clampCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length > 0 ? items : undefined;
}

function normalizeDailyUsage(raw: unknown): AdRewardDailyUsage | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as Partial<AdRewardDailyUsage>;
  const count = clampCount(record.count);
  if (count <= 0 && !record.lastGrantedAtGameTime) {
    return count > 0 ? { count } : undefined;
  }
  return {
    count,
    lastGrantedAtGameTime:
      typeof record.lastGrantedAtGameTime === 'number' && Number.isFinite(record.lastGrantedAtGameTime)
        ? record.lastGrantedAtGameTime
        : undefined,
    productIdsToday: normalizeStringArray(record.productIdsToday),
    deliveryIdsToday: normalizeStringArray(record.deliveryIdsToday),
    truckIdsToday: normalizeStringArray(record.truckIdsToday),
  };
}

function normalizeUnlockRecord(
  raw: unknown,
  currentGameTime: number,
): Record<string, MarketAnalysisUnlock> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out: Record<string, MarketAnalysisUnlock> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const record = value as Partial<MarketAnalysisUnlock>;
    const productId =
      typeof record.productId === 'string' && record.productId.length > 0
        ? record.productId
        : key;
    const expiresAtGameTime = Number(record.expiresAtGameTime);
    if (!Number.isFinite(expiresAtGameTime) || expiresAtGameTime <= currentGameTime) {
      continue;
    }
    out[key] = { productId, expiresAtGameTime };
  }
  return out;
}

function normalizeMaintenanceTokens(
  raw: unknown,
  currentGameTime: number,
): Record<string, MaintenanceDiscountToken> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out: Record<string, MaintenanceDiscountToken> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const record = value as Partial<MaintenanceDiscountToken>;
    const truckId =
      typeof record.truckId === 'string' && record.truckId.length > 0 ? record.truckId : key;
    const discountRate = Number(record.discountRate);
    const maxDiscountCash = Number(record.maxDiscountCash);
    const expiresAtGameTime = Number(record.expiresAtGameTime);
    if (
      !Number.isFinite(discountRate) ||
      !Number.isFinite(maxDiscountCash) ||
      !Number.isFinite(expiresAtGameTime) ||
      expiresAtGameTime <= currentGameTime
    ) {
      continue;
    }
    out[truckId] = {
      truckId,
      discountRate: Math.max(0, Math.min(1, discountRate)),
      maxDiscountCash: Math.max(0, maxDiscountCash),
      expiresAtGameTime,
    };
  }
  return out;
}

function normalizeRecentGrants(raw: unknown): AdRewardRecentGrant[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const grants: AdRewardRecentGrant[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Partial<AdRewardRecentGrant>;
    if (!record.slotId || !isAdRewardSlotId(record.slotId)) {
      continue;
    }
    if (typeof record.grantedAt !== 'number' || typeof record.gameTime !== 'number') {
      continue;
    }
    grants.push({
      slotId: record.slotId,
      grantedAt: record.grantedAt,
      gameTime: record.gameTime,
      payloadSummary:
        typeof record.payloadSummary === 'string' ? record.payloadSummary.slice(0, 120) : '',
    });
  }
  return grants.slice(0, MAX_RECENT_GRANTS);
}

export function getTodayResetKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDefaultMonetizationState(now = new Date()): MonetizationState {
  return {
    monetizationVersion: 1,
    dailyResetKey: getTodayResetKey(now),
    adRewardUsage: {},
    totalRewardedAdsToday: 0,
    premiumAdFree: false,
    marketAnalysisUnlocks: {},
    maintenanceDiscountTokens: {},
    boostedDeliveryIds: [],
    recentGrants: [],
  };
}

export function normalizeMonetizationState(
  raw: Partial<MonetizationState> | null | undefined,
  currentGameTime = 0,
): MonetizationState {
  const defaults = createDefaultMonetizationState();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const adRewardUsage: Partial<Record<AdRewardSlotId, AdRewardDailyUsage>> = {};
  if (raw.adRewardUsage && typeof raw.adRewardUsage === 'object') {
    for (const [slotId, usage] of Object.entries(raw.adRewardUsage)) {
      if (!isAdRewardSlotId(slotId)) {
        continue;
      }
      const normalizedUsage = normalizeDailyUsage(usage);
      if (normalizedUsage) {
        adRewardUsage[slotId] = normalizedUsage;
      }
    }
  }

  const totalRewardedAdsToday = Math.min(
    MONETIZATION_GLOBAL_DAILY_AD_CAP,
    clampCount(raw.totalRewardedAdsToday),
  );

  const boostedDeliveryIds = normalizeStringArray(raw.boostedDeliveryIds) ?? [];

  const state: MonetizationState = {
    monetizationVersion: 1,
    dailyResetKey:
      typeof raw.dailyResetKey === 'string' && raw.dailyResetKey.length > 0
        ? raw.dailyResetKey
        : defaults.dailyResetKey,
    adRewardUsage,
    totalRewardedAdsToday,
    premiumAdFree: raw.premiumAdFree === true,
    marketAnalysisUnlocks: normalizeUnlockRecord(raw.marketAnalysisUnlocks, currentGameTime),
    maintenanceDiscountTokens: normalizeMaintenanceTokens(
      raw.maintenanceDiscountTokens,
      currentGameTime,
    ),
    boostedDeliveryIds,
    recentGrants: normalizeRecentGrants(raw.recentGrants),
  };

  return resetDailyUsageIfNeeded(state);
}

export function resetDailyUsageIfNeeded(
  state: MonetizationState,
  resetKey = getTodayResetKey(),
): MonetizationState {
  if (state.dailyResetKey === resetKey) {
    return state;
  }
  return {
    ...state,
    dailyResetKey: resetKey,
    adRewardUsage: {},
    totalRewardedAdsToday: 0,
    boostedDeliveryIds: [],
  };
}

function getSlotUsage(state: MonetizationState, slotId: AdRewardSlotId): AdRewardDailyUsage {
  return state.adRewardUsage[slotId] ?? { count: 0 };
}

function isSlotAllowedForLevel(slotId: AdRewardSlotId, playerLevel: number): boolean {
  if (playerLevel > LOW_LEVEL_MAX_PLAYER_LEVEL) {
    return true;
  }
  return LOW_LEVEL_ALLOWED_AD_SLOTS.includes(slotId);
}

function getSlotDailyLimit(slotId: AdRewardSlotId): number {
  return MONETIZATION_SLOT_CONFIG[slotId]?.dailyLimit ?? 0;
}

export function getActiveMaintenanceDiscountToken(
  state: MonetizationState,
  truckId: string,
  currentGameTime: number,
): MaintenanceDiscountToken | null {
  const tokens = state.maintenanceDiscountTokens ?? {};
  const token = tokens[truckId];
  if (!token) {
    return null;
  }
  if (token.expiresAtGameTime <= currentGameTime) {
    return null;
  }
  return token;
}

export function calculateDiscountedRepairCost(
  baseCost: number,
  token: MaintenanceDiscountToken | null,
): { finalCost: number; discountAmount: number } {
  if (!token || baseCost <= 0) {
    return { finalCost: baseCost, discountAmount: 0 };
  }
  const discountAmount = Math.min(
    token.maxDiscountCash,
    Math.round(baseCost * token.discountRate),
  );
  return {
    finalCost: Math.max(0, baseCost - discountAmount),
    discountAmount,
  };
}

export function canGrantAdReward(
  state: MonetizationState,
  slotId: AdRewardSlotId,
  context: AdRewardGrantContext,
): AdRewardEligibilityResult {
  const normalized = resetDailyUsageIfNeeded(normalizeMonetizationState(state, context.currentGameTime));

  if (normalized.premiumAdFree) {
    return { ok: false, reason: 'Reklamsız mod aktif.' };
  }

  if (!context.hasCompletedOnboarding) {
    return { ok: false, reason: 'Rehber tamamlanmadan reklam ödülleri kapalı.' };
  }

  if (!isSlotAllowedForLevel(slotId, context.playerLevel)) {
    return { ok: false, reason: 'Bu ödül henüz açılmadı.' };
  }

  if (normalized.totalRewardedAdsToday >= MONETIZATION_GLOBAL_DAILY_AD_CAP) {
    return { ok: false, reason: 'Günlük reklam limitine ulaşıldı.' };
  }

  const slotLimit = getSlotDailyLimit(slotId);
  const usage = getSlotUsage(normalized, slotId);
  if (usage.count >= slotLimit) {
    return { ok: false, reason: 'Bu ödülün günlük limiti doldu.' };
  }

  switch (slotId) {
    case 'market_analysis': {
      const productId = context.selectedProductId?.trim();
      if (!productId) {
        return { ok: false, reason: 'Ürün seçilmedi.' };
      }
      const sameProductLimit =
        MONETIZATION_SLOT_CONFIG.market_analysis.sameProductDailyLimit ?? 1;
      const productIdsToday = usage.productIdsToday ?? [];
      const productCount = productIdsToday.filter((id) => id === productId).length;
      if (productCount >= sameProductLimit) {
        return { ok: false, reason: 'Bu ürün için bugünkü analiz hakkın doldu.' };
      }
      break;
    }
    case 'maintenance_discount': {
      const truckId = context.selectedTruckId?.trim();
      if (!truckId) {
        return { ok: false, reason: 'Kamyon seçilmedi.' };
      }
      const repairCost = context.currentRepairCost ?? 0;
      if (repairCost <= 300) {
        return { ok: false, reason: 'Bu bakım için reklam indirimi gerekmez.' };
      }
      break;
    }
    case 'delivery_boost': {
      const deliveryId = context.selectedDeliveryId?.trim();
      if (!deliveryId) {
        return { ok: false, reason: 'Aktif teslimat seçilmedi.' };
      }
      if ((normalized.boostedDeliveryIds ?? []).includes(deliveryId)) {
        return { ok: false, reason: 'Bu teslimat zaten hızlandırıldı.' };
      }
      break;
    }
    case 'contract_refresh':
      break;
    case 'daily_ops_bonus':
      break;
    default:
      return { ok: false, reason: 'Geçersiz ödül slotu.' };
  }

  return { ok: true };
}

function appendRecentGrant(
  state: MonetizationState,
  grant: AdRewardRecentGrant,
): MonetizationState {
  const recentGrants = [grant, ...(state.recentGrants ?? [])].slice(0, MAX_RECENT_GRANTS);
  return { ...state, recentGrants };
}

function incrementSlotUsage(
  state: MonetizationState,
  slotId: AdRewardSlotId,
  context: AdRewardGrantContext,
  payloadSummary: string,
): MonetizationState {
  const usage = getSlotUsage(state, slotId);
  const nextUsage: AdRewardDailyUsage = {
    count: usage.count + 1,
    lastGrantedAtGameTime: context.currentGameTime,
    productIdsToday: usage.productIdsToday ? [...usage.productIdsToday] : undefined,
    deliveryIdsToday: usage.deliveryIdsToday ? [...usage.deliveryIdsToday] : undefined,
    truckIdsToday: usage.truckIdsToday ? [...usage.truckIdsToday] : undefined,
  };

  if (slotId === 'market_analysis' && context.selectedProductId) {
    nextUsage.productIdsToday = [...(nextUsage.productIdsToday ?? []), context.selectedProductId];
  }
  if (slotId === 'delivery_boost' && context.selectedDeliveryId) {
    nextUsage.deliveryIdsToday = [...(nextUsage.deliveryIdsToday ?? []), context.selectedDeliveryId];
  }
  if (slotId === 'maintenance_discount' && context.selectedTruckId) {
    nextUsage.truckIdsToday = [...(nextUsage.truckIdsToday ?? []), context.selectedTruckId];
  }

  const nextState: MonetizationState = {
    ...state,
    adRewardUsage: {
      ...state.adRewardUsage,
      [slotId]: nextUsage,
    },
    totalRewardedAdsToday: Math.min(
      MONETIZATION_GLOBAL_DAILY_AD_CAP,
      state.totalRewardedAdsToday + 1,
    ),
  };

  return appendRecentGrant(nextState, {
    slotId,
    grantedAt: Date.now(),
    gameTime: context.currentGameTime,
    payloadSummary,
  });
}

export function applyAdRewardGrant(
  state: MonetizationState,
  slotId: AdRewardSlotId,
  context: AdRewardGrantContext,
): ApplyAdRewardGrantResult {
  const eligibility = canGrantAdReward(state, slotId, context);
  if (!eligibility.ok) {
    throw new Error(eligibility.reason ?? 'Ödül verilemedi.');
  }

  let monetization = resetDailyUsageIfNeeded(normalizeMonetizationState(state, context.currentGameTime));
  const effects: AdRewardGrantEffect[] = [];
  const slotConfig = MONETIZATION_SLOT_CONFIG[slotId];

  switch (slotId) {
    case 'daily_ops_bonus': {
      const amount = getDailyOpsBonusCash(context.playerLevel);
      effects.push({ type: 'cash', amount });
      monetization = incrementSlotUsage(monetization, slotId, context, `+$${amount} nakit`);
      break;
    }
    case 'contract_refresh': {
      effects.push({ type: 'contract_refresh_bypass' });
      monetization = incrementSlotUsage(monetization, slotId, context, 'Piyasa yenileme');
      break;
    }
    case 'market_analysis': {
      const productId = context.selectedProductId!.trim();
      const unlockHours = slotConfig.unlockGameHours ?? 24;
      const expiresAtGameTime = context.currentGameTime + unlockHours;
      effects.push({ type: 'market_analysis_unlock', productId, expiresAtGameTime });
      monetization = {
        ...incrementSlotUsage(monetization, slotId, context, `Analiz · ${productId}`),
        marketAnalysisUnlocks: {
          ...(monetization.marketAnalysisUnlocks ?? {}),
          [productId]: { productId, expiresAtGameTime },
        },
      };
      break;
    }
    case 'maintenance_discount': {
      const truckId = context.selectedTruckId!.trim();
      const discountRate = slotConfig.discountRate ?? 0.3;
      const maxDiscountCash = slotConfig.maxDiscountCash ?? 500;
      const expiresAtGameTime = context.currentGameTime + (slotConfig.expiresGameHours ?? 24);
      effects.push({
        type: 'maintenance_discount_token',
        truckId,
        discountRate,
        maxDiscountCash,
        expiresAtGameTime,
      });
      monetization = {
        ...incrementSlotUsage(monetization, slotId, context, `Bakım indirimi · ${truckId}`),
        maintenanceDiscountTokens: {
          ...(monetization.maintenanceDiscountTokens ?? {}),
          [truckId]: {
            truckId,
            discountRate,
            maxDiscountCash,
            expiresAtGameTime,
          },
        },
      };
      break;
    }
    case 'delivery_boost': {
      const deliveryId = context.selectedDeliveryId!.trim();
      const progressBoost = slotConfig.progressBoost ?? 0.18;
      effects.push({ type: 'delivery_boost', deliveryId, progressBoost });
      monetization = {
        ...incrementSlotUsage(monetization, slotId, context, `Teslimat hızlandırma · ${deliveryId}`),
        boostedDeliveryIds: [...(monetization.boostedDeliveryIds ?? []), deliveryId],
      };
      break;
    }
    default:
      throw new Error('Geçersiz ödül slotu.');
  }

  return { monetization, effects };
}

export function consumeMaintenanceDiscountToken(
  state: MonetizationState,
  truckId: string,
): MonetizationState {
  const tokens = { ...(state.maintenanceDiscountTokens ?? {}) };
  delete tokens[truckId];
  return {
    ...state,
    maintenanceDiscountTokens: tokens,
  };
}

export function getActiveMarketAnalysisUnlock(
  state: MonetizationState,
  productId: string,
  currentGameTime: number,
): MarketAnalysisUnlock | null {
  const unlocks = state.marketAnalysisUnlocks ?? {};
  const unlock = unlocks[productId];
  if (!unlock) {
    return null;
  }
  if (unlock.expiresAtGameTime <= currentGameTime) {
    return null;
  }
  return unlock;
}

export function formatMarketAnalysisUnlockLabel(
  unlock: MarketAnalysisUnlock,
  currentGameTime: number,
): string {
  const hoursLeft = Math.max(0, unlock.expiresAtGameTime - currentGameTime);
  const totalMinutes = Math.max(0, Math.round(hoursLeft * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `Analiz açık · ${hours}s ${minutes}dk`;
  }
  if (minutes > 0) {
    return `Analiz açık · ${minutes}dk`;
  }
  return 'Analiz açık';
}

export function isDeliveryBoosted(state: MonetizationState, deliveryId: string): boolean {
  return (state.boostedDeliveryIds ?? []).includes(deliveryId);
}

export function calculateDeliveryBoostProgress(
  currentProgress: number,
  progressBoost: number,
): number {
  const safeProgress = Number.isFinite(currentProgress) ? currentProgress : 0;
  const safeBoost = Number.isFinite(progressBoost) ? progressBoost : 0;
  return Math.max(0, Math.min(1, safeProgress + safeBoost));
}
