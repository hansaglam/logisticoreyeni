/**
 * Türkiye-first ROAD ingest filter. Not a truck-access claim.
 *
 * Prototype (Step 2E) includes motorway–secondary corridors only.
 * `tertiary` remains an optional later class; it is not ingested by default.
 */
export const ROAD_CLASS_POLICY_ID = 'tur-osm-highway-corridor-v2-prototype' as const;

export const OSM_HIGHWAY_PROTOTYPE_INCLUDED = ['motorway', 'trunk', 'primary', 'secondary'] as const;

/** Catalog of classes the architecture may accept later. Prototype ingest does not use tertiary. */
export const OSM_HIGHWAY_ALLOWED = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'] as const;

export const OSM_HIGHWAY_EXCLUDED = [
  'footway',
  'cycleway',
  'path',
  'steps',
  'pedestrian',
  'service',
  'residential',
  'living_street',
  'track',
  'bridleway',
] as const;

export type OsmHighwayAllowed = (typeof OSM_HIGHWAY_ALLOWED)[number];
export type OsmHighwayPrototype = (typeof OSM_HIGHWAY_PROTOTYPE_INCLUDED)[number];

export function highwayBase(highway: string | undefined): string {
  if (!highway) return '';
  return highway.split('_link')[0];
}

export function isAllowedOsmHighway(highway: string | undefined): highway is OsmHighwayAllowed {
  return (OSM_HIGHWAY_ALLOWED as readonly string[]).includes(highwayBase(highway));
}

export function isPrototypeOsmHighway(highway: string | undefined): highway is OsmHighwayPrototype {
  return (OSM_HIGHWAY_PROTOTYPE_INCLUDED as readonly string[]).includes(highwayBase(highway));
}

export function isExcludedOsmHighway(highway: string | undefined): boolean {
  return (OSM_HIGHWAY_EXCLUDED as readonly string[]).includes(highwayBase(highway));
}

export const ROAD_TRUCK_ACCESS_DEFAULT = 'UNVERIFIED' as const;
