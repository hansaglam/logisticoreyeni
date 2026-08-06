import {
  MANAGEMENT_GRID_GAP,
  MANAGEMENT_HEADER_GAP,
  MANAGEMENT_PANEL_PADDING,
  MANAGEMENT_TILE_MIN_HEIGHT,
} from './managementTheme';

const HEADER_BLOCK_HEIGHT = 72;

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
