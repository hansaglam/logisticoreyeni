/**
 * Compact ROAD first/last-mile transfer-access records (Map V2 Step 25).
 * Offline-generated. No runtime Dijkstra / OSM / full ROAD graph.
 */

export const MULTIMODAL_ROAD_TRANSFER_ACCESS_SCHEMA_VERSION = 1 as const;
export const MULTIMODAL_ROAD_TRANSFER_ACCESS_PACKAGE_ID =
  'map-v2.country.tur.multimodal-road-transfer-access.v1' as const;
export const MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID =
  'dijkstra-road-transfer-access-v1' as const;
/** Same undirected Dijkstra family as country-overview ROAD corridors. Not legal truck routing. */
export const ROAD_ACCESS_ROUTING_DIRECTIONALITY =
  'OVERVIEW_UNDIRECTED_SOURCE_BACKED' as const;
export const SOURCE_BACKED_ROAD_TRANSFER_ACCESS = 'SOURCE_BACKED_ROAD_TRANSFER_ACCESS' as const;

export const ROAD_INFRA_SNAP_SEARCH_RADII_METERS = [50, 150, 400, 1000, 2500, 15000, 40000] as const;
/** Default giant-component snap bound (city ROAD access radius). */
export const ROAD_INFRA_SNAP_MAX_METERS = 15000;
/** When infra sits on a local ROAD fragment disconnected from the giant, allow this bound. */
export const ROAD_INFRA_SNAP_DISCONNECTED_PRECINCT_METERS = 40000;
export const ROAD_INFRA_ATTACHED_EXACT_METERS = 25;
export const ROAD_INFRA_NEAR_ROAD_METERS = 2500;
export const ROAD_ACCESS_ENDPOINT_CANDIDATE_LIMIT = 24;
export const ROAD_ACCESS_MAX_DIRECT_DETOUR_RATIO = 4;
export const ROAD_ACCESS_MAX_DIRECT_ROUTE_METERS = 80_000;
export const ROAD_ACCESS_MAX_REGIONAL_ROUTE_METERS = 150_000;

export type MultimodalRoadTransferMode = 'RAIL' | 'SEA' | 'AIR';

export type RoadTransferAccessEvidenceStatus =
  | 'ATTACHED_EXACT'
  | 'PROVISIONAL_NEAR_ROAD'
  | 'PROVISIONAL_BOUNDED_SNAP'
  | 'UNRESOLVED';

export type RoadTransferAccessRecordStatus = 'READY' | 'UNRESOLVED';

export type RoadCityAssociationType = 'DIRECT' | 'REGIONAL' | null;

export type MultimodalRoadTransferAccessRecord = {
  logicalKey: string;
  legacyCityId: string;
  geoCityId: string;
  transferMode: MultimodalRoadTransferMode;
  infrastructureId: string;
  transferNodeId: string;
  associationType: RoadCityAssociationType;
  cityRoadAnchorNodeId: string;
  infrastructureRoadNodeId: string;
  infrastructureWgs84: { longitude: number; latitude: number };
  snapDistanceMeters: number;
  snapEvidenceStatus: Exclude<RoadTransferAccessEvidenceStatus, 'UNRESOLVED'>;
  distanceMeters: number;
  roadEdgeCount: number;
  routeReference: string;
  distanceAuthority: typeof SOURCE_BACKED_ROAD_TRANSFER_ACCESS;
  sourceRoadPackageHash: `sha256:${string}`;
  algorithmId: typeof MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID;
  routingDirectionality: typeof ROAD_ACCESS_ROUTING_DIRECTIONALITY;
  evidenceStatus: 'PROVISIONAL';
  status: 'READY';
};

export type MultimodalRoadTransferAccessArtifactV1 = {
  schemaVersion: typeof MULTIMODAL_ROAD_TRANSFER_ACCESS_SCHEMA_VERSION;
  packageId: typeof MULTIMODAL_ROAD_TRANSFER_ACCESS_PACKAGE_ID;
  geoCountryId: 'country.tur';
  algorithmId: typeof MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID;
  routingDirectionality: typeof ROAD_ACCESS_ROUTING_DIRECTIONALITY;
  sourceRoadPackageHash: `sha256:${string}`;
  cityAccessPackageHash: `sha256:${string}`;
  contentHash: `sha256:${string}`;
  records: readonly MultimodalRoadTransferAccessRecord[];
};

export function roadTransferAccessLogicalKey(
  legacyCityId: string,
  transferMode: MultimodalRoadTransferMode,
  infrastructureId: string,
): string {
  return `${legacyCityId}|${transferMode}|${infrastructureId}`;
}

export function findRoadTransferAccess(
  artifact: MultimodalRoadTransferAccessArtifactV1 | null | undefined,
  legacyCityId: string,
  transferMode: MultimodalRoadTransferMode,
  infrastructureId?: string | null,
): MultimodalRoadTransferAccessRecord | null {
  if (!artifact?.records?.length) return null;
  const matches = artifact.records.filter((row) => {
    if (row.legacyCityId !== legacyCityId || row.transferMode !== transferMode) return false;
    if (infrastructureId) return row.infrastructureId === infrastructureId;
    return true;
  });
  if (infrastructureId) return matches[0] ?? null;
  return matches.length === 1 ? matches[0] : null;
}
