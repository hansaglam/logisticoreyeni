import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';

import { colors } from '../../theme';

export type MiniTrendDirection = 'up' | 'down' | 'stable';
export type MiniTrendChartVariant = 'mini' | 'detail';

export interface MiniTrendChartProps {
  data: number[];
  trend: MiniTrendDirection;
  width?: number;
  height?: number;
  variant?: MiniTrendChartVariant;
  /** Keskin çizgi = piyasa dalgalanması; smooth = yumuşak eğri */
  lineStyle?: 'sharp' | 'smooth';
  strokeWidth?: number;
  showLastPoint?: boolean;
}

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 36;
const MINI_PADDING_X = 2;
const MINI_PADDING_Y = 5;
const DETAIL_PADDING_X = 6;
const DETAIL_PADDING_Y = 14;
const Y_PAD_RATIO = 0.14;
const MINI_VISUAL_AMPLITUDE_BOOST = 2.15;
const MIN_VISUAL_RANGE_RATIO = 0.032;

function resolveTrendColor(trend: MiniTrendDirection): string {
  switch (trend) {
    case 'up':
      return colors.success;
    case 'down':
      return colors.danger;
    default:
      return colors.info;
  }
}

function resolveTrendFill(trend: MiniTrendDirection): string {
  switch (trend) {
    case 'up':
      return colors.successSoft;
    case 'down':
      return colors.dangerSoft;
    default:
      return colors.infoSoft;
  }
}

type ChartPoint = { x: number; y: number };

function buildChartPoints(
  data: number[],
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
  visualAmplitudeBoost = 1,
): ChartPoint[] {
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const mean = data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);

  let paddedMin: number;
  let paddedMax: number;

  const minVisualRange = mean * MIN_VISUAL_RANGE_RATIO * visualAmplitudeBoost;

  if (range > 0.001) {
    paddedMin = min - range * Y_PAD_RATIO * visualAmplitudeBoost;
    paddedMax = max + range * Y_PAD_RATIO * visualAmplitudeBoost;

    if (paddedMax - paddedMin < minVisualRange) {
      const mid = (min + max) / 2;
      paddedMin = mid - minVisualRange / 2;
      paddedMax = mid + minVisualRange / 2;
    }
  } else {
    paddedMin = mean - minVisualRange / 2;
    paddedMax = mean + minVisualRange / 2;
  }

  const paddedRange = Math.max(paddedMax - paddedMin, 0.001);

  return data.map((value, index) => {
    const x =
      data.length <= 1
        ? width / 2
        : paddingX + (index / (data.length - 1)) * innerWidth;

    const normalizedY = (value - paddedMin) / paddedRange;
    const y = paddingY + (1 - normalizedY) * innerHeight;
    return { x, y };
  });
}

function buildLinePath(
  points: ChartPoint[],
  width: number,
  style: 'sharp' | 'smooth',
  curveTension = 0.28,
): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    const p = points[0];
    return `M 0 ${p.y} L ${width} ${p.y}`;
  }

  if (style === 'sharp') {
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length; index += 1) {
      path += ` L ${points[index].x} ${points[index].y}`;
    }
    return path;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const prev = points[index - 1] ?? current;
    const after = points[index + 2] ?? next;

    const tension = curveTension;
    const cp1x = current.x + (next.x - prev.x) * tension;
    const cp1y = current.y + (next.y - prev.y) * tension;
    const cp2x = next.x - (after.x - current.x) * tension;
    const cp2y = next.y - (after.y - current.y) * tension;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
  }

  return path;
}

function buildAreaPath(
  points: ChartPoint[],
  height: number,
  width: number,
  lineStyle: 'sharp' | 'smooth',
  curveTension = 0.28,
): string {
  const linePath = buildLinePath(points, width, lineStyle, curveTension);
  if (!linePath || points.length === 0) {
    return '';
  }

  const last = points[points.length - 1];
  const first = points[0];
  const bottom = height - 0.5;

  return `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
}

function buildGridLines(
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const innerHeight = height - paddingY * 2;
  const rows = 3;
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  for (let index = 1; index < rows; index += 1) {
    const y = paddingY + (innerHeight / rows) * index;
    lines.push({
      x1: paddingX,
      y1: y,
      x2: width - paddingX,
      y2: y,
    });
  }

  return lines;
}

export default function MiniTrendChart({
  data,
  trend,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  variant = 'mini',
  lineStyle = 'smooth',
  strokeWidth,
  showLastPoint = false,
}: MiniTrendChartProps) {
  const isDetail = variant === 'detail';
  const paddingX = isDetail ? DETAIL_PADDING_X : MINI_PADDING_X;
  const paddingY = isDetail ? DETAIL_PADDING_Y : MINI_PADDING_Y;
  const resolvedStrokeWidth = strokeWidth ?? (isDetail ? 2.1 : 1.85);
  const curveTension = isDetail ? 0.28 : 0.2;
  const visualAmplitudeBoost = isDetail ? 1 : MINI_VISUAL_AMPLITUDE_BOOST;

  const strokeColor = resolveTrendColor(trend);
  const fillColor = resolveTrendFill(trend);
  const gradientId = `trend-fill-${trend}-${variant}`;

  const { linePath, areaPath, hasEnoughData, lastPoint, gridLines } = useMemo(() => {
    const cleaned = data.filter((value) => Number.isFinite(value) && value > 0);

    if (cleaned.length === 0) {
      return {
        linePath: '',
        areaPath: '',
        hasEnoughData: false,
        lastPoint: null,
        gridLines: [],
      };
    }

    const points = buildChartPoints(
      cleaned,
      width,
      height,
      paddingX,
      paddingY,
      visualAmplitudeBoost,
    );
    return {
      linePath: buildLinePath(points, width, lineStyle, curveTension),
      areaPath: buildAreaPath(points, height, width, lineStyle, curveTension),
      hasEnoughData: cleaned.length >= 2,
      lastPoint: points[points.length - 1] ?? null,
      gridLines: isDetail ? buildGridLines(width, height, paddingX, paddingY) : [],
    };
  }, [curveTension, data, height, isDetail, lineStyle, paddingX, paddingY, visualAmplitudeBoost, width]);

  if (!hasEnoughData) {
    return (
      <View style={[styles.fallback, { height }, isDetail && styles.fallbackDetail]}>
        <Text style={styles.fallbackText}>Henüz veri yok</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { height },
        isDetail && styles.containerDetail,
      ]}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={strokeColor} stopOpacity={isDetail ? 0.34 : 0.26} />
            <Stop offset="55%" stopColor={strokeColor} stopOpacity={isDetail ? 0.1 : 0.08} />
            <Stop offset="100%" stopColor={fillColor} stopOpacity={0.01} />
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
                strokeOpacity={0.35}
                strokeWidth={0.75}
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
            stroke={strokeColor}
            strokeWidth={resolvedStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {showLastPoint && lastPoint ? (
          <>
            <Circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={resolvedStrokeWidth + 3}
              fill={strokeColor}
              opacity={0.18}
            />
            <Circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={resolvedStrokeWidth + 1.2}
              fill={strokeColor}
              stroke={colors.card}
              strokeWidth={1.75}
            />
          </>
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
    paddingHorizontal: 2,
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
