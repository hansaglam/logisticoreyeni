import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { colors, formatMoney, spacing, typography } from '../../theme';
import {
  buildMovingAverage,
  buildTimeAxisLabels,
  formatChartAxisValue,
} from '../../utils/marketAnalysisSeries';
import type { ProductTrendDirection } from '../../utils/productPriceTrend';

const CHART_HEIGHT = 208;
const VIEW_WIDTH = 320;
const MARGIN_LEFT = 54;
const MARGIN_RIGHT = 10;
const MARGIN_TOP = 14;
const MARGIN_BOTTOM = 26;
const Y_TICK_COUNT = 5;
const Y_PAD_RATIO = 0.12;

export interface MarketAnalysisChartProps {
  data: number[];
  trend: ProductTrendDirection;
  currentTime?: number;
  height?: number;
}

type ChartPoint = { x: number; y: number };

function resolveTrendColor(trend: ProductTrendDirection): string {
  switch (trend) {
    case 'up':
      return colors.success;
    case 'down':
      return colors.danger;
    default:
      return colors.info;
  }
}

function resolveTrendFill(trend: ProductTrendDirection): string {
  switch (trend) {
    case 'up':
      return colors.successSoft;
    case 'down':
      return colors.dangerSoft;
    default:
      return colors.infoSoft;
  }
}

function buildYTicks(min: number, max: number, count: number): number[] {
  const range = max - min;
  const paddedMin = min - range * Y_PAD_RATIO;
  const paddedMax = max + range * Y_PAD_RATIO;
  const paddedRange = Math.max(paddedMax - paddedMin, 0.01);

  const ticks: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const ratio = index / Math.max(count - 1, 1);
    ticks.push(paddedMin + (1 - ratio) * paddedRange);
  }
  return ticks;
}

function buildPoints(
  data: number[],
  plotWidth: number,
  plotHeight: number,
  paddedMin: number,
  paddedMax: number,
): ChartPoint[] {
  const paddedRange = Math.max(paddedMax - paddedMin, 0.001);

  return data.map((value, index) => {
    const x =
      data.length <= 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth;
    const normalizedY = (value - paddedMin) / paddedRange;
    const y = (1 - normalizedY) * plotHeight;
    return { x, y };
  });
}

function buildLinePath(points: ChartPoint[]): string {
  if (points.length === 0) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    path += ` L ${points[index].x} ${points[index].y}`;
  }
  return path;
}

