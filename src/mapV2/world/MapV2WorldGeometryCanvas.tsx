import React, { memo } from 'react';

import type { GeometryLodId } from '../geo/geometry';
import MapV2GeographicCanvas, { type WorldGeometryHud } from './MapV2GeographicCanvas';

export type { WorldGeometryHud };

const DEBUG_PAINT = {
  fill: '#14324A',
  border: '#4A7A9B',
  strokeWidth: 0.0009,
};
const DEBUG_SELECTED = {
  fill: '#1D4E89',
  border: '#2388FF',
  strokeWidth: 0.0018,
};

type Props = {
  selectedId: string | null;
  lodOverride: GeometryLodId | 'AUTO';
  cullEnabled: boolean;
  onSelect: (geoCountryId: string | null) => void;
  onHud: (hud: WorldGeometryHud) => void;
};

function MapV2WorldGeometryCanvasInner({ selectedId, lodOverride, cullEnabled, onSelect, onHud }: Props) {
  return (
    <MapV2GeographicCanvas
      selectedId={selectedId}
      lodOverride={lodOverride}
      cullEnabled={cullEnabled}
      onSelect={onSelect}
      onHud={onHud}
      getCountryPaint={(_id, selected) => (selected ? DEBUG_SELECTED : DEBUG_PAINT)}
      homePolicy="FULL_WORLD"
    />
  );
}

export default memo(MapV2WorldGeometryCanvasInner);
