/**
 * Piyasa grafik görünüm serisi — kontrollü pattern sistemi.
 * Yalnızca chart render datası; ekonomi currentPrice değişmez, son nokta = currentPrice.
 */

import { colors } from '../theme';
import type { ProductId } from '../types/game';
import { createSeededRng, getProductMarketProfile } from './productMarketProfile';
import type { ProductTrendDirection } from './productPriceTrend';
import {
  countPriceDirectionChanges,
  MARKET_PRICE_HISTORY_DISPLAY_POINTS,
  MARKET_PRICE_HISTORY_MINI_POINTS,
} from './marketPriceHistoryGenerator';

export type MarketChartPattern =
  | 'DOWN_WITH_BOUNCE'
  | 'DOWN_EXHAUSTION'
  | 'UP_WITH_PULLBACK'
  | 'UP_COOLING'
  | 'SIDEWAYS_ACCUMULATION'
  | 'BREAKOUT_THEN_RETEST'
  | 'RECOVERY_FROM_LOW';

export type MarketChartSeriesMode = 'mini' | 'detail';
export type MarketStatusKey = 'YOGUN_TALEP' | 'STOK_AZ' | 'STOK_FAZLA' | 'NORMAL';
export type ChartMomentumType =
  | 'pullback'
  | 'cooling'
  | 'bounce'
  | 'exhaustion'
  | 'accumulation'
  | 'breakout'
  | 'recovery';

export interface ChartTrendInfo {
  displayPercentChange: number;
  displayTrendDirection: ProductTrendDirection;
  displayTrendLabel: string;
  displayTrendColor: string;
  selectedPattern: MarketChartPattern;
  momentumType: ChartMomentumType;
  statusKey: MarketStatusKey;
}

export interface BuildMarketChartSeriesInput {
  rawHistory: number[];
  currentPrice: number;
  productId: ProductId | string;
  cityId: string;
  marketStatus?: string;
  currentTime?: number;
  mode?: MarketChartSeriesMode;
}

export interface MarketChartSeriesResult {
  prices: number[];
  pattern: MarketChartPattern;
  usedPatternGeneration: boolean;
  chartTrendInfo: ChartTrendInfo;
}

type AnchorOffset = { progress: number; offset: number };

interface PatternBlueprint {
  anchors: AnchorOffset[];
}

interface StatusPercentBounds {
  min: number;
  max: number;
  direction: ProductTrendDirection;
}