function buildAreaPath(points: ChartPoint[], plotHeight: number): string {
  if (points.length === 0) return '';
  const linePath = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${linePath} L ${last.x} ${plotHeight} L ${first.x} ${plotHeight} Z`;
}

export default function MarketAnalysisChart({
  data,
  trend,
  currentTime,
  height = CHART_HEIGHT,
}: MarketAnalysisChartProps) {
  const strokeColor = resolveTrendColor(trend);
  const fillColor = resolveTrendFill(trend);
  const gradientId = `market-analysis-${trend}`;
  const plotWidth = VIEW_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const plotHeight = height - MARGIN_TOP - MARGIN_BOTTOM;

  const chartModel = useMemo(() => {
    const cleaned = data.filter((value) => Number.isFinite(value) && value > 0);
    if (cleaned.length < 2) return null;

    const xLabels = buildTimeAxisLabels(currentTime);

    const min = Math.min(...cleaned);
    const max = Math.max(...cleaned);
    const range = max - min;
    const mean = cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
    const minVisualRange = mean * 0.024;

    let paddedMin = min - range * Y_PAD_RATIO;
    let paddedMax = max + range * Y_PAD_RATIO;
    if (paddedMax - paddedMin < minVisualRange) {
      const mid = (min + max) / 2;
      paddedMin = mid - minVisualRange / 2;
      paddedMax = mid + minVisualRange / 2;
    }

    const paddedRange = Math.max(paddedMax - paddedMin, 0.001);
    const yTicks = buildYTicks(min, max, Y_TICK_COUNT);
    const points = buildPoints(cleaned, plotWidth, plotHeight, paddedMin, paddedMax);
    const maValues = buildMovingAverage(cleaned, 6);
    const maPoints = buildPoints(maValues, plotWidth, plotHeight, paddedMin, paddedMax);

    const horizontalGrid = yTicks.map((tick) => {
      const normalizedY = (tick - paddedMin) / paddedRange;
      return (1 - normalizedY) * plotHeight;
    });

    const verticalGrid = xLabels.map((_, index) => {
      const x =
        xLabels.length <= 1 ? plotWidth / 2 : (index / (xLabels.length - 1)) * plotWidth;
      return x;
    });

    return {
      min,
      max,
      yTicks,
      paddedMin,
      paddedRange,
      horizontalGrid,
      verticalGrid,
      linePath: buildLinePath(points),
      areaPath: buildAreaPath(points, plotHeight),
      maPath: buildLinePath(maPoints),
      lastPoint: points[points.length - 1] ?? null,
      xLabels,
    };
  }, [currentTime, data, plotHeight, plotWidth]);

  if (!chartModel) {
    return (
      <View style={[styles.panel, { height }]}>
        <Text style={styles.fallbackText}>Henüz yeterli fiyat geçmişi yok</Text>
      </View>
    );
  }

  const {
    min,
    max,
    yTicks,
    paddedMin,
    paddedRange,
    horizontalGrid,
    verticalGrid,
    linePath,
    areaPath,
    maPath,
    lastPoint,
    xLabels,
  } = chartModel;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.panel, { height }]}>
        <Svg width="100%" height={height} viewBox={`0 0 ${VIEW_WIDTH} ${height}`}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={strokeColor} stopOpacity={0.28} />
              <Stop offset="55%" stopColor={strokeColor} stopOpacity={0.09} />
              <Stop offset="100%" stopColor={fillColor} stopOpacity={0.01} />
            </LinearGradient>
          </Defs>

          {horizontalGrid.map((y, index) => (
            <Line
              key={`h-${index}`}
              x1={MARGIN_LEFT}
              y1={MARGIN_TOP + y}
              x2={MARGIN_LEFT + plotWidth}
              y2={MARGIN_TOP + y}
              stroke={colors.border}
              strokeOpacity={0.2}
              strokeWidth={0.65}
            />
          ))}

          {verticalGrid.slice(1, -1).map((x) => (
            <Line
              key={`v-${x}`}
              x1={MARGIN_LEFT + x}
              y1={MARGIN_TOP}
              x2={MARGIN_LEFT + x}
              y2={MARGIN_TOP + plotHeight}
              stroke={colors.border}
              strokeOpacity={0.12}
              strokeWidth={0.55}
            />
          ))}

          {yTicks.map((tick) => {
            const gridY = (1 - (tick - paddedMin) / paddedRange) * plotHeight;
            return (
              <SvgText
                key={`y-${Math.round(tick)}`}
                x={MARGIN_LEFT - 8}
                y={MARGIN_TOP + gridY + 3.5}
                fill={colors.textMuted}
                fontSize={9}
                fontWeight="600"
                textAnchor="end"
              >
                {formatChartAxisValue(tick)}
              </SvgText>
            );
          })}

          <Path
            d={areaPath}
            fill={`url(#${gradientId})`}
            stroke="none"
            transform={`translate(${MARGIN_LEFT}, ${MARGIN_TOP})`}
          />

          {maPath ? (
            <Path
              d={maPath}
              fill="none"
              stroke={strokeColor}
              strokeOpacity={0.14}
              strokeWidth={1}
              strokeDasharray="3 4"
              transform={`translate(${MARGIN_LEFT}, ${MARGIN_TOP})`}
            />
          ) : null}

          <Path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={2.05}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={`translate(${MARGIN_LEFT}, ${MARGIN_TOP})`}
          />

          {lastPoint ? (
            <>
              <Circle
                cx={MARGIN_LEFT + lastPoint.x}
                cy={MARGIN_TOP + lastPoint.y}
                r={5.5}
                fill={strokeColor}
                opacity={0.14}
              />
              <Circle
                cx={MARGIN_LEFT + lastPoint.x}
                cy={MARGIN_TOP + lastPoint.y}
                r={3.6}
                fill={strokeColor}
                stroke={colors.card}
                strokeWidth={1.75}
              />
            </>
          ) : null}

          {xLabels.map((label, index) => {
            const x =
              xLabels.length <= 1
                ? plotWidth / 2
                : (index / (xLabels.length - 1)) * plotWidth;
            return (
              <SvgText
                key={label}
                x={MARGIN_LEFT + x}
                y={height - 8}
                fill={colors.textMuted}
                fontSize={9}
                fontWeight="600"
                textAnchor="middle"
              >
                {label}
              </SvgText>
            );
          })}
        </Svg>
      </View>

      <View style={styles.rangeRow}>
        <Text style={styles.rangeText} numberOfLines={1}>
          En düşük: {formatMoney(min)}
        </Text>
        <Text style={styles.rangeText} numberOfLines={1}>
          En yüksek: {formatMoney(max)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  panel: {
    width: '100%',
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fallbackText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rangeText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
});
