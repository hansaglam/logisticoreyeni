/**
 * Ürün piyasa karakteri, stok durumu bias'ı ve grafik pattern seçimi.
 */

import type { ProductId } from '../types/game';

export interface ProductMarketProfile {
  volatility: number;
  trendStrength: number;
  meanReversion: number;
  shockChance: number;
  smoothing: number;
}

export interface MarketStateBias {
  directionBias: -1 | 0 | 1;
  volatilityMultiplier: number;
  meanReversionMultiplier: number;
  counterTrendBounceChance: number;
}

export type MarketPricePattern =
  | 'TREND_UP_PULLBACK'
  | 'TREND_DOWN_BOUNCE'
  | 'SIDEWAYS_NOISE'
  | 'BREAKOUT_UP'
  | 'BREAKDOWN_DOWN'
  | 'RECOVERY'
  | 'COOLING_OFF';

export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function getProductMarketProfile(productId: ProductId | string): ProductMarketProfile {
  switch (productId) {
    case 'fruit':
      return {
        volatility: 0.026,
        trendStrength: 0.6,
        meanReversion: 0.13,
        shockChance: 0.06,
        smoothing: 0.46,
      };
    case 'steel':
      return {
        volatility: 0.008,
        trendStrength: 0.86,
        meanReversion: 0.1,
        shockChance: 0.018,
        smoothing: 0.64,
      };
    case 'electronics':
      return {
        volatility: 0.017,
        trendStrength: 0.7,
        meanReversion: 0.11,
        shockChance: 0.085,
        smoothing: 0.5,
      };
    case 'machinery':
      return {
        volatility: 0.011,
        trendStrength: 0.78,
        meanReversion: 0.1,
        shockChance: 0.028,
        smoothing: 0.58,
      };
    case 'textile':
      return {
        volatility: 0.016,
        trendStrength: 0.66,
        meanReversion: 0.12,
        shockChance: 0.038,
        smoothing: 0.54,
      };
    case 'furniture':
      return {
        volatility: 0.013,
        trendStrength: 0.7,
        meanReversion: 0.11,
        shockChance: 0.032,
        smoothing: 0.56,
      };
    case 'beverage':
      return {
        volatility: 0.014,
        trendStrength: 0.68,
        meanReversion: 0.12,
        shockChance: 0.04,
        smoothing: 0.55,
      };
    default:
      return {
        volatility: 0.012,
        trendStrength: 0.68,
        meanReversion: 0.11,
        shockChance: 0.03,
        smoothing: 0.57,
      };
  }
}

function normalizeStockStatusKey(status?: string): string {
  if (!status) return 'Dengeli';
  if (status.includes('Kritik') || status.includes('Yoğun')) return 'Kritik Kıtlık';
  if (status.includes('Kıtlık') || status.includes('Az')) return 'Kıtlık';
  if (status.includes('Yüksek Fazla')) return 'Yüksek Fazla';
  if (status.includes('Fazla')) return 'Fazla';
  return 'Dengeli';
}

export function getMarketStateBias(stockStatus?: string): MarketStateBias {
  switch (normalizeStockStatusKey(stockStatus)) {
    case 'Yüksek Fazla':
    case 'Fazla':
      return {
        directionBias: -1,
        volatilityMultiplier: 0.96,
        meanReversionMultiplier: 1.05,
        counterTrendBounceChance: 0.22,
      };
    case 'Kıtlık':
      return {
        directionBias: 1,
        volatilityMultiplier: 1.08,
        meanReversionMultiplier: 0.98,
        counterTrendBounceChance: 0.26,
      };
    case 'Kritik Kıtlık':
      return {
        directionBias: 1,
        volatilityMultiplier: 1.28,
        meanReversionMultiplier: 0.92,
        counterTrendBounceChance: 0.24,
      };
    default:
      return {
        directionBias: 0,
        volatilityMultiplier: 0.72,
        meanReversionMultiplier: 1.15,
        counterTrendBounceChance: 0.14,
      };
  }
}

export function stockRatioToStatusKey(stockRatio: number): string {
  if (stockRatio < 0.3) return 'Kritik Kıtlık';
  if (stockRatio < 0.7) return 'Kıtlık';
  if (stockRatio <= 1.2) return 'Dengeli';
  if (stockRatio <= 1.6) return 'Fazla';
  return 'Yüksek Fazla';
}

const PATTERNS_BY_STATUS: Record<string, MarketPricePattern[]> = {
  Fazla: ['TREND_DOWN_BOUNCE', 'COOLING_OFF', 'SIDEWAYS_NOISE'],
  'Yüksek Fazla': ['TREND_DOWN_BOUNCE', 'COOLING_OFF', 'SIDEWAYS_NOISE'],
  Kıtlık: ['TREND_UP_PULLBACK', 'RECOVERY', 'SIDEWAYS_NOISE'],
  'Kritik Kıtlık': ['TREND_UP_PULLBACK', 'BREAKOUT_UP', 'TREND_UP_PULLBACK'],
  Dengeli: ['SIDEWAYS_NOISE', 'RECOVERY', 'COOLING_OFF'],
};

export function pickMarketPricePattern(input: {
  stockStatus?: string;
  changePercent?: number;
  productId: string;
  seed: string;
}): MarketPricePattern {
  const statusKey = normalizeStockStatusKey(input.stockStatus);
  let pool = [...(PATTERNS_BY_STATUS[statusKey] ?? PATTERNS_BY_STATUS.Dengeli)];

  const change = input.changePercent ?? 0;
  if (change > 4 && !pool.includes('BREAKOUT_UP')) {
    pool.push('BREAKOUT_UP');
  }
  if (change < -4 && !pool.includes('BREAKDOWN_DOWN')) {
    pool.push('BREAKDOWN_DOWN');
  }
  if (Math.abs(change) <= 2 && !pool.includes('SIDEWAYS_NOISE')) {
    pool.push('SIDEWAYS_NOISE');
  }

  const rng = createSeededRng(`${input.seed}-pattern`);
  return pool[Math.floor(rng() * pool.length)] ?? 'SIDEWAYS_NOISE';
}
