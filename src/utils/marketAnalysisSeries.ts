/**
 * Piyasa analiz grafiği serisi — priceHistory esas, yapay pattern yok.
 * Ekonomi currentPrice değişmez; son nokta = currentPrice.
 */

import type { ProductId } from '../types/game';
import {
  createSeededRng,
  getMarketStateBias,
  getProductMarketProfile,
} from './productMarketProfile';

export const MARKET_ANALYSIS_POINT_COUNT = 48;
export const MARKET_MINI_FROM_DETAIL_COUNT = 18;

export type AnalysisDataSource = 'history' | 'expanded';

export interface BuildMarketAnalysisInput {
  rawHistory: number[];
  currentPrice: number;
  productId: ProductId | string;
  cityId: string;
  marketStatus?: string;
  currentTime?: number;
}

export interface MomentumSignal {
  shortSlope: number;
  mediumSlope: number;
  volatility: number;
  directionChanges: number;
  hasRecoveryFromLow: boolean;
  hasRecentCounterMove: boolean;
  isSlowingDown: boolean;
  isSlowingUp: boolean;
  direction: 'up' | 'down' | 'stable';
}

export interface MarketAnalysisSnapshot {
  detailPrices: number[];
  miniPrices: number[];
  momentum: MomentumSignal;
  dataSource: AnalysisDataSource;
}

