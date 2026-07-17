/**
 * Piyasa fiyat geçmişi — segment hikâyesi + volatilite ile seri üretimi ve momentum analizi.
 * Seed/normalize + render öncesi görünüm katmanı; ekonomi currentPrice'a dokunmaz.
 */

import type { ProductId } from '../types/game';
import {
  buildMarketStorySegments,
  createSeededRng,
  getMarketStateBias,
  getProductMarketProfile,
  pickMarketPricePattern,
  type MarketPricePattern,
  type MarketStoryPhase,
  type ProductMarketProfile,
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
  /** Son segmentte kısa tepki (düşüşte yukarı / yükselişte aşağı) */
  hasRecentCounterMove: boolean;
  /** Yatay salınım — çok yön değişimi, düşük net hareket */
  isChoppy: boolean;
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
  const swing = direction === 'stable' ? 0.032 + rng() * 0.048 : 0.045 + rng() * 0.07;

  if (direction === 'up') {
    return roundPrice(endPrice * (1 - swing));
  }
  if (direction === 'down') {
    return roundPrice(endPrice * (1 + swing));
  }

  const offset = (rng() - 0.5) * swing * 1.8;
  return roundPrice(endPrice * (1 + offset));
}

function normalizeSegmentRatios(
  segments: Array<{ phase: MarketStoryPhase; lengthRatio: number }>,
): Array<{ phase: MarketStoryPhase; start: number; end: number }> {
  const total = segments.reduce((sum, segment) => sum + segment.lengthRatio, 0);
  let cursor = 0;

  return segments.map((segment) => {
    const ratio = segment.lengthRatio / Math.max(total, 0.001);
    const start = cursor;
    cursor += ratio;
    return { phase: segment.phase, start, end: cursor };
  });
}

function resolvePhaseAtProgress(
  segments: Array<{ phase: MarketStoryPhase; start: number; end: number }>,
  progress: number,
): MarketStoryPhase {
  for (const segment of segments) {
    if (progress >= segment.start && progress < segment.end) {
      return segment.phase;
    }
  }
  return segments[segments.length - 1]?.phase ?? 'consolidation';
}

function applyPhaseOffset(
  phase: MarketStoryPhase,
  localProgress: number,
  amplitude: number,
  profile: ProductMarketProfile,
  direction: 'up' | 'down' | 'stable',
): number {
  const wave =
    Math.sin(localProgress * Math.PI * profile.waveFrequency) *
    amplitude *
    profile.microWaveAmplitude *
    0.42;

  switch (phase) {
    case 'impulse_up':
      return amplitude * (0.16 + localProgress * 0.62) + wave;
    case 'impulse_down':
      return -amplitude * (0.16 + localProgress * 0.62) - wave;
    case 'pullback':
      return -amplitude * profile.pullbackDepth * (0.42 + Math.sin(localProgress * Math.PI) * 0.72);
    case 'bounce':
      return amplitude * profile.bounceHeight * (0.42 + Math.sin(localProgress * Math.PI) * 0.72);
    case 'consolidation':
      return (
        Math.sin(localProgress * Math.PI * (profile.waveFrequency * 1.4)) *
        amplitude *
        0.42 *
        profile.microWaveAmplitude
      );
    case 'squeeze':
      return (
        Math.sin(localProgress * Math.PI * 2.2) * amplitude * 0.14 -
        amplitude * 0.04 * (1 - localProgress)
      );
    case 'deceleration':
      if (direction === 'up') {
        return amplitude * (0.18 - localProgress * 0.22) + wave * 0.4;
      }
      if (direction === 'down') {
        return -amplitude * (0.18 - localProgress * 0.22) - wave * 0.4;
      }
      return wave * 0.35;
    default:
      return wave;
  }
}

function gaussianEnvelope(progress: number, center: number, width: number): number {
  const distance = (progress - center) / Math.max(width, 0.001);
  return Math.exp(-(distance * distance) * 2.8);
}

