import type { MapSourceManifest } from '../../mapData/mapSourcePolicy';
import type { MapV2TransportMode } from '../domain/transport';
import type { GeoCoordinateWgs84, ProjectedWorldPoint, WebMercatorProjectionMeta } from './webMercator';
import { WEB_MERCATOR_PROJECTION_META } from './webMercator';

export const TRANSPORT_NETWORK_SCHEMA_VERSION = 1 as const;
export const TRANSPORT_PACKAGE_PROCESSING_VERSION = 'map-v2-transport-2d-1';
export const TRANSPORT_SIMPLIFICATION_VERSION = 'none-empty-2d';
export const TRANSPORT_QUANTIZE = 100000;

export const TRANSPORT_NETWORK_LODS = ['NETWORK_LOW', 'NETWORK_MEDIUM', 'NETWORK_HIGH'] as const;
export type TransportNetworkLod = (typeof TRANSPORT_NETWORK_LODS)[number];

export const TRANSPORT_SOURCE_STATUSES = ['READY', 'PROTOTYPE', 'SOURCE_PENDING'] as const;
export type TransportSourceStatus = (typeof TRANSPORT_SOURCE_STATUSES)[number];

export const CITY_TRANSPORT_ACCESS_STATUSES = ['VERIFIED', 'PROVISIONAL', 'UNRESOLVED'] as const;
export type CityTransportAccessStatus = (typeof CITY_TRANSPORT_ACCESS_STATUSES)[number];

export type GeoTransportNodeKindRuntime =
  | 'ROAD_JUNCTION'
  | 'CITY_ACCESS'
  | 'BORDER_CROSSING'
  | 'RAIL_JUNCTION'
  | 'RAIL_STATION'
  | 'RAIL_TERMINAL'
  | 'PORT'
  | 'SEA_WAYPOINT'
  | 'ANCHORAGE'
  | 'AIRPORT'
  | 'AIR_WAYPOINT'
  | 'INTERMODAL_HUB';

export type GeoTransportLineString = {
  wgs84: GeoCoordinateWgs84[];
  projectedQuantized: number[];
};

export type GeoTransportNodeRecord = {
  nodeId: string;
  mode: MapV2TransportMode;
  kind: GeoTransportNodeKindRuntime;
  geoCountryId: string;
  geoCityId?: string;
  infrastructureId?: string;
  coordinate?: GeoCoordinateWgs84;
  projected?: ProjectedWorldPoint;
  sourceMetadata: Record<string, string | number | boolean | null>;
};

export type GeoTransportEdgeRecord = {
  edgeId: string;
  mode: MapV2TransportMode;
  fromNodeId: string;
  toNodeId: string;
  geometry: GeoTransportLineString;
  lengthMeters?: number;
  networkLod: TransportNetworkLod;
  attributes: Record<string, string | number | boolean | null>;
  sourceMetadata: Record<string, string | number | boolean | null>;
  sourceFeatureIds?: string[];
};

export type GeoTransportNetworkPackageV1 = {
  schemaVersion: typeof TRANSPORT_NETWORK_SCHEMA_VERSION;
  packageId: string;
  contentHash: `sha256:${string}`;
  geoCountryId: string;
  mode: MapV2TransportMode;
  sourceStatus: TransportSourceStatus;
  projection: WebMercatorProjectionMeta;
  sourceManifest: MapSourceManifest;
  transformation: {
    processingVersion: string;
    projectionVersion: number;
    simplificationVersion: string;
    filtersApplied: string[];
    lodPolicyId: string;
    quantize: number;
  };
  nodes: GeoTransportNodeRecord[];
  edges: GeoTransportEdgeRecord[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    componentCount: number;
  };
  productionApproved: false;
};

export type CityTransportAccess = {
  geoCityId: string;
  mode: MapV2TransportMode;
  accessNodeIds: string[];
  status: CityTransportAccessStatus;
  notes?: string;
};

