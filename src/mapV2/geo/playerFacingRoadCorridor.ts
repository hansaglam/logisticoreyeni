/**
 * Player-facing curated ROAD corridors. Geometry is precomputed offline.
 * The country dashboard must never import the canonical ROAD monolith or chunk runtime.
 */
export const PLAYER_ROAD_CORRIDOR_SCHEMA_VERSION = 1 as const;
export const PLAYER_ROAD_CORRIDOR_POLICY_VERSION = 'map-v2-player-corridors-v1' as const;
export const PLAYER_ROAD_CORRIDOR_SIMPLIFY_VERSION = 'open-polyline-dp-0.000018' as const;
export const PLAYER_ROAD_CORRIDOR_SIMPLIFY_TOLERANCE = 0.000018;
export const PLAYER_ROAD_CORRIDOR_QUANTIZE = 100_000_000;
export const EXPECTED_ROAD_SOURCE_PACKAGE_HASH =
  'sha256:b506587dfd7e390794a448a0a855b773af640ebfeba316a4ffc86bacf4d45882' as const;

export type PlayerFacingCorridorStatus = 'VERIFIED_SOURCE_PATH' | 'PROVISIONAL_SOURCE_PATH' | 'UNRESOLVED';

export type CountryOverviewRoadCorridor = {
  id: string;
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromGeoCityId: string;
  toGeoCityId: string;
  fromAccessNodeId: string;
  toAccessNodeId: string;
  sourceEdgeIds: readonly string[];
  sourceNodeIds?: readonly string[];
  projectedPolyline: readonly number[];
  sourceRouteLengthMeters: number;
  displayPriority: number;
  status: Exclude<PlayerFacingCorridorStatus, 'UNRESOLVED'>;
};

export type PlayerFacingRoadCorridorArtifactV1 = {
  schemaVersion: typeof PLAYER_ROAD_CORRIDOR_SCHEMA_VERSION;
  countryId: 'country.tur';
  mode: 'ROAD';
  sourceRoadPackageHash: `sha256:${string}`;
  corridorPolicyVersion: string;
  routeAlgorithmVersion: string;
  simplificationVersion: string;
  quantization: number;
  corridors: readonly CompactPlayerCorridor[];
  unresolved: readonly UnresolvedCorridorCandidate[];
  contentHash: `sha256:${string}`;
};

/** Compact player payload. Full sourceEdgeIds live in the lineage sidecar for DEV/tests. */
export type CompactPlayerCorridor = {
  id: string;
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromGeoCityId: string;
  toGeoCityId: string;
  fromAccessNodeId: string;
  toAccessNodeId: string;
  status: Exclude<PlayerFacingCorridorStatus, 'UNRESOLVED'>;
  displayPriority: number;
  sourceEdgeCount: number;
  sourceRouteLengthMeters: number;
  sourceEdgeIdsHash: `sha256:${string}`;
  /** Delta-encoded quantized projected polyline. */
  q: number[];
};

export type UnresolvedCorridorCandidate = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  reason: string;
};

export type PlayerFacingRoadCorridorSetV1 = {
  schemaVersion: 1;
  geoCountryId: string;
  mode: 'ROAD';
  sourceRoadPackageHash: string | null;
  corridors: readonly CountryOverviewRoadCorridor[];
  unresolved: readonly UnresolvedCorridorCandidate[];
  unavailableReason: 'ROUTE_EXTRACTION_NOT_READY' | null;
  contentHash: string | null;
};

export const PLAYER_FACING_ROAD_CORRIDOR_CANDIDATES: ReadonlyArray<{
  fromLegacyCityId: string;
  toLegacyCityId: string;
}> = [
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'ankara' },
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'bursa' },
  { fromLegacyCityId: 'bursa', toLegacyCityId: 'izmir' },
  { fromLegacyCityId: 'izmir', toLegacyCityId: 'antalya' },
  { fromLegacyCityId: 'ankara', toLegacyCityId: 'antalya' },
  { fromLegacyCityId: 'ankara', toLegacyCityId: 'adana' },
  { fromLegacyCityId: 'ankara', toLegacyCityId: 'trabzon' },
  { fromLegacyCityId: 'ankara', toLegacyCityId: 'diyarbakir' },
  { fromLegacyCityId: 'adana', toLegacyCityId: 'diyarbakir' },
  { fromLegacyCityId: 'antalya', toLegacyCityId: 'adana' },
];

export function corridorIdForPair(a: string, b: string): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return `corridor.tur.${left}.${right}.v1`;
}

export function playerFacingCorridorsAreReady(set: PlayerFacingRoadCorridorSetV1): boolean {
  return set.corridors.length > 0 && set.unavailableReason == null;
}
