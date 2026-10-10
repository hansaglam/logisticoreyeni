/**
 * Player-facing curated RAIL corridors. Geometry is precomputed offline from the
 * canonical OSM rail graph. The country dashboard must never import that graph.
 */
export const PLAYER_RAIL_CORRIDOR_SCHEMA_VERSION = 1 as const;
export const PLAYER_RAIL_CORRIDOR_POLICY_VERSION = 'map-v2-player-rail-corridors-v1' as const;
export const PLAYER_RAIL_CORRIDOR_SIMPLIFY_VERSION = 'open-polyline-dp-0.000016' as const;
export const PLAYER_RAIL_CORRIDOR_SIMPLIFY_TOLERANCE = 0.000016;
export const PLAYER_RAIL_CORRIDOR_QUANTIZE = 100_000_000;
export const EXPECTED_RAIL_SOURCE_PACKAGE_HASH =
  'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b' as const;

export type PlayerFacingRailCorridorStatus = 'PROVISIONAL_SOURCE_PATH' | 'UNRESOLVED';

export type PlayerFacingRailAccessStatus = 'PROVISIONAL' | 'UNRESOLVED';

/** Full domain record. Compact player JSON stores a subset plus lineage sidecar. */
export type PlayerFacingRailCorridor = {
  id: string;
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromGeoCityId: string;
  toGeoCityId: string;
  fromRailAccessId: string;
  toRailAccessId: string;
  sourceEdgeIds: readonly string[];
  sourceNodeIds?: readonly string[];
  projectedPolyline: readonly number[];
  sourceRouteLengthMeters: number;
  accessStatusFrom: PlayerFacingRailAccessStatus;
  accessStatusTo: PlayerFacingRailAccessStatus;
  displayPriority: number;
  status: Exclude<PlayerFacingRailCorridorStatus, 'UNRESOLVED'>;
};

export type CompactPlayerRailCorridor = {
  id: string;
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromGeoCityId: string;
  toGeoCityId: string;
  fromRailAccessId: string;
  toRailAccessId: string;
  accessStatusFrom: PlayerFacingRailAccessStatus;
  accessStatusTo: PlayerFacingRailAccessStatus;
  fromAccessName: string | null;
  toAccessName: string | null;
  fromAccessKind: string | null;
  toAccessKind: string | null;
  fromComponentId: string | null;
  toComponentId: string | null;
  status: Exclude<PlayerFacingRailCorridorStatus, 'UNRESOLVED'>;
  displayPriority: number;
  sourceEdgeCount: number;
  sourceRouteLengthMeters: number;
  sourceEdgeIdsHash: `sha256:${string}`;
  /** Delta-encoded quantized projected polyline. */
  q: number[];
};

export type UnresolvedRailCorridorCandidate = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  reason: string;
};

export type PlayerFacingRailCorridorArtifactV1 = {
  schemaVersion: typeof PLAYER_RAIL_CORRIDOR_SCHEMA_VERSION;
  countryId: 'country.tur';
  mode: 'RAIL';
  sourceRailPackageHash: `sha256:${string}`;
  corridorPolicyVersion: string;
  routeAlgorithmVersion: string;
  routeCostPolicyVersion: string;
  simplificationVersion: string;
  quantization: number;
  corridors: readonly CompactPlayerRailCorridor[];
  unresolved: readonly UnresolvedRailCorridorCandidate[];
  contentHash: `sha256:${string}`;
};

export const PLAYER_RAIL_ELIGIBLE_LEGACY_CITY_IDS = [
  'izmir',
  'istanbul',
  'ankara',
  'adana',
  'diyarbakir',
] as const;

export const PLAYER_RAIL_UNRESOLVED_LEGACY_CITY_IDS = ['bursa', 'antalya', 'trabzon'] as const;

/** Required V1 pairs, then optional İzmir–İstanbul if source-backed. */
export const PLAYER_FACING_RAIL_CORRIDOR_CANDIDATES: ReadonlyArray<{
  fromLegacyCityId: string;
  toLegacyCityId: string;
  optional?: boolean;
}> = [
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'ankara' },
  { fromLegacyCityId: 'izmir', toLegacyCityId: 'ankara' },
  { fromLegacyCityId: 'ankara', toLegacyCityId: 'adana' },
  { fromLegacyCityId: 'adana', toLegacyCityId: 'diyarbakir' },
  { fromLegacyCityId: 'izmir', toLegacyCityId: 'istanbul', optional: true },
];

export function railCorridorIdForPair(a: string, b: string): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return `corridor.tur.rail.${left}.${right}.v1`;
}
