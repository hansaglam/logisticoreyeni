/**
 * Player-facing curated AIR corridors. Airport-to-airport geodesic visualization.
 * Not a topology graph. Not a filed flight plan / ATC route.
 */
export const PLAYER_AIR_CORRIDOR_SCHEMA_VERSION = 1 as const;
export const PLAYER_AIR_CORRIDOR_POLICY_VERSION = 'map-v2-player-air-corridors-v1' as const;
export const PLAYER_AIR_CORRIDOR_QUANTIZE = 100_000_000;
export const AIR_ALLOW_PREVIEW_ONLY_ENDPOINTS = false;
export const EXPECTED_AIR_SOURCE_AIRPORT_HASH =
  'sha256:880b97d5d2326396d8436fec8fc0601c7e3016bdbf6ad614081c3949f1659032' as const;

/**
 * Visual logistics air corridors only.
 * Not a filed flight plan, ATC route, airway, SID/STAR, restricted-airspace path, or real airline route.
 * Status is never REAL_FLIGHT_ROUTE.
 */
export type PlayerFacingAirCorridorStatus =
  | 'VERIFIED_ENDPOINTS_PREVIEW'
  | 'PROVISIONAL_ENDPOINTS_PREVIEW'
  | 'UNRESOLVED';

export type CompactPlayerAirCorridor = {
  id: string;
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromGeoCityId: string;
  toGeoCityId: string;
  fromAirportId: string;
  toAirportId: string;
  fromIata: string | null;
  toIata: string | null;
  fromIcao: string | null;
  toIcao: string | null;
  endpointCargoCapabilityFrom: string;
  endpointCargoCapabilityTo: string;
  endpointReadinessFrom: string;
  endpointReadinessTo: string;
  status: Exclude<PlayerFacingAirCorridorStatus, 'UNRESOLVED'>;
  displayPriority: number;
  geodesicDistanceMeters: number;
  sampleCount: number;
  /** Delta-encoded quantized projected geodesic. */
  q: number[];
};

export type UnresolvedAirCorridorCandidate = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  reason: string;
};

export type PlayerFacingAirCorridorArtifactV1 = {
  schemaVersion: typeof PLAYER_AIR_CORRIDOR_SCHEMA_VERSION;
  countryId: 'country.tur';
  mode: 'AIR';
  sourceAirportArtifactHash: `sha256:${string}`;
  cargoQaPolicyVersion: string;
  geodesicAlgorithmVersion: string;
  corridorPolicyVersion: string;
  projectionVersion: number;
  quantization: number;
  allowPreviewOnlyEndpoints: boolean;
  corridors: readonly CompactPlayerAirCorridor[];
  unresolved: readonly UnresolvedAirCorridorCandidate[];
  contentHash: `sha256:${string}`;
};

export const PLAYER_AIR_READY_LEGACY_CITY_IDS = [
  'izmir',
  'istanbul',
  'ankara',
  'antalya',
  'adana',
  'diyarbakir',
  'trabzon',
] as const;

export const PLAYER_AIR_EXCLUDED_LEGACY_CITY_IDS = ['bursa'] as const;

/** Curated national AIR logistics skeleton. Canonical city order is applied at emit. */
export const PLAYER_FACING_AIR_CORRIDOR_CANDIDATES: ReadonlyArray<{
  fromLegacyCityId: string;
  toLegacyCityId: string;
  optional?: boolean;
  displayPriority: number;
}> = [
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'izmir', displayPriority: 10 },
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'ankara', displayPriority: 20 },
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'antalya', displayPriority: 30 },
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'trabzon', displayPriority: 40 },
  { fromLegacyCityId: 'ankara', toLegacyCityId: 'diyarbakir', displayPriority: 50 },
  { fromLegacyCityId: 'ankara', toLegacyCityId: 'adana', displayPriority: 60 },
  { fromLegacyCityId: 'izmir', toLegacyCityId: 'antalya', displayPriority: 70 },
  { fromLegacyCityId: 'adana', toLegacyCityId: 'diyarbakir', optional: true, displayPriority: 80 },
];

export function airCorridorIdForPair(a: string, b: string): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return `corridor.tur.air.${left}.${right}.v1`;
}
