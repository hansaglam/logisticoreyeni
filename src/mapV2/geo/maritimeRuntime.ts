import type { MapSourceManifest } from '../../mapData/mapSourcePolicy';
import type { MaritimeChannelId, MaritimeRegionId, PortSeaAccessFailureReason } from './maritimeNavigability';

export type MaritimeSmokeTest = {
  id: string;
  fromPortId: string;
  toPortId: string;
  ok: boolean;
  meters: number | null;
  nodeCount: number | null;
  channels: MaritimeChannelId[];
  requiredChannels: MaritimeChannelId[];
  notes: string;
};

export type SeaRuntimeManifestV1 = {
  schemaVersion: 1;
  packageId: 'map-v2.country.tur.transport.sea.runtime.v1';
  geoCountryId: 'country.tur';
  mode: 'SEA';
  sourceStatus: 'PROTOTYPE';
  sourcePackageFile: 'turkey-sea-network.json';
  debugPackageFile: 'turkey-sea-debug.json';
  sourcePackageHash: `sha256:${string}`;
  contentHash: `sha256:${string}`;
  sourceManifest: MapSourceManifest;
  graphPolicyVersion: string;
  landMaskVersion: string;
  processingVersion: string;
    stats: {
      nodeCount: number;
      edgeCount: number;
      componentCount: number;
      channelNodeCount: number;
      coarseNodeCount: number;
      approachNodeCount?: number;
      bosphorusNodeCount: number;
      dardanellesNodeCount: number;
    };
  regions: MaritimeRegionId[];
  channels: MaritimeChannelId[];
  seaAccess: {
    logisticsEvaluated: number;
    resolved: number;
    unresolved: number;
    failureReasons: Record<PortSeaAccessFailureReason, number>;
  };
  smokeTests: MaritimeSmokeTest[];
  productionApproved: false;
};

export type SeaDebugEdge = {
  edgeId: string;
  channel: MaritimeChannelId | null;
  layer: 'TRUNK' | 'APPROACH' | 'CHANNEL';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type SeaDebugViewV1 = {
  schemaVersion: 1;
  packageId: 'map-v2.country.tur.transport.sea.debug.v1';
  edges: SeaDebugEdge[];
  smokePaths: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
};
