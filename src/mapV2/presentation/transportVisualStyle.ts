import type { MapLod } from './mapLodPolicy';
import { mapVisualTokens } from './mapVisualTokens';

export type RoadVisualState = 'BACKGROUND_ROAD' | 'CANONICAL_GAMEPLAY_ROAD' | 'ACTIVE_ROUTE' | 'SECONDARY';

export type TransportVisualStyle = {
  visible: boolean;
  core: string;
  halo: string;
  widthScale: number;
  segmented: boolean;
};

export function resolveRoadVisualStyle(lod: MapLod, routeState: RoadVisualState): TransportVisualStyle {
  const visible = lod !== 'WORLD_OVERVIEW' && lod !== 'WORLD_FOCUSED';
  if (routeState === 'ACTIVE_ROUTE') {
    return { visible, core: mapVisualTokens.roadSelected, halo: mapVisualTokens.roadGlow, widthScale: 1.2, segmented: false };
  }
  if (routeState === 'BACKGROUND_ROAD' || routeState === 'SECONDARY') {
    return { visible, core: mapVisualTokens.roadSecondary, halo: mapVisualTokens.roadBase, widthScale: 0.72, segmented: false };
  }
  const operations = lod === 'COUNTRY_OPERATIONS' || lod === 'COUNTRY_DETAIL';
  return {
    visible,
    core: mapVisualTokens.roadPrimary,
    halo: mapVisualTokens.roadGlow,
    widthScale: operations ? 1.08 : 1,
    segmented: false,
  };
}

export function resolveRailVisualStyle(lod: MapLod, emphasized: boolean): TransportVisualStyle {
  const visible = lod !== 'WORLD_OVERVIEW' && lod !== 'WORLD_FOCUSED';
  return {
    visible,
    core: emphasized ? mapVisualTokens.railSelected : mapVisualTokens.railPrimary,
    halo: mapVisualTokens.railBase,
    widthScale: emphasized ? 1.05 : 0.86,
    segmented: true,
  };
}

/** Future route language. Not a live network. */
export const SEA_ROUTE_VISUAL = {
  productionEnabled: false as const,
  core: '#6E8CA8',
  halo: 'rgba(110, 140, 168, 0.25)',
};

export const AIR_ROUTE_VISUAL = {
  productionEnabled: false as const,
  core: '#8EA0B8',
  halo: 'rgba(142, 160, 184, 0.2)',
};
