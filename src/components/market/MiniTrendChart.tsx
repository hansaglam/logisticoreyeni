import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';

import { colors } from '../../theme';
import {
  buildMarketChartGeometry,
  getMarketChartGradientStops,
  getMarketChartStrokeWidth,
  MARKET_DETAIL_VIEW_WIDTH,
  resolveMarketChartColors,
  type MarketChartTrend,
  type MarketChartVariant,
} from './marketChartVisuals';

export type MiniTrendDirection = MarketChartTrend;
export type MiniTrendChartVariant = MarketChartVariant;

export interface MiniTrendChartProps {
  data: number[];
  trend: MiniTrendDirection;
  width?: number;
  height?: number;
  variant?: MiniTrendChartVariant;
}

const DEFAULT_WIDTH = 200;

export default function MiniTrendChart({
  data,
  trend,
  width = DEFAULT_WIDTH,
  height = 36,
  variant = 'mini',
}: MiniTrendChartProps) {
  const isDetail = variant === 'detail';
  const viewWidth = isDetail ? MARKET_DETAIL_VIEW_WIDTH : width;
  const chartColors = resolveMarketChartColors(trend);
  const gradientStops = getMarketChartGradientStops(variant);
  const strokeWidth = getMarketChartStrokeWidth(variant);
  const gradientId = `trend-fill-${trend}-${variant}`;

  const geometry = useMemo(
    () =>
      buildMarketChartGeometry({
        data,
        width: viewWidth,
        height,
        variant,
      }),
    [data, height, variant, viewWidth],
  );

  if (!geometry.hasEnoughData) {
    return (
      <View style={[styles.fallback, { height }, isDetail && styles.fallbackDetail]}>
        <Text style={styles.fallbackText}>Henüz veri yok</Text>
      </View>
    );
  }

  const { linePath, areaPath, gridLines } = geometry;

  return (
    <View
      style={[
        styles.container,
        { height },
        isDetail && styles.containerDetail,
      ]}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${viewWidth} ${height}`}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={chartColors.stroke} stopOpacity={gradientStops.top} />
            <Stop offset="55%" stopColor={chartColors.stroke} stopOpacity={gradientStops.mid} />
            <Stop offset="100%" stopColor={chartColors.fill} stopOpacity={gradientStops.bottom} />
          </LinearGradient>
        </Defs>

        {isDetail
          ? gridLines.map((line, index) => (
              <Line
                key={`grid-${index}`}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={colors.border}
                strokeOpacity={0.22}
                strokeWidth={0.7}
              />
            ))
          : null}

        {areaPath ? (
          <Path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        ) : null}

        {linePath ? (
          <Path
            d={linePath}
            fill="none"
            stroke={chartColors.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
  },
  containerDetail: {
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fallback: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardSoft,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fallbackDetail: {
    borderRadius: 10,
  },
  fallbackText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
