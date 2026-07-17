/**
 * Piyasa grafik snapshot — marketAnalysisSeries üzerinden trend bilgisi.
 */

import { colors } from '../theme';
import type { ProductId } from '../types/game';
import {
  buildMarketAnalysisSeries,
  deriveMomentumSignal,
  getMomentumCommentary,
  MARKET_ANALYSIS_POINT_COUNT,
  MARKET_MINI_FROM_DETAIL_COUNT,
  type MomentumSignal,
} from './marketAnalysisSeries';
import type { ProductTrendDirection } from './productPriceTrend';

export type MarketChartPattern =
  | 'DOWN_WITH_BOUNCE'
  | 'DOWN_EXHAUSTION'
  | 'UP_WITH_PULLBACK'
  | 'UP_COOLING'
  | 'SIDEWAYS_ACCUMULATION'
  | 'BREAKOUT_THEN_RETEST'
  | 'RECOVERY_FROM_LOW';

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
  momentum: MomentumSignal;
  dataSource: 'history' | 'enriched';
}

export interface BuildMarketChartSnapshotInput {
  rawHistory: number[];
  currentPrice: number;
  productId: ProductId | string;
  cityId: string;
  marketStatus?: string;
  currentTime?: number;
}

export interface MarketChartSnapshot {
  detailPrices: number[];
  miniPrices: number[];
  chartTrendInfo: ChartTrendInfo;
}

export function normalizeMarketStatusKey(status?: string): MarketStatusKey {
  if (!status) return 'NORMAL';
  if (status.includes('Kritik') || status.includes('Yoğun')) return 'YOGUN_TALEP';
  if (status.includes('Kıtlık') || status.includes('Az')) return 'STOK_AZ';
  if (status.includes('Fazla')) return 'STOK_FAZLA';
  return 'NORMAL';
}

function resolveDirectionFromSeries(prices: number[]): ProductTrendDirection {
  if (prices.length < 2) return 'stable';
  const first = prices[0];
  const last = prices[prices.length - 1];
  const change = ((last - first) / Math.max(first, 0.01)) * 100;
  if (change > 1.2) return 'up';
  if (change < -1.2) return 'down';
  return 'stable';
}

function resolveTrendColor(
  direction: ProductTrendDirection,
  statusKey: MarketStatusKey,
): string {
  if (statusKey === 'STOK_FAZLA' && direction !== 'up') return colors.danger;
  if ((statusKey === 'YOGUN_TALEP' || statusKey === 'STOK_AZ') && direction !== 'down') {
    return direction === 'up' ? colors.success : colors.info;
  }

  switch (direction) {
    case 'up':
      return colors.success;
    case 'down':
      return colors.danger;
    default:
      return colors.info;
  }
}

function resolveTrendLabel(
  direction: ProductTrendDirection,
  statusKey: MarketStatusKey,
  momentum: MomentumSignal,
): string {
  if (momentum.hasRecoveryFromLow && statusKey === 'STOK_FAZLA') return 'Takipte';
  if (direction === 'up' && statusKey === 'YOGUN_TALEP') return 'Yükselişte';
  if (direction === 'up' && statusKey === 'STOK_AZ') return 'Talep Güçlü';
  if (direction === 'down' && statusKey === 'STOK_FAZLA') return 'Baskı Altında';
  if (statusKey === 'YOGUN_TALEP' && direction === 'up') return 'Güçlü';
  switch (direction) {
    case 'up':
      return 'Yükselişte';
    case 'down':
      return 'Düşüşte';
    default:
      return 'Dengeli';
  }
}

function inferPatternFromMomentum(
  direction: ProductTrendDirection,
  momentum: MomentumSignal,
): { pattern: MarketChartPattern; momentumType: ChartMomentumType } {
  if (direction === 'down') {
    if (momentum.hasRecoveryFromLow) {
      return { pattern: 'RECOVERY_FROM_LOW', momentumType: 'recovery' };
    }
    if (momentum.isSlowingDown) {
      return { pattern: 'DOWN_EXHAUSTION', momentumType: 'exhaustion' };
    }
    if (momentum.hasRecentCounterMove) {
      return { pattern: 'DOWN_WITH_BOUNCE', momentumType: 'bounce' };
    }
    return { pattern: 'DOWN_WITH_BOUNCE', momentumType: 'bounce' };
  }

  if (direction === 'up') {
    if (momentum.isSlowingUp) {
      return { pattern: 'UP_COOLING', momentumType: 'cooling' };
    }
    if (momentum.hasRecentCounterMove) {
      return { pattern: 'UP_WITH_PULLBACK', momentumType: 'pullback' };
    }
    if (momentum.volatility > 0.55) {
      return { pattern: 'BREAKOUT_THEN_RETEST', momentumType: 'breakout' };
    }
    return { pattern: 'UP_WITH_PULLBACK', momentumType: 'pullback' };
  }

  return { pattern: 'SIDEWAYS_ACCUMULATION', momentumType: 'accumulation' };
}

