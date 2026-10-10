import type { MapSourceManifest } from '../../mapData/mapSourcePolicy';
import type { CityTransportAccess, GeoTransportNetworkPackageV1, TransportNetworkLod } from './transportNetwork';
import type { TransportStyleClass } from '../presentation/transportPaint';

export const TCDD_QA_STATUS = 'TCDD_QA_ONLY' as const;

export type RailIngestStatsSnapshot = {
  rawFeatureCount: number;
  acceptedFeatureCount: number;
  rejectedFeatureCount: number;
  rejectedByReason: Record<string, number>;
  railwayClassCounts: Record<string, number>;
  nodeCount: number;
  edgeCount: number;
  stationCount: number;
  haltCount: number;
  junctionCount: number;
  terminalCount: number;
  associatedStations: number;
  unassociatedStations: number;
  verticesBeforeSimplify: number;
  verticesAfterSimplify: number;
  edgesLow: number;
  edgesMedium: number;
  edgesHigh: number;
  identityOsmId: number;
  identityGeomFallback: number;
  trueDuplicateSegmentsMerged: number;
  parallelSegmentsPreserved: number;
  collapsedSegmentsSkipped: number;
  zeroLengthSegmentsSkipped: number;
  borderCrossingNodes: number;
  isolatedNodeCount: number;
  largestComponentNodes: number;
};

export type RailRuntimeManifestV1 = {
  schemaVersion: 1;
  packageId: string;
  contentHash: `sha256:${string}`;
  geoCountryId: string;
  mode: 'RAIL';
  sourceStatus: 'PROTOTYPE';
  sourcePackageFile: string;
  debugPackageFile: string;
  sourcePackageHash: `sha256:${string}`;
  sourceManifest: MapSourceManifest;
  transformation: GeoTransportNetworkPackageV1['transformation'];
  stats: RailIngestStatsSnapshot;
  connectivity: {
    nodeCount: number;
    edgeCount: number;
    componentCount: number;
    isolatedNodeCount: number;
    largestComponentNodes: number;
    stationComponentCount: number;
  };
  cityAccess: CityTransportAccess[];
  tcddQa: {
    status: typeof TCDD_QA_STATUS;
    corridors: Array<{
      id: string;
      expected: string;
      osmSameComponent: boolean | null;
      cityAStatus: string;
      cityBStatus: string;
      note: string;
    }>;
    notes: string[];
  };
  productionApproved: false;
};

export type RailDebugEdge = {
  edgeId: string;
  networkLod: TransportNetworkLod;
  styleClass: TransportStyleClass;
  projectedQuantized: number[];
};

export type RailDebugStation = {
  nodeId: string;
  kind: string;
  x: number;
  y: number;
  name: string | null;
  associated: boolean;
};

export type RailConnectivityQaV1 = {
  schemaVersion: 1;
  packageId: string;
  contentHash?: `sha256:${string}`;
  sourcePackageHash: string;
  componentCount: number;
  largestComponent: { componentId: string; nodeCount: number; edgeCount: number; regionHint: string } | null;
  nearBreakCounts: Record<string, number>;
  stationOrphans: number;
  stationClasses?: { attachedExact: number; provisionalNearEdge: number; unresolved: number };
  cityAccessAudit: Array<{
    legacyCityId: string;
    geoCityId: string;
    status: string;
    componentId: string | null;
    componentSize: number;
    candidateKind: string | null;
  }>;
  corridors: Array<{ id: string; sameComponent: boolean }>;
  issues: Array<{ id: string; type: string; sourceEvidence: string; resolutionStatus: string }>;
  notes: string[];
};

export type RailDebugViewV1 = {
  schemaVersion: 1;
  packageId: string;
  contentHash: `sha256:${string}`;
  sourcePackageHash: `sha256:${string}`;
  geoCountryId: 'country.tur';
  mode: 'RAIL';
  quantize: number;
  edges: RailDebugEdge[];
  stations: RailDebugStation[];
  cityAccess: Array<{
    geoCityId: string;
    gameplayCityId?: string;
    status: CityTransportAccess['status'];
    x?: number;
    y?: number;
  }>;
};
