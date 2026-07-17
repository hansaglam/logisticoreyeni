/**
 * Piyasa fiyat geçmişi — pattern + volatilite ile seri üretimi ve momentum analizi.
 * Yalnızca seed/normalize sırasında çalışır; render'da yeniden üretilmez.
 */

import type { ProductId } from '../types/game';
import {
  createSeededRng,
  getMarketStateBias,
  getProductMarketProfile,
  pickMarketPricePattern,
  type MarketPricePattern,
} from './productMarketProfile';
import type { MarketStockStatus } from './marketProductViewModel';

export const MARKET_PRICE_HISTORY_DISPLAY_POINTS = 24;
export const MARKET_PRICE_HISTORY_MINI_POINTS = 12;

export interface PriceHistoryGenerateContext {
  productId: ProductId | string;
  cityId?: string;
  basePrice?: number;
  stockStatus?: MarketStockStatus | string;
  stock?: number;
  targetStock?: number;
}

export interface GenerateMarketPriceHistoryInput extends PriceHistoryGenerateContext {
  endPrice: number;
  startPrice?: number;
  pointCount?: number;
  seed?: string;
  pattern?: MarketPricePattern;
}

export interface PriceMomentum {
  shortTerm: number;
  mediumTerm: number;
  directionChanges: number;
  isSlowing: boolean;
  isAccelerating: boolean;
  volatility: number;
}