function roundPrice(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

export function normalizeMarketStatusKey(status?: string): MarketStatusKey {
  if (!status) return 'NORMAL';
  if (status.includes('Kritik') || status.includes('Yoğun')) return 'YOGUN_TALEP';
  if (status.includes('Kıtlık') || status.includes('Az')) return 'STOK_AZ';
  if (status.includes('Fazla')) return 'STOK_FAZLA';
  return 'NORMAL';
}

function buildChartSeed(input: BuildMarketChartSeriesInput): string {
  const gameDay = Math.floor((input.currentTime ?? 0) / 24);
  const statusKey = normalizeMarketStatusKey(input.marketStatus);
  return `${input.cityId}-${input.productId}-${gameDay}-${statusKey}-chart`;
}

function getProductOffsetMultiplier(productId: string): number {
  switch (productId) {
    case 'fruit':
      return 1.28;
    case 'steel':
      return 0.78;
    case 'electronics':
      return 1.12;
    default:
      return 0.95;
  }
}

function getStatusPercentBounds(statusKey: MarketStatusKey, productId: string): StatusPercentBounds {
  switch (statusKey) {
    case 'YOGUN_TALEP':
      if (productId === 'steel') return { min: 6, max: 18, direction: 'up' };
      if (productId === 'electronics') return { min: 8, max: 30, direction: 'up' };
      return { min: 6, max: 28, direction: 'up' };
    case 'STOK_AZ':
      return { min: 3, max: 22, direction: 'up' };
    case 'STOK_FAZLA':
      return { min: -30, max: -3, direction: 'down' };
    default:
      return { min: -6, max: 6, direction: 'stable' };
  }
}

function resolveMomentumType(pattern: MarketChartPattern): ChartMomentumType {
  switch (pattern) {
    case 'UP_WITH_PULLBACK':
      return 'pullback';
    case 'UP_COOLING':
      return 'cooling';
    case 'DOWN_WITH_BOUNCE':
      return 'bounce';
    case 'DOWN_EXHAUSTION':
      return 'exhaustion';
    case 'BREAKOUT_THEN_RETEST':
      return 'breakout';
    case 'RECOVERY_FROM_LOW':
      return 'recovery';
    default:
      return 'accumulation';
  }
}

function resolveTrendLabel(
  direction: ProductTrendDirection,
  statusKey: MarketStatusKey,
  pattern: MarketChartPattern,
): string {
  if (pattern === 'RECOVERY_FROM_LOW' && statusKey === 'STOK_FAZLA') {
    return 'Takipte';
  }
  if (statusKey === 'YOGUN_TALEP' && direction === 'up') {
    return 'Yükselişte';
  }
  if (statusKey === 'STOK_AZ' && direction === 'up') {
    return 'Talep Güçlü';
  }
  if (statusKey === 'STOK_FAZLA' && direction === 'down') {
    return 'Baskı Altında';
  }
  switch (direction) {
    case 'up':
      return 'Yükselişte';
    case 'down':
      return 'Düşüşte';
    default:
      return 'Dengeli';
  }
}

function resolveTrendColor(direction: ProductTrendDirection): string {
  switch (direction) {
    case 'up':
      return colors.success;
    case 'down':
      return colors.danger;
    default:
      return colors.info;
  }
}

function pickTargetDisplayPercent(
  statusKey: MarketStatusKey,
  productId: string,
  pattern: MarketChartPattern,
  seed: string,
): number {
  const bounds = getStatusPercentBounds(statusKey, productId);
  const rng = createSeededRng(`${seed}-target-pct`);

  if (pattern === 'RECOVERY_FROM_LOW' && statusKey === 'STOK_FAZLA') {
    return -Math.round(3 + rng() * 5);
  }

  if (bounds.direction === 'up') {
    return Math.round(bounds.min + rng() * (bounds.max - bounds.min));
  }

  if (bounds.direction === 'down') {
    const magnitude = Math.abs(bounds.max) + rng() * (Math.abs(bounds.min) - Math.abs(bounds.max));
    return -Math.round(magnitude);
  }

  return Math.round(bounds.min + rng() * (bounds.max - bounds.min));
}

function resolveDisplayTrendDirection(
  targetPercent: number,
  statusKey: MarketStatusKey,
): ProductTrendDirection {
  if (statusKey === 'YOGUN_TALEP' || statusKey === 'STOK_AZ') {
    return 'up';
  }
  if (statusKey === 'STOK_FAZLA') {
    return 'down';
  }

  if (targetPercent > 1.5) return 'up';
  if (targetPercent < -1.5) return 'down';
  return 'stable';
}

function buildChartTrendInfo(input: {
  pattern: MarketChartPattern;
  targetPercent: number;
  marketStatus?: string;
  productId: string;
}): ChartTrendInfo {
  const statusKey = normalizeMarketStatusKey(input.marketStatus);
  let direction = resolveDisplayTrendDirection(input.targetPercent, statusKey);

  if (statusKey === 'YOGUN_TALEP' || statusKey === 'STOK_AZ') {
    direction = 'up';
  } else if (statusKey === 'STOK_FAZLA' && input.pattern !== 'RECOVERY_FROM_LOW') {
    direction = 'down';
  }

  let displayPercent = input.targetPercent;
  if (statusKey === 'YOGUN_TALEP' && displayPercent < 6) {
    displayPercent = 6;
  }
  if (statusKey === 'STOK_AZ' && displayPercent < 3) {
    displayPercent = 3;
  }
  if (statusKey === 'STOK_FAZLA' && input.pattern !== 'RECOVERY_FROM_LOW' && displayPercent > -3) {
    displayPercent = -3;
  }

  return {
    displayPercentChange: displayPercent,
    displayTrendDirection: direction,
    displayTrendLabel: resolveTrendLabel(direction, statusKey, input.pattern),
    displayTrendColor: resolveTrendColor(direction),
    selectedPattern: input.pattern,
    momentumType: resolveMomentumType(input.pattern),
    statusKey,
  };
}

function startPriceFromTargetPercent(currentPrice: number, targetPercent: number): number {
  if (Math.abs(targetPercent) < 0.01) {
    return roundPrice(currentPrice);
  }
  return roundPrice(currentPrice / (1 + targetPercent / 100));
}

const PATTERN_BLUEPRINTS: Record<MarketChartPattern, PatternBlueprint> = {
  DOWN_WITH_BOUNCE: {
    anchors: [
      { progress: 0, offset: 0 },
      { progress: 0.18, offset: -0.14 },
      { progress: 0.32, offset: 0.1 },
      { progress: 0.55, offset: -0.32 },
      { progress: 0.78, offset: -0.42 },
      { progress: 0.92, offset: -0.38 },
      { progress: 1, offset: 0 },
    ],
  },
  DOWN_EXHAUSTION: {
    anchors: [
      { progress: 0, offset: 0 },
      { progress: 0.2, offset: -0.28 },
      { progress: 0.42, offset: -0.38 },
      { progress: 0.58, offset: -0.36 },
      { progress: 0.78, offset: -0.4 },
      { progress: 0.92, offset: -0.28 },
      { progress: 1, offset: 0 },
    ],
  },
  UP_WITH_PULLBACK: {
    anchors: [
      { progress: 0, offset: 0 },
      { progress: 0.22, offset: 0.16 },
      { progress: 0.36, offset: 0.06 },
      { progress: 0.58, offset: 0.24 },
      { progress: 0.8, offset: 0.08 },
      { progress: 0.94, offset: 0.03 },
      { progress: 1, offset: 0 },
    ],
  },
  UP_COOLING: {
    anchors: [
      { progress: 0, offset: 0 },
      { progress: 0.2, offset: 0.22 },
      { progress: 0.42, offset: 0.34 },
      { progress: 0.58, offset: 0.1 },
      { progress: 0.78, offset: 0.06 },
      { progress: 0.92, offset: 0.02 },
      { progress: 1, offset: 0 },
    ],
  },
  SIDEWAYS_ACCUMULATION: {
    anchors: [
      { progress: 0, offset: 0 },
      { progress: 0.15, offset: 0.08 },
      { progress: 0.32, offset: -0.1 },
      { progress: 0.5, offset: 0.06 },
      { progress: 0.68, offset: -0.08 },
      { progress: 0.85, offset: 0.05 },
      { progress: 1, offset: 0 },
    ],
  },
  BREAKOUT_THEN_RETEST: {
    anchors: [
      { progress: 0, offset: 0 },
      { progress: 0.18, offset: 0.04 },
      { progress: 0.34, offset: -0.02 },
      { progress: 0.52, offset: 0.26 },
      { progress: 0.68, offset: 0.08 },
      { progress: 0.86, offset: 0.14 },
      { progress: 1, offset: 0 },
    ],
  },
  RECOVERY_FROM_LOW: {
    anchors: [
      { progress: 0, offset: 0 },
      { progress: 0.2, offset: -0.22 },
      { progress: 0.42, offset: -0.3 },
      { progress: 0.58, offset: -0.22 },
      { progress: 0.74, offset: -0.18 },
      { progress: 0.88, offset: -0.24 },
      { progress: 1, offset: 0 },
    ],
  },
};

const PATTERN_POOLS: Record<MarketStatusKey, MarketChartPattern[]> = {
  STOK_FAZLA: ['DOWN_WITH_BOUNCE', 'DOWN_EXHAUSTION', 'RECOVERY_FROM_LOW'],
  YOGUN_TALEP: ['UP_WITH_PULLBACK', 'UP_COOLING', 'BREAKOUT_THEN_RETEST'],
  STOK_AZ: ['UP_WITH_PULLBACK', 'UP_COOLING'],
  NORMAL: ['SIDEWAYS_ACCUMULATION'],
};

export function pickMarketChartPattern(input: {
  marketStatus?: string;
  productId: string;
  seed: string;
}): MarketChartPattern {
  const statusKey = normalizeMarketStatusKey(input.marketStatus);
  const pool = PATTERN_POOLS[statusKey] ?? PATTERN_POOLS.NORMAL;
  const rng = createSeededRng(`${input.seed}-pattern`);

  if (statusKey === 'STOK_FAZLA') {
    const roll = rng();
    if (roll < 0.14) return 'RECOVERY_FROM_LOW';
    if (roll < 0.57) return 'DOWN_WITH_BOUNCE';
    return 'DOWN_EXHAUSTION';
  }

  if (statusKey === 'YOGUN_TALEP' && input.productId === 'electronics') {
    const roll = rng();
    if (roll < 0.38) return 'BREAKOUT_THEN_RETEST';
    if (roll < 0.68) return 'UP_WITH_PULLBACK';
    return 'UP_COOLING';
  }

  if (statusKey === 'YOGUN_TALEP' && input.productId === 'steel') {
    const roll = rng();
    return roll < 0.55 ? 'UP_WITH_PULLBACK' : 'UP_COOLING';
  }

  return pool[Math.floor(rng() * pool.length)] ?? 'SIDEWAYS_ACCUMULATION';
}

function interpolateAnchorOffset(progress: number, anchors: AnchorOffset[]): number {
  if (anchors.length === 0) return 0;
  if (progress <= anchors[0].progress) return anchors[0].offset;
  if (progress >= anchors[anchors.length - 1].progress) return anchors[anchors.length - 1].offset;

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const left = anchors[index];
    const right = anchors[index + 1];
    if (progress >= left.progress && progress <= right.progress) {
      const span = right.progress - left.progress;
      const local = span > 0 ? (progress - left.progress) / span : 0;
      const smooth = local * local * (3 - 2 * local);
      return left.offset + (right.offset - left.offset) * smooth;
    }
  }

  return 0;
}