function countSameDirectionSteps(prices: number[]): { up: number; down: number; total: number } {
  let up = 0;
  let down = 0;

  for (let index = 1; index < prices.length; index += 1) {
    const delta = prices[index] - prices[index - 1];
    if (delta > 0.001) up += 1;
    else if (delta < -0.001) down += 1;
  }

  return { up, down, total: prices.length - 1 };
}

/** 24 noktanın ~%72+ aynı yönde gitmesi veya ≤2 yön değişimi = fazla düz */
export function isOverLinearChart(prices: number[]): boolean {
  if (prices.length < 6) return true;

  const { up, down, total } = countSameDirectionSteps(prices);
  if (total === 0) return true;

  const dominantRatio = Math.max(up, down) / total;
  if (dominantRatio >= 0.72) return true;
  if (countPriceDirectionChanges(prices) <= 2) return true;

  return false;
}

function resolveChartTrendDirection(
  startPrice: number,
  endPrice: number,
): 'up' | 'down' | 'stable' {
  const changeRatio = (endPrice - startPrice) / Math.max(startPrice, 0.01);
  if (changeRatio > 0.012) return 'up';
  if (changeRatio < -0.012) return 'down';
  return 'stable';
}

function computeMicroDeviationBudget(
  startPrice: number,
  endPrice: number,
  profile: ProductMarketProfile,
): number {
  const totalRange = Math.abs(endPrice - startPrice);
  const meanPrice = (startPrice + endPrice) / 2;
  return Math.max(
    totalRange * 0.28,
    meanPrice * profile.volatility * 2.6,
    meanPrice * 0.0045,
  );
}

/** Yükselişte geri çekilme / düşüşte tepki — son fiyat korunur */
export function injectSubtlePullbacks(
  prices: number[],
  endPrice: number,
  productId: string,
  seed: string,
): number[] {
  if (prices.length < 8) return prices;

  const startPrice = prices[0];
  const direction = resolveChartTrendDirection(startPrice, endPrice);

  const profile = getProductMarketProfile(productId);
  const rng = createSeededRng(`${seed}-pullback`);
  const n = prices.length;
  const budget = computeMicroDeviationBudget(startPrice, endPrice, profile);
  const result: number[] = [];

  const pullbackCenters =
    direction === 'up'
      ? [0.28 + rng() * 0.06, 0.58 + rng() * 0.08]
      : [];
  const bounceCenters =
    direction === 'down'
      ? [0.3 + rng() * 0.06, 0.6 + rng() * 0.07]
      : [];

  for (let index = 0; index < n; index += 1) {
    const progress = index / (n - 1);
    const baseline = startPrice + (endPrice - startPrice) * progress;
    let deviation = 0;

    if (direction === 'up') {
      for (const center of pullbackCenters) {
        deviation -=
          gaussianEnvelope(progress, center, 0.075) *
          budget *
          profile.pullbackDepth *
          (0.85 + rng() * 0.2);
      }
    } else if (direction === 'down') {
      for (const center of bounceCenters) {
        deviation +=
          gaussianEnvelope(progress, center, 0.07) *
          budget *
          profile.bounceHeight *
          (0.85 + rng() * 0.2);
      }
    } else {
      deviation +=
        Math.sin(progress * Math.PI * profile.waveFrequency * 1.1) *
        budget *
        0.42 *
        profile.microWaveAmplitude;
      deviation +=
        Math.sin(progress * Math.PI * (profile.waveFrequency * 2.4 + 0.6)) *
        budget *
        0.18;
    }

    deviation +=
      Math.sin(progress * Math.PI * profile.waveFrequency) *
      budget *
      0.14 *
      profile.microWaveAmplitude;

    result.push(roundPrice(baseline + deviation));
  }

  result[0] = roundPrice(startPrice);
  result[n - 1] = roundPrice(endPrice);
  return result;
}

