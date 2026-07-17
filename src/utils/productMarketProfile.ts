/**
 * Ürün piyasa karakteri, stok durumu bias'ı ve grafik pattern seçimi.
 */

import type { ProductId } from '../types/game';

export interface ProductMarketProfile {
  /** Temel volatilite katsayısı */
  volatility: number;
  /** Ana trend ne kadar net */
  trendStrength: number;
  meanReversion: number;
  /** Sert sıçrama olasılığı — düşük tutulmalı */
  shockChance: number;
  /** Seri sonrası yumuşatma (0–1) */
  smoothing: number;
  /** Mikro dalga frekansı — meyve yüksek, çelik düşük */
  waveFrequency: number;
  /** Segment içi dalga genliği çarpanı */
  microWaveAmplitude: number;
  /** Geri çekilme derinliği (yükseliş trendinde) */
  pullbackDepth: number;
  /** Tepki yükselişi yüksekliği (düşüş trendinde) */
  bounceHeight: number;
  /** Yatay konsolidasyon olasılığı */
  consolidationChance: number;
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

export type MarketStoryPhase =
  | 'impulse_up'
  | 'impulse_down'
  | 'pullback'
  | 'bounce'
  | 'consolidation'
  | 'deceleration'
  | 'squeeze';

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
        volatility: 0.028,
        trendStrength: 0.58,
        meanReversion: 0.14,
        shockChance: 0.035,
        smoothing: 0.32,
        waveFrequency: 3.8,
        microWaveAmplitude: 1.25,
        pullbackDepth: 0.42,
        bounceHeight: 0.46,
        consolidationChance: 0.18,
      };
    case 'steel':
      return {
        volatility: 0.009,
        trendStrength: 0.88,
        meanReversion: 0.09,
        shockChance: 0.012,
        smoothing: 0.5,
        waveFrequency: 1.4,
        microWaveAmplitude: 0.72,
        pullbackDepth: 0.32,
        bounceHeight: 0.34,
        consolidationChance: 0.28,
      };
    case 'electronics':
      return {
        volatility: 0.019,
        trendStrength: 0.72,
        meanReversion: 0.11,
        shockChance: 0.048,
        smoothing: 0.38,
        waveFrequency: 2.6,
        microWaveAmplitude: 1.05,
        pullbackDepth: 0.36,
        bounceHeight: 0.38,
        consolidationChance: 0.16,
      };
    case 'machinery':
      return {
        volatility: 0.012,
        trendStrength: 0.78,
        meanReversion: 0.1,
        shockChance: 0.022,
        smoothing: 0.58,
        waveFrequency: 1.9,
        microWaveAmplitude: 0.68,
        pullbackDepth: 0.26,
        bounceHeight: 0.28,
        consolidationChance: 0.22,
      };
    case 'textile':
      return {
        volatility: 0.016,
        trendStrength: 0.66,
        meanReversion: 0.12,
        shockChance: 0.028,
        smoothing: 0.54,
        waveFrequency: 2.2,
        microWaveAmplitude: 0.74,
        pullbackDepth: 0.3,
        bounceHeight: 0.32,
        consolidationChance: 0.2,
      };
    case 'furniture':
      return {
        volatility: 0.013,
        trendStrength: 0.7,
        meanReversion: 0.11,
        shockChance: 0.025,
        smoothing: 0.56,
        waveFrequency: 2.0,
        microWaveAmplitude: 0.7,
        pullbackDepth: 0.28,
        bounceHeight: 0.3,
        consolidationChance: 0.21,
      };
    case 'beverage':
      return {
        volatility: 0.014,
        trendStrength: 0.68,
        meanReversion: 0.12,
        shockChance: 0.03,
        smoothing: 0.55,
        waveFrequency: 2.1,
        microWaveAmplitude: 0.72,
        pullbackDepth: 0.29,
        bounceHeight: 0.31,
        consolidationChance: 0.2,
      };
    default:
      return {
        volatility: 0.012,
        trendStrength: 0.68,
        meanReversion: 0.11,
        shockChance: 0.025,
        smoothing: 0.57,
        waveFrequency: 2.0,
        microWaveAmplitude: 0.7,
        pullbackDepth: 0.28,
        bounceHeight: 0.3,
        consolidationChance: 0.2,
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
        counterTrendBounceChance: 0.28,
      };
    case 'Kıtlık':
      return {
        directionBias: 1,
        volatilityMultiplier: 1.08,
        meanReversionMultiplier: 0.98,
        counterTrendBounceChance: 0.3,
      };
    case 'Kritik Kıtlık':
      return {
        directionBias: 1,
        volatilityMultiplier: 1.28,
        meanReversionMultiplier: 0.92,
        counterTrendBounceChance: 0.28,
      };
    default:
      return {
        directionBias: 0,
        volatilityMultiplier: 0.78,
        meanReversionMultiplier: 1.12,
        counterTrendBounceChance: 0.2,
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
  Fazla: ['TREND_DOWN_BOUNCE', 'COOLING_OFF', 'SIDEWAYS_NOISE', 'BREAKDOWN_DOWN'],
  'Yüksek Fazla': ['TREND_DOWN_BOUNCE', 'COOLING_OFF', 'BREAKDOWN_DOWN', 'SIDEWAYS_NOISE'],
  Kıtlık: ['TREND_UP_PULLBACK', 'RECOVERY', 'SIDEWAYS_NOISE', 'BREAKOUT_UP'],
  'Kritik Kıtlık': ['TREND_UP_PULLBACK', 'BREAKOUT_UP', 'RECOVERY', 'TREND_UP_PULLBACK'],
  Dengeli: ['SIDEWAYS_NOISE', 'RECOVERY', 'COOLING_OFF', 'TREND_UP_PULLBACK', 'TREND_DOWN_BOUNCE'],
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

export function buildMarketStorySegments(
  pattern: MarketPricePattern,
  direction: 'up' | 'down' | 'stable',
  profile: ProductMarketProfile,
  rng: () => number,
): Array<{ phase: MarketStoryPhase; lengthRatio: number }> {
  const jitter = () => 0.04 + rng() * 0.06;

  switch (pattern) {
    case 'TREND_UP_PULLBACK':
      return [
        { phase: 'impulse_up', lengthRatio: 0.26 + jitter() },
        { phase: 'pullback', lengthRatio: 0.16 + jitter() * 0.7 },
        { phase: 'impulse_up', lengthRatio: 0.24 + jitter() },
        { phase: 'consolidation', lengthRatio: 0.14 + jitter() * 0.6 },
        { phase: 'deceleration', lengthRatio: 0.1 + jitter() * 0.5 },
      ];
    case 'TREND_DOWN_BOUNCE':
      return [
        { phase: 'impulse_down', lengthRatio: 0.24 + jitter() },
        { phase: 'bounce', lengthRatio: 0.14 + jitter() * 0.7 },
        { phase: 'impulse_down', lengthRatio: 0.22 + jitter() },
        { phase: 'bounce', lengthRatio: 0.1 + jitter() * 0.5 },
        { phase: 'deceleration', lengthRatio: 0.12 + jitter() * 0.5 },
      ];
    case 'BREAKOUT_UP':
      return [
        { phase: 'squeeze', lengthRatio: 0.22 + jitter() * 0.6 },
        { phase: 'impulse_up', lengthRatio: 0.32 + jitter() },
        { phase: 'pullback', lengthRatio: 0.12 + jitter() * 0.5 },
        { phase: 'impulse_up', lengthRatio: 0.18 + jitter() * 0.8 },
        { phase: 'deceleration', lengthRatio: 0.08 + jitter() * 0.4 },
      ];
    case 'BREAKDOWN_DOWN':
      return [
        { phase: 'squeeze', lengthRatio: 0.2 + jitter() * 0.5 },
        { phase: 'impulse_down', lengthRatio: 0.3 + jitter() },
        { phase: 'bounce', lengthRatio: 0.12 + jitter() * 0.5 },
        { phase: 'impulse_down', lengthRatio: 0.16 + jitter() * 0.7 },
        { phase: 'deceleration', lengthRatio: 0.1 + jitter() * 0.4 },
      ];
    case 'RECOVERY':
      return [
        { phase: 'impulse_down', lengthRatio: 0.2 + jitter() * 0.6 },
        { phase: 'bounce', lengthRatio: 0.16 + jitter() * 0.7 },
        { phase: 'impulse_up', lengthRatio: 0.28 + jitter() },
        { phase: 'consolidation', lengthRatio: 0.14 + jitter() * 0.6 },
        { phase: 'deceleration', lengthRatio: 0.08 + jitter() * 0.4 },
      ];
    case 'COOLING_OFF':
      return [
        { phase: 'impulse_up', lengthRatio: 0.22 + jitter() * 0.6 },
        { phase: 'deceleration', lengthRatio: 0.18 + jitter() * 0.7 },
        { phase: 'pullback', lengthRatio: 0.16 + jitter() * 0.6 },
        { phase: 'consolidation', lengthRatio: 0.2 + jitter() * 0.8 },
        { phase: 'impulse_down', lengthRatio: 0.1 + jitter() * 0.4 },
      ];
    case 'SIDEWAYS_NOISE':
    default:
      if (direction === 'up') {
        return [
          { phase: 'consolidation', lengthRatio: 0.22 + jitter() * 0.6 },
          { phase: 'impulse_up', lengthRatio: 0.2 + jitter() * 0.7 },
          { phase: 'pullback', lengthRatio: 0.14 + jitter() * 0.5 },
          { phase: 'consolidation', lengthRatio: 0.18 + jitter() * 0.6 },
          { phase: 'impulse_up', lengthRatio: 0.12 + jitter() * 0.5 },
        ];
      }
      if (direction === 'down') {
        return [
          { phase: 'consolidation', lengthRatio: 0.22 + jitter() * 0.6 },
          { phase: 'impulse_down', lengthRatio: 0.2 + jitter() * 0.7 },
          { phase: 'bounce', lengthRatio: 0.14 + jitter() * 0.5 },
          { phase: 'consolidation', lengthRatio: 0.18 + jitter() * 0.6 },
          { phase: 'impulse_down', lengthRatio: 0.12 + jitter() * 0.5 },
        ];
      }
      return [
        { phase: 'consolidation', lengthRatio: 0.28 + jitter() },
        { phase: 'bounce', lengthRatio: 0.12 + jitter() * 0.5 },
        { phase: 'pullback', lengthRatio: 0.12 + jitter() * 0.5 },
        { phase: 'consolidation', lengthRatio: 0.24 + jitter() },
        { phase: 'consolidation', lengthRatio: 0.12 + jitter() * 0.5 },
      ];
  }
}