function roundPrice(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

function inferTrendDirection(
  startPrice: number,
  endPrice: number,
  stockStatus?: string,
): 'up' | 'down' | 'stable' {
  const bias = getMarketStateBias(stockStatus);
  const changeRatio = (endPrice - startPrice) / Math.max(startPrice, 0.01);

  if (Math.abs(changeRatio) <= 0.012) {
    if (bias.directionBias === 1) return 'up';
    if (bias.directionBias === -1) return 'down';
    return 'stable';
  }
  if (changeRatio > 0.012) return 'up';
  if (changeRatio < -0.012) return 'down';
  return 'stable';
}

function inferStartPrice(
  endPrice: number,
  basePrice: number | undefined,
  direction: 'up' | 'down' | 'stable',
  rng: () => number,
): number {
  const swing = direction === 'stable' ? 0.028 + rng() * 0.045 : 0.04 + rng() * 0.065;

  if (direction === 'up') {
    return roundPrice(endPrice * (1 - swing));
  }
  if (direction === 'down') {
    return roundPrice(endPrice * (1 + swing));
  }

  const offset = (rng() - 0.5) * swing * 1.6;
  return roundPrice(endPrice * (1 + offset));
}

function applyPatternWave(
  pattern: MarketPricePattern,
  progress: number,
  direction: 'up' | 'down' | 'stable',
  amplitude: number,
  rng: () => number,
): number {
  const waveA = Math.sin(progress * Math.PI * (1.9 + rng() * 0.6)) * amplitude;
  const waveB = Math.sin(progress * Math.PI * (4.2 + rng() * 0.8)) * amplitude * 0.22;

  switch (pattern) {
    case 'TREND_UP_PULLBACK':
      return waveA * 0.85 - Math.max(0, Math.sin(progress * Math.PI * 3.2)) * amplitude * 0.42;
    case 'TREND_DOWN_BOUNCE':
      return waveA * 0.85 + Math.max(0, Math.sin(progress * Math.PI * 3.0)) * amplitude * 0.42;
    case 'BREAKOUT_UP':
      return progress < 0.58 ? waveB * 0.35 : amplitude * (0.28 + (progress - 0.58) * 0.95);
    case 'BREAKDOWN_DOWN':
      return progress < 0.58 ? waveB * 0.35 : -amplitude * (0.28 + (progress - 0.58) * 0.95);
    case 'RECOVERY':
      return progress < 0.42
        ? -amplitude * (0.45 - progress)
        : amplitude * (progress - 0.35) * 0.85 + waveB;
    case 'COOLING_OFF':
      return progress < 0.45
        ? amplitude * (0.35 - progress * 0.2)
        : -amplitude * (progress - 0.4) * 0.75 + waveB;
    case 'SIDEWAYS_NOISE':
    default:
      return waveA * 0.62 + waveB;
  }
}

function generatePatternSeries(input: {
  pattern: MarketPricePattern;
  startPrice: number;
  endPrice: number;
  pointCount: number;
  productId: string;
  stockStatus?: string;
  seed: string;
}): number[] {
  const { pattern, startPrice, endPrice, pointCount, productId, stockStatus, seed } = input;
  const profile = getProductMarketProfile(productId);
  const bias = getMarketStateBias(stockStatus);
  const rng = createSeededRng(`${seed}-${pattern}`);

  const direction = inferTrendDirection(startPrice, endPrice, stockStatus);
  const amplitude =
    endPrice * profile.volatility * bias.volatilityMultiplier * (2.0 + rng() * 0.75);

  const prices: number[] = [startPrice];

  for (let index = 1; index < pointCount - 1; index += 1) {
    const progress = index / (pointCount - 1);
    const drift = startPrice + (endPrice - startPrice) * progress;
    const patternWave = applyPatternWave(pattern, progress, direction, amplitude, rng);

    let counterMove = 0;
    if (rng() < bias.counterTrendBounceChance) {
      const sign = direction === 'down' ? 1 : direction === 'up' ? -1 : rng() > 0.5 ? 1 : -1;
      counterMove = sign * amplitude * (0.2 + rng() * 0.35);
    }

    let shock = 0;
    if (rng() < profile.shockChance) {
      shock = (rng() > 0.5 ? 1 : -1) * amplitude * (0.5 + rng() * 0.55);
    }

    const minBound = Math.min(startPrice, endPrice) * 0.86;
    const maxBound = Math.max(startPrice, endPrice) * 1.14;
    let nextPrice = drift + patternWave + counterMove + shock;
    nextPrice = Math.max(minBound, Math.min(maxBound, nextPrice));

    prices.push(roundPrice(nextPrice));
  }

  prices.push(endPrice);

  if (direction === 'up' && prices[prices.length - 1] <= prices[0] * 1.01) {
    prices[0] = roundPrice(endPrice * (1 - 0.05 - rng() * 0.04));
  } else if (direction === 'down' && prices[prices.length - 1] >= prices[0] * 0.99) {
    prices[0] = roundPrice(endPrice * (1 + 0.05 + rng() * 0.04));
  }

  prices[prices.length - 1] = endPrice;
  return prices;
}

export function generateMarketPriceHistory(
  input: GenerateMarketPriceHistoryInput,
): number[] {
  const endPrice = Math.max(input.endPrice, 0.01);
  const pointCount = Math.max(8, input.pointCount ?? MARKET_PRICE_HISTORY_DISPLAY_POINTS);
  const seed =
    input.seed ?? `${input.cityId ?? 'city'}-${input.productId}-history`;
  const rng = createSeededRng(seed);

  const bias = getMarketStateBias(input.stockStatus);
  const directionHint =
    bias.directionBias === 1 ? 'up' : bias.directionBias === -1 ? 'down' : 'stable';

  const startPrice =
    input.startPrice != null && input.startPrice > 0
      ? roundPrice(input.startPrice)
      : inferStartPrice(endPrice, input.basePrice, directionHint, rng);

  const changePercent = ((endPrice - startPrice) / Math.max(startPrice, 0.01)) * 100;
  const pattern =
    input.pattern ??
    pickMarketPricePattern({
      stockStatus: input.stockStatus,
      changePercent,
      productId: String(input.productId),
      seed,
    });

  return generatePatternSeries({
    pattern,
    startPrice,
    endPrice,
    pointCount,
    productId: String(input.productId),
    stockStatus: input.stockStatus,
    seed,
  });
}

export function countPriceDirectionChanges(prices: number[]): number {
  if (prices.length < 3) return 0;
  let changes = 0;
  let previousSign = 0;

  for (let index = 1; index < prices.length; index += 1) {
    const delta = prices[index] - prices[index - 1];
    if (Math.abs(delta) < 0.001) continue;
    const sign = delta > 0 ? 1 : -1;
    if (previousSign !== 0 && sign !== previousSign) {
      changes += 1;
    }
    previousSign = sign;
  }

  return changes;
}

export function isMonotonicPriceHistory(prices: number[]): boolean {
  if (prices.length < 4) return true;
  return countPriceDirectionChanges(prices) <= 1;
}

export function shouldEnrichPriceHistory(prices: number[]): boolean {
  if (prices.length < MARKET_PRICE_HISTORY_MINI_POINTS) {
    return true;
  }
  return isMonotonicPriceHistory(prices);
}

export function enrichPriceHistory(
  history: number[],
  context: PriceHistoryGenerateContext & { endPrice: number },
): number[] {
  const cleaned = history
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const endPrice = Math.max(context.endPrice, 0.01);
  const startPrice = cleaned.length > 0 ? cleaned[0] : undefined;
  const stableSeed = `${context.cityId ?? 'city'}-${context.productId}-enrich`;

  return generateMarketPriceHistory({
    ...context,
    endPrice,
    startPrice,
    seed: stableSeed,
    pointCount: MARKET_PRICE_HISTORY_DISPLAY_POINTS,
  });
}

export function slicePriceHistoryForDisplay(
  prices: number[],
  pointCount: number,
): number[] {
  if (prices.length <= pointCount) {
    return prices;
  }
  return prices.slice(-pointCount);
}

function percentChange(from: number, to: number): number {
  const safeFrom = Math.max(from, 0.01);
  return ((to - safeFrom) / safeFrom) * 100;
}

function segmentSlope(prices: number[], fromIndex: number, length: number): number {
  if (prices.length < 2 || fromIndex < 0) return 0;
  const startIndex = Math.max(0, fromIndex);
  const endIndex = Math.min(prices.length - 1, startIndex + length);
  if (endIndex <= startIndex) return 0;
  return percentChange(prices[startIndex], prices[endIndex]) / (endIndex - startIndex);
}

export function computePriceMomentum(prices: number[]): PriceMomentum {
  const cleaned = prices.filter((value) => Number.isFinite(value) && value > 0);

  if (cleaned.length < 2) {
    return {
      shortTerm: 0,
      mediumTerm: 0,
      directionChanges: 0,
      isSlowing: false,
      isAccelerating: false,
      volatility: 0,
    };
  }

  const shortLen = Math.min(4, cleaned.length - 1);
  const mediumLen = Math.min(12, cleaned.length - 1);

  const shortTerm = percentChange(
    cleaned[cleaned.length - 1 - shortLen],
    cleaned[cleaned.length - 1],
  );
  const mediumTerm = percentChange(
    cleaned[cleaned.length - 1 - mediumLen],
    cleaned[cleaned.length - 1],
  );

  const recentSlope = segmentSlope(cleaned, cleaned.length - 1 - shortLen, shortLen);
  const priorSlope = segmentSlope(
    cleaned,
    Math.max(0, cleaned.length - 1 - shortLen * 2),
    shortLen,
  );

  const directionChanges = countPriceDirectionChanges(cleaned);

  let volatility = 0;
  for (let index = 1; index < cleaned.length; index += 1) {
    volatility += Math.abs(percentChange(cleaned[index - 1], cleaned[index]));
  }
  volatility /= Math.max(cleaned.length - 1, 1);

  const isSlowing =
    Math.abs(recentSlope) < Math.abs(priorSlope) * 0.75 &&
    Math.abs(priorSlope) > 0.08;

  const isAccelerating =
    Math.abs(recentSlope) > Math.abs(priorSlope) * 1.25 &&
    Math.abs(recentSlope) > 0.08;

  return {
    shortTerm,
    mediumTerm,
    directionChanges,
    isSlowing,
    isAccelerating,
    volatility,
  };
}

export function resolveMomentumTrendDirection(momentum: PriceMomentum): 'up' | 'down' | 'stable' {
  if (momentum.mediumTerm > 1.5) return 'up';
  if (momentum.mediumTerm < -1.5) return 'down';
  return 'stable';
}