/** Kısa yataylama / tempo düşüşü segmentleri */
export function addConsolidationSegments(
  prices: number[],
  endPrice: number,
  productId: string,
  seed: string,
): number[] {
  if (prices.length < 8) return prices;

  const profile = getProductMarketProfile(productId);
  const rng = createSeededRng(`${seed}-consolidation`);
  const startPrice = prices[0];
  const direction = resolveChartTrendDirection(startPrice, endPrice);
  const n = prices.length;
  const budget = computeMicroDeviationBudget(startPrice, endPrice, profile) * 0.55;

  const plateauCenter = direction === 'up' ? 0.82 + rng() * 0.06 : 0.8 + rng() * 0.08;
  const slowdownCenter = direction === 'down' ? 0.78 + rng() * 0.06 : 0.76 + rng() * 0.06;

  const result = prices.map((price, index) => {
    const progress = index / (n - 1);
    const baseline = startPrice + (endPrice - startPrice) * progress;

    let flatBias = 0;
    flatBias += gaussianEnvelope(progress, plateauCenter, 0.09) * budget * 0.35;
    if (direction === 'down') {
      flatBias += gaussianEnvelope(progress, slowdownCenter, 0.1) * budget * 0.25;
    }

    const oscillation =
      Math.sin(progress * Math.PI * (profile.waveFrequency * 0.85 + 0.4)) *
      budget *
      0.22 *
      profile.microWaveAmplitude;

    if (direction === 'stable') {
      return roundPrice(
        baseline +
          oscillation +
          gaussianEnvelope(progress, 0.45 + rng() * 0.1, 0.12) * budget * 0.3,
      );
    }

    const blended = price * 0.55 + (baseline + flatBias + oscillation) * 0.45;
    return roundPrice(blended);
  });

  result[0] = roundPrice(startPrice);
  result[n - 1] = roundPrice(endPrice);
  return result;
}

/** Fazla lineer grafiklere kontrollü mikro yapı enjekte eder */
export function avoidOverLinearChartShape(
  prices: number[],
  endPrice: number,
  productId: string,
  seed: string,
): number[] {
  if (prices.length < 6) return prices;

  let result = [...prices];
  result[result.length - 1] = roundPrice(endPrice);

  if (isOverLinearChart(result)) {
    result = injectSubtlePullbacks(result, endPrice, productId, seed);
    result = addConsolidationSegments(result, endPrice, productId, seed);
  } else if (countPriceDirectionChanges(result) < 4) {
    result = injectSubtlePullbacks(result, endPrice, productId, `${seed}-extra`);
  }

  result[0] = roundPrice(result[0]);
  result[result.length - 1] = roundPrice(endPrice);
  return blendSmoothPriceSeries(result, 0.16);
}

function smoothPriceSeries(prices: number[], smoothing: number): number[] {
  if (prices.length < 4 || smoothing <= 0) {
    return prices;
  }

  const window = smoothing > 0.6 ? 3 : 2;
  const result = [...prices];

  for (let index = 1; index < prices.length - 1; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -window; offset <= window; offset += 1) {
      const sampleIndex = index + offset;
      if (sampleIndex >= 0 && sampleIndex < prices.length) {
        sum += prices[sampleIndex];
        count += 1;
      }
    }
    result[index] = sum / Math.max(count, 1);
  }

  result[0] = prices[0];
  result[result.length - 1] = prices[prices.length - 1];
  return result.map(roundPrice);
}

