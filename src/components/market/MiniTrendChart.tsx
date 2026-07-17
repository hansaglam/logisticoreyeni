import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors } from '../../theme';

export type MiniTrendDirection = 'up' | 'down' | 'stable';

export interface MiniTrendChartProps {
  data: number[];
  trend: MiniTrendDirection;
  width?: number;
  height?: number;
  /** Keskin çizgi = piyasa dalgalanması; smooth = yumuşak eğri */
  lineStyle?: 'sharp' | 'smooth';
  strokeWidth?: number;
  showLastPoint?: boolean;
}

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 36;
const PADDING_X = 2;
const PADDING_Y = 4;

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
): ChartPoint[] {
  const innerWidth = width - PADDING_X * 2;
  const innerHeight = height - PADDING_Y * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  return data.map((value, index) => {
    const x =
      data.length <= 1
        ? width / 2
        : PADDING_X + (index / (data.length - 1)) * innerWidth;

    let normalizedY = 0.5;
    if (range > 0.001) {
      normalizedY = (value - min) / range;
    }

    const y = PADDING_Y + (1 - normalizedY) * innerHeight;
    return { x, y };
  });
}

function buildLinePath(points: ChartPoint[], width: number, style: 'sharp' | 'smooth'): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    const p = points[0];
    return `M ${PADDING_X} ${p.y} L ${width - PADDING_X} ${p.y}`;
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
    const controlX = (current.x + next.x) / 2;
    path += ` C ${controlX} ${current.y}, ${controlX} ${next.y}, ${next.x} ${next.y}`;
  }

  return path;
}

function buildAreaPath(
  points: ChartPoint[],
  height: number,
  width: number,
  lineStyle: 'sharp' | 'smooth',
): string {
  const linePath = buildLinePath(points, width, lineStyle);
  if (!linePath || points.length === 0) {
    return '';
  }

  const last = points[points.length - 1];
  const first = points[0];
  const bottom = height - 1;

  return `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
}

export default function MiniTrendChart({
  data,
  trend,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  lineStyle = 'smooth',
  strokeWidth = 2,
  showLastPoint = false,
}: MiniTrendChartProps) {
  const strokeColor = resolveTrendColor(trend);
  const fillColor = resolveTrendFill(trend);
  const gradientId = `trend-fill-${trend}`;

  const { linePath, areaPath, hasEnoughData, lastPoint } = useMemo(() => {
    const cleaned = data.filter((value) => Number.isFinite(value) && value > 0);

    if (cleaned.length === 0) {
      return { linePath: '', areaPath: '', hasEnoughData: false, lastPoint: null };
    }

    const points = buildChartPoints(cleaned, width, height);
    return {
      linePath: buildLinePath(points, width, lineStyle),
      areaPath: buildAreaPath(points, height, width, lineStyle),
      hasEnoughData: cleaned.length >= 2,
      lastPoint: points[points.length - 1] ?? null,
    };
  }, [data, height, lineStyle, width]);

  if (!hasEnoughData) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Text style={styles.fallbackText}>Henüz veri yok</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={strokeColor} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={fillColor} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        {areaPath ? (
          <Path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        ) : null}
        {linePath ? (
          <Path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {showLastPoint && lastPoint ? (
          <Circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r={strokeWidth + 1.5}
            fill={strokeColor}
            stroke={colors.card}
            strokeWidth={1.5}
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
  fallback: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardSoft,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fallbackText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
