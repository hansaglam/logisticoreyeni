/**
 * Semantic map zoom levels. Product code asks for a level, not a raw zoom number.
 */

export type MapScope = 'WORLD' | 'COUNTRY' | 'CITY_DETAIL';

export type MapLod =
  | 'WORLD_OVERVIEW'
  | 'WORLD_FOCUSED'
  | 'COUNTRY_OVERVIEW'
  | 'COUNTRY_OPERATIONS'
  | 'COUNTRY_DETAIL';

const WORLD_FOCUS_ZOOM = 1.8;
const COUNTRY_OPERATIONS_ZOOM = 1.35;

export function resolveMapLod(input: {
  scope: MapScope;
  zoom?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  hasCitySelection?: boolean;
}): MapLod {
  if (input.scope === 'CITY_DETAIL') return 'COUNTRY_DETAIL';
  if (input.scope === 'WORLD') {
    return (input.zoom ?? 1) >= WORLD_FOCUS_ZOOM ? 'WORLD_FOCUSED' : 'WORLD_OVERVIEW';
  }
  if (input.hasCitySelection) return 'COUNTRY_OPERATIONS';
  return (input.zoom ?? 1) >= COUNTRY_OPERATIONS_ZOOM ? 'COUNTRY_OPERATIONS' : 'COUNTRY_OVERVIEW';
}

export function lodShowsGameplayCities(lod: MapLod): boolean {
  return lod === 'COUNTRY_OVERVIEW' || lod === 'COUNTRY_OPERATIONS' || lod === 'COUNTRY_DETAIL';
}

export function lodShowsRoadNetwork(lod: MapLod): boolean {
  return lod === 'COUNTRY_OVERVIEW' || lod === 'COUNTRY_OPERATIONS' || lod === 'COUNTRY_DETAIL';
}

export function lodShowsCountryLabels(lod: MapLod): boolean {
  return lod === 'WORLD_OVERVIEW' || lod === 'WORLD_FOCUSED';
}

/** Individual truck markers belong to country LOD. World stays aggregate. */
export function lodShowsIndividualVehicles(lod: MapLod): boolean {
  return lod === 'COUNTRY_OVERVIEW' || lod === 'COUNTRY_OPERATIONS' || lod === 'COUNTRY_DETAIL';
}

/** World shows a count, not one pin per truck. */
export function lodShowsFleetAggregate(lod: MapLod): boolean {
  return lod === 'WORLD_OVERVIEW' || lod === 'WORLD_FOCUSED';
}

/** Internal description. Not rendered in the command center. */
export function describeMapLod(lod: MapLod): { lod: MapLod; cities: boolean; roads: boolean } {
  return {
    lod,
    cities: lodShowsGameplayCities(lod),
    roads: lodShowsRoadNetwork(lod),
  };
}
