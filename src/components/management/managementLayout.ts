import {
  MANAGEMENT_GRID_GAP,
  MANAGEMENT_HEADER_GAP,
  MANAGEMENT_PANEL_PADDING,
  MANAGEMENT_TILE_MIN_HEIGHT,
} from './managementTheme';

const HEADER_BLOCK_HEIGHT = 56;

export function estimateManagementPanelContentHeight(itemCount: number): number {
  const rowCount = Math.ceil(itemCount / 2);
  const gridHeight =
    rowCount * MANAGEMENT_TILE_MIN_HEIGHT +
    Math.max(0, rowCount - 1) * MANAGEMENT_GRID_GAP;
  return (
    MANAGEMENT_PANEL_PADDING +
    HEADER_BLOCK_HEIGHT +
    MANAGEMENT_HEADER_GAP +
    gridHeight +
    MANAGEMENT_PANEL_PADDING
  );
}

export function resolveManagementPanelHeight(params: {
  itemCount: number;
  availableHeight: number;
}): {
  naturalHeight: number;
  panelHeight: number;
  needsScroll: boolean;
  rowCount: number;
} {
  const rowCount = Math.ceil(params.itemCount / 2);
  const naturalHeight = estimateManagementPanelContentHeight(params.itemCount);
  const safeAvailable = Math.max(1, params.availableHeight);
  const panelHeight = Math.min(naturalHeight, safeAvailable);
  return {
    naturalHeight,
    panelHeight: Math.max(panelHeight, 1),
    needsScroll: naturalHeight > safeAvailable,
    rowCount,
  };
}
