import type { GameplayCityId, GeoCityId, GeoCountryId, GeoInfrastructureId } from './ids';
import type { MapV2TransportMode } from './transport';

export type GeographicLevel = 'WORLD' | 'REGION' | 'COUNTRY' | 'CITY' | 'INFRASTRUCTURE';

export const MAP_V2_ROLLOUT_MODES = [
  'LEGACY_ONLY',
  'MAP_V2_SHADOW',
  'MAP_V2_INTERNAL',
  'MAP_V2_PRIMARY',
  'LEGACY_FALLBACK',
  'MAP_V2_ONLY',
] as const;

export type MapV2RolloutMode = (typeof MAP_V2_ROLLOUT_MODES)[number];

/** Transient session UI — not player progression. */
export interface MapV2UiStateDraft {
  geographicLevel: GeographicLevel;
  selectedCountryId: GeoCountryId | null;
  selectedCityId: GeoCityId | GameplayCityId | null;
  selectedInfrastructureId: GeoInfrastructureId | null;
  activeTransportLayers: MapV2TransportMode[];
  navigationStack: GeographicLevel[];
}

export interface VisibleCountryDraft {
  geoCountryId: GeoCountryId;
  nameKey: string;
  geometryRef?: string;
  lockVisual: 'LOCKED' | 'UNLOCKED' | 'SELECTED';
}

export interface VisibleCityDraft {
  gameplayCityId?: GameplayCityId;
  geoCityId?: GeoCityId | null;
  nameKey: string;
  mappingUnresolved: boolean;
}

export type MapV2FallbackCategory =
  | 'missing-country-geometry'
  | 'unresolved-city-mapping'
  | 'missing-transport-geometry'
  | 'invalid-mapdata-release'
  | 'mapdata-load-failed';