function applyPatternVariation(
  anchors: AnchorOffset[],
  productId: string,
  seed: string,
): AnchorOffset[] {
  const rng = createSeededRng(`${seed}-variation`);
  const mul = getProductOffsetMultiplier(productId);

  return anchors.map((anchor) => {
    if (anchor.progress === 0 || anchor.progress === 1) {
      return anchor;
    }
    const jitter = (rng() - 0.5) * 0.08 * mul;
    return {
      progress: anchor.progress,
      offset: anchor.offset * (0.92 + rng() * 0.16) + jitter,
    };
  });
}

function generatePatternSeries(input: {
  pattern: MarketChartPattern;
  startPrice: number;
  endPrice: number;
  pointCount: number;
  productId: string;
  seed: string;
}): number[] {
  const { pattern, startPrice, endPrice, pointCount, productId, seed } = input;
  const blueprint = PATTERN_BLUEPRINTS[pattern];
  const anchors = applyPatternVariation(blueprint.anchors, productId, seed);
  const profile = getProductMarketProfile(productId);
  const offsetMul = getProductOffsetMultiplier(productId);
  const rng = createSeededRng(`${seed}-${pattern}-gen`);

  const swing = Math.abs(endPrice - startPrice);
  const safeSwing = Math.max(swing, endPrice * profile.volatility * 4);
  const prices: number[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const progress = pointCount <= 1 ? 1 : index / (pointCount - 1);
    const linear = startPrice + (endPrice - startPrice) * progress;
    const anchorOffset = interpolateAnchorOffset(progress, anchors);

    const ripple =
      Math.sin(progress * Math.PI * profile.waveFrequency * (pointCount >= 20 ? 1 : 0.85)) *
      0.05 *
      offsetMul *
      (rng() * 0.3 + 0.7);

    const deviation = (anchorOffset * offsetMul + ripple) * safeSwing;
    prices.push(roundPrice(linear + deviation));
  }

  prices[0] = roundPrice(startPrice);
  prices[prices.length - 1] = roundPrice(endPrice);
  return prices;
}

function computeStepVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  let sum = 0;
  for (let index = 1; index < prices.length; index += 1) {
    sum += Math.abs(prices[index] - prices[index - 1]) / Math.max(prices[index - 1], 0.01);
  }
  return sum / (prices.length - 1);
}

export function isTooLinear(prices: number[]): boolean {
  if (prices.length < 6) return true;
  const changes = countPriceDirectionChanges(prices);
  if (changes <= 2) return true;

  const { up, down, total } = countSameDirection(prices);
  if (total === 0) return true;
  return Math.max(up, down) / total >= 0.78;
}

export function isTooFlat(prices: number[]): boolean {
  if (prices.length < 2) return true;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const mean = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  const rangeRatio = (max - min) / Math.max(mean, 0.01);
  return rangeRatio < 0.012;
}

export function isTooSpiky(prices: number[]): boolean {
  if (prices.length < 4) return false;
  const vol = computeStepVolatility(prices);
  if (vol > 0.09) return true;

  for (let index = 2; index < prices.length - 2; index += 1) {
    const prev = prices[index - 1];
    const curr = prices[index];
    const next = prices[index + 1];
    const spikeUp = curr - prev > 0 && curr - next > 0;
    const spikeDown = curr - prev < 0 && curr - next < 0;
    const magnitude = Math.abs(curr - prev) / Math.max(prev, 0.01);
    if ((spikeUp || spikeDown) && magnitude > 0.045) {
      return true;
    }
  }

  return false;
}

