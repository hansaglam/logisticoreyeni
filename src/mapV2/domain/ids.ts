/** Opaque geographic identity. Assigned at ingestion — never a display name. */
export type GeoCountryId = string;
export type GeoRegionId = string;
export type GeoCityId = string;
export type GeoInfrastructureId = string;
export type GeoTransportNodeId = string;
export type GeoTransportEdgeId = string;
export type GeoBoundaryId = string;
export type GeometryRef = string;
export type ProvenanceRef = string;
export type NameKey = string;

/** Live gameplay catalog identity. LEGACY-STABLE — do not rename. */
export type GameplayCityId = string;

export const LEGACY_STABLE_GAMEPLAY_CITY_IDS = [
  'izmir',
  'istanbul',
  'ankara',
  'bursa',
  'antalya',
  'adana',
  'diyarbakir',
  'trabzon',
] as const;

export type LegacyStableGameplayCityId = (typeof LEGACY_STABLE_GAMEPLAY_CITY_IDS)[number];