function roundPrice(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

function buildSeed(input: BuildMarketAnalysisInput): string {
  const gameDay = Math.floor((input.currentTime ?? 0) / 24);
  return `${input.cityId}-${input.productId}-${gameDay}-analysis`;
}

export function getChartMaxStepRatio(productId: string): number {
  switch (productId) {
    case 'steel':
    case 'machinery':
      return 0.032;
    case 'fruit':
      return 0.055;
    case 'electronics':
      return 0.062;
    case 'textile':
    case 'furniture':
    case 'beverage':
      return 0.042;
    default:
      return 0.04;
  }
}

export function sanitizePriceHistoryForChart(
  history: number[],
  endPrice: number,
): number[] {
  const cleaned = history
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (cleaned.length === 0) {
    return [roundPrice(endPrice)];
  }

  const working = [...cleaned];
  if (Math.abs(working[working.length - 1] - endPrice) > 0.001) {
    working.push(roundPrice(endPrice));
  } else {
    working[working.length - 1] = roundPrice(endPrice);
  }

  return working;
}

function resampleSeries(prices: number[], pointCount: number): number[] {
  if (prices.length === pointCount) return [...prices];
  if (prices.length === 1) {
    return Array.from({ length: pointCount }, () => prices[0]);
  }

  const result: number[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const position = (index / (pointCount - 1)) * (prices.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(prices.length - 1, lower + 1);
    const fraction = position - lower;
    result.push(
      roundPrice(prices[lower] * (1 - fraction) + prices[upper] * fraction),
    );
  }
  return result;
}

function applyLightVisualSmoothing(prices: number[], strength = 0.1): number[] {
  if (prices.length < 4 || strength <= 0) return [...prices];

  const result = [...prices];
  for (let index = 1; index < prices.length - 1; index += 1) {
    const neighborAvg = (prices[index - 1] + prices[index + 1]) / 2;
    result[index] = roundPrice(prices[index] * (1 - strength) + neighborAvg * strength);
  }

  result[0] = roundPrice(prices[0]);
  result[result.length - 1] = roundPrice(prices[prices.length - 1]);
  return result;
}

export function limitSingleStepMoves(
  prices: number[],
  endPrice: number,
  productId: string,
): number[] {
  if (prices.length < 2) return [roundPrice(endPrice)];

  const maxRatio = getChartMaxStepRatio(String(productId));
  const result = [roundPrice(prices[0])];

  for (let index = 1; index < prices.length; index += 1) {
    const previous = result[index - 1];
    const target = prices[index];
    const delta = target - previous;
    const maxDelta = previous * maxRatio;

    if (Math.abs(delta) > maxDelta) {
      result.push(roundPrice(previous + Math.sign(delta) * maxDelta));
    } else {
      result.push(roundPrice(target));
    }
  }

  result[result.length - 1] = roundPrice(endPrice);
  return result;
}

function spreadFinalApproach(
  prices: number[],
  endPrice: number,
  productId: string,
  seed: string,
): number[] {
  if (prices.length < 4) return [roundPrice(endPrice)];

  const result = [...prices];
  const lastIndex = result.length - 1;
  const approachLen = Math.min(10, lastIndex);
  const anchorIndex = lastIndex - approachLen;
  const profile = getProductMarketProfile(productId);
  const maxRatio = getChartMaxStepRatio(String(productId));
  const rng = createSeededRng(`${seed}-approach`);

  let cursor = result[anchorIndex];
  for (let index = anchorIndex + 1; index <= lastIndex; index += 1) {
    const remaining = lastIndex - index;
    const target =
      index === lastIndex
        ? endPrice
        : endPrice - ((endPrice - cursor) / Math.max(remaining + 1, 1)) * remaining;

    let delta = target - cursor;
    const maxDelta = cursor * maxRatio;
    if (Math.abs(delta) > maxDelta) {
      delta = Math.sign(delta) * maxDelta;
    }

    const micro =
      (rng() - 0.5) * cursor * profile.volatility * (index === lastIndex ? 0.08 : 0.22);
    cursor = roundPrice(cursor + delta + micro);
    result[index] = cursor;
  }

  result[lastIndex] = roundPrice(endPrice);
  return result;
}

export function expandShortHistory(
  known: number[],
  endPrice: number,
  input: BuildMarketAnalysisInput,
): number[] {
  const seed = buildSeed(input);
  const profile = getProductMarketProfile(input.productId);
  const bias = getMarketStateBias(input.marketStatus);
  const rng = createSeededRng(`${seed}-expand`);
  const pointCount = MARKET_ANALYSIS_POINT_COUNT;

  const startPrice = known[0] ?? endPrice;
  let base = resampleSeries(known, pointCount);
  base[0] = roundPrice(startPrice);
  base[base.length - 1] = roundPrice(endPrice);

  const mean = base.reduce((sum, value) => sum + value, 0) / Math.max(base.length, 1);
  const direction =
    endPrice > startPrice * 1.012
      ? 1
      : endPrice < startPrice * 0.988
        ? -1
        : bias.directionBias;

  for (let index = 1; index < base.length - 1; index += 1) {
    const progress = index / (base.length - 1);
    const drift = startPrice + (endPrice - startPrice) * progress;
    const wave =
      Math.sin(progress * Math.PI * profile.waveFrequency) *
      mean *
      profile.volatility *
      0.42;
    const noise = (rng() - 0.5) * mean * profile.volatility * 0.55;

    let counter = 0;
    if (rng() < bias.counterTrendBounceChance * 0.35) {
      counter =
        (direction === -1 ? 1 : direction === 1 ? -1 : rng() > 0.5 ? 1 : -1) *
        mean *
        profile.volatility *
        0.35;
    }

    base[index] = roundPrice(drift * 0.55 + base[index] * 0.45 + wave + noise + counter);
  }

  base[0] = roundPrice(startPrice);
  base[base.length - 1] = roundPrice(endPrice);

  let result = limitSingleStepMoves(base, endPrice, String(input.productId));
  result = spreadFinalApproach(result, endPrice, String(input.productId), seed);
  result = applyLightVisualSmoothing(result, 0.08);
  result[result.length - 1] = roundPrice(endPrice);
  return result;
}

function percentChange(from: number, to: number): number {
  return ((to - from) / Math.max(from, 0.01)) * 100;
}

function segmentSlope(prices: number[], start: number, length: number): number {
  const end = Math.min(prices.length - 1, start + length);
  if (end <= start) return 0;
  return percentChange(prices[start], prices[end]) / (end - start);
}

function countDirectionChanges(prices: number[]): number {
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

export function deriveMomentumSignal(prices: number[]): MomentumSignal {
  const cleaned = prices.filter((value) => Number.isFinite(value) && value > 0);
  if (cleaned.length < 2) {
    return {
      shortSlope: 0,
      mediumSlope: 0,
      volatility: 0,
      directionChanges: 0,
      hasRecoveryFromLow: false,
      hasRecentCounterMove: false,
      isSlowingDown: false,
      isSlowingUp: false,
      direction: 'stable',
    };
  }

  const shortLen = Math.min(6, cleaned.length - 1);
  const mediumLen = Math.min(12, cleaned.length - 1);
  const shortSlope = segmentSlope(cleaned, cleaned.length - 1 - shortLen, shortLen);
  const mediumSlope = segmentSlope(cleaned, cleaned.length - 1 - mediumLen, mediumLen);

  const priorShortStart = Math.max(0, cleaned.length - 1 - shortLen * 2);
  const priorShortSlope = segmentSlope(cleaned, priorShortStart, shortLen);

  let volatility = 0;
  for (let index = 1; index < cleaned.length; index += 1) {
    volatility += Math.abs(percentChange(cleaned[index - 1], cleaned[index]));
  }
  volatility /= Math.max(cleaned.length - 1, 1);

  const minRecent = Math.min(...cleaned.slice(-Math.min(8, cleaned.length)));
  const minOverall = Math.min(...cleaned);
  const hasRecoveryFromLow =
    minRecent > minOverall * 1.008 &&
    cleaned[cleaned.length - 1] > minRecent * 1.004 &&
    mediumSlope < -0.5;

  const hasRecentCounterMove =
    (mediumSlope < -0.8 && shortSlope > 0.35) || (mediumSlope > 0.8 && shortSlope < -0.35);

  const isSlowingDown =
    mediumSlope < -0.4 &&
    Math.abs(shortSlope) < Math.abs(priorShortSlope) * 0.78 &&
    Math.abs(priorShortSlope) > 0.08;

  const isSlowingUp =
    mediumSlope > 0.4 &&
    Math.abs(shortSlope) < Math.abs(priorShortSlope) * 0.78 &&
    Math.abs(priorShortSlope) > 0.08;

  const netChange = percentChange(cleaned[0], cleaned[cleaned.length - 1]);
  let direction: MomentumSignal['direction'] = 'stable';
  if (netChange > 1.2) direction = 'up';
  else if (netChange < -1.2) direction = 'down';

  return {
    shortSlope,
    mediumSlope,
    volatility,
    directionChanges: countDirectionChanges(cleaned),
    hasRecoveryFromLow,
    hasRecentCounterMove,
    isSlowingDown,
    isSlowingUp,
    direction,
  };
}

export function buildMarketAnalysisSeries(
  input: BuildMarketAnalysisInput,
): MarketAnalysisSnapshot {
  const endPrice = Math.max(input.currentPrice, 0.01);
  const seed = buildSeed(input);
  const sanitized = sanitizePriceHistoryForChart(input.rawHistory, endPrice);

  let detailPrices: number[];
  let dataSource: AnalysisDataSource;

  if (sanitized.length >= MARKET_ANALYSIS_POINT_COUNT) {
    detailPrices = resampleSeries(
      sanitized.slice(-MARKET_ANALYSIS_POINT_COUNT * 2),
      MARKET_ANALYSIS_POINT_COUNT,
    );
    dataSource = 'history';
  } else {
    detailPrices = expandShortHistory(sanitized, endPrice, input);
    dataSource = 'expanded';
  }

  detailPrices = limitSingleStepMoves(detailPrices, endPrice, String(input.productId));
  detailPrices = spreadFinalApproach(
    detailPrices,
    endPrice,
    String(input.productId),
    seed,
  );
  detailPrices = applyLightVisualSmoothing(detailPrices, dataSource === 'history' ? 0.1 : 0.08);
  detailPrices[detailPrices.length - 1] = roundPrice(endPrice);
  detailPrices[0] = roundPrice(detailPrices[0]);

  const miniCount = Math.min(MARKET_MINI_FROM_DETAIL_COUNT, detailPrices.length);
  const miniPrices = detailPrices.slice(-miniCount);
  miniPrices[miniPrices.length - 1] = roundPrice(endPrice);

  return {
    detailPrices,
    miniPrices,
    momentum: deriveMomentumSignal(detailPrices),
    dataSource,
  };
}

export function formatChartAxisValue(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 1_000_000_000) {
    return `$${(rounded / 1_000_000_000).toFixed(1)}B`;
  }
  if (rounded >= 1_000_000) {
    return `$${(rounded / 1_000_000).toFixed(1)}M`;
  }
  if (rounded >= 10_000) {
    return `$${Math.round(rounded / 1000)}k`;
  }
  if (rounded >= 1000) {
    const thousands = rounded / 1000;
    return thousands >= 10 ? `$${Math.round(thousands)}k` : `$${thousands.toFixed(1)}k`;
  }
  return `$${rounded.toLocaleString('en-US')}`;
}

export function buildTimeAxisLabels(currentTime?: number): string[] {
  if (currentTime != null && Number.isFinite(currentTime)) {
    const endHour = Math.floor(currentTime);
    const startHour = Math.max(0, endHour - 24);
    const midHour = Math.max(0, endHour - 12);

    const format = (hour: number) => {
      const day = Math.floor(hour / 24) + 1;
      const hourOfDay = hour % 24;
      return `G${day} ${hourOfDay.toString().padStart(2, '0')}:00`;
    };

    return [format(startHour), format(midHour), 'Şimdi'];
  }

  return ['-24h', '-12h', 'Şimdi'];
}

export function buildMovingAverage(prices: number[], window = 6): number[] {
  if (prices.length === 0) return [];
  return prices.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = prices.slice(start, index + 1);
    const avg = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    return roundPrice(avg);
  });
}

