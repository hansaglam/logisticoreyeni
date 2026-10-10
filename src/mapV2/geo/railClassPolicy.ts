/**
 * Türkiye RAIL class filter. Logistics V1 default is heavy/national railway=rail.
 * Excluded classes remain reportable; tags are not erased from the raw extract.
 */
export const RAIL_CLASS_POLICY_ID = 'tur-osm-railway-national-v1' as const;

export const OSM_RAILWAY_LOGISTICS_INCLUDED = ['rail'] as const;

/** Considered only when usage is main or branch (freight/intercity evidence). */
export const OSM_RAILWAY_CONDITIONAL = ['narrow_gauge'] as const;

export const OSM_RAILWAY_EXCLUDED_DEFAULT = [
  'tram',
  'subway',
  'light_rail',
  'funicular',
  'monorail',
  'miniature',
  'construction',
  'abandoned',
  'disused',
  'razed',
  'proposed',
  'planned',
  'dismantled',
] as const;

export const OSM_RAILWAY_STATION_TAGS = ['station', 'halt'] as const;
export const OSM_RAILWAY_TERMINAL_TAGS = ['yard', 'freight_terminal'] as const;

export const OSM_RAIL_SERVICE_DETAIL = ['yard', 'siding', 'spur', 'crossover'] as const;
export const OSM_RAIL_USAGE_HIGH = ['industrial', 'military', 'tourism'] as const;

export function railwayBase(railway: string | undefined): string {
  return (railway ?? '').trim();
}

export function isLogisticsOsmRailway(railway: string | undefined, usage?: string | null): boolean {
  const base = railwayBase(railway);
  if ((OSM_RAILWAY_LOGISTICS_INCLUDED as readonly string[]).includes(base)) return true;
  if ((OSM_RAILWAY_CONDITIONAL as readonly string[]).includes(base)) {
    return usage === 'main' || usage === 'branch';
  }
  return false;
}

export function isExcludedOsmRailway(railway: string | undefined): boolean {
  return (OSM_RAILWAY_EXCLUDED_DEFAULT as readonly string[]).includes(railwayBase(railway));
}

export function isOsmRailStationTag(railway: string | undefined): boolean {
  return (OSM_RAILWAY_STATION_TAGS as readonly string[]).includes(railwayBase(railway));
}

export function isOsmRailTerminalTag(railway: string | undefined): boolean {
  return (OSM_RAILWAY_TERMINAL_TAGS as readonly string[]).includes(railwayBase(railway));
}

export function isRailServiceDetail(service: string | null | undefined): boolean {
  if (!service) return false;
  return (OSM_RAIL_SERVICE_DETAIL as readonly string[]).includes(service);
}
