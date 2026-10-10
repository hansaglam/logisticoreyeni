/**
 * Player-facing curated SEA corridors. Geometry is precomputed offline from the
 * canonical maritime graph. The country dashboard must never import that graph.
 */
export const PLAYER_SEA_CORRIDOR_SCHEMA_VERSION = 1 as const;
export const PLAYER_SEA_CORRIDOR_POLICY_VERSION = 'map-v2-player-sea-corridors-v1' as const;
export const PLAYER_SEA_CORRIDOR_SIMPLIFY_VERSION = 'open-polyline-dp-protected-channel-0.000018' as const;
export const PLAYER_SEA_CORRIDOR_SIMPLIFY_TOLERANCE = 0.000018;
export const PLAYER_SEA_CORRIDOR_QUANTIZE = 100_000_000;
export const EXPECTED_SEA_SOURCE_PACKAGE_HASH =
  'sha256:2588dc93ef822899b2f74fec92e01df354d2ebe2fcf1783ddc1a454016eb9973' as const;

export type PlayerFacingSeaCorridorStatus = 'PROVISIONAL_SOURCE_PATH' | 'UNRESOLVED';
export type PlayerFacingSeaAccessStatus = 'PROVISIONAL' | 'UNRESOLVED';
export type PlayerFacingSeaAssociationType = 'DIRECT' | 'REGIONAL' | 'NONE' | 'UNRESOLVED';

export type CompactPlayerSeaCorridor = {
  id: string;
  fromLegacyCityId: string;
  toLegacyCityId: string;
  fromGeoCityId: string;
  toGeoCityId: string;
  fromPortId: string;
  toPortId: string;
  fromSeaAccessId: string;
  toSeaAccessId: string;
  portAssociationFrom: PlayerFacingSeaAssociationType;
  portAssociationTo: PlayerFacingSeaAssociationType;
  accessStatusFrom: PlayerFacingSeaAccessStatus;
  accessStatusTo: PlayerFacingSeaAccessStatus;
  fromPortName: string | null;
  toPortName: string | null;
  maritimeRegions: readonly string[];
  channelsUsed: readonly string[];
  status: Exclude<PlayerFacingSeaCorridorStatus, 'UNRESOLVED'>;
  displayPriority: number;
  sourceEdgeCount: number;
  sourceNodeCount: number;
  sourceRouteLengthMeters: number;
  sourceEdgeIdsHash: `sha256:${string}`;
  /** Delta-encoded quantized projected polyline. */
  q: number[];
};

export type UnresolvedSeaCorridorCandidate = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  reason: string;
};

export type PlayerFacingSeaCorridorArtifactV1 = {
  schemaVersion: typeof PLAYER_SEA_CORRIDOR_SCHEMA_VERSION;
  countryId: 'country.tur';
  mode: 'SEA';
  sourceSeaPackageHash: `sha256:${string}`;
  sourcePortsArtifactHash: `sha256:${string}`;
  corridorPolicyVersion: string;
  routeAlgorithmVersion: string;
  routeCostPolicyVersion: string;
  simplificationVersion: string;
  quantization: number;
  corridors: readonly CompactPlayerSeaCorridor[];
  unresolved: readonly UnresolvedSeaCorridorCandidate[];
  contentHash: `sha256:${string}`;
};

export const PLAYER_SEA_ELIGIBLE_LEGACY_CITY_IDS = [
  'istanbul',
  'izmir',
  'bursa',
  'antalya',
  'adana',
  'trabzon',
] as const;

export const PLAYER_SEA_NON_SEA_LEGACY_CITY_IDS = ['ankara', 'diyarbakir'] as const;

export const PLAYER_FACING_SEA_CORRIDOR_CANDIDATES: ReadonlyArray<{
  fromLegacyCityId: string;
  toLegacyCityId: string;
  requiredChannels: readonly ('BOSPHORUS' | 'DARDANELLES')[];
  forbiddenChannels?: readonly ('BOSPHORUS' | 'DARDANELLES')[];
  optional?: boolean;
}> = [
  {
    fromLegacyCityId: 'istanbul',
    toLegacyCityId: 'izmir',
    requiredChannels: ['DARDANELLES'],
    forbiddenChannels: ['BOSPHORUS'],
  },
  { fromLegacyCityId: 'istanbul', toLegacyCityId: 'trabzon', requiredChannels: ['BOSPHORUS'] },
  { fromLegacyCityId: 'izmir', toLegacyCityId: 'antalya', requiredChannels: [] },
  { fromLegacyCityId: 'antalya', toLegacyCityId: 'adana', requiredChannels: [] },
  { fromLegacyCityId: 'bursa', toLegacyCityId: 'trabzon', requiredChannels: ['BOSPHORUS'] },
  { fromLegacyCityId: 'bursa', toLegacyCityId: 'izmir', requiredChannels: ['DARDANELLES'], optional: true },
];

export function seaCorridorIdForPair(a: string, b: string): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return `corridor.tur.sea.${left}.${right}.v1`;
}
