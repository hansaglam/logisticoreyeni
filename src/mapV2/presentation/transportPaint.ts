import type { MapV2TransportMode } from '../domain/transport';
import { isAllowedOsmHighway } from '../geo/roadClassPolicy';
import { isRailServiceDetail, OSM_RAIL_USAGE_HIGH } from '../geo/railClassPolicy';
import { paintForRoadProfile, ROAD_RENDER_PROFILE_DEBUG, type RoadRenderProfile } from './roadRenderProfile';

export type TransportStyleClass =
  | 'ROAD_MOTORWAY'
  | 'ROAD_TRUNK'
  | 'ROAD_PRIMARY'
  | 'ROAD_SECONDARY'
  | 'ROAD_TERTIARY'
  | 'ROAD_UNKNOWN'
  | 'RAIL_MAIN'
  | 'RAIL_BRANCH'
  | 'RAIL_SERVICE'
  | 'RAIL_UNKNOWN'
  | 'SEA_PENDING'
  | 'AIR_PENDING';

export type TransportRenderableEdge = {
  edgeId: string;
  mode: MapV2TransportMode;
  projectedGeometry: number[];
  styleClass: TransportStyleClass;
  quantizeScale: number;
};

export type TransportPaint = {
  color: string;
  dash: number[];
  strokeWidth: number;
};

export function styleClassFromAttributes(mode: MapV2TransportMode, attributes: Record<string, string | number | boolean | null>): TransportStyleClass {
  if (mode === 'ROAD') {
    const highway = typeof attributes.highway === 'string' ? attributes.highway : '';
    const base = highway.split('_link')[0];
    if (base === 'motorway') return 'ROAD_MOTORWAY';
    if (base === 'trunk') return 'ROAD_TRUNK';
    if (base === 'primary') return 'ROAD_PRIMARY';
    if (base === 'secondary') return 'ROAD_SECONDARY';
    if (base === 'tertiary') return 'ROAD_TERTIARY';
    if (isAllowedOsmHighway(highway)) return 'ROAD_UNKNOWN';
    return 'ROAD_UNKNOWN';
  }
  if (mode === 'RAIL') {
    const usage = typeof attributes.usage === 'string' ? attributes.usage : '';
    const service = typeof attributes.service === 'string' ? attributes.service : '';
    if (isRailServiceDetail(service)) return 'RAIL_SERVICE';
    if (usage === 'branch' || (OSM_RAIL_USAGE_HIGH as readonly string[]).includes(usage)) return 'RAIL_BRANCH';
    if (attributes.railway === 'rail' || attributes.railway === 'narrow_gauge') return 'RAIL_MAIN';
    return 'RAIL_UNKNOWN';
  }
  if (mode === 'SEA') return 'SEA_PENDING';
  return 'AIR_PENDING';
}

export function paintForTransportStyle(
  styleClass: TransportStyleClass,
  profile: RoadRenderProfile = ROAD_RENDER_PROFILE_DEBUG,
): TransportPaint {
  if (styleClass.startsWith('ROAD_')) return paintForRoadProfile(styleClass, profile);
  if (styleClass === 'RAIL_MAIN') {
    return { color: '#C5D0D8', dash: [5, 4], strokeWidth: 0.0002 };
  }
  if (styleClass === 'RAIL_BRANCH') {
    return { color: '#8E99A3', dash: [4, 5], strokeWidth: 0.00016 };
  }
  if (styleClass.startsWith('RAIL')) {
    return { color: '#66717A', dash: [3, 6], strokeWidth: 0.00013 };
  }
  if (styleClass === 'SEA_PENDING') {
    return { color: '#34D399', dash: [2, 6], strokeWidth: 0.0002 };
  }
  return { color: '#C4B5FD', dash: [1, 8], strokeWidth: 0.0002 };
}

export function toRenderableEdge(
  edgeId: string,
  mode: MapV2TransportMode,
  projectedQuantized: number[],
  attributes: Record<string, string | number | boolean | null>,
  quantizeScale: number,
): TransportRenderableEdge {
  return {
    edgeId,
    mode,
    projectedGeometry: projectedQuantized,
    styleClass: styleClassFromAttributes(mode, attributes),
    quantizeScale,
  };
}