function alignTrendWithStatus(input: {
  direction: ProductTrendDirection;
  percentChange: number;
  statusKey: MarketStatusKey;
}): ProductTrendDirection {
  let { direction, percentChange, statusKey } = input;

  if (Math.abs(percentChange) <= 0) {
    direction = 'stable';
  }

  if (statusKey === 'YOGUN_TALEP' || statusKey === 'STOK_AZ') {
    if (percentChange > 0.5) direction = 'up';
    else if (percentChange < -1.5) direction = 'down';
    else if (percentChange > 0 && direction === 'stable') direction = 'up';
  }

  if (statusKey === 'STOK_FAZLA') {
    if (percentChange < -0.5) direction = 'down';
    else if (percentChange > 1.5) direction = 'up';
    else if (percentChange < 0 && direction === 'stable') direction = 'down';
  }

  return direction;
}

function buildChartTrendInfo(input: {
  prices: number[];
  marketStatus?: string;
  dataSource: 'history' | 'enriched';
  momentum: MomentumSignal;
}): ChartTrendInfo {
  const statusKey = normalizeMarketStatusKey(input.marketStatus);
  const first = input.prices[0] ?? input.prices[input.prices.length - 1];
  const last = input.prices[input.prices.length - 1] ?? first;
  let displayPercentChange = Math.round(
    ((last - first) / Math.max(first, 0.01)) * 100,
  );

  if (Math.abs(displayPercentChange) <= 0) {
    displayPercentChange = 0;
  }

  let direction = alignTrendWithStatus({
    direction: resolveDirectionFromSeries(input.prices),
    percentChange: displayPercentChange,
    statusKey,
  });

  const { pattern, momentumType } = inferPatternFromMomentum(direction, input.momentum);

  return {
    displayPercentChange,
    displayTrendDirection: direction,
    displayTrendLabel: resolveTrendLabel(direction, statusKey, input.momentum),
    displayTrendColor: resolveTrendColor(direction, statusKey),
    selectedPattern: pattern,
    momentumType,
    statusKey,
    momentum: input.momentum,
    dataSource: input.dataSource,
  };
}

export function buildMarketChartSnapshot(
  input: BuildMarketChartSnapshotInput,
): MarketChartSnapshot {
  const endPrice = Math.max(input.currentPrice, 0.01);
  const analysis = buildMarketAnalysisSeries(input);

  const detailPrices = [...analysis.detailPrices];
  const miniPrices = [...analysis.miniPrices];
  detailPrices[detailPrices.length - 1] = endPrice;
  miniPrices[miniPrices.length - 1] = endPrice;

  const chartTrendInfo = buildChartTrendInfo({
    prices: detailPrices,
    marketStatus: input.marketStatus,
    dataSource: analysis.dataSource === 'history' ? 'history' : 'enriched',
    momentum: analysis.momentum,
  });

  return {
    detailPrices,
    miniPrices,
    chartTrendInfo,
  };
}

/** @deprecated use buildMarketChartSnapshot */
export function buildMarketChartSeries(input: BuildMarketChartSnapshotInput & { mode?: string }) {
  const snapshot = buildMarketChartSnapshot(input);
  return {
    prices: input.mode === 'mini' ? snapshot.miniPrices : snapshot.detailPrices,
    pattern: snapshot.chartTrendInfo.selectedPattern,
    usedPatternGeneration: snapshot.chartTrendInfo.dataSource === 'enriched',
    chartTrendInfo: snapshot.chartTrendInfo,
  };
}

export function getChartTrendCommentary(info: ChartTrendInfo): string {
  return getMomentumCommentary(info.statusKey, info.momentum);
}

export function getMarketChartPatternCommentary(
  _pattern: MarketChartPattern,
  statusKey?: MarketStatusKey,
): string {
  return getMomentumCommentary(statusKey ?? 'NORMAL', {
    shortSlope: 0,
    mediumSlope: 0,
    volatility: 0,
    directionChanges: 0,
    hasRecoveryFromLow: false,
    hasRecentCounterMove: false,
    isSlowingDown: false,
    isSlowingUp: false,
    direction: 'stable',
  });
}

export function buildChartRelativeTimeLabels(): string[] {
  return ['-24h', '-12h', 'Şimdi'];
}

export { MARKET_ANALYSIS_POINT_COUNT, MARKET_MINI_FROM_DETAIL_COUNT };
