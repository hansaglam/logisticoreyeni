export const DASHBOARD_HORIZONTAL_PADDING = 16;
export const DASHBOARD_HERO_PADDING = 13;

export const METRIC_ROW_GAP = 8;
export const METRIC_CELL_HORIZONTAL_PADDING = 8;

export type MetricRowLayout = {
  availableMetricsWidth: number;
  cellWidth: number;
  gap: number;
};

export function resolveAvailableHeroContentWidth(windowWidth: number): number {
  const safeWidth = Math.max(0, windowWidth);
  return Math.max(
    0,
    safeWidth - DASHBOARD_HORIZONTAL_PADDING * 2 - DASHBOARD_HERO_PADDING * 2,
  );
}

/** Four equal metric cells in a single row — all supported widths. */
export function resolveMetricRowLayout(windowWidth: number): MetricRowLayout {
  const availableMetricsWidth = resolveAvailableHeroContentWidth(windowWidth);
  const gap = METRIC_ROW_GAP;
  const cellWidth =
    availableMetricsWidth > 0
      ? (availableMetricsWidth - gap * 3) / 4
      : 0;

  return {
    availableMetricsWidth,
    cellWidth,
    gap,
  };
}

/** @deprecated Use resolveMetricRowLayout — always single-row 4 metrics. */
export function resolveMetricGridLayout(windowWidth: number, _fontScale: number = 1) {
  const row = resolveMetricRowLayout(windowWidth);
  return {
    useTwoColumnMetrics: false,
    availableMetricsWidth: row.availableMetricsWidth,
    cellWidth: row.cellWidth,
    gap: row.gap,
  };
}

export const METRIC_GRID_GAP = METRIC_ROW_GAP;
