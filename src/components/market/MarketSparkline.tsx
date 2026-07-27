import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../../theme';
import type { ProductId } from '../../types/game';

export const MARKET_SPARKLINE_WIDTH = 96;
export const MARKET_SPARKLINE_HEIGHT = 36;
export const MARKET_SPARKLINE_MIN_POINTS = 12;
export const MARKET_SPARKLINE_MAX_POINTS = 20;

export type SparklineDirection = 'up' | 'down' | 'stable';

export interface MarketSparklineProps {
  productId: ProductId;
  priceHistory?: number[];
  currentPrice: number;
  changePercent: number;
  width?: number;
  height?: number;
}

const SPARKLINE_PADDING_X = 1;
const SPARKLINE_PADDING_Y = 4;
const DIRECTION_THRESHOLD = 0.5;

const SPARKLINE_COLORS = {
  up: colors.success,
  down: colors.danger,
  stable: '#8B9BB4',
  neutral: '#8B9BB4',
} as const;

export function resolveSparklineDirection(changePercent: number): SparklineDirection {
  if (changePercent > DIRECTION_THRESHOLD) return 'up';
  if (changePercent < -DIRECTION_THRESHOLD) return 'down';
  return 'stable';
}

export function resolveSparklineStrokeColor(direction: SparklineDirection): string {
  switch (direction) {
    case 'up':
      return SPARKLINE_COLORS.up;
    case 'down':
      return SPARKLINE_COLORS.down;
    default:
      return SPARKLINE_COLORS.stable;
  }
}

export function buildSparklineSeries(
  priceHistory: number[] | undefined,
  currentPrice: number,
  maxPoints = MARKET_SPARKLINE_MAX_POINTS,
  minPoints = MARKET_SPARKLINE_MIN_POINTS,
): number[] {
  const cleaned = (priceHistory ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (cleaned.length === 0) {
    return [];
  }

  const series = [...cleaned];
  const last = series[series.length - 1];

  if (Math.abs(last - currentPrice) > 0.001) {
    series.push(currentPrice);
  } else {
    series[series.length - 1] = currentPrice;
  }

  const targetCount = Math.min(maxPoints, Math.max(minPoints, series.length));
  return series.slice(-targetCount);
}

export function buildSparklineLinePath(
  data: number[],
  width: number,
  height: number,
): string {
  const midY = height / 2;

  if (data.length === 0) {
    return `M 0 ${midY} L ${width} ${midY}`;
  }

  if (data.length === 1) {
    return `M 0 ${midY} L ${width} ${midY}`;
  }

  const innerWidth = width - SPARKLINE_PADDING_X * 2;
  const innerHeight = height - SPARKLINE_PADDING_Y * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const mean = data.reduce((sum, value) => sum + value, 0) / data.length;

  let paddedMin = min;
  let paddedMax = max;

  if (range <= mean * 0.001) {
    paddedMin = mean - Math.max(mean * 0.01, 0.01);
    paddedMax = mean + Math.max(mean * 0.01, 0.01);
  } else {
    paddedMin = min - range * 0.1;
    paddedMax = max + range * 0.1;
  }

  const paddedRange = Math.max(paddedMax - paddedMin, 0.001);

  return data
    .map((value, index) => {
      const x =
        SPARKLINE_PADDING_X +
        (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
      const normalizedY = (value - paddedMin) / paddedRange;
      const y = SPARKLINE_PADDING_Y + (1 - normalizedY) * innerHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

function arePriceHistoriesEqual(
  left: number[] | undefined,
  right: number[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function MarketSparklineInner({
  productId,
  priceHistory,
  currentPrice,
  changePercent,
  width = MARKET_SPARKLINE_WIDTH,
  height = MARKET_SPARKLINE_HEIGHT,
}: MarketSparklineProps) {
  const direction = resolveSparklineDirection(changePercent);
  const strokeColor = resolveSparklineStrokeColor(direction);

  const linePath = useMemo(() => {
    const series = buildSparklineSeries(priceHistory, currentPrice);
    return buildSparklineLinePath(series, width, height);
  }, [productId, priceHistory, currentPrice, changePercent, width, height]);

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.85}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function areMarketSparklinePropsEqual(
  prev: MarketSparklineProps,
  next: MarketSparklineProps,
): boolean {
  return (
    prev.productId === next.productId &&
    prev.currentPrice === next.currentPrice &&
    prev.changePercent === next.changePercent &&
    arePriceHistoriesEqual(prev.priceHistory, next.priceHistory) &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

const MarketSparkline = React.memo(MarketSparklineInner, areMarketSparklinePropsEqual);
MarketSparkline.displayName = 'MarketSparkline';

export default MarketSparkline;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    justifyContent: 'center',
  },
});
