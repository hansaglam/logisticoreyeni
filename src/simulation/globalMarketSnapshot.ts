/**
 * Global market epoch + deterministic snapshot — ortak canlı piyasa.
 */

import type { City, GlobalEconomy, ProductId, WorldEvent } from '../types/game';
import {
  getEconomyNow,
  getMarketEpoch,
  getNextMarketTickAt,
  MARKET_TICK_INTERVAL_MS,
  ECONOMY_CONFIG_VERSION,
} from './economyClock';
import {
  FUEL_PRICE_MAX_PER_LITER,
  FUEL_PRICE_MIN_PER_LITER,
  getSafeFuelPrice,
  normalizeGlobalEconomy,
  sanitizeFuelPricePerLiter,
} from './economy';
import { clampPrice } from './marketEconomyCalculations';

export const GLOBAL_MARKET_SEED = 'logisticore-global-market-v1';
export { ECONOMY_CONFIG_VERSION };

export { FUEL_PRICE_MAX_PER_LITER, FUEL_PRICE_MIN_PER_LITER, sanitizeFuelPricePerLiter };

export interface GlobalEconomySnapshot {
  version: number;
  epoch: number;
  generatedAt: number;
  validUntil: number;
  fuelPricePerLiter: number;
  cityMarketPrices: Record<string, Partial<Record<ProductId, number>>>;
  activeEvents: WorldEvent[];
  modifiers: {
    fuelMultiplier: number;
    maintenanceMultiplier: number;
    demandMultiplier: number;
  };
  economyConfigVersion: number;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministik 0–1 RNG — kişisel Math.random yok */
export function createMarketSeededRng(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function buildMarketSeed(
  epoch: number,
  cityId: string,
  productId: string,
): string {
  return `${GLOBAL_MARKET_SEED}|${epoch}|${cityId}|${productId}`;
}

export function resolveActiveEventModifiers(events: WorldEvent[] | undefined): {
  fuelMultiplier: number;
  maintenanceMultiplier: number;
  demandMultiplier: number;
} {
  let fuelMultiplier = 1;
  let maintenanceMultiplier = 1;
  let demandMultiplier = 1;
  for (const event of events ?? []) {
    if (!event.isActive) continue;
    const impact = event.impact;
    if (!impact) continue;
    if (typeof impact.fuelPriceMultiplier === 'number' && Number.isFinite(impact.fuelPriceMultiplier)) {
      fuelMultiplier *= Math.max(1, Math.min(1.35, impact.fuelPriceMultiplier));
    }
    if (
      typeof impact.maintenanceCostMultiplier === 'number' &&
      Number.isFinite(impact.maintenanceCostMultiplier)
    ) {
      maintenanceMultiplier *= Math.max(0.5, Math.min(1.5, impact.maintenanceCostMultiplier));
    }
    if (
      typeof impact.productDemandMultiplier === 'number' &&
      Number.isFinite(impact.productDemandMultiplier)
    ) {
      demandMultiplier *= Math.max(0.5, Math.min(1.5, impact.productDemandMultiplier));
    }
  }
  return { fuelMultiplier, maintenanceMultiplier, demandMultiplier };
}

export function buildGlobalEconomySnapshot(params: {
  globalEconomy?: GlobalEconomy | null;
  cities?: City[];
  activeEvents?: WorldEvent[];
  nowMs?: number;
}): GlobalEconomySnapshot {
  const nowMs = params.nowMs ?? getEconomyNow();
  const epoch = getMarketEpoch(nowMs);
  const economy = normalizeGlobalEconomy(params.globalEconomy ?? {});
  const modifiers = resolveActiveEventModifiers(params.activeEvents);
  const fuelPricePerLiter = sanitizeFuelPricePerLiter(
    getSafeFuelPrice(economy) * modifiers.fuelMultiplier,
  );

  const cityMarketPrices: GlobalEconomySnapshot['cityMarketPrices'] = {};
  for (const city of params.cities ?? []) {
    const productPrices: Partial<Record<ProductId, number>> = {};
    for (const [productId, state] of Object.entries(city.products ?? {})) {
      const base = state.basePrice ?? state.currentPrice ?? 1;
      const current = state.currentPrice ?? base;
      const rng = createMarketSeededRng(buildMarketSeed(epoch, city.id, productId));
      // Epoch içi küçük deterministik sapma (±1.5%) — ortak piyasa hissi
      const wobble = 1 + (rng() - 0.5) * 0.03;
      productPrices[productId as ProductId] = clampPrice(current * wobble, base);
    }
    cityMarketPrices[city.id] = productPrices;
  }

  return {
    version: 1,
    epoch,
    generatedAt: nowMs,
    validUntil: getNextMarketTickAt(nowMs),
    fuelPricePerLiter,
    cityMarketPrices,
    activeEvents: (params.activeEvents ?? []).filter((event) => event.isActive),
    modifiers,
    economyConfigVersion: ECONOMY_CONFIG_VERSION,
  };
}

export function applyFuelPriceSanitizationToEconomy(
  globalEconomy: GlobalEconomy | null | undefined,
): GlobalEconomy {
  const normalized = normalizeGlobalEconomy(globalEconomy ?? {});
  return {
    ...normalized,
    fuelPrice: sanitizeFuelPricePerLiter(normalized.fuelPrice),
  };
}

export { MARKET_TICK_INTERVAL_MS, getMarketEpoch, getNextMarketTickAt };