export type CountryCityTransportAccessPackageV1 = {
  schemaVersion: 1;
  packageId: string;
  contentHash: `sha256:${string}`;
  geoCountryId: string;
  accesses: CityTransportAccess[];
};

export type GeoInfrastructureRecord = {
  geoInfrastructureId: string;
  infrastructureType: string;
  geoCountryId: string;
  geoCityId?: string;
  coordinate?: GeoCoordinateWgs84;
  projected?: ProjectedWorldPoint;
  sourceMetadata: Record<string, string | number | boolean | null>;
  productionApproved: false;
};

export type IntermodalLinkDraft = {
  fromNodeId: string;
  toNodeId: string;
  hubInfrastructureId?: string;
  notes?: string;
};

export type CountryInfrastructurePackageV1 = {
  schemaVersion: 1;
  packageId: string;
  contentHash: `sha256:${string}`;
  geoCountryId: string;
  facilities: GeoInfrastructureRecord[];
  intermodalLinks: IntermodalLinkDraft[];
};

export type TransportModeManifestRow = {
  mode: MapV2TransportMode;
  source: string;
  license: string;
  status: TransportSourceStatus;
  qaAuthority: string;
  odblDerived: boolean;
  notes: string;
  packageFile: string;
};

export type CountryTransportManifestV1 = {
  schemaVersion: 1;
  packageId: string;
  contentHash: `sha256:${string}`;
  geoCountryId: string;
  layout: 'per-mode';
  processingVersion: string;
  modes: TransportModeManifestRow[];
  infrastructurePackageFile: string;
  cityAccessPackageFile: string;
  gameplaySeparation: {
    routesTs: 'gameplay-metadata-not-topology';
    mapRoadNetwork: 'legacy-png-aligned-not-geo';
  };
};

export const TRANSPORT_LOD_POLICY_ID = 'network-lod-subset-v1';

export function transportLodRank(lod: TransportNetworkLod): number {
  return TRANSPORT_NETWORK_LODS.indexOf(lod);
}

export function edgeVisibleAtLod(edgeLod: TransportNetworkLod, viewLod: TransportNetworkLod): boolean {
  return transportLodRank(edgeLod) <= transportLodRank(viewLod);
}

export function emptyPendingManifest(datasetType: MapSourceManifest['datasetType'], datasetId: string, notes: string): MapSourceManifest {
  return {
    policyVersion: 1,
    datasetId,
    datasetType,
    sourceName: 'unresolved',
    sourceURL: 'unresolved',
    license: 'unresolved',
    licenseURL: 'unresolved',
    sourceVersion: 'unresolved',
    retrievedAt: 'unresolved',
    sourceHash: 'unresolved',
    originalFormat: 'unresolved',
    processedFormat: 'GeoTransportNetworkPackageV1',
    processingVersion: TRANSPORT_PACKAGE_PROCESSING_VERSION,
    derivedFrom: [],
    attributionRequired: false,
    productionApproved: false,
    notes,
  };
}

export function osmPendingManifest(datasetType: MapSourceManifest['datasetType'], datasetId: string, notes: string): MapSourceManifest {
  return {
    policyVersion: 1,
    datasetId,
    datasetType,
    sourceName: 'OpenStreetMap (preprocessed extract; not ingested in Step 2D)',
    sourceURL: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL 1.0',
    licenseURL: 'https://opendatacommons.org/licenses/odbl/1-0/',
    sourceVersion: 'unresolved',
    retrievedAt: 'unresolved',
    sourceHash: 'unresolved',
    originalFormat: 'OSM PBF / GeoJSON extract',
    processedFormat: 'GeoTransportNetworkPackageV1',
    processingVersion: TRANSPORT_PACKAGE_PROCESSING_VERSION,
    derivedFrom: [],
    attributionRequired: true,
    productionApproved: false,
    notes,
  };
}

export const WEB_MERCATOR_TRANSPORT_PROJECTION = WEB_MERCATOR_PROJECTION_META;