function countSameDirection(prices: number[]): { up: number; down: number; total: number } {
  let up = 0;
  let down = 0;
  for (let index = 1; index < prices.length; index += 1) {
    const delta = prices[index] - prices[index - 1];
    if (delta > 0.001) up += 1;
    else if (delta < -0.001) down += 1;
  }
  return { up, down, total: prices.length - 1 };
}

function buildPatternChart(input: BuildMarketChartSeriesInput, pointCount: number): MarketChartSeriesResult {
  const endPrice = Math.max(input.currentPrice, 0.01);
  const seed = buildChartSeed(input);
  const statusKey = normalizeMarketStatusKey(input.marketStatus);
  const productId = String(input.productId);

  const pattern = pickMarketChartPattern({
    marketStatus: input.marketStatus,
    productId,
    seed,
  });

  const targetPercent = pickTargetDisplayPercent(statusKey, productId, pattern, seed);
  const startPrice = startPriceFromTargetPercent(endPrice, targetPercent);

  let prices = generatePatternSeries({
    pattern,
    startPrice,
    endPrice,
    pointCount,
    productId,
    seed,
  });

  let resolvedPattern = pattern;

  if (isTooLinear(prices) || isTooFlat(prices) || isTooSpiky(prices)) {
    resolvedPattern =
      statusKey === 'STOK_FAZLA'
        ? 'DOWN_WITH_BOUNCE'
        : statusKey === 'YOGUN_TALEP' || statusKey === 'STOK_AZ'
          ? 'UP_WITH_PULLBACK'
          : 'SIDEWAYS_ACCUMULATION';

    prices = generatePatternSeries({
      pattern: resolvedPattern,
      startPrice,
      endPrice,
      pointCount,
      productId,
      seed: `${seed}-fallback`,
    });
  }

  prices[0] = roundPrice(startPrice);
  prices[prices.length - 1] = endPrice;

  const chartTrendInfo = buildChartTrendInfo({
    pattern: resolvedPattern,
    targetPercent,
    marketStatus: input.marketStatus,
    productId,
  });

  return {
    prices,
    pattern: resolvedPattern,
    usedPatternGeneration: true,
    chartTrendInfo,
  };
}

export function buildMarketChartSeries(input: BuildMarketChartSeriesInput): MarketChartSeriesResult {
  const pointCount =
    input.mode === 'mini' ? MARKET_PRICE_HISTORY_MINI_POINTS : MARKET_PRICE_HISTORY_DISPLAY_POINTS;

  return buildPatternChart(input, pointCount);
}

export function getMarketChartPatternCommentary(
  pattern: MarketChartPattern,
  statusKey?: MarketStatusKey,
): string {
  if (pattern === 'RECOVERY_FROM_LOW' && statusKey === 'STOK_FAZLA') {
    return 'Satış baskısı sürüyor; dipten toparlanma sinyali takip edilebilir.';
  }

  switch (pattern) {
    case 'DOWN_WITH_BOUNCE':
      return 'Satış baskısı sürüyor ancak kısa tepki hareketleri görülüyor.';
    case 'DOWN_EXHAUSTION':
      return 'Düşüş temposu yavaşlıyor. Alım için takip edilebilir.';
    case 'UP_WITH_PULLBACK':
      return 'Talep güçlü. Küçük geri çekilmeler sonrası yükseliş korunuyor.';
    case 'UP_COOLING':
      return 'Fiyat güçlü seyrediyor ancak yükseliş temposu yavaşlıyor.';
    case 'BREAKOUT_THEN_RETEST':
      return 'Fiyat yukarı kırılım sonrası yönünü korumaya çalışıyor.';
    case 'SIDEWAYS_ACCUMULATION':
      return 'Piyasa yön arıyor. Net hareket için takip edilebilir.';
    case 'RECOVERY_FROM_LOW':
      return 'Fiyat dipten toparlanma sinyali veriyor olabilir.';
    default:
      return 'Piyasa yön arıyor. Net hareket için takip edilebilir.';
  }
}

export function getChartTrendCommentary(info: ChartTrendInfo): string {
  return getMarketChartPatternCommentary(info.selectedPattern, info.statusKey);
}