export function getMomentumCommentary(
  statusKey: 'YOGUN_TALEP' | 'STOK_AZ' | 'STOK_FAZLA' | 'NORMAL',
  momentum: MomentumSignal,
): string {
  if (statusKey === 'STOK_FAZLA') {
    if (momentum.hasRecoveryFromLow || momentum.hasRecentCounterMove) {
      return 'Fiyat dipten tepki arıyor. Alım için takip edilebilir.';
    }
    if (momentum.isSlowingDown) {
      return 'Satış baskısı sürüyor ancak düşüş temposu yavaşlıyor.';
    }
    if (momentum.direction === 'down') {
      return 'Satış baskısı devam ediyor. Acele alım yerine takip edilebilir.';
    }
    return 'Stok fazlası baskısı sürüyor. Fiyat yönü için takip mantıklı olabilir.';
  }

  if (statusKey === 'YOGUN_TALEP' || statusKey === 'STOK_AZ') {
    if (momentum.isSlowingUp) {
      return 'Fiyat güçlü seyrediyor ancak yükseliş temposu yavaşlıyor.';
    }
    if (momentum.hasRecentCounterMove && momentum.direction === 'up') {
      return 'Talep güçlü. Küçük geri çekilmeler sonrası yükseliş korunuyor.';
    }
    if (momentum.direction === 'up') {
      return 'Talep güçlü. Fiyat kademeli yükselişini koruyor.';
    }
    return 'Talep yüksek ancak fiyat yönü netleşmedi. Takip edilebilir.';
  }

  if (momentum.directionChanges >= 4 && Math.abs(momentum.mediumSlope) <= 1.5) {
    return 'Piyasa yön arıyor. Net hareket için takip edilebilir.';
  }

  if (momentum.hasRecentCounterMove) {
    return 'Fiyat yatay seyrediyor, kısa vadeli tepkiler görülüyor.';
  }

  return 'Piyasa yön arıyor. Net hareket için takip edilebilir.';
}
