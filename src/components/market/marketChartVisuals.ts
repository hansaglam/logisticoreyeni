import { colors } from '../../theme';

export type MarketChartTrend = 'up' | 'down' | 'stable';
export type MarketChartVariant = 'mini' | 'detail';

export const MARKET_DETAIL_CHART_HEIGHT = 152;
export const MARKET_MINI_CHART_HEIGHT = 40;
export const MARKET_DETAIL_VIEW_WIDTH = 320;

const Y_PAD_RATIO = 0.14;
const MIN_VISUAL_RANGE_RATIO = 0.032;
const MINI_VISUAL_AMPLITUDE_BOOST = 2.1;

const PADDING = {
  mini: { x: 2, y: 5 },
  detail: { x: 8, y: 14 },
} as const;

export interface MarketChartColors {
  stroke: string;
  fill: string;
}

export type MarketChartPoint = { x: number; y: number };

export interface MarketChartGeometry {
  points: MarketChartPoint[];
  linePath: string;
  areaPath: string;
  lastPoint: MarketChartPoint | null;
  gridLines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  min: number;
  max: number;
  hasEnoughData: boolean;
}

export function resolveMarketChartColors(trend: MarketChartTrend): MarketChartColors {
  switch (trend) {
    case 'up':
      return { stroke: colors.success, fill: colors.successSoft };
    case 'down':
      return { stroke: colors.danger, fill: colors.dangerSoft };
    default:
      return { stroke: colors.info, fill: colors.infoSoft };
  }
}

function buildChartPoints(
  data: number[],
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
  visualAmplitudeBoost: number,
): MarketChartPoint[] {
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const mean = data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);
  const minVisualRange = mean * MIN_VISUAL_RANGE_RATIO * visualAmplitudeBoost;

  let paddedMin: number;
  let paddedMax: number;

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

export function buildSmoothLinePath(
  points: MarketChartPoint[],
  width: number,
  curveTension = 0.3,
): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const point = points[0];
    return `M 0 ${point.y} L ${width} ${point.y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const prev = points[index - 1] ?? current;
    const after = points[index + 2] ?? next;

    const cp1x = current.x + (next.x - prev.x) * curveTension;
    const cp1y = current.y + (next.y - prev.y) * curveTension;
    const cp2x = next.x - (after.x - current.x) * curveTension;
    const cp2y = next.y - (after.y - current.y) * curveTension;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
  }

  return path;
}

export function buildAreaPathFromLine(
  linePath: string,
  points: MarketChartPoint[],
  height: number,
): string {
  if (!linePath || points.length === 0) return '';

  const last = points[points.length - 1];
  const first = points[0];
  const bottom = height - 0.5;

  return `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
}

function buildSubtleGridLines(
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
  rowCount = 3,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const innerHeight = height - paddingY * 2;
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  for (let index = 1; index < rowCount; index += 1) {
    const y = paddingY + (innerHeight / rowCount) * index;
    lines.push({
      x1: paddingX,
      y1: y,
      x2: width - paddingX,
      y2: y,
    });
  }

  return lines;
}

export function buildMarketChartGeometry(input: {
  data: number[];
  width: number;
  height: number;
  variant: MarketChartVariant;
}): MarketChartGeometry {
  const cleaned = input.data.filter((value) => Number.isFinite(value) && value > 0);

  if (cleaned.length < 2) {
    return {
      points: [],
      linePath: '',
      areaPath: '',
      lastPoint: null,
      gridLines: [],
      min: 0,
      max: 0,
      hasEnoughData: false,
    };
  }

  const isDetail = input.variant === 'detail';
  const padding = isDetail ? PADDING.detail : PADDING.mini;
  const visualAmplitudeBoost = isDetail ? 1 : MINI_VISUAL_AMPLITUDE_BOOST;
  const curveTension = isDetail ? 0.3 : 0.24;

  const points = buildChartPoints(
    cleaned,
    input.width,
    input.height,
    padding.x,
    padding.y,
    visualAmplitudeBoost,
  );

  const linePath = buildSmoothLinePath(points, input.width, curveTension);
  const areaPath = buildAreaPathFromLine(linePath, points, input.height);

  return {
    points,
    linePath,
    areaPath,
    lastPoint: points[points.length - 1] ?? null,
    gridLines: isDetail
      ? buildSubtleGridLines(input.width, input.height, padding.x, padding.y)
      : [],
    min: Math.min(...cleaned),
    max: Math.max(...cleaned),
    hasEnoughData: true,
  };
}

export function getMarketChartStrokeWidth(variant: MarketChartVariant): number {
  return variant === 'detail' ? 2.1 : 1.85;
}

export function getMarketChartGradientStops(variant: MarketChartVariant): {
  top: number;
  mid: number;
  bottom: number;
} {
  if (variant === 'detail') {
    return { top: 0.32, mid: 0.1, bottom: 0.01 };
  }
  return { top: 0.24, mid: 0.07, bottom: 0.01 };
}