/** Hafif yumuşatma — mikro dalgaları korur */
function blendSmoothPriceSeries(prices: number[], smoothing: number): number[] {
  if (prices.length < 4 || smoothing <= 0) {
    return prices;
  }

  const smoothed = smoothPriceSeries(prices, smoothing);
  const blend = Math.min(0.38, smoothing);

  return prices.map((price, index) =>
    roundPrice(price * (1 - blend) + smoothed[index] * blend),
  );
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
    endPrice * profile.volatility * bias.volatilityMultiplier * (3.0 + rng() * 1.0);

  const rawSegments = buildMarketStorySegments(pattern, direction, profile, rng);
  const segments = normalizeSegmentRatios(rawSegments);

  const prices: number[] = [roundPrice(startPrice)];

  for (let index = 1; index < pointCount - 1; index += 1) {
    const progress = index / (pointCount - 1);
    const drift = startPrice + (endPrice - startPrice) * progress;

    const segment = segments.find((item) => progress >= item.start && progress < item.end) ?? segments[0];
    const localProgress =
      segment.end > segment.start
        ? (progress - segment.start) / (segment.end - segment.start)
        : 0;

    const phase = resolvePhaseAtProgress(segments, progress);
    const phaseOffset = applyPhaseOffset(
      phase,
      localProgress,
      amplitude,
      profile,
      direction,
    );

    let counterMove = 0;
    if (rng() < bias.counterTrendBounceChance * 0.82) {
      const sign = direction === 'down' ? 1 : direction === 'up' ? -1 : rng() > 0.5 ? 1 : -1;
      counterMove = sign * amplitude * (0.16 + rng() * 0.26);
    }

    let shock = 0;
    if (rng() < profile.shockChance * 0.45) {
      shock = (rng() > 0.5 ? 1 : -1) * amplitude * (0.22 + rng() * 0.26);
    }

    const minBound = Math.min(startPrice, endPrice) * 0.84;
    const maxBound = Math.max(startPrice, endPrice) * 1.16;
    let nextPrice = drift + phaseOffset + counterMove + shock;
    nextPrice = Math.max(minBound, Math.min(maxBound, nextPrice));

    prices.push(roundPrice(nextPrice));
  }

  prices.push(roundPrice(endPrice));

  if (direction === 'up' && prices[prices.length - 1] <= prices[0] * 1.012) {
    prices[0] = roundPrice(endPrice * (1 - 0.055 - rng() * 0.035));
  } else if (direction === 'down' && prices[prices.length - 1] >= prices[0] * 0.988) {
    prices[0] = roundPrice(endPrice * (1 + 0.055 + rng() * 0.035));
  }

  let result = blendSmoothPriceSeries(prices, profile.smoothing * 0.28);
  result[result.length - 1] = roundPrice(endPrice);
  result[0] = roundPrice(result[0]);

  return avoidOverLinearChartShape(result, endPrice, productId, `${seed}-shape`);
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
  if (isMonotonicPriceHistory(prices)) {
    return true;
  }
  return countPriceDirectionChanges(prices) <= 2;
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

function resamplePriceSeries(prices: number[], pointCount: number): number[] {
  if (prices.length === pointCount) {
    return prices;
  }
  if (prices.length === 1) {
    return Array.from({ length: pointCount }, () => prices[0]);
  }

  const result: number[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const position = (index / (pointCount - 1)) * (prices.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(prices.length - 1, lowerIndex + 1);
    const fraction = position - lowerIndex;
    const value =
      prices[lowerIndex] * (1 - fraction) + prices[upperIndex] * fraction;
    result.push(roundPrice(value));
  }
  return result;
}

function needsDisplayReshape(prices: number[]): boolean {
  if (prices.length < 8) return true;
  if (isMonotonicPriceHistory(prices)) return true;
  if (countPriceDirectionChanges(prices) <= 2) return true;

  let volatility = 0;
  for (let index = 1; index < prices.length; index += 1) {
    volatility += Math.abs(prices[index] - prices[index - 1]) / Math.max(prices[index - 1], 0.01);
  }
  volatility /= Math.max(prices.length - 1, 1);

  const profileAvgVolatility = 0.012;
  return volatility < profileAvgVolatility * 0.35;
}

/**
 * Render öncesi grafik serisi — ekonomi verisini değiştirmez, son nokta = endPrice.
 * Mini ve detay grafik aynı hikâyeyi paylaşır.
 */
export function shapeChartDisplaySeries(input: {
  prices: number[];
  endPrice: number;
  productId: ProductId | string;
  cityId: string;
  stockStatus?: string;
  pointCount?: number;
}): number[] {
  const pointCount = input.pointCount ?? MARKET_PRICE_HISTORY_DISPLAY_POINTS;
  const endPrice = Math.max(input.endPrice, 0.01);
  const cleaned = input.prices
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const seed = `${input.cityId}-${input.productId}-chart-display`;

  if (cleaned.length === 0) {
    return generateMarketPriceHistory({
      endPrice,
      productId: input.productId,
      cityId: input.cityId,
      stockStatus: input.stockStatus,
      seed,
      pointCount,
    });
  }

  const working =
    Math.abs(cleaned[cleaned.length - 1] - endPrice) > 0.001
      ? [...cleaned.slice(-pointCount * 2), endPrice]
      : [...cleaned.slice(-pointCount * 2)];

  working[working.length - 1] = endPrice;

  if (needsDisplayReshape(working)) {
    const startPrice = working[0] ?? endPrice;
    const generated = generateMarketPriceHistory({
      endPrice,
      startPrice,
      productId: input.productId,
      cityId: input.cityId,
      stockStatus: input.stockStatus,
      seed,
      pointCount,
    });
    return avoidOverLinearChartShape(generated, endPrice, String(input.productId), seed);
  }

  const resampled = resamplePriceSeries(working, pointCount);
  const profile = getProductMarketProfile(input.productId);
  let shaped = blendSmoothPriceSeries(resampled, profile.smoothing * 0.22);
  shaped[shaped.length - 1] = endPrice;

  if (countPriceDirectionChanges(shaped) <= 2) {
    const generated = generateMarketPriceHistory({
      endPrice,
      startPrice: shaped[0],
      productId: input.productId,
      cityId: input.cityId,
      stockStatus: input.stockStatus,
      seed: `${seed}-fallback`,
      pointCount,
    });
    return avoidOverLinearChartShape(generated, endPrice, String(input.productId), `${seed}-fallback`);
  }

  return avoidOverLinearChartShape(shaped, endPrice, String(input.productId), seed);
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
      hasRecentCounterMove: false,
      isChoppy: false,
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

  const hasRecentCounterMove =
    (mediumTerm < -1.2 && shortTerm > 0.6) || (mediumTerm > 1.2 && shortTerm < -0.6);

  const isChoppy =
    directionChanges >= 4 && Math.abs(mediumTerm) <= 2.5 && volatility >= 0.35;

  return {
    shortTerm,
    mediumTerm,
    directionChanges,
    isSlowing,
    isAccelerating,
    volatility,
    hasRecentCounterMove,
    isChoppy,
  };
}

export function resolveMomentumTrendDirection(momentum: PriceMomentum): 'up' | 'down' | 'stable' {
  if (momentum.mediumTerm > 1.5) return 'up';
  if (momentum.mediumTerm < -1.5) return 'down';
  return 'stable';
}

export function getChartMomentumCommentary(
  momentum: PriceMomentum,
  trendDirection: 'up' | 'down' | 'stable',
): string | null {
  if (momentum.hasRecentCounterMove && trendDirection === 'down') {
    return 'Fiyat dipten tepki arıyor olabilir. Yön henüz net değil.';
  }
  if (momentum.hasRecentCounterMove && trendDirection === 'up') {
    return 'Yükseliş sonrası küçük geri çekilme var. Yön aranıyor olabilir.';
  }
  if (trendDirection === 'up' && momentum.isSlowing) {
    return 'Fiyat güçlü seyrediyor ancak yükseliş temposu yavaşlamış olabilir.';
  }
  if (trendDirection === 'down' && momentum.isSlowing) {
    return 'Satış baskısı devam ediyor ama düşüş temposu yavaşlıyor.';
  }
  if (trendDirection === 'down' && momentum.isAccelerating) {
    return 'Satış baskısı güçleniyor. Alım için acele etmek gerekmiyor.';
  }
  if (trendDirection === 'up' && momentum.isAccelerating) {
    return 'Yükseliş ivmeleniyor. Stok varsa satış fırsatı değerlendirilebilir.';
  }
  if (momentum.isChoppy || (trendDirection === 'stable' && momentum.directionChanges >= 3)) {
    return 'Piyasa yön arıyor. Takip etmek mantıklı olabilir.';
  }
  if (trendDirection === 'stable' && momentum.volatility >= 0.5) {
    return 'Piyasa kararsız ama hareketli. Net yön için birkaç periyot daha izlenebilir.';
  }
  return null;
}
